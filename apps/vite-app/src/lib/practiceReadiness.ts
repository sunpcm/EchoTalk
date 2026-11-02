import { ApiError } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

const codes = [
  "database_unavailable",
  "user_unavailable",
  "settings_required",
  "custom_unverified",
  "custom_incomplete",
  "permission_denied",
  "livekit_unconfigured",
  "provider_unconfigured",
] as const;

export type PracticeReadinessCode = (typeof codes)[number];
export interface PracticeReadinessIssue {
  readonly code: PracticeReadinessCode | "unknown";
  readonly message: string;
  readonly canOpenSettings: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只消费本次 readiness 响应的白名单 code，绝不展示远端文本。 */
export function classifyPracticeReadiness(error: unknown): PracticeReadinessIssue {
  if (error instanceof ApiError && error.status === 503 && isRecord(error.data)) {
    const detail: unknown = error.data.detail;
    if (
      isRecord(detail) &&
      detail.status === "not_ready" &&
      isRecord(detail.errors) &&
      Object.values(detail.errors).every((value) => typeof value === "string") &&
      typeof detail.code === "string" &&
      codes.some((code) => code === detail.code)
    ) {
      const code = detail.code as PracticeReadinessCode;
      return {
        code,
        message: zhCN.practiceReadiness[code],
        canOpenSettings: [
          "settings_required",
          "custom_unverified",
          "custom_incomplete",
          "permission_denied",
        ].includes(code),
      };
    }
  }
  return { code: "unknown", message: zhCN.practiceReadiness.fallback, canOpenSettings: false };
}
