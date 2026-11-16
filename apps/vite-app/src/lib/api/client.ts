/**
 * 后端 API 客户端核心：唯一 base URL 缓存、ApiError、request 与共享辅助类型。
 */

import { getApiBaseUrl } from "@/platform";
import { getAccessToken, getAuthRevision, invalidateAuthSession } from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { logDiagnostic } from "@/lib/diagnostics";
import * as apiErrorMessageModule from "../apiErrorMessage";
import * as apiRequestHeadersModule from "../apiRequestHeaders";
import * as apiRequestTimeoutModule from "../apiRequestTimeout";
import type { components as ApiComponents } from "../api.generated";

export type ApiSchemas = ApiComponents["schemas"];
export type WithRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type OptionalNonNullable<T> = {
  [K in keyof T]?: NonNullable<T[K]>;
};

let cachedBaseUrl: string | null = null;
export function getBaseUrl(): string {
  if (cachedBaseUrl === null) {
    cachedBaseUrl = getApiBaseUrl();
  }
  return cachedBaseUrl;
}

/** API 错误类，携带 HTTP 状态码用于区分 404 等场景 */
export class ApiError extends Error {
  public data?: any;
  constructor(
    public readonly status: number,
    message: string,
    data?: any,
  ) {
    super(message);
    this.name = "ApiError";
    this.data = data;
  }
}

/** 公共网络函数的单请求覆盖选项。 */
export interface ApiRequestOptions {
  readonly signal?: AbortSignal | null;
}

/** 通用请求封装 */
export async function request<T>(
  path: string,
  options?: RequestInit,
  timeoutOptions?: apiRequestTimeoutModule.ApiRequestTimeoutOptions,
): Promise<T> {
  const baseUrl = getBaseUrl();
  const reqRevision = getAuthRevision();
  const accessToken = await getAccessToken();

  if (getAuthRevision() !== reqRevision) {
    throw new Error(zhCN.auth.sessionChanged);
  }

  const headers = apiRequestHeadersModule.buildApiRequestHeaders(options?.headers, accessToken);
  const requestAbort = apiRequestTimeoutModule.createApiRequestAbortHandle(
    options?.signal,
    timeoutOptions,
  );
  let res: Response;
  let fetchFailed = false;
  try {
    const preflightFailure = requestAbort.getFailure();
    if (preflightFailure) {
      throw preflightFailure;
    }

    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: requestAbort.signal,
      });
    } catch (error) {
      fetchFailed = true;
      throw error;
    }

    if (!res.ok) {
      logDiagnostic("api_http_failed", { status: res.status });
      if (res.status === 401) {
        invalidateAuthSession(reqRevision);
      }
      let body: any = {};
      try {
        body = await res.json();
      } catch (error) {
        if (requestAbort.getFailure()) {
          throw error;
        }
      }

      const message = apiErrorMessageModule.getApiErrorMessage(res.status, body);

      throw new ApiError(res.status, message, body);
    }

    return await res.json();
  } catch (error) {
    const requestFailure = requestAbort.getFailure();
    if (requestFailure) {
      logDiagnostic(
        requestFailure.kind === "timeout" ? "api_request_timeout" : "api_request_aborted",
      );
      throw requestFailure;
    }
    if (fetchFailed) {
      logDiagnostic("api_network_failed");
    }
    throw error;
  } finally {
    requestAbort.dispose();
  }
}

// ─── 健康检查 API ───

export interface HealthReadyResponse {
  status: string;
}

/** 深度健康检查，验证 DB、LiveKit 等是否已就绪 */
export function checkHealthReady(options?: ApiRequestOptions): Promise<HealthReadyResponse> {
  return request<HealthReadyResponse>("/health/ready", {
    signal: options?.signal,
  });
}
