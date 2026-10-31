import React, { useEffect, useLayoutEffect, useRef } from "react";
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { dispatchAgent } from "@/lib/api";
import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
} from "@/lib/auth";
import type { AuthPrincipal } from "@/lib/auth";
import { logDiagnostic } from "@/lib/diagnostics";
import { createLifecycleAdapter, detectPlatform, getLiveKitWsUrl } from "@/platform";
import { useConversationStore } from "@/store/conversation";
import { hasRoomConnection } from "@/store/conversationState";
import { ActiveConversation } from "./ActiveConversation";
import { ConnectingView, RoomUnavailableView } from "./ConversationStatusViews";
import { stopRoomLocalTracks, type TrackHolderRoom } from "./roomAudio";

interface RoomSessionProps {
  sessionId: string;
  sessionGen: number;
  token: string;
  wsUrl: string;
}

/** 绑定单个 sessionGen/sessionId 的 LiveKit 资源、生命周期与调度所有权。 */
export function RoomSession({ sessionId, sessionGen, token, wsUrl }: RoomSessionProps) {
  const isMountedRef = useRef(true);
  const roomRef = useRef<TrackHolderRoom | null>(null);
  const dispatchedKeyRef = useRef<string | null>(null);

  // 绑定进入该会话时的认证快照与 revision，防重渲染修改身份
  const boundPrincipalRef = useRef<AuthPrincipal | null>(null);
  const boundRevisionRef = useRef<number>(0);
  const isInitializedAuth = useRef(false);

  if (!isInitializedAuth.current) {
    isInitializedAuth.current = true;
    boundPrincipalRef.current = getAuthSnapshot().principal;
    boundRevisionRef.current = getAuthRevision();
  }

  const boundPrincipal = boundPrincipalRef.current;
  const boundRevision = boundRevisionRef.current;

  // iOS 原生 App 容器使用异步 native 门禁，Web / Tauri 无需额外等待
  const isNative = detectPlatform() === "ios";

  // 原生首次注册/状态 pending 期间不得挂载 audio=true 的 LiveKitRoom
  const [isNativeReady, setIsNativeReady] = React.useState(!isNative);

  // 初次进入已有 Token 的 Room 前进行 Web 快照检查
  const initialSnap = !isNative ? createLifecycleAdapter().getSnapshot() : null;
  const isInitialBlocked =
    !isNative &&
    initialSnap !== null &&
    (initialSnap.visibility === "hidden" || initialSnap.online === false);

  useEffect(() => {
    isMountedRef.current = true;
    let isActive = true;

    const adapter = createLifecycleAdapter();
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    // 原生 inactive、Web hidden/suspend、offline 必须同步停轨后再失败关闭
    const handleLifecycleEvent = (event: {
      type: string;
      snapshot: { visibility: string; online: boolean | null };
    }) => {
      if (!isActive) return;

      if (
        event.type === "suspend" ||
        event.snapshot.visibility === "hidden" ||
        event.snapshot.online === false
      ) {
        const current = useConversationStore.getState();
        if (current.sessionGen !== sessionGen || current.sessionId !== sessionId) {
          return;
        }
        if (!hasRoomConnection(current)) {
          return;
        }
        const currentAuth = getAuthSnapshot();
        const currentRev = getAuthRevision();
        if (
          currentAuth.state !== "authenticated" ||
          !currentAuth.principal ||
          !arePrincipalsEqual(currentAuth.principal, boundPrincipal) ||
          currentRev !== boundRevision
        ) {
          return;
        }

        logDiagnostic("lifecycle_audio_interrupted");
        stopRoomLocalTracks(roomRef.current);
        current.failConnection(sessionId, sessionGen);
      }
    };

    // subscribe-before-snapshot：消除就绪到 Room 挂载/roomRef 绑定/订阅的空窗
    const unsubscribe = adapter.subscribe(handleLifecycleEvent);

    // ROOM-01: 监听认证快照，认证 revision 或 principal 变化立即作废计时器
    const unsubAuth = subscribeAuthSnapshot((snap) => {
      if (!isActive) return;
      if (
        snap.state !== "authenticated" ||
        !snap.principal ||
        !arePrincipalsEqual(snap.principal, boundPrincipal) ||
        getAuthRevision() !== boundRevision
      ) {
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
      }
    });

    if (isNative) {
      // 原生 pending 最多 10 秒后 failConnection、清 token 及资源
      pendingTimer = setTimeout(() => {
        if (!isActive) return;
        const current = useConversationStore.getState();
        if (current.sessionGen !== sessionGen || current.sessionId !== sessionId) {
          return;
        }
        if (!hasRoomConnection(current)) {
          return;
        }

        const currentAuth = getAuthSnapshot();
        const currentRev = getAuthRevision();
        if (
          currentAuth.state !== "authenticated" ||
          !currentAuth.principal ||
          !arePrincipalsEqual(currentAuth.principal, boundPrincipal) ||
          currentRev !== boundRevision
        ) {
          return;
        }

        logDiagnostic("native_lifecycle_ready_timeout");
        stopRoomLocalTracks(roomRef.current);
        current.failConnection(sessionId, sessionGen);
      }, 10000);

      adapter.whenReady().then(() => {
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        if (!isActive) return;

        // 原生 whenReady 后重新核验 snapshot/auth/gen/token/state 才能挂载
        const current = useConversationStore.getState();
        if (
          current.sessionGen !== sessionGen ||
          current.sessionId !== sessionId ||
          !hasRoomConnection(current)
        ) {
          return;
        }

        const currentAuth = getAuthSnapshot();
        const currentRev = getAuthRevision();
        if (
          currentAuth.state !== "authenticated" ||
          !currentAuth.principal ||
          !arePrincipalsEqual(currentAuth.principal, boundPrincipal) ||
          currentRev !== boundRevision
        ) {
          return;
        }

        const snap = adapter.getSnapshot();
        if (
          !adapter.capabilities.nativeAppState ||
          snap.visibility === "hidden" ||
          snap.online === false
        ) {
          stopRoomLocalTracks(roomRef.current);
          current.failConnection(sessionId, sessionGen);
          return;
        }

        setIsNativeReady(true);
      });
    } else {
      // Web / Tauri: 订阅后立即读取当前快照 (CON-04)
      const snap = adapter.getSnapshot();
      if (snap.visibility === "hidden" || snap.online === false) {
        handleLifecycleEvent({
          type: snap.visibility === "hidden" ? "suspend" : "connectivity",
          snapshot: snap,
        });
      }
    }

    return () => {
      isActive = false;
      isMountedRef.current = false;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      unsubAuth();
      unsubscribe();
      adapter.dispose();
      stopRoomLocalTracks(roomRef.current);
    };
  }, [sessionId, sessionGen, isNative, boundPrincipal, boundRevision]);

  if (isInitialBlocked) {
    return <InitialBlockedHandler sessionId={sessionId} sessionGen={sessionGen} />;
  }

  if (isNative && !isNativeReady) {
    return <ConnectingView />;
  }

  const effectiveWsUrl = getLiveKitWsUrl({ tokenWsUrl: wsUrl });
  if (!effectiveWsUrl) {
    return <RoomUnavailableView />;
  }

  return (
    <LiveKitRoom
      key={`lk-room-${sessionGen}-${sessionId}`}
      serverUrl={effectiveWsUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      onConnected={() => {
        const current = useConversationStore.getState();
        if (
          current.sessionGen !== sessionGen ||
          current.sessionId !== sessionId ||
          !hasRoomConnection(current)
        ) {
          return;
        }

        if (!isMountedRef.current) {
          return;
        }

        const dispatchKey = `${sessionGen}:${sessionId}`;
        if (dispatchedKeyRef.current === dispatchKey) {
          return;
        }

        // DSP-01: 在同步 store 通知前捕获请求来源精确认证快照与 revision
        const authSnap = getAuthSnapshot();
        if (
          authSnap.state !== "authenticated" ||
          !authSnap.principal ||
          !arePrincipalsEqual(authSnap.principal, boundPrincipal) ||
          getAuthRevision() !== boundRevision
        ) {
          return;
        }
        const reqPrincipal = boundPrincipal;
        const reqRevision = boundRevision;

        dispatchedKeyRef.current = dispatchKey;
        if (!current.markDispatched(sessionId, sessionGen)) {
          return;
        }

        // markDispatched 同步触发订阅者后，重新核验全部可重入门禁
        if (!isMountedRef.current) {
          return;
        }

        const afterSetState = useConversationStore.getState();
        if (
          afterSetState.sessionGen !== sessionGen ||
          afterSetState.sessionId !== sessionId ||
          !hasRoomConnection(afterSetState)
        ) {
          return;
        }

        const afterSetAuth = getAuthSnapshot();
        const afterSetRev = getAuthRevision();
        if (
          afterSetAuth.state !== "authenticated" ||
          !afterSetAuth.principal ||
          !arePrincipalsEqual(afterSetAuth.principal, reqPrincipal) ||
          afterSetRev !== reqRevision
        ) {
          return;
        }

        dispatchAgent(sessionId)
          .then((res) => {
            if (!isMountedRef.current) return;

            const latest = useConversationStore.getState();
            if (latest.sessionGen !== sessionGen || latest.sessionId !== sessionId) {
              return;
            }
            if (!hasRoomConnection(latest)) {
              return;
            }

            const latestAuth = getAuthSnapshot();
            const latestRev = getAuthRevision();
            if (
              latestAuth.state !== "authenticated" ||
              !latestAuth.principal ||
              !arePrincipalsEqual(latestAuth.principal, reqPrincipal) ||
              latestRev !== reqRevision
            ) {
              return;
            }

            const isDispatchedSuccess =
              res !== null &&
              typeof res === "object" &&
              !Array.isArray(res) &&
              "dispatched" in res &&
              (res as { dispatched: unknown }).dispatched === true;

            if (!isDispatchedSuccess) {
              stopRoomLocalTracks(roomRef.current);
              latest.failDispatch(sessionId, sessionGen);
            }
          })
          .catch(() => {
            if (!isMountedRef.current) return;

            const latest = useConversationStore.getState();
            if (latest.sessionGen !== sessionGen || latest.sessionId !== sessionId) {
              return;
            }
            if (!hasRoomConnection(latest)) {
              return;
            }

            const latestAuth = getAuthSnapshot();
            const latestRev = getAuthRevision();
            if (
              latestAuth.state !== "authenticated" ||
              !latestAuth.principal ||
              !arePrincipalsEqual(latestAuth.principal, reqPrincipal) ||
              latestRev !== reqRevision
            ) {
              return;
            }

            logDiagnostic("agent_dispatch_failed");
            stopRoomLocalTracks(roomRef.current);
            latest.failDispatch(sessionId, sessionGen);
          });
      }}
      onError={() => {
        if (!isMountedRef.current) return;
        const current = useConversationStore.getState();
        if (current.sessionGen !== sessionGen || current.sessionId !== sessionId) {
          return;
        }
        if (!hasRoomConnection(current)) {
          return;
        }
        const currentAuth = getAuthSnapshot();
        const currentRev = getAuthRevision();
        if (
          currentAuth.state !== "authenticated" ||
          !currentAuth.principal ||
          !arePrincipalsEqual(currentAuth.principal, boundPrincipal) ||
          currentRev !== boundRevision
        ) {
          return;
        }

        logDiagnostic("livekit_connection_failed");
        stopRoomLocalTracks(roomRef.current);
        current.failConnection(sessionId, sessionGen);
      }}
      onDisconnected={() => {
        if (!isMountedRef.current) return;
        const current = useConversationStore.getState();
        if (current.sessionGen !== sessionGen || current.sessionId !== sessionId) {
          return;
        }
        if (!hasRoomConnection(current)) {
          return;
        }
        const currentAuth = getAuthSnapshot();
        const currentRev = getAuthRevision();
        if (
          currentAuth.state !== "authenticated" ||
          !currentAuth.principal ||
          !arePrincipalsEqual(currentAuth.principal, boundPrincipal) ||
          currentRev !== boundRevision
        ) {
          return;
        }

        logDiagnostic("livekit_disconnected");
        stopRoomLocalTracks(roomRef.current);
        current.failConnection(sessionId, sessionGen);
      }}
      data-lk-theme="default"
      className="flex min-h-[60vh] flex-col"
    >
      <RoomContextSync roomRef={roomRef} />
      <ActiveConversation boundPrincipal={boundPrincipal} boundRevision={boundRevision} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

/** 同步 Room 上下文引用，并在 Room 真正替换或退出时停止本地音轨。 */
function RoomContextSync({
  onRoom,
  roomRef,
}: {
  onRoom?: (room: TrackHolderRoom | null) => void;
  roomRef?: React.MutableRefObject<TrackHolderRoom | null>;
}) {
  const room = useRoomContext();
  const onRoomRef = useRef(onRoom);
  onRoomRef.current = onRoom;

  // ROOM-02: render 阶段同步绑定，消除 child 已提交但 passive effect 未运行的空窗
  if (roomRef) {
    roomRef.current = room;
  }

  // ROOM-03: 只依赖稳定的 room/roomRef，正常 store 重渲染不得触发 cleanup
  useLayoutEffect(() => {
    if (roomRef) {
      roomRef.current = room;
    }
    onRoomRef.current?.(room);
    return () => {
      stopRoomLocalTracks(room);
      if (roomRef && roomRef.current === room) {
        roomRef.current = null;
      }
      onRoomRef.current?.(null);
    };
  }, [room, roomRef]);

  return null;
}

/** 初次进入已有 Token 的 Room 时，若快照已 hidden/offline，立即失败关闭。 */
function InitialBlockedHandler({
  sessionId,
  sessionGen,
}: {
  sessionId: string;
  sessionGen: number;
}) {
  const failConnection = useConversationStore((state) => state.failConnection);

  useEffect(() => {
    failConnection(sessionId, sessionGen);
  }, [failConnection, sessionId, sessionGen]);

  return <ConnectingView />;
}
