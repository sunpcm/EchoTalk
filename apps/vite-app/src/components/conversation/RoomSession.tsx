import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { dispatchAgent } from "@/lib/api";
import { arePrincipalsEqual, getAuthSnapshot, subscribeAuthSnapshot } from "@/lib/auth";
import { logDiagnostic } from "@/lib/diagnostics";
import {
  createLifecycleAdapter,
  detectPlatform,
  getLiveKitWsUrl,
  type LifecycleAdapter,
  type WebLifecycleEvent,
} from "@/platform";
import { useConversationStore } from "@/store/conversation";
import { hasRoomConnection } from "@/store/conversationState";
import { ActiveConversation } from "./ActiveConversation";
import { ConnectingView, RoomUnavailableView } from "./ConversationStatusViews";
import { stopRoomLocalTracks, type TrackHolderRoom } from "./roomAudio";
import { useRoomAuthOwnership } from "./useRoomAuthOwnership";

interface RoomSessionProps {
  sessionId: string;
  sessionGen: number;
  token: string;
  wsUrl: string;
}

interface LifecycleSubscription {
  readonly revision: number;
  active: boolean;
  unsubscribe: () => void;
}

/** 绑定单个 sessionGen/sessionId 的 LiveKit 资源、生命周期与调度所有权。 */
export function RoomSession({ sessionId, sessionGen, token, wsUrl }: RoomSessionProps) {
  const isMountedRef = useRef(true);
  const roomRef = useRef<TrackHolderRoom | null>(null);
  const dispatchedKeyRef = useRef<string | null>(null);
  const lifecycleAdapterRef = useRef<LifecycleAdapter | null>(null);
  const lifecycleSubscriptionRef = useRef<LifecycleSubscription | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeadlineRef = useRef<number | null>(null);
  const nativeReadyCompletedRef = useRef(false);
  const nativeSettledRef = useRef(false);

  const { boundPrincipal, authorizedRevision, isCurrentRevision } = useRoomAuthOwnership();
  const latestAuthorizedRevisionRef = useRef(authorizedRevision);
  latestAuthorizedRevisionRef.current = authorizedRevision;

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

  const clearPendingTimer = useCallback((): void => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  const failOwnedConnection = useCallback(
    (revision: number | null, diagnostic?: string): boolean => {
      if (!isMountedRef.current || revision === null || !isCurrentRevision(revision)) {
        return false;
      }

      const current = useConversationStore.getState();
      if (
        current.sessionGen !== sessionGen ||
        current.sessionId !== sessionId ||
        !hasRoomConnection(current)
      ) {
        return false;
      }

      if (diagnostic) {
        logDiagnostic(diagnostic);
      }
      stopRoomLocalTracks(roomRef.current);
      current.failConnection(sessionId, sessionGen);
      return true;
    },
    [isCurrentRevision, sessionId, sessionGen],
  );

  const reconcileNativePendingRef = useRef<(revision: number | null) => void>(() => {});
  const reconcileNativePending = useCallback(
    (revision: number | null): void => {
      if (
        !isNative ||
        !isMountedRef.current ||
        revision === null ||
        nativeSettledRef.current ||
        !isCurrentRevision(revision)
      ) {
        return;
      }

      const current = useConversationStore.getState();
      if (
        current.sessionGen !== sessionGen ||
        current.sessionId !== sessionId ||
        !hasRoomConnection(current)
      ) {
        return;
      }

      const deadline = pendingDeadlineRef.current;
      if (deadline === null) {
        return;
      }

      clearPendingTimer();
      if (Date.now() >= deadline) {
        pendingDeadlineRef.current = null;
        nativeSettledRef.current = true;
        failOwnedConnection(revision, "native_lifecycle_ready_timeout");
        return;
      }

      if (nativeReadyCompletedRef.current) {
        const adapter = lifecycleAdapterRef.current;
        if (!adapter) {
          return;
        }

        const snap = adapter.getSnapshot();
        pendingDeadlineRef.current = null;
        nativeSettledRef.current = true;
        if (
          !adapter.capabilities.nativeAppState ||
          snap.visibility === "hidden" ||
          snap.online === false
        ) {
          failOwnedConnection(revision);
          return;
        }

        setIsNativeReady(true);
        return;
      }

      const timer = setTimeout(
        () => {
          // A stale callback may still be queued or invoked after rotation. It only owns the
          // pending handle it installed, so it cannot clear a newer revision's timer.
          if (pendingTimerRef.current !== timer) {
            return;
          }
          pendingTimerRef.current = null;
          reconcileNativePendingRef.current(revision);
        },
        Math.max(0, deadline - Date.now()),
      );
      pendingTimerRef.current = timer;
    },
    [clearPendingTimer, failOwnedConnection, isCurrentRevision, isNative, sessionId, sessionGen],
  );
  reconcileNativePendingRef.current = reconcileNativePending;

  useEffect(() => {
    isMountedRef.current = true;
    let isActive = true;

    const adapter = createLifecycleAdapter();
    lifecycleAdapterRef.current = adapter;
    nativeReadyCompletedRef.current = false;
    pendingDeadlineRef.current = isNative ? Date.now() + 10000 : null;
    nativeSettledRef.current = !isNative;

    // ROOM-01: principal 失效立即作废计时器；同 principal revision 更新保留原始 10s 预算
    const unsubAuth = subscribeAuthSnapshot((snap) => {
      if (!isActive) return;
      if (
        snap.state !== "authenticated" ||
        !snap.principal ||
        !boundPrincipal ||
        !arePrincipalsEqual(snap.principal, boundPrincipal)
      ) {
        clearPendingTimer();
        pendingDeadlineRef.current = null;
        nativeSettledRef.current = true;
      }
    });

    if (isNative) {
      adapter.whenReady().then(() => {
        if (!isActive) return;
        nativeReadyCompletedRef.current = true;
        reconcileNativePendingRef.current(latestAuthorizedRevisionRef.current);
      });
    }

    return () => {
      isActive = false;
      isMountedRef.current = false;
      clearPendingTimer();
      pendingDeadlineRef.current = null;
      nativeSettledRef.current = true;
      const subscription = lifecycleSubscriptionRef.current;
      if (subscription) {
        subscription.active = false;
        subscription.unsubscribe();
        lifecycleSubscriptionRef.current = null;
      }
      unsubAuth();
      adapter.dispose();
      if (lifecycleAdapterRef.current === adapter) {
        lifecycleAdapterRef.current = null;
      }
      stopRoomLocalTracks(roomRef.current);
    };
  }, [sessionId, sessionGen, isNative, boundPrincipal, clearPendingTimer]);

  useEffect(() => {
    if (isNative) {
      reconcileNativePending(authorizedRevision);
    }
  }, [authorizedRevision, isNative, reconcileNativePending]);

  // Each delivered auth receipt owns a fresh business listener. The physical adapter stays
  // stable, while any saved prior listener remains permanently invalid.
  useEffect(() => {
    const adapter = lifecycleAdapterRef.current;
    const previous = lifecycleSubscriptionRef.current;
    if (!adapter || authorizedRevision === null) {
      if (previous) {
        previous.active = false;
        previous.unsubscribe();
        lifecycleSubscriptionRef.current = null;
      }
      return;
    }

    const revision = authorizedRevision;
    const subscription: LifecycleSubscription = {
      revision,
      active: true,
      unsubscribe: () => {},
    };
    const handleLifecycleEvent = (event: WebLifecycleEvent): void => {
      if (!subscription.active || !isMountedRef.current || !isCurrentRevision(revision)) {
        return;
      }
      if (
        event.type === "suspend" ||
        event.snapshot.visibility === "hidden" ||
        event.snapshot.online === false
      ) {
        failOwnedConnection(revision, "lifecycle_audio_interrupted");
      }
    };

    // Subscribe-before-snapshot also applies after every auth receipt rotation.
    subscription.unsubscribe = adapter.subscribe(handleLifecycleEvent);
    lifecycleSubscriptionRef.current = subscription;
    if (previous) {
      previous.active = false;
      previous.unsubscribe();
    }

    const snap = adapter.getSnapshot();
    // The native adapter intentionally exposes hidden while registration/getState is pending.
    // That is an unready gate rather than a trusted background fact; whenReady reconciliation
    // settles it. Web snapshots and already-ready native snapshots remain fail-closed.
    const canEvaluateSnapshot = !isNative || adapter.capabilities.nativeAppState;
    if (canEvaluateSnapshot && (snap.visibility === "hidden" || snap.online === false)) {
      handleLifecycleEvent({
        type: snap.visibility === "hidden" ? "suspend" : "connectivity",
        snapshot: snap,
      });
    }

    return () => {
      subscription.active = false;
    };
  }, [authorizedRevision, failOwnedConnection, isCurrentRevision, isNative]);

  if (isInitialBlocked) {
    return (
      <InitialBlockedHandler
        sessionId={sessionId}
        sessionGen={sessionGen}
        authorizedRevision={authorizedRevision}
        isCurrentRevision={isCurrentRevision}
      />
    );
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
        const callbackRevision = authorizedRevision;
        if (callbackRevision === null || !isCurrentRevision(callbackRevision)) {
          return;
        }

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

        // DSP-01: 在同步 store 通知前捕获请求来源 principal 与 revision
        const reqPrincipal = boundPrincipal;
        const reqRevision = callbackRevision;

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
        if (
          !afterSetAuth.principal ||
          !arePrincipalsEqual(afterSetAuth.principal, reqPrincipal) ||
          !isCurrentRevision(reqRevision)
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
            if (
              !latestAuth.principal ||
              !arePrincipalsEqual(latestAuth.principal, reqPrincipal) ||
              !isCurrentRevision(reqRevision)
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
            if (
              !latestAuth.principal ||
              !arePrincipalsEqual(latestAuth.principal, reqPrincipal) ||
              !isCurrentRevision(reqRevision)
            ) {
              return;
            }

            logDiagnostic("agent_dispatch_failed");
            stopRoomLocalTracks(roomRef.current);
            latest.failDispatch(sessionId, sessionGen);
          });
      }}
      onError={() => {
        const callbackRevision = authorizedRevision;
        if (callbackRevision === null || !isCurrentRevision(callbackRevision)) {
          return;
        }
        if (!isMountedRef.current) return;
        const current = useConversationStore.getState();
        if (current.sessionGen !== sessionGen || current.sessionId !== sessionId) {
          return;
        }
        if (!hasRoomConnection(current)) {
          return;
        }

        logDiagnostic("livekit_connection_failed");
        stopRoomLocalTracks(roomRef.current);
        current.failConnection(sessionId, sessionGen);
      }}
      onDisconnected={() => {
        const callbackRevision = authorizedRevision;
        if (callbackRevision === null || !isCurrentRevision(callbackRevision)) {
          return;
        }
        if (!isMountedRef.current) return;
        const current = useConversationStore.getState();
        if (current.sessionGen !== sessionGen || current.sessionId !== sessionId) {
          return;
        }
        if (!hasRoomConnection(current)) {
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
      <ActiveConversation
        sessionId={sessionId}
        sessionGen={sessionGen}
        boundPrincipal={boundPrincipal}
        authorizedRevision={authorizedRevision}
      />
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
  authorizedRevision,
  isCurrentRevision,
}: {
  sessionId: string;
  sessionGen: number;
  authorizedRevision: number | null;
  isCurrentRevision: (revision: number | null) => boolean;
}) {
  const failConnection = useConversationStore((state) => state.failConnection);

  useEffect(() => {
    if (isCurrentRevision(authorizedRevision)) {
      failConnection(sessionId, sessionGen);
    }
  }, [authorizedRevision, failConnection, isCurrentRevision, sessionGen, sessionId]);

  return <ConnectingView />;
}
