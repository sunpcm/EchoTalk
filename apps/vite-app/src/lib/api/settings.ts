/**
 * 用户设置（settings）相关 API 与类型。
 */

import type { ApiRequestOptions, ApiSchemas, OptionalNonNullable, WithRequired } from "./client";
import { request } from "./client";
import * as apiRequestTimeoutModule from "../apiRequestTimeout";

/** 用户双轨制配置（GET 响应） */
type GeneratedUserSettingsResponse = WithRequired<
  ApiSchemas["UserSettingsResponse"],
  "stt_provider" | "llm_provider" | "llm_model" | "tts_provider"
>;

export type UserSettingsResponse = Omit<
  GeneratedUserSettingsResponse,
  "is_custom_verified" | "subscription_tier"
> &
  Partial<Pick<GeneratedUserSettingsResponse, "is_custom_verified" | "subscription_tier">>;

/** 用户双轨制配置更新（PUT 请求体） */
export type UserSettingsUpdate = OptionalNonNullable<ApiSchemas["UserSettingsUpdate"]>;

// ─── 用户设置 API ───

/** 获取当前用户的双轨制配置 */
export function getUserSettings(options?: ApiRequestOptions): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/user/settings", {
    signal: options?.signal,
  });
}

/** 更新当前用户的双轨制配置（部分更新） */
export function updateUserSettings(
  data: UserSettingsUpdate,
  options?: ApiRequestOptions,
): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>(
    "/user/settings",
    {
      method: "PUT",
      body: JSON.stringify(data),
      signal: options?.signal,
    },
    { timeoutMs: apiRequestTimeoutModule.UPDATE_USER_SETTINGS_REQUEST_TIMEOUT_MS },
  );
}
