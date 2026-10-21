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
    expect(state.sessionGen).toBeGreaterThanOrEqual(0);
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

    it("drops stale health check result after goHome without polluting dashboard", async () => {
      let resolveHealth!: (val: { status: string }) => void;
      vi.mocked(api.checkHealthReady).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveHealth = resolve;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      // 用户在 health check 期间返回主页
      useConversationStore.getState().goHome();
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().connectionState).toBe("idle");

      // 迟到的 health check resolve
      resolveHealth({ status: "ok" });
      await promise;

      // 状态依然是 dashboard / idle，没有被迟到结果切到 session 视图
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(api.createSession).not.toHaveBeenCalled();
    });

    it("drops stale createSession result after reset without mutating state", async () => {
      let resolveCreate!: (session: api.Session) => void;
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalled();
      });

      // 用户重置
      useConversationStore.getState().reset();
      expect(useConversationStore.getState().sessionId).toBeNull();

      resolveCreate({
        id: "stale-sess",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      await promise;

      expect(useConversationStore.getState().sessionId).toBeNull();
      expect(api.getSessionToken).not.toHaveBeenCalled();
    });

    it("drops stale getSessionToken result after goHome", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValue({
        id: "sess-1",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalledWith("sess-1");
      });

      useConversationStore.getState().goHome();
      expect(useConversationStore.getState().token).toBeNull();

      resolveToken({ token: "stale-tok", ws_url: "wss://stale.com" });
      await promise;

      expect(useConversationStore.getState().token).toBeNull();
      expect(useConversationStore.getState().wsUrl).toBeNull();
    });

    it("isolates across identical connection states across generations (e.g. both connecting)", async () => {
      let resolveFirstCreate!: (s: api.Session) => void;
      let resolveSecondCreate!: (s: api.Session) => void;

      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });

      // 第一代
      vi.mocked(api.createSession).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstCreate = resolve;
          }),
      );
      const promise1 = useConversationStore.getState().startSession("free_talk");

      await vi.waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connecting");
      });

      // 重置并开始第二代（同样进入 connecting 状态）
      useConversationStore.getState().reset();
      vi.mocked(api.createSession).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondCreate = resolve;
          }),
      );
      const promise2 = useConversationStore.getState().startSession("free_talk");

      await vi.waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connecting");
      });

      // 第一代 createSession 迟到返回
      vi.mocked(api.getSessionToken).mockResolvedValue({
        token: "second-tok",
        ws_url: "wss://second.com",
      });
      resolveFirstCreate({
        id: "sess-gen1",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      await promise1;

      // 绝不能为第一代获取 Token
      expect(api.getSessionToken).not.toHaveBeenCalledWith("sess-gen1");

      // 第二代正常完成
      resolveSecondCreate({
        id: "sess-gen2",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      await promise2;

      expect(useConversationStore.getState().sessionId).toBe("sess-gen2");
      expect(api.getSessionToken).toHaveBeenCalledWith("sess-gen2");
    });
  });

  describe("endSession", () => {
    it("immediately clears token and wsUrl and sets state to ending before API resolves", async () => {
      let resolveApiEnd!: (s: api.Session) => void;
      vi.mocked(api.endSession).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveApiEnd = resolve;
          }),
      );

      useConversationStore.setState({
        sessionId: "sess-456",
        token: "tok-abc",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });

      const promise = useConversationStore.getState().endSession();

      // 在 API resolve 前观察：token/wsUrl 立即清空，进入 ending 状态
      const pendingState = useConversationStore.getState();
      expect(pendingState.connectionState).toBe("ending");
      expect(pendingState.token).toBeNull();
      expect(pendingState.wsUrl).toBeNull();
      expect(pendingState.error).toBeNull();
      expect(pendingState.sessionId).toBe("sess-456");

      resolveApiEnd({
        id: "sess-456",
        user_id: "u1",
        mode: "free_talk",
        status: "completed",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: "2025-01-01T00:10:00Z",
        transcripts: [],
      });
      await promise;

      expect(api.endSession).toHaveBeenCalledWith("sess-456");
      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(useConversationStore.getState().error).toBeNull();
    });

    it("deduplicates in-flight end calls without calling API multiple times", async () => {
      let resolveApiEnd!: (s: api.Session) => void;
      vi.mocked(api.endSession).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveApiEnd = resolve;
          }),
      );

      useConversationStore.setState({
        sessionId: "sess-dup",
        token: "tok-dup",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });

      const p1 = useConversationStore.getState().endSession();
      const p2 = useConversationStore.getState().endSession();
      const p3 = useConversationStore.getState().endSession();

      expect(api.endSession).toHaveBeenCalledTimes(1);

      resolveApiEnd({} as api.Session);
      await Promise.all([p1, p2, p3]);

      expect(api.endSession).toHaveBeenCalledTimes(1);
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });

    it("enters end_failed when apiEndSession rejects, keeping audio stopped and session intact", async () => {
      useConversationStore.setState({
        sessionId: "sess-fail",
        token: "tok-fail",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });
      vi.mocked(api.endSession).mockRejectedValue(new Error("Network timeout"));

      await useConversationStore.getState().endSession();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("end_failed");
      expect(state.error).toBe("Network timeout");
      expect(state.sessionId).toBe("sess-fail");
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();
    });

    it("allows retrying the same session from end_failed", async () => {
      useConversationStore.setState({
        sessionId: "sess-retry",
        token: null,
        wsUrl: null,
        connectionState: "end_failed",
        error: "Previous failure",
      });

      vi.mocked(api.endSession).mockResolvedValue({} as api.Session);

      await useConversationStore.getState().endSession();

      expect(api.endSession).toHaveBeenCalledWith("sess-retry");
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("ended");
      expect(state.error).toBeNull();
    });

    it("cancels local startup generation and does not call apiEndSession if sessionId is null", async () => {
      useConversationStore.setState({ sessionId: null, connectionState: "connecting" });

      await useConversationStore.getState().endSession();

      expect(api.endSession).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(useConversationStore.getState().error).toBeNull();
    });

    it("cancels startup during health check phase and drops late health response", async () => {
      let resolveHealth!: (val: { status: string }) => void;
      vi.mocked(api.checkHealthReady).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveHealth = resolve;
          }),
      );

      const startPromise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");
      expect(useConversationStore.getState().sessionId).toBeNull();

      // 在 health check 期间调用 endSession
      await useConversationStore.getState().endSession();
      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(api.endSession).not.toHaveBeenCalled();

      // 迟到的 health check 返回
      resolveHealth({ status: "ok" });
      await startPromise;

      // 绝不创建会话
      expect(api.createSession).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });

    it("cancels startup during createSession phase and drops late create response", async () => {
      let resolveCreate!: (s: api.Session) => void;
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );

      const startPromise = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalled();
      });
      expect(useConversationStore.getState().sessionId).toBeNull();

      // 在 createSession 在途期间调用 endSession
      await useConversationStore.getState().endSession();
      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(api.endSession).not.toHaveBeenCalled();

      // 迟到的 createSession 返回
      resolveCreate({
        id: "late-created",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      await startPromise;

      // 绝不获取 Token，绝不把 late-created 赋给已结束的会话
      expect(api.getSessionToken).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });

    it("saves sessionId immediately upon createSession and ends session properly while token is in-flight", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValue({
        id: "sess-created-token-pending",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );
      vi.mocked(api.endSession).mockResolvedValue({} as api.Session);

      const startPromise = useConversationStore.getState().startSession("free_talk");

      // 等待 createSession 完成，此时 sessionId 已保存，但 token 在途
      await vi.waitFor(() => {
        expect(useConversationStore.getState().sessionId).toBe("sess-created-token-pending");
        expect(useConversationStore.getState().token).toBeNull();
      });

      // 在 token 在途期间发起结束
      const endPromise = useConversationStore.getState().endSession();

      // 必须向服务端发起针对该 session 的 end 请求
      expect(api.endSession).toHaveBeenCalledWith("sess-created-token-pending");
      await endPromise;
      expect(useConversationStore.getState().connectionState).toBe("ended");

      // 随后迟到的 Token 返回
      resolveToken({ token: "late-token", ws_url: "wss://late.com" });
      await startPromise;

      // 迟到的 Token 绝不能复活已结束的会话
      expect(useConversationStore.getState().token).toBeNull();
      expect(useConversationStore.getState().wsUrl).toBeNull();
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });

    it("drops stale end response if user goes home during in-flight end", async () => {
      let resolveApiEnd!: (s: api.Session) => void;
      vi.mocked(api.endSession).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveApiEnd = resolve;
          }),
      );

      useConversationStore.setState({
        sessionId: "sess-stale",
        token: "tok",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });

      const promise = useConversationStore.getState().endSession();
      expect(useConversationStore.getState().connectionState).toBe("ending");

      // 用户返回主页
      useConversationStore.getState().goHome();
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();

      resolveApiEnd({} as api.Session);
      await promise;

      // 不得被迟到的 end 结果篡改为 ended
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();
    });

    it("does not overwrite new session if old session end completes late", async () => {
      let resolveOldEnd!: (s: api.Session) => void;
      vi.mocked(api.endSession).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveOldEnd = resolve;
          }),
      );

      useConversationStore.setState({
        sessionId: "sess-old",
        token: "tok-old",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });

      const oldEndPromise = useConversationStore.getState().endSession();

      // 用户重置并开启新会话 Session 2
      useConversationStore.getState().reset();
      useConversationStore.setState({
        sessionId: "sess-new",
        token: "tok-new",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });

      // 旧会话结束迟到完成
      resolveOldEnd({} as api.Session);
      await oldEndPromise;

      // 新会话状态绝不被篡改
      const currentState = useConversationStore.getState();
      expect(currentState.sessionId).toBe("sess-new");
      expect(currentState.token).toBe("tok-new");
      expect(currentState.connectionState).toBe("active");
    });
  });

  describe("setActive", () => {
    it("changes connectionState to active when connecting and token is present", () => {
      useConversationStore.setState({
        connectionState: "connecting",
        sessionId: "sess-1",
        token: "valid-tok",
      });
      useConversationStore.getState().setActive();

      expect(useConversationStore.getState().connectionState).toBe("active");
    });

    it("does not change state to active if token is null", () => {
      useConversationStore.setState({
        connectionState: "connecting",
        sessionId: "sess-1",
        token: null,
      });
      useConversationStore.getState().setActive();

      expect(useConversationStore.getState().connectionState).toBe("connecting");
    });

    it("does not revive ended or ending or end_failed states", () => {
      for (const nonConnecting of ["ending", "end_failed", "ended", "idle"] as const) {
        useConversationStore.setState({
          connectionState: nonConnecting,
          sessionId: "sess-1",
          token: "tok-1",
        });
        useConversationStore.getState().setActive();

        expect(useConversationStore.getState().connectionState).toBe(nonConnecting);
      }
    });

    it("rejects setActive when sessionId or sessionGen mismatch", () => {
      useConversationStore.setState({
        connectionState: "connecting",
        sessionId: "sess-actual",
        sessionGen: 5,
        token: "tok-1",
      });

      // 不同的 sessionId
      useConversationStore.getState().setActive("sess-different", 5);
      expect(useConversationStore.getState().connectionState).toBe("connecting");

      // 不同的 sessionGen
      useConversationStore.getState().setActive("sess-actual", 4);
      expect(useConversationStore.getState().connectionState).toBe("connecting");

      // 匹配时成功
      useConversationStore.getState().setActive("sess-actual", 5);
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
    it("sets agent error, clears tokens, and updates connectionState to ended", () => {
      useConversationStore.setState({
        connectionState: "active",
        token: "tok-x",
        wsUrl: "wss://lk.test",
      });
      const error = { code: "CUSTOM_TRACK_FAILED", message: "Audio track error" };

      useConversationStore.getState().setAgentError(error);

      const state = useConversationStore.getState();
      expect(state.agentError).toEqual(error);
      expect(state.connectionState).toBe("ended");
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();
    });

    it("cancels in-flight startup generation when agent error occurs", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValue({
        id: "sess-error-flight",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );

      const startPromise = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(useConversationStore.getState().sessionId).toBe("sess-error-flight");
      });

      // 发生 Agent 错误终止会话
      useConversationStore
        .getState()
        .setAgentError({ code: "AUDIO_ERR", message: "Microphone error" });
      expect(useConversationStore.getState().connectionState).toBe("ended");

      // 迟到的 Token 返回
      resolveToken({ token: "tok-late-err", ws_url: "wss://late.com" });
      await startPromise;

      // 状态依然是 ended，未被 token 复活
      expect(useConversationStore.getState().token).toBeNull();
      expect(useConversationStore.getState().connectionState).toBe("ended");
    });
  });

  describe("reset", () => {
    it("resets session connection state and increments generation without changing appView or selectedScenario", () => {
      const scenario: api.CurriculumRecommendation = {
        scenario_name: "Coffee Shop",
        difficulty_cefr: "A2",
        category: "daily",
        focus_skills: ["listening"],
        system_prompt_template: "Prompt",
      };

      const initialGen = useConversationStore.getState().sessionGen;

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
      expect(state.appView).toBe("session");
      expect(state.selectedScenario).toEqual(scenario);
      expect(state.sessionGen).toBeGreaterThan(initialGen);
    });
  });

  describe("goHome", () => {
    it("resets all store fields and increments generation", () => {
      const scenario: api.CurriculumRecommendation = {
        scenario_name: "Coffee Shop",
        difficulty_cefr: "A2",
        category: "daily",
        focus_skills: ["listening"],
        system_prompt_template: "Prompt",
      };

      const initialGen = useConversationStore.getState().sessionGen;

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
      expect(state.sessionGen).toBeGreaterThan(initialGen);
    });
  });
});
