import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useConversationStore } from "./conversation";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  checkHealthReady: vi.fn(),
  createSession: vi.fn(),
  getSessionToken: vi.fn(),
  endSession: vi.fn(),
}));

describe("useConversationStore", () => {
  beforeEach(() => {
    useConversationStore.getState().goHome();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct initial state", () => {
    const state = useConversationStore.getState();
    expect(state.connectionState).toBe("idle");
    expect(state.appView).toBe("dashboard");
    expect(state.sessionId).toBeNull();
    expect(state.token).toBeNull();
    expect(state.wsUrl).toBeNull();
    expect(state.error).toBeNull();
    expect(state.selectedScenario).toBeNull();
    expect(state.agentError).toBeNull();
  });

  describe("startSession", () => {
    it("successfully starts a session with mode and docContext", async () => {
      const mockSession: api.Session = {
        id: "sess-123",
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      };
      const mockTokenRes = {
        token: "livekit-token",
        ws_url: "wss://livekit.example.com",
      };
      const docContext: api.DocContext = {
        content_type: "pdf",
        raw_text: "Sample doc",
        prompt: "Discuss this document",
      };

      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValue(mockSession);
      vi.mocked(api.getSessionToken).mockResolvedValue(mockTokenRes);

      await useConversationStore.getState().startSession("free_talk", docContext);

      expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      expect(api.createSession).toHaveBeenCalledWith("free_talk", docContext);
      expect(api.getSessionToken).toHaveBeenCalledWith("sess-123");

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("connecting");
      expect(state.appView).toBe("session");
      expect(state.sessionId).toBe("sess-123");
      expect(state.token).toBe("livekit-token");
      expect(state.wsUrl).toBe("wss://livekit.example.com");
      expect(state.error).toBeNull();
    });

    it("does not start session if connectionState is not idle", async () => {
      useConversationStore.setState({ connectionState: "connecting" });

      await useConversationStore.getState().startSession("free_talk");

      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();
    });

    it("handles health check error gracefully with Error instance", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(api.checkHealthReady).mockRejectedValue(new Error("Health check failed"));

      await useConversationStore.getState().startSession("free_talk");

      expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      expect(api.createSession).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe("Health check failed");
    });

    it("handles health check error with fallback message for non-Error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(api.checkHealthReady).mockRejectedValue("Unknown network error");

      await useConversationStore.getState().startSession("free_talk");

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe("服务不可用，请稍后再试或检查相关配置");
    });

    it("handles createSession / getSessionToken error with Error instance", async () => {
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockRejectedValue(new Error("Failed to create session"));

      await useConversationStore.getState().startSession("free_talk");

      expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      expect(api.createSession).toHaveBeenCalledWith("free_talk", undefined);
      expect(api.getSessionToken).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe("Failed to create session");
    });

    it("handles createSession / getSessionToken error with fallback message for non-Error", async () => {
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockRejectedValue("Session creation string error");

      await useConversationStore.getState().startSession("free_talk");

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe("连接失败");
    });
  });

  describe("endSession", () => {
    it("calls apiEndSession and updates connectionState to ended when sessionId exists", async () => {
      useConversationStore.setState({ sessionId: "sess-456", connectionState: "active" });
      vi.mocked(api.endSession).mockResolvedValue({} as api.Session);

      await useConversationStore.getState().endSession();

      expect(api.endSession).toHaveBeenCalledWith("sess-456");
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });

    it("updates connectionState to ended even if apiEndSession throws", async () => {
      useConversationStore.setState({ sessionId: "sess-456", connectionState: "active" });
      vi.mocked(api.endSession).mockRejectedValue(new Error("API error"));

      await useConversationStore.getState().endSession();

      expect(api.endSession).toHaveBeenCalledWith("sess-456");
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });

    it("does not call apiEndSession if sessionId is null", async () => {
      useConversationStore.setState({ sessionId: null, connectionState: "connecting" });

      await useConversationStore.getState().endSession();

      expect(api.endSession).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });
  });

  describe("setActive", () => {
    it("changes connectionState to active", () => {
      useConversationStore.setState({ connectionState: "connecting" });
      useConversationStore.getState().setActive();

      expect(useConversationStore.getState().connectionState).toBe("active");
    });
  });

  describe("setSelectedScenario", () => {
    it("sets selected scenario", () => {
      const scenario: api.CurriculumRecommendation = {
        scenario_name: "Job Interview",
        difficulty_cefr: "B2",
        category: "business",
        focus_skills: ["vocabulary"],
        system_prompt_template: "Prompt template",
      };

      useConversationStore.getState().setSelectedScenario(scenario);

      expect(useConversationStore.getState().selectedScenario).toEqual(scenario);

      useConversationStore.getState().setSelectedScenario(null);

      expect(useConversationStore.getState().selectedScenario).toBeNull();
    });
  });

  describe("setAgentError", () => {
    it("sets agent error and updates connectionState to ended", () => {
      useConversationStore.setState({ connectionState: "active" });
      const error = { code: "CUSTOM_TRACK_FAILED", message: "Audio track error" };

      useConversationStore.getState().setAgentError(error);

      const state = useConversationStore.getState();
      expect(state.agentError).toEqual(error);
      expect(state.connectionState).toBe("ended");
    });
  });

  describe("reset", () => {
    it("resets session connection state and error without changing appView or selectedScenario", () => {
      const scenario: api.CurriculumRecommendation = {
        scenario_name: "Coffee Shop",
        difficulty_cefr: "A2",
        category: "daily",
        focus_skills: ["listening"],
        system_prompt_template: "Prompt",
      };

      useConversationStore.setState({
        connectionState: "ended",
        appView: "session",
        sessionId: "sess-789",
        token: "token-123",
        wsUrl: "wss://test.com",
        error: "Some error",
        selectedScenario: scenario,
        agentError: { code: "ERR", message: "Msg" },
      });

      useConversationStore.getState().reset();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.sessionId).toBeNull();
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();
      expect(state.error).toBeNull();
      expect(state.agentError).toBeNull();
      // appView and selectedScenario should remain preserved in reset()
      expect(state.appView).toBe("session");
      expect(state.selectedScenario).toEqual(scenario);
    });
  });

  describe("goHome", () => {
    it("resets all store fields including appView and selectedScenario", () => {
      const scenario: api.CurriculumRecommendation = {
        scenario_name: "Coffee Shop",
        difficulty_cefr: "A2",
        category: "daily",
        focus_skills: ["listening"],
        system_prompt_template: "Prompt",
      };

      useConversationStore.setState({
        connectionState: "ended",
        appView: "session",
        sessionId: "sess-789",
        token: "token-123",
        wsUrl: "wss://test.com",
        error: "Some error",
        selectedScenario: scenario,
        agentError: { code: "ERR", message: "Msg" },
      });

      useConversationStore.getState().goHome();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.sessionId).toBeNull();
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();
      expect(state.error).toBeNull();
      expect(state.selectedScenario).toBeNull();
      expect(state.agentError).toBeNull();
    });
  });
});
