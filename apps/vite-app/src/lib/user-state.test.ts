import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { clearUserSessionData } from "./user-state";
import {
  clearDiagnosticBuffer,
  getDiagnosticGeneration,
  getDiagnosticSnapshot,
  logDiagnostic,
  subscribeDiagnosticBuffer,
} from "./diagnostics";
import * as auth from "./auth";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAppStore } from "@/store/appStore";
import { useSettingsStore } from "@/store/settings";
import { useAssessmentStore } from "@/store/assessment";

describe("clearUserSessionData", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearDiagnosticBuffer();
    useAppStore.getState().reset();
    useSettingsStore.getState().reset();
    useAssessmentStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    clearDiagnosticBuffer();
    vi.restoreAllMocks();
  });

  it("synchronously resets conversation, settings, and assessment stores idempotently", () => {
    // 设置一些临时用户数据
    useAppStore.setState({
      sessionId: "session-123",
      token: "livekit-token-abc",
      wsUrl: "wss://lk.test",
      appView: "session",
      connectionState: "active",
    });
    useSettingsStore.setState({
      settings: {
        is_custom_mode: true,
        theme: "dark",
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "test-model",
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: true,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "verified",
      },
    });
    useAssessmentStore.setState({
      loadState: "loaded",
      assessment: {
        id: "assess-1",
        session_id: "session-123",
        overall_score: 85,
        phoneme_alignment: [],
        source: "test",
        provider: null,
        model_version: null,
        is_synthetic: false,
        confidence: null,
        provider_response_ref: null,
        created_at: "2026-01-01",
      },
    });

    const convGenBefore = useAppStore.getState().sessionGen;

    clearUserSessionData();

    // 验证 conversation 状态被清除，且回到 dashboard 且 token 为空
    const conv = useAppStore.getState();
    expect(conv.sessionId).toBeNull();
    expect(conv.token).toBeNull();
    expect(conv.appView).toBe("dashboard");
    expect(conv.connectionState).toBe("idle");
    expect(conv.sessionGen).toBeGreaterThan(convGenBefore);

    // 验证 settings 状态被重置
    const settings = useSettingsStore.getState();
    expect(settings.settings).toBeNull();
    expect(settings.loading).toBe(false);
    expect(settings.saving).toBe(false);

    // 验证 assessment 状态被重置
    const assessment = useAssessmentStore.getState();
    expect(assessment.assessment).toBeNull();
    expect(assessment.loadState).toBe("idle");

    // 重复调用幂等，不报错
    expect(() => clearUserSessionData()).not.toThrow();
  });

  it("clears diagnostic data and invalidates copy ownership without mounting diagnostic UI", () => {
    logDiagnostic("api_http_failed", { status: 503 });
    const oldSnapshot = getDiagnosticSnapshot();
    const generation = getDiagnosticGeneration();
    clearUserSessionData();
    expect(getDiagnosticSnapshot()).toEqual([]);
    expect(getDiagnosticGeneration()).toBeGreaterThan(generation);
    expect(oldSnapshot).toHaveLength(1);
    expect(() => clearUserSessionData()).not.toThrow();
    logDiagnostic("api_http_failed", { status: 502 });
    expect(getDiagnosticSnapshot().map((record) => record.status)).toEqual([502]);
  });

  it("does not let a failed diagnostic listener prevent clearing business stores", () => {
    useAppStore.setState({ sessionId: "synthetic-session", token: "synthetic-token" });
    const stop = subscribeDiagnosticBuffer(() => {
      throw new Error("synthetic-listener-canary");
    });
    try {
      expect(() => clearUserSessionData()).not.toThrow();
      expect(useAppStore.getState().sessionId).toBeNull();
      expect(useAppStore.getState().token).toBeNull();
      expect(useSettingsStore.getState().settings).toBeNull();
      expect(getDiagnosticSnapshot()).toEqual([]);
    } finally {
      stop();
    }
  });

  it.each(["logout", "switch-account", "unmount"] as const)(
    "clears through the real AuthGate on %s while settings UI is absent",
    async (action) => {
      let listener: ((snapshot: auth.AuthSnapshot) => void) | undefined;
      const principal = { issuer: "urn:synthetic-test", subject: "account-a" };
      vi.spyOn(auth, "initializeAuthSnapshot").mockResolvedValue({
        state: "authenticated",
        principal,
      });
      vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((callback) => {
        listener = callback;
        return () => {};
      });
      const view = render(createElement(AuthGate, null, createElement("div", null, "private")));
      await act(async () => {
        await Promise.resolve();
      });
      logDiagnostic("api_http_failed", { status: 503 });
      expect(getDiagnosticSnapshot()).toHaveLength(1);
      const generation = getDiagnosticGeneration();
      if (action === "unmount") {
        view.unmount();
      } else {
        act(() => {
          listener?.(
            action === "logout"
              ? { state: "anonymous", principal: null }
              : { state: "authenticated", principal: { ...principal, subject: "account-b" } },
          );
        });
      }
      expect(getDiagnosticSnapshot()).toEqual([]);
      expect(getDiagnosticGeneration()).toBeGreaterThan(generation);
    },
  );
});
