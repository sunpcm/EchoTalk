import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";

const tConv = zhCN.conversation;
const tDash = zhCN.dashboard;

/** idle 状态不应在 session 视图出现，作为安全回退 */
export function IdleView() {
  const error = useConversationStore((state) => state.error);
  const goHome = useConversationStore((state) => state.goHome);

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

/** 调度失败视图：AI 服务启动未确认，音频已停止 */
export function DispatchFailedView() {
  const goHome = useConversationStore((state) => state.goHome);

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
export function ConnectingView() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="border-accent h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" />
      <p className="text-text-muted">{tConv.connecting}</p>
    </div>
  );
}

/** 结束中视图：卸载房间后的即时状态展示 */
export function EndingView() {
  const goHome = useConversationStore((state) => state.goHome);

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
export function EndFailedView() {
  const endSession = useConversationStore((state) => state.endSession);
  const goHome = useConversationStore((state) => state.goHome);
  const error = useConversationStore((state) => state.error);

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

/** 无有效 WebSocket 地址时展示安全失败视图。 */
export function RoomUnavailableView() {
  const goHome = useConversationStore((state) => state.goHome);

  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="bg-danger-bg text-danger-text w-full max-w-sm rounded-[20px] p-6 text-center text-sm">
        <p className="font-semibold">{tConv.errorTitle}</p>
        <p className="mt-1">无法获取有效的 WebSocket 服务器地址，请检查 VITE_API_BASE_URL 配置。</p>
      </div>
      <button onClick={goHome} className="btn-primary px-6 py-2.5">
        {tDash.goHome}
      </button>
    </div>
  );
}

/** 连接中断/失败视图：语音连接已中断，音频已停止 */
export function ConnectionFailedView() {
  const goHome = useConversationStore((state) => state.goHome);

  return (
    <div className="flex flex-col items-center gap-6 py-8" data-testid="connection-failed-view">
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
              {tConv.connectionFailedTitle}
            </h3>
            <p className="text-danger-text mt-1 text-sm leading-relaxed">
              {tConv.connectionFailedMessage}
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
