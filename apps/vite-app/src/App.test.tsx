import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import * as api from "@/lib/api";
import { useSettingsStore } from "@/store/settings";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthSnapshot: vi.fn(() => ({
      state: "authenticated",
      principal: { issuer: "urn:echotalk:auth:dev", subject: "dev-user" },
    })),
    getAuthRevision: vi.fn(() => 1),
    arePrincipalsEqual: vi.fn((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
    }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const { ApiError } = await importOriginal<typeof import("@/lib/api")>();
  return {
    ApiError,
    getCallCapabilities: vi.fn().mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "disabled",
    }),
    checkHealthReady: vi.fn(),
    createSession: vi.fn(),
    getSessionToken: vi.fn(),
    dispatchAgent: vi.fn(),
    getUserSettings: vi.fn().mockResolvedValue({
      is_custom_mode: false,
      theme: "warm",
      stt_provider: null,
      llm_provider: null,
      llm_model: null,
      tts_provider: null,
      has_stt_key: false,
      has_llm_key: false,
      has_tts_key: false,
      stt_status: "unconfigured",
      llm_status: "unconfigured",
      tts_status: "unconfigured",
    }),
    updateUserSettings: vi.fn(),
    getKnowledgeStates: vi.fn().mockResolvedValue([]),
    getRecommendedCurriculum: vi.fn().mockResolvedValue({
      weakest_skill: "",
      weakest_skill_mastery: 0,
      target_level: "B1",
      recommendations: [],
    }),
    listSessions: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
    listActiveSessions: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
    getDailyProgress: vi.fn().mockResolvedValue({ completed_sessions: 0, total_turns: 0 }),
  };
});

describe("App initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.getState().reset();
    useSettingsStore.getState().reset();
    useSettingsStore.setState({ theme: "dark" });
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies theme DOM attribute on mount without triggering backend PUT sync", () => {
    render(<App />);

    // 属性已同步到 documentElement
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    // 启动时不应调用 updateUserSettings 触发 PUT
    expect(api.updateUserSettings).not.toHaveBeenCalled();

    // 但正常触发了 fetchSettings 进行水合
    expect(api.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("shows one safe readiness alert, opens settings and only rechecks on explicit click", async () => {
    vi.mocked(api.checkHealthReady).mockRejectedValueOnce(
      new api.ApiError(503, "raw-canary", {
        detail: {
          status: "not_ready",
          code: "settings_required",
          errors: { config: "raw-canary" },
        },
      }),
    );
    render(<App />);
    await act(async () => {
      await useConversationStore.getState().startSession("scenario");
    });
    expect(screen.getAllByText(zhCN.practiceReadiness.settings_required)).toHaveLength(1);
    expect(screen.queryByText("raw-canary")).not.toBeInTheDocument();
    expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: zhCN.practiceReadiness.openSettings }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.createSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: zhCN.settings.closeAriaLabel }));
    expect(api.checkHealthReady).toHaveBeenCalledTimes(1);

    let resolve!: (value: api.HealthReadyResponse) => void;
    vi.mocked(api.checkHealthReady).mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: zhCN.practiceReadiness.retry }));
    await waitFor(() => expect(api.checkHealthReady).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: zhCN.practiceReadiness.checking })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: zhCN.practiceReadiness.checking }));
    expect(api.checkHealthReady).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve({ status: "ready" });
    });
    expect(screen.getByText(zhCN.practiceReadiness.ready)).toBeInTheDocument();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.getSessionToken).not.toHaveBeenCalled();
    expect(api.dispatchAgent).not.toHaveBeenCalled();
  });

  it("opening a new document setup cancels an old in-flight recheck", async () => {
    vi.mocked(api.checkHealthReady).mockRejectedValueOnce(
      new api.ApiError(503, "raw-canary", {
        detail: { status: "not_ready", code: "settings_required", errors: { config: "x" } },
      }),
    );
    render(<App />);
    await act(async () => {
      await useConversationStore.getState().startSession("scenario");
    });
    let resolve!: (value: api.HealthReadyResponse) => void;
    vi.mocked(api.checkHealthReady).mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: zhCN.practiceReadiness.retry }));
    await waitFor(() => expect(api.checkHealthReady).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("heading", { name: zhCN.docChat.dashboardEntry }));
    await act(async () => {
      resolve({ status: "ready" });
    });
    expect(useConversationStore.getState()).toMatchObject({
      appView: "doc-chat-setup",
      readinessNotice: false,
      recheckingReadiness: false,
    });
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.getSessionToken).not.toHaveBeenCalled();
  });

  it("unknown readiness input renders local fallback and offers no inferred settings action", async () => {
    vi.mocked(api.checkHealthReady).mockRejectedValue(
      new api.ApiError(503, "settings_required raw-canary", {
        detail: "<html>raw-canary</html>",
      }),
    );
    render(<App />);
    await act(async () => {
      await useConversationStore.getState().startSession("scenario");
    });
    expect(screen.getByText(zhCN.practiceReadiness.fallback)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: zhCN.practiceReadiness.openSettings }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-canary/)).not.toBeInTheDocument();
  });
});
