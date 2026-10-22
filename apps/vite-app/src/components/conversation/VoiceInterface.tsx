/**
 * 语音对话核心组件。
 * 管理 LiveKit 房间连接和语音交互界面。
 * Phase 2: 对话结束后展示发音评估和技能树。
 * Phase 4: 左右分栏布局 — 左侧语音状态+回答推荐，右侧微信风格聊天流。
 *          增加防拦截连接异常提示（1Password / 去广告插件 / 代理路由）。
 * Phase 5: DataChannel 错误拦截 — 自定义轨 fail-fast 错误通过 agent_error topic 接收，
 *          显示红色错误卡片并阻止自动重连。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useVoiceAssistant,
  useDataChannel,
  useRoomContext,
  BarVisualizer,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionState, DisconnectReason } from "livekit-client";
import { useConversationStore } from "@/store/conversation";
import { useAssessmentStore } from "@/store/assessment";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import { dispatchAgent } from "@/lib/api";
import { getAuthSnapshot, getAuthRevision, arePrincipalsEqual } from "@/lib/auth";
import { PronunciationFeedback } from "@/components/pronunciation/PronunciationFeedback";
import { SkillTree } from "@/components/learning/SkillTree";
import { AnswerRecommendations } from "@/components/learning/AnswerRecommendations";
import { ChatSubtitles } from "@/components/conversation/ChatSubtitles";
import { zhCN } from "@/i18n/zh-CN";
import { getLiveKitWsUrl } from "@/platform";

const tConv = zhCN.conversation;
const tAssess = zhCN.assessment;
const tDash = zhCN.dashboard;
const tWarn = zhCN.connectionWarning;
const tAgentErr = zhCN.agentError;

/** 同步停止指定 Room 拥有的全部本地音轨（不等待网络 disconnect） */
export function stopRoomLocalTracks(
  room?: {
    localParticipant?: {
      trackPublications?: Map<unknown, { track?: { stop?: () => void } }>;
    };
  } | null,
) {
  if (!room?.localParticipant?.trackPublications) return;
  try {
    room.localParticipant.trackPublications.forEach((pub) => {
      try {
        pub?.track?.stop?.();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

type TrackHolderRoom = Parameters<typeof stopRoomLocalTracks>[0];

/** 主入口：根据 connectionState 渲染不同视图 */
export function VoiceInterface() {
  const { connectionState, sessionId, token, wsUrl, error, goHome, sessionGen } =
    useConversationStore();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);

  const mountedSessionId = sessionId;
  const mountedGen = sessionGen;
  const isMountedRef = useRef(true);
  const roomRef = useRef<TrackHolderRoom | null>(null);
  const dispatchedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopRoomLocalTracks(roomRef.current);
    };
  }, []);

  // idle 状态不应在 session 视图出现，作为安全回退
  if (connectionState === "idle") {
    return (
      <div className="flex flex-col items-center gap-6 py-12">
        {error && (
          <div className="bg-danger-bg text-danger-text w-full max-w-sm rounded-lg p-4 text-center text-sm">
            <p className="font-medium">{tConv.errorTitle}</p>
            <p>{error}</p>
          </div>
        )}
        <button onClick={goHome} className="btn-primary px-8 py-3 text-lg">
          {tDash.goHome}
        </button>
      </div>
    );
  }

  if (connectionState === "checking_health" || (connectionState === "connecting" && !token)) {
    return <ConnectingView />;
  }

  if (connectionState === "ending") {
    return <EndingView />;
  }

  if (connectionState === "end_failed") {
    return <EndFailedView />;
  }

  if (connectionState === "ended") {
    return <EndedView />;
  }

  if (connectionState === "dispatch_failed") {
    return <DispatchFailedView />;
  }

  // 严格安全门禁：除 connecting/active 且 token 存在外，绝不挂载 LiveKitRoom
  if ((connectionState !== "connecting" && connectionState !== "active") || !token) {
    return <ConnectingView />;
  }

  // connecting（有 token）或 active 状态：解析并渲染 LiveKit 房间
  const effectiveWsUrl = getLiveKitWsUrl({ tokenWsUrl: wsUrl });

  // 若 effectiveWsUrl 为空（如原生强制代理但未配置有效 Host），直接展示错误卡片
  if (!effectiveWsUrl) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <div className="bg-danger-bg text-danger-text w-full max-w-sm rounded-[20px] p-6 text-center text-sm">
          <p className="font-semibold">{tConv.errorTitle}</p>
          <p className="mt-1">
            无法获取有效的 WebSocket 服务器地址，请检查 VITE_API_BASE_URL 配置。
          </p>
        </div>
        <button onClick={goHome} className="btn-primary px-6 py-2.5">
          {tDash.goHome}
        </button>
      </div>
    );
  }

  return (
    <>
      {/* 防拦截警告 Toast */}
      {showWarning && (
        <ConnectionWarningToast
          error={connectionError}
          onDismiss={() => setShowWarning(false)}
          onRetry={() => {
            setShowWarning(false);
            setConnectionError(null);
            window.location.reload();
          }}
        />
      )}

      <LiveKitRoom
        key={`lk-room-${mountedGen}-${mountedSessionId ?? "none"}`}
        serverUrl={effectiveWsUrl ?? undefined}
        token={token ?? undefined}
        connect={true}
        audio={true}
        video={false}
        onConnected={() => {
          const current = useConversationStore.getState();
          // 代际/SessionId 检查与状态防守：旧 Room 回调或过期 Session 不 dispatchAgent
          if (
            current.sessionGen !== mountedGen ||
            current.sessionId !== mountedSessionId ||
            (current.connectionState !== "connecting" && current.connectionState !== "active") ||
            !mountedSessionId ||
            !current.token
          ) {
            return;
          }

          // 组件存活检查
          if (!isMountedRef.current) {
            return;
          }

          // 去重检查：当前 sessionId/sessionGen 最多发送一次 dispatch POST
          const dispatchKey = `${mountedGen}:${mountedSessionId}`;
          if (dispatchedKeyRef.current === dispatchKey) {
            return;
          }

          // 核心门禁 (DSP-01)：在触发任何可能引起外部订阅者同步回调的动作之前，先捕获请求来源精确认证快照与 revision
          const authSnap = getAuthSnapshot();
          if (authSnap.state !== "authenticated" || !authSnap.principal) {
            stopRoomLocalTracks(roomRef.current);
            current.failDispatch(mountedSessionId, mountedGen);
            return;
          }
          const reqPrincipal = authSnap.principal;
          const reqRevision = getAuthRevision();

          // 记录本地 ref 并同步标记 store（注意：markDispatched 是同步 set，会同步触发所有 store 订阅者）
          dispatchedKeyRef.current = dispatchKey;
          if (!current.markDispatched(mountedSessionId, mountedGen)) {
            return;
          }

          // 核心门禁 (DSP-01)：在 markDispatched 同步触发订阅者之后，必须重新核验同步可重入边界：
          // 1. 组件是否依然存活
          if (!isMountedRef.current) {
            return;
          }

          // 2. 当前 session/gen/state/token 是否依然一致且有效
          const afterSetState = useConversationStore.getState();
          if (
            afterSetState.sessionGen !== mountedGen ||
            afterSetState.sessionId !== mountedSessionId ||
            (afterSetState.connectionState !== "connecting" &&
              afterSetState.connectionState !== "active") ||
            !afterSetState.token
          ) {
            return;
          }

          // 3. 原始认证快照与 revision 是否在 markDispatched 期间保持一致（防篡改/换人/同 principal 新 revision 冒充旧连接来源）
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

          setConnectionError(null);
          setShowWarning(false);

          dispatchAgent(mountedSessionId)
            .then((res) => {
              // 门禁核对：组件存活
              if (!isMountedRef.current) return;

              // 门禁核对：sessionId 与 sessionGen 归属
              const latest = useConversationStore.getState();
              if (latest.sessionGen !== mountedGen || latest.sessionId !== mountedSessionId) {
                return;
              }

              // 门禁核对：连接状态仍为 connecting 或 active
              if (latest.connectionState !== "connecting" && latest.connectionState !== "active") {
                return;
              }

              // 门禁核对：来源认证严格一致
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

              // 响应格式核验：API 成功仅接受对象且 dispatched 严格 true
              const isDispatchedSuccess =
                res !== null &&
                typeof res === "object" &&
                !Array.isArray(res) &&
                "dispatched" in res &&
                (res as { dispatched: unknown }).dispatched === true;

              if (!isDispatchedSuccess) {
                stopRoomLocalTracks(roomRef.current);
                latest.failDispatch(mountedSessionId, mountedGen);
                return;
              }

              // 成功维持原界面，无需额外操作
            })
            .catch(() => {
              // 门禁核对：组件存活
              if (!isMountedRef.current) return;

              // 门禁核对：sessionId 与 sessionGen 归属
              const latest = useConversationStore.getState();
              if (latest.sessionGen !== mountedGen || latest.sessionId !== mountedSessionId) {
                return;
              }

              // 门禁核对：连接状态仍为 connecting 或 active
              if (latest.connectionState !== "connecting" && latest.connectionState !== "active") {
                return;
              }

              // 门禁核对：来源认证严格一致
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

              // P2 安全固定日志：避免异常内容回显或日志泄漏 Token
              console.error("Agent dispatch failed");
              stopRoomLocalTracks(roomRef.current);
              latest.failDispatch(mountedSessionId, mountedGen);
            });
        }}
        onError={(error) => {
          const current = useConversationStore.getState();
          // 旧 Room 实例的错误不污染当前新会话
          if (current.sessionGen !== mountedGen || current.sessionId !== mountedSessionId) {
            return;
          }
          console.error("LiveKit connection error:", error);
          setConnectionError(error.message);
          setShowWarning(true);
        }}
        onDisconnected={(reason) => {
          const current = useConversationStore.getState();
          // 旧 Room 实例的断开不污染当前新会话
          if (current.sessionGen !== mountedGen || current.sessionId !== mountedSessionId) {
            return;
          }
          console.log("LiveKit disconnected:", reason);
          // Agent 错误已通过 DataChannel 处理，跳过重复警告
          if (useConversationStore.getState().agentError) return;
          // 非正常断开（如被插件拦截）时显示警告
          if (reason !== undefined && reason !== DisconnectReason.CLIENT_INITIATED) {
            setConnectionError(String(reason));
            setShowWarning(true);
          }
        }}
        data-lk-theme="default"
        className="flex min-h-[60vh] flex-col"
      >
        <RoomContextSync
          onRoom={(r) => {
            roomRef.current = r;
          }}
        />
        <ActiveView />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </>
  );
}

/** 内部组件：同步 Room 上下文引用供本地音轨主动 stop */
function RoomContextSync({ onRoom }: { onRoom: (room: TrackHolderRoom | null) => void }) {
  const room = useRoomContext();
  useEffect(() => {
    onRoom(room);
    return () => {
      onRoom(null);
    };
  }, [room, onRoom]);
  return null;
}

/** 调度失败视图：AI 服务启动未确认，音频已停止 */
function DispatchFailedView() {
  const goHome = useConversationStore((s) => s.goHome);

  return (
    <div className="flex flex-col items-center gap-6 py-8" data-testid="dispatch-failed-view">
      <div className="border-danger-border bg-danger-bg w-full max-w-md rounded-[20px] border p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <svg className="text-danger h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-danger-text text-base font-semibold">
              {tConv.dispatchFailedTitle}
            </h3>
            <p className="text-danger-text mt-1 text-sm leading-relaxed">
              {tConv.dispatchFailedMessage}
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-4">
        <button onClick={goHome} className="btn-primary px-6 py-2.5 text-sm font-medium">
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 连接中视图：loading 状态 */
function ConnectingView() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="border-accent h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" />
      <p className="text-text-muted">{tConv.connecting}</p>
    </div>
  );
}

/** 结束中视图：卸载房间后的即时状态展示 */
function EndingView() {
  const goHome = useConversationStore((s) => s.goHome);
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center" data-testid="ending-view">
      <div className="border-accent h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" />
      <h3 className="text-text-default text-lg font-semibold">{tConv.ending}</h3>
      <p className="text-text-muted text-sm">{tConv.endingHint}</p>
      <button onClick={goHome} className="btn-secondary mt-4 px-6 py-2 text-sm">
        {tDash.goHome}
      </button>
    </div>
  );
}

/** 结束失败视图：音频已停止，待重试 */
function EndFailedView() {
  const endSession = useConversationStore((s) => s.endSession);
  const goHome = useConversationStore((s) => s.goHome);
  const error = useConversationStore((s) => s.error);

  return (
    <div className="flex flex-col items-center gap-6 py-8" data-testid="end-failed-view">
      <div className="border-danger-border bg-danger-bg w-full max-w-md rounded-[20px] border p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <svg className="text-danger h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-danger-text text-base font-semibold">{tConv.endFailedTitle}</h3>
            <p className="text-danger-text mt-1 text-sm leading-relaxed">
              {tConv.endFailedMessage}
            </p>
            {error && <p className="text-danger mt-2 font-mono text-xs">{error}</p>}
          </div>
        </div>
      </div>
      <div className="flex gap-4">
        <button onClick={endSession} className="btn-primary px-6 py-2.5 text-sm font-medium">
          {tConv.retryEndButton}
        </button>
        <button onClick={goHome} className="btn-secondary px-6 py-2.5 text-sm font-medium">
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 对话中视图：左右分栏布局 */
function ActiveView() {
  const connectionState = useConnectionState();
  const voiceAssistant = useVoiceAssistant();
  const room = useRoomContext();
  const { setActive, endSession, setAgentError, sessionId, sessionGen } = useConversationStore();
  const endError = useConversationStore((state) => state.error);

  // 同步停止当前 Room 拥有的本地音轨，不等待网络 disconnect 延迟
  const handleEnd = useCallback(() => {
    stopRoomLocalTracks(room);
    void endSession();
  }, [room, endSession]);

  // 组件卸载时（如由于代际变化或状态切出），主动同步停止该 Room 拥有的本地音轨
  useEffect(() => {
    return () => {
      stopRoomLocalTracks(room);
    };
  }, [room]);

  // Phase 5: 监听 agent_error DataChannel 消息（自定义轨 fail-fast）
  useDataChannel("agent_error", (msg) => {
    try {
      const text = new TextDecoder().decode(msg.payload);
      const parsed = JSON.parse(text);
      if (parsed.type === "agent_error" && parsed.code && parsed.message) {
        console.error("Agent error received via DataChannel:", parsed);
        setAgentError({ code: parsed.code, message: parsed.message });
      }
    } catch {
      // 格式异常的消息，忽略
    }
  });

  // LiveKit 连接成功后，将 store 状态切换到 active（附带 session/代际保护）
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      setActive(sessionId ?? undefined, sessionGen);
    }
  }, [connectionState, setActive, sessionId, sessionGen]);

  // 连接中
  if (connectionState !== ConnectionState.Connected) {
    return <ConnectingView />;
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6 p-4 lg:flex-row">
      {/* ===== 左侧：语音状态 + 回答推荐 ===== */}
      <div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
        {/* 语音可视化 + 状态 */}
        <div className="border-border-default bg-surface rounded-[20px] border p-4 shadow-[0_6px_22px_-14px_var(--card-shadow)]">
          <div className="mb-4 h-24 w-full">
            {voiceAssistant.audioTrack && (
              <BarVisualizer
                state={voiceAssistant.state}
                trackRef={voiceAssistant.audioTrack}
                barCount={7}
                className="h-full w-full"
              />
            )}
          </div>

          {/* Agent 状态文案 */}
          <AgentStatusText state={voiceAssistant.state} />

          {/* 控制栏 */}
          <div className="mt-3">
            <VoiceAssistantControlBar controls={{ leave: false }} />
          </div>

          {/* 结束对话按钮 */}
          <button
            onClick={handleEnd}
            className="bg-danger hover:bg-danger-hover focus-visible:ring-danger mt-3 w-full rounded-[14px] px-6 py-2 text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {tConv.endButton}
          </button>
          {endError ? <p className="text-danger mt-2 text-sm">{endError}</p> : null}
        </div>

        {/* 回答推荐面板（固定在左下） */}
        <AnswerRecommendations />
      </div>

      {/* ===== 右侧：微信风格聊天流 ===== */}
      <div className="min-h-[50vh] flex-1 lg:min-h-0">
        <ChatSubtitles />
      </div>
    </div>
  );
}

/** Agent 状态文案 */
function AgentStatusText({ state }: { state: string }) {
  const text = (() => {
    switch (state) {
      case "listening":
        return tConv.listening;
      case "thinking":
        return tConv.connecting;
      case "speaking":
        return tConv.speaking;
      default:
        return tConv.idle;
    }
  })();

  return <p className="text-text-muted text-center text-sm font-medium">{text}</p>;
}

/** 防拦截连接警告 Toast */
function ConnectionWarningToast({
  error,
  onDismiss,
  onRetry,
}: {
  error: string | null;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-x-0 top-4 z-50 mx-auto max-w-lg animate-[slideDown_0.3s_ease-out] px-4">
      <div className="border-warning-border bg-warning-bg rounded-[20px] border p-4 shadow-lg">
        <div className="flex items-start gap-3">
          {/* 警告图标 */}
          <div className="mt-0.5 shrink-0">
            <svg className="text-warning-bar h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h4 className="text-warning text-sm font-semibold">{tWarn.title}</h4>
            <p className="text-warning mt-1 text-xs leading-relaxed">{tWarn.message}</p>
            {error && <p className="text-warning mt-1 font-mono text-xs">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={onRetry}
                className="bg-warning-bg text-warning border-warning-border hover:bg-warning-border rounded-md border px-3 py-1 text-xs font-medium transition-colors"
              >
                {tWarn.retry}
              </button>
              <button
                onClick={onDismiss}
                className="border-warning-border text-warning hover:bg-warning-bg rounded-md border px-3 py-1 text-xs font-medium transition-colors"
              >
                {tWarn.dismiss}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 正在分析视图 */
function AnalyzingView({ state }: { state: "pending" | "running" }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      <p className="text-text-muted">{state === "pending" ? tAssess.pending : tAssess.analyzing}</p>
      <p className="text-text-faint text-sm">
        {state === "pending" ? tAssess.pendingHint : tAssess.analyzingHint}
      </p>
    </div>
  );
}

/** 加载失败视图 */
function AssessmentErrorView({
  failed,
  errorCode,
  retryable,
  onRetry,
}: {
  failed: boolean;
  errorCode: string | null;
  retryable: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="bg-danger-bg rounded-lg p-4 text-center">
      <p className="text-danger text-sm">
        {failed
          ? errorCode === "analysis_unsupported"
            ? tAssess.unsupported
            : tAssess.failed
          : tAssess.loadError}
      </p>
      {failed && retryable ? (
        <button onClick={onRetry} className="btn-primary mt-3 px-4 py-2 text-sm">
          {tAssess.retry}
        </button>
      ) : null}
    </div>
  );
}

/** 已结束视图：展示评估结果和技能树，或 Agent 错误卡片 */
function EndedView() {
  const sessionId = useConversationStore((s) => s.sessionId);
  const goHome = useConversationStore((s) => s.goHome);
  const agentError = useConversationStore((s) => s.agentError);
  const {
    assessment,
    grammarErrors,
    knowledgeStates,
    reset: resetAssessment,
    retryFailedAnalysis,
    job,
  } = useAssessmentStore();

  // 启动轮询（仅在非 Agent 错误且存在 sessionId 时）
  const loadState = usePollingAssessment(agentError || !sessionId ? null : sessionId);

  const handleGoHome = useCallback(() => {
    resetAssessment();
    goHome();
  }, [resetAssessment, goHome]);

  const handleRetry = useCallback(() => {
    if (sessionId) void retryFailedAnalysis(sessionId);
  }, [retryFailedAnalysis, sessionId]);

  // 无 ID 在途取消（在 health/create 返回前取消）：展示本地已取消/服务端状态未知，不启动分析
  if (!sessionId) {
    return (
      <div className="flex flex-col items-center gap-6 py-8" data-testid="cancelled-local-view">
        <div className="text-center">
          <h2 className="text-text-default mb-2 text-2xl font-bold">
            {tConv.cancelledBeforeStartTitle}
          </h2>
          <p className="text-text-muted text-sm leading-relaxed">
            {tConv.cancelledBeforeStartMessage}
          </p>
        </div>
        <button
          onClick={handleGoHome}
          className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
        >
          {tDash.goHome}
        </button>
      </div>
    );
  }

  // Agent 错误：显示红色错误卡片
  if (agentError) {
    return (
      <div className="flex flex-col items-center gap-6 py-8">
        <div className="border-danger-border bg-danger-bg w-full max-w-sm rounded-[20px] border p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <svg className="text-danger h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-danger-text text-sm font-semibold">{tAgentErr.title}</h3>
              <p className="text-danger-text mt-1 text-sm leading-relaxed">{agentError.message}</p>
              <p className="text-danger mt-0.5 font-mono text-xs">{agentError.code}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleGoHome} className="btn-primary px-6 py-2.5">
            {tAgentErr.goHome}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {/* 标题 */}
      <div className="text-center">
        <h2 className="text-text-default mb-2 text-2xl font-bold">{tConv.ended}</h2>
      </div>

      {/* 评估内容 */}
      {(loadState === "pending" || loadState === "running") && <AnalyzingView state={loadState} />}
      {(loadState === "failed" || loadState === "error") && (
        <AssessmentErrorView
          failed={loadState === "failed"}
          errorCode={job?.error_code ?? null}
          retryable={job?.retryable ?? false}
          onRetry={handleRetry}
        />
      )}
      {loadState === "loaded" && assessment && (
        <div className="w-full max-w-md space-y-8">
          <PronunciationFeedback assessment={assessment} grammarErrors={grammarErrors} />
          {knowledgeStates.length > 0 && (
            <div>
              <h3 className="text-text-default mb-3 text-lg font-semibold">
                {tAssess.skillTreeTitle}
              </h3>
              <SkillTree states={knowledgeStates} />
            </div>
          )}
        </div>
      )}

      {/* 返回主页按钮 */}
      <button
        onClick={handleGoHome}
        className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
      >
        {tDash.goHome}
      </button>
    </div>
  );
}
