import { ConnectionState } from "livekit-client";
import { useConversationStore } from "@/store/conversation";
import { useAppStore } from "@/store/appStore";
import { zhCN } from "@/i18n/zh-CN";
import "./SessionPracticeJournal.css";

const tConv = zhCN.conversation;
const tDash = zhCN.dashboard;

/** idle 状态不应在 session 视图出现，作为安全回退 */
export function IdleView() {
  const error = useConversationStore((state) => state.error);
  const goHome = useAppStore((state) => state.goHome);

  return (
    <div className="practice-status-view">
      {error && (
        <div className="practice-status-view__panel practice-status-view__panel--danger">
          <h1 className="practice-status-view__title">{tConv.errorTitle}</h1>
          <p className="practice-status-view__message mt-2 text-sm">{error}</p>
        </div>
      )}
      <div className="practice-status-view__actions">
        <button type="button" onClick={goHome} className="btn-primary px-8 py-3 text-lg">
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 调度失败视图：AI 服务启动未确认，音频已停止 */
export function DispatchFailedView() {
  const goHome = useAppStore((state) => state.goHome);

  return (
    <div className="practice-status-view" data-testid="dispatch-failed-view">
      <div className="practice-status-view__panel practice-status-view__panel--danger">
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
            <h1 className="practice-status-view__title text-danger-text">
              {tConv.dispatchFailedTitle}
            </h1>
            <p className="practice-status-view__message text-danger-text mt-2 text-sm">
              {tConv.dispatchFailedMessage}
            </p>
          </div>
        </div>
      </div>
      <div className="practice-status-view__actions">
        <button
          type="button"
          onClick={goHome}
          className="btn-primary px-6 py-2.5 text-sm font-medium"
        >
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 连接状态视图：默认用于首次连接，也显示真实的断连与重连状态。 */
export function ConnectingView({
  connectionState = ConnectionState.Connecting,
}: {
  connectionState?: ConnectionState;
}) {
  const isDisconnected = connectionState === ConnectionState.Disconnected;
  const statusLabel = isDisconnected ? tConv.connectionFailedTitle : tConv.connecting;

  return (
    <div
      className="practice-status-view"
      data-testid="connecting-view"
      data-connection-state={connectionState}
      role={isDisconnected ? "alert" : "status"}
      aria-live="polite"
    >
      {isDisconnected ? (
        <span
          aria-hidden="true"
          className="practice-status-view__mark practice-status-view__mark--danger"
        />
      ) : (
        <span aria-hidden="true" className="practice-status-view__spinner" />
      )}
      <h1 className="practice-status-view__title">{statusLabel}</h1>
      {isDisconnected ? (
        <p className="practice-status-view__message">{tConv.connectionFailedMessage}</p>
      ) : null}
    </div>
  );
}

/** 结束中视图：卸载房间后的即时状态展示 */
export function EndingView() {
  const goHome = useAppStore((state) => state.goHome);

  return (
    <div className="practice-status-view" data-testid="ending-view">
      <span aria-hidden="true" className="practice-status-view__spinner" />
      <h1 className="practice-status-view__title">{tConv.ending}</h1>
      <p className="practice-status-view__message">{tConv.endingHint}</p>
      <div className="practice-status-view__actions">
        <button type="button" onClick={goHome} className="btn-secondary px-6 py-2 text-sm">
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 结束失败视图：音频已停止，待重试 */
export function EndFailedView() {
  const endSession = useConversationStore((state) => state.endSession);
  const goHome = useAppStore((state) => state.goHome);
  const error = useConversationStore((state) => state.error);

  return (
    <div className="practice-status-view" data-testid="end-failed-view">
      <div className="practice-status-view__panel practice-status-view__panel--danger">
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
            <h1 className="practice-status-view__title text-danger-text">{tConv.endFailedTitle}</h1>
            <p className="practice-status-view__message text-danger-text mt-2 text-sm">
              {tConv.endFailedMessage}
            </p>
            {error && <p className="text-danger mt-2 font-mono text-xs">{error}</p>}
          </div>
        </div>
      </div>
      <div className="practice-status-view__actions">
        <button
          type="button"
          onClick={endSession}
          className="btn-primary px-6 py-2.5 text-sm font-medium"
        >
          {tConv.retryEndButton}
        </button>
        <button
          type="button"
          onClick={goHome}
          className="btn-secondary px-6 py-2.5 text-sm font-medium"
        >
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 无有效 WebSocket 地址时展示安全失败视图。 */
export function RoomUnavailableView() {
  const goHome = useAppStore((state) => state.goHome);

  return (
    <div className="practice-status-view">
      <div className="practice-status-view__panel practice-status-view__panel--danger">
        <h1 className="practice-status-view__title">{tConv.errorTitle}</h1>
        <p className="practice-status-view__message mt-2">{tConv.roomUnavailable}</p>
      </div>
      <div className="practice-status-view__actions">
        <button type="button" onClick={goHome} className="btn-primary px-6 py-2.5">
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}

/** 连接中断/失败视图：语音连接已中断，音频已停止 */
export function ConnectionFailedView() {
  const goHome = useAppStore((state) => state.goHome);

  return (
    <div className="practice-status-view" data-testid="connection-failed-view">
      <div className="practice-status-view__panel practice-status-view__panel--danger">
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
            <h1 className="practice-status-view__title text-danger-text">
              {tConv.connectionFailedTitle}
            </h1>
            <p className="practice-status-view__message text-danger-text mt-2 text-sm">
              {tConv.connectionFailedMessage}
            </p>
          </div>
        </div>
      </div>
      <div className="practice-status-view__actions">
        <button
          type="button"
          onClick={goHome}
          className="btn-primary px-6 py-2.5 text-sm font-medium"
        >
          {tDash.goHome}
        </button>
      </div>
    </div>
  );
}
