import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logDiagnostic,
  DIAGNOSTIC_PREFIX,
  ALLOWED_DIAGNOSTIC_EVENTS,
  ALLOWED_AGENT_CODES,
  clearDiagnosticBuffer,
  getDiagnosticGeneration,
  getDiagnosticSnapshot,
  subscribeDiagnosticBuffer,
} from "./diagnostics";
import pkg from "../../package.json";
import * as detectionModule from "@/platform/detection";
import * as authModule from "@/lib/auth";

describe("Diagnostics Helper (CP-06)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.spyOn(detectionModule, "detectPlatform").mockReturnValue("web");
    vi.spyOn(authModule, "getAuthRevision").mockReturnValue(1);
    clearDiagnosticBuffer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Record Schema & Whitelist Fields", () => {
    it("generates strict whitelist record without extra fields or unknown spreads", () => {
      const record = logDiagnostic("api_network_failed", {
        status: 500, // 不应被 api_network_failed 采纳
        agent_code: "ERR_CUSTOM_KEY_INVALID", // 不应被 api_network_failed 采纳
        ...({ extra_untrusted_leak: "canary_leak_data" } as any),
      });

      expect(record).not.toBeNull();
      expect(record?.schema_version).toBe(1);
      expect(record?.app_version).toBe(pkg.version);
      expect(record?.platform).toBe("web");
      expect(record?.event).toBe("api_network_failed");

      // 精确字段检查：只允许 schema_version, app_version, platform, event
      const keys = Object.keys(record!);
      expect(keys.sort()).toEqual(["schema_version", "app_version", "platform", "event"].sort());

      // 验证序列化结构中完全无泄露
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("canary_leak_data");
      expect(serialized).not.toContain("extra_untrusted_leak");
      expect(serialized).not.toContain("status");
      expect(serialized).not.toContain("agent_code");
    });

    it("verifies app_version strictly matches package.json version", () => {
      const record = logDiagnostic("api_network_failed");
      expect(record?.app_version).toBe(pkg.version);
      expect(typeof record?.app_version).toBe("string");
      expect(record?.app_version.length).toBeGreaterThan(0);
    });
  });

  describe("Platform Detection & Fallback", () => {
    const knownPlatforms = ["ios", "android", "macos", "windows", "web"] as const;

    for (const p of knownPlatforms) {
      it(`resolves known platform correctly: ${p}`, () => {
        vi.spyOn(detectionModule, "detectPlatform").mockReturnValue(p);
        const record = logDiagnostic("api_network_failed");
        expect(record?.platform).toBe(p);
      });
    }

    it("maps unexpected platform string to 'unknown'", () => {
      vi.spyOn(detectionModule, "detectPlatform").mockReturnValue("linux" as any);
      const record = logDiagnostic("api_network_failed");
      expect(record?.platform).toBe("unknown");
    });

    it("falls back to 'unknown' when detectPlatform throws error", () => {
      vi.spyOn(detectionModule, "detectPlatform").mockImplementation(() => {
        throw new Error("SecurityError: window access denied");
      });
      const record = logDiagnostic("api_network_failed");
      expect(record?.platform).toBe("unknown");
    });
  });

  describe("Event Validation & Level Mapping", () => {
    it("handles all 10 frozen events and dispatches to appropriate console levels", () => {
      for (const ev of ALLOWED_DIAGNOSTIC_EVENTS) {
        warnSpy.mockClear();
        errorSpy.mockClear();
        logSpy.mockClear();

        const record = logDiagnostic(ev);
        expect(record).not.toBeNull();
        expect(record?.event).toBe(ev);

        if (ev === "lifecycle_audio_interrupted" || ev === "native_lifecycle_ready_timeout") {
          expect(warnSpy).toHaveBeenCalledWith(DIAGNOSTIC_PREFIX, record);
          expect(errorSpy).not.toHaveBeenCalled();
          expect(logSpy).not.toHaveBeenCalled();
        } else if (ev === "livekit_disconnected") {
          expect(logSpy).toHaveBeenCalledWith(DIAGNOSTIC_PREFIX, record);
          expect(warnSpy).not.toHaveBeenCalled();
          expect(errorSpy).not.toHaveBeenCalled();
        } else {
          expect(errorSpy).toHaveBeenCalledWith(DIAGNOSTIC_PREFIX, record);
          expect(warnSpy).not.toHaveBeenCalled();
          expect(logSpy).not.toHaveBeenCalled();
        }
      }
    });

    it("rejects unknown event without calling console or echoing invalid event name", () => {
      const maliciousCanary = "api_fail_canary_secret_12345; DROP TABLE";
      const result = logDiagnostic(maliciousCanary);

      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("Status Range & Non-Integer Rejection", () => {
    it("attaches valid integer status between 100 and 599 for api_http_failed", () => {
      for (const validStatus of [100, 200, 401, 404, 500, 503, 599]) {
        const record = logDiagnostic("api_http_failed", { status: validStatus });
        expect(record?.status).toBe(validStatus);
        expect(Object.keys(record!).sort()).toEqual(
          ["schema_version", "app_version", "platform", "event", "status"].sort(),
        );
      }
    });

    it("does not attach status if outside 100..599 or non-integer or wrong type", () => {
      const invalidStatuses = [
        99,
        600,
        0,
        -500,
        404.5,
        NaN,
        Infinity,
        -Infinity,
        "500",
        null,
        undefined,
        {},
        [500],
      ];

      for (const invalid of invalidStatuses) {
        const record = logDiagnostic("api_http_failed", { status: invalid });
        expect(record).not.toBeNull();
        expect(record?.status).toBeUndefined();
        expect("status" in record!).toBe(false);
      }
    });

    it("does not attach status to events other than api_http_failed", () => {
      const record = logDiagnostic("api_network_failed", { status: 500 });
      expect(record?.status).toBeUndefined();
      expect("status" in record!).toBe(false);
    });
  });

  describe("Agent Error Code Whitelist & Sanitization", () => {
    it("attaches agent_code when matching strict whitelist for agent_error_received", () => {
      for (const code of ALLOWED_AGENT_CODES) {
        const record = logDiagnostic("agent_error_received", { agent_code: code });
        expect(record?.agent_code).toBe(code);
        expect(Object.keys(record!).sort()).toEqual(
          ["schema_version", "app_version", "platform", "event", "agent_code"].sort(),
        );
      }
    });

    it("maps unknown, malicious, long or secret-like agent_code to 'unknown'", () => {
      const sensitiveCanaries = [
        "Bearer secret_jwt_token_canary_xyz",
        "ERR_UNKNOWN_INTERNAL_CRASH",
        "CUSTOM_SECRET_KEY_12345",
        "x".repeat(500),
        "",
        null,
        undefined,
        1234,
        { code: "ERR_CUSTOM_KEY_INVALID" },
      ];

      for (const canary of sensitiveCanaries) {
        errorSpy.mockClear();
        const record = logDiagnostic("agent_error_received", { agent_code: canary });
        expect(record?.agent_code).toBe("unknown");

        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain("secret_jwt_token_canary");
        expect(serialized).not.toContain("ERR_UNKNOWN_INTERNAL_CRASH");
        expect(serialized).not.toContain("CUSTOM_SECRET_KEY_12345");
        expect(serialized).toContain('"agent_code":"unknown"');
      }
    });

    it("does not attach agent_code to events other than agent_error_received", () => {
      const record = logDiagnostic("api_http_failed", {
        status: 500,
        agent_code: "ERR_CUSTOM_KEY_INVALID",
      });
      expect(record?.agent_code).toBeUndefined();
      expect("agent_code" in record!).toBe(false);
    });
  });

  describe("Privacy & Canary Absence Guarantee", () => {
    it("never includes URL, headers, token, body or message canaries in serialized output", () => {
      const canaries = {
        token: "bearer-token-canary-secret-1234",
        url: "https://api.echotalk.dev/api/sessions/private-123",
        path: "/api/user/settings",
        message: "Internal sensitive error message",
        body: { secret: "confidential_document_content" },
        user_id: "user-uuid-private-123",
      };

      // 无论外部调用传入什么
      const record = logDiagnostic("api_http_failed", {
        status: 500,
        ...canaries,
      } as any);

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(canaries.token);
      expect(serialized).not.toContain(canaries.url);
      expect(serialized).not.toContain(canaries.path);
      expect(serialized).not.toContain(canaries.message);
      expect(serialized).not.toContain("confidential_document_content");
      expect(serialized).not.toContain(canaries.user_id);
    });
  });

  describe("Failure Isolation", () => {
    it("does not throw when console output sinks throw exceptions", () => {
      errorSpy.mockImplementation(() => {
        throw new Error("Console pipe broken");
      });
      warnSpy.mockImplementation(() => {
        throw new Error("Console pipe broken");
      });
      logSpy.mockImplementation(() => {
        throw new Error("Console pipe broken");
      });

      expect(() => {
        const record = logDiagnostic("api_network_failed");
        expect(record).not.toBeNull();
      }).not.toThrow();

      expect(() => {
        const record = logDiagnostic("lifecycle_audio_interrupted");
        expect(record).not.toBeNull();
      }).not.toThrow();
    });
  });

  describe("User-controlled diagnostic buffer", () => {
    it("buffers safe records with frozen inputs and unreadable unknown fields", () => {
      const options = Object.freeze({
        status: 503,
        token: "synthetic-token-canary",
        url: "https://private.invalid/secret-path-canary",
        user_id: "synthetic-account-canary",
        body: "synthetic-document-canary",
        get unknown_payload() {
          throw new Error("unknown fields must never be read");
        },
      });
      const record = logDiagnostic("api_http_failed", options);
      const records = getDiagnosticSnapshot();
      expect(records).toEqual([
        {
          schema_version: 1,
          app_version: pkg.version,
          platform: "web",
          event: "api_http_failed",
          status: 503,
        },
      ]);
      expect(errorSpy).toHaveBeenCalledWith(DIAGNOSTIC_PREFIX, record);
      expect(JSON.stringify(records)).not.toContain("canary");
      expect(Object.isFrozen(records)).toBe(true);
      expect(Object.isFrozen(records[0])).toBe(true);
      expect(Reflect.set(records, "0", { token: "injected-canary" })).toBe(false);
      expect(Reflect.set(record!, "token", "injected-canary")).toBe(false);
      expect(Reflect.set(records[0], "status", 401)).toBe(false);
      expect(getDiagnosticSnapshot()).toBe(records);
      expect(getDiagnosticSnapshot()[0].status).toBe(503);
    });

    it("retains the latest 50 records in order and keeps earlier snapshots isolated", () => {
      logDiagnostic("api_http_failed", { status: 100 });
      const earlier = getDiagnosticSnapshot();
      for (let status = 101; status < 155; status += 1) {
        logDiagnostic("api_http_failed", { status });
      }
      const records = getDiagnosticSnapshot();
      expect(records).toHaveLength(50);
      expect(records.map((record) => record.status)).toEqual(
        Array.from({ length: 50 }, (_, index) => 105 + index),
      );
      expect(earlier).toHaveLength(1);
      expect(earlier[0].status).toBe(100);
      clearDiagnosticBuffer();
      expect(getDiagnosticSnapshot()).toEqual([]);
      expect(records).toHaveLength(50);
    });

    it("keeps only whitelisted fields for every event and rejects unknown events", () => {
      for (const event of ALLOWED_DIAGNOSTIC_EVENTS) {
        logDiagnostic(event, { status: 599, agent_code: "secret-canary" });
      }
      expect(getDiagnosticSnapshot()).toHaveLength(ALLOWED_DIAGNOSTIC_EVENTS.length);
      for (const record of getDiagnosticSnapshot()) {
        const keys = ["schema_version", "app_version", "platform", "event"];
        if (record.event === "api_http_failed") keys.push("status");
        if (record.event === "agent_error_received") {
          keys.push("agent_code");
          expect(record.agent_code).toBe("unknown");
        }
        expect(Object.keys(record).sort()).toEqual(keys.sort());
      }
      const before = getDiagnosticSnapshot();
      for (const event of ["unknown-canary", "__proto__", "constructor"]) {
        expect(logDiagnostic(event)).toBeNull();
      }
      expect(getDiagnosticSnapshot()).toBe(before);
      expect(JSON.stringify(before)).not.toContain("secret-canary");
    });

    it("clears without a mounted consumer on authentication revision change", () => {
      logDiagnostic("api_http_failed", { status: 503 });
      const generation = getDiagnosticGeneration();
      vi.mocked(authModule.getAuthRevision).mockReturnValue(2);
      expect(getDiagnosticSnapshot()).toEqual([]);
      expect(getDiagnosticGeneration()).toBeGreaterThan(generation);
      logDiagnostic("livekit_disconnected");
      expect(getDiagnosticSnapshot().map((record) => record.event)).toEqual([
        "livekit_disconnected",
      ]);
      vi.mocked(authModule.getAuthRevision).mockReturnValue(3);
      logDiagnostic("agent_dispatch_failed");
      expect(getDiagnosticSnapshot().map((record) => record.event)).toEqual([
        "agent_dispatch_failed",
      ]);
    });

    it("invalidates generation even on empty clears and preserves it for new records", () => {
      const initial = getDiagnosticGeneration();
      clearDiagnosticBuffer();
      const cleared = getDiagnosticGeneration();
      expect(cleared).toBeGreaterThan(initial);
      logDiagnostic("api_network_failed");
      expect(getDiagnosticGeneration()).toBe(cleared);
      clearDiagnosticBuffer();
      expect(getDiagnosticGeneration()).toBeGreaterThan(cleared);
    });

    it("isolates listener errors, reentrant clearing and auth cleanup", () => {
      const release = vi.fn();
      let authChanged: (() => void) | undefined;
      vi.spyOn(authModule, "subscribeAuthSnapshot").mockImplementation((listener) => {
        authChanged = () => listener({ state: "anonymous", principal: null });
        return release;
      });
      const stopThrowing = subscribeDiagnosticBuffer(() => {
        throw new Error("synthetic-listener-canary");
      });
      let clearOnce = true;
      const listener = vi.fn(() => {
        if (clearOnce) {
          clearOnce = false;
          clearDiagnosticBuffer();
        }
      });
      const stop = subscribeDiagnosticBuffer(listener);
      try {
        expect(() => logDiagnostic("api_network_failed")).not.toThrow();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getDiagnosticSnapshot()).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(
          DIAGNOSTIC_PREFIX,
          expect.objectContaining({ event: "api_network_failed" }),
        );
        logDiagnostic("livekit_disconnected");
        vi.mocked(authModule.getAuthRevision).mockReturnValue(2);
        authChanged?.();
        expect(getDiagnosticSnapshot()).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(3);
      } finally {
        stop();
        stop();
        stopThrowing();
      }
      expect(release).toHaveBeenCalledTimes(2);
      const calls = listener.mock.calls.length;
      logDiagnostic("api_network_failed");
      expect(listener).toHaveBeenCalledTimes(calls);
    });

    it("keeps duplicate callbacks independent and tolerates auth cleanup failure", () => {
      vi.spyOn(authModule, "subscribeAuthSnapshot").mockReturnValue(() => {
        throw new Error("synthetic-cleanup-canary");
      });
      const listener = vi.fn();
      const first = subscribeDiagnosticBuffer(listener);
      const second = subscribeDiagnosticBuffer(listener);
      expect(() => first()).not.toThrow();
      try {
        logDiagnostic("api_network_failed");
        expect(listener).toHaveBeenCalledTimes(1);
      } finally {
        expect(() => second()).not.toThrow();
      }
      logDiagnostic("api_network_failed");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("keeps buffer notifications usable when auth subscription registration fails", () => {
      vi.spyOn(authModule, "subscribeAuthSnapshot").mockImplementation(() => {
        throw new Error("synthetic-subscription-canary");
      });
      const listener = vi.fn();
      const stop = subscribeDiagnosticBuffer(listener);
      try {
        expect(logDiagnostic("api_network_failed")).not.toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
        vi.mocked(authModule.getAuthRevision).mockReturnValue(2);
        expect(getDiagnosticSnapshot()).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(2);
      } finally {
        stop();
      }
    });

    it("isolates console failure and rejects records invalidated during construction", () => {
      errorSpy.mockImplementation(() => {
        throw new Error("synthetic-console-canary");
      });
      expect(logDiagnostic("api_network_failed")).not.toBeNull();
      expect(getDiagnosticSnapshot()).toHaveLength(1);
      logDiagnostic("api_http_failed", {
        get status() {
          clearDiagnosticBuffer();
          return 503;
        },
      });
      expect(getDiagnosticSnapshot()).toEqual([]);
    });
  });
});
