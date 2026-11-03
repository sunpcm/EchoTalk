import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";
import { classifyPracticeReadiness } from "./practiceReadiness";

const actionable = [
  "settings_required",
  "custom_unverified",
  "custom_incomplete",
  "permission_denied",
] as const;
const service = [
  "database_unavailable",
  "user_unavailable",
  "livekit_unconfigured",
  "provider_unconfigured",
] as const;

function response(code: string) {
  return { detail: { status: "not_ready", code, errors: { config: "sensitive-canary" } } };
}

describe("practice readiness classification", () => {
  for (const code of [...actionable, ...service]) {
    it(`maps ${code} using local text and a fixed action`, () => {
      const issue = classifyPracticeReadiness(new ApiError(503, "raw-canary", response(code)));
      expect(issue).toEqual({
        code,
        message: zhCN.practiceReadiness[code],
        canOpenSettings: actionable.some((item) => item === code),
      });
      expect(JSON.stringify(issue)).not.toContain("canary");
    });
  }

  it.each([
    new Error("settings_required sensitive-canary"),
    new ApiError(503, "sensitive-canary", "<html>settings_required</html>"),
    new ApiError(503, "sensitive-canary", { detail: { errors: { llm: "configure key" } } }),
    new ApiError(503, "sensitive-canary", response("__proto__")),
    new ApiError(503, "sensitive-canary", response("future_server_code")),
    new ApiError(403, "sensitive-canary", response("settings_required")),
    new ApiError(503, "sensitive-canary", {
      detail: { status: "not_ready", code: "settings_required", errors: { config: {} } },
    }),
    { status: 503, data: response("settings_required") },
    null,
  ])("uses a safe fallback for unknown, legacy or untrusted input %#", (error) => {
    expect(classifyPracticeReadiness(error)).toEqual({
      code: "unknown",
      message: zhCN.practiceReadiness.fallback,
      canOpenSettings: false,
    });
  });
});
