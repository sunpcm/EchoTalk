export const DEFAULT_API_REQUEST_TIMEOUT_MS = 10_000;

/**
 * 设置更新可能触发后端最长 10s 的并行 Provider 校验。
 * 额外 5s 覆盖连接建立、响应传输与客户端处理。
 */
export const UPDATE_USER_SETTINGS_REQUEST_TIMEOUT_MS = 15_000;

export const API_REQUEST_TIMEOUT_ERROR_NAME = "ApiRequestTimeoutError";
export const API_REQUEST_ABORTED_ERROR_NAME = "ApiRequestAbortedError";
export const API_REQUEST_TIMEOUT_ERROR_MESSAGE = "API request timed out";
export const API_REQUEST_ABORTED_ERROR_MESSAGE = "API request aborted";

export class ApiRequestTimeoutError extends Error {
  public readonly kind = "timeout";

  constructor() {
    super(API_REQUEST_TIMEOUT_ERROR_MESSAGE);
    this.name = API_REQUEST_TIMEOUT_ERROR_NAME;
  }
}

export class ApiRequestAbortedError extends Error {
  public readonly kind = "aborted";

  constructor() {
    super(API_REQUEST_ABORTED_ERROR_MESSAGE);
    this.name = API_REQUEST_ABORTED_ERROR_NAME;
  }
}

export type ApiRequestFailure = ApiRequestTimeoutError | ApiRequestAbortedError;

export interface ApiRequestTimeoutOptions {
  timeoutMs?: number;
}

export interface ApiRequestAbortHandle {
  readonly signal: AbortSignal;
  getFailure(): ApiRequestFailure | null;
  dispose(): void;
}

/**
 * 仅接受正有限数；其余运行时输入统一回退到稳定的默认预算。
 */
export function resolveApiRequestTimeout(options?: unknown): number {
  if (typeof options !== "object" || options === null) {
    return DEFAULT_API_REQUEST_TIMEOUT_MS;
  }

  const timeoutMs = (options as { timeoutMs?: unknown }).timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_API_REQUEST_TIMEOUT_MS;
  }
  return timeoutMs;
}

/**
 * 将调用方 signal 与一次请求的内部超时组合。
 * 调用方取消始终优先；内部 signal 的 reason 固定为可区分的无正文错误。
 */
export function createApiRequestAbortHandle(
  externalSignal?: AbortSignal | null,
  options?: ApiRequestTimeoutOptions,
): ApiRequestAbortHandle {
  const controller = new AbortController();
  const timeoutError = new ApiRequestTimeoutError();
  const abortedError = new ApiRequestAbortedError();
  let failure: ApiRequestFailure | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const stopListening = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    externalSignal?.removeEventListener("abort", abortForCaller);
  };

  const abortWith = (nextFailure: ApiRequestFailure) => {
    if (failure !== null) return;
    failure = nextFailure;
    stopListening();
    controller.abort(nextFailure);
  };

  function abortForCaller() {
    abortWith(abortedError);
  }

  if (externalSignal?.aborted) {
    abortForCaller();
  } else {
    timeoutId = setTimeout(() => abortWith(timeoutError), resolveApiRequestTimeout(options));
    externalSignal?.addEventListener("abort", abortForCaller, { once: true });

    // 覆盖检查与监听注册之间的同步竞态。
    if (externalSignal?.aborted) {
      abortForCaller();
    }
  }

  return {
    signal: controller.signal,
    getFailure() {
      // 即使内部超时先触发，已 aborted 的调用方 signal 仍优先。
      return externalSignal?.aborted ? abortedError : failure;
    },
    dispose() {
      stopListening();
    },
  };
}
