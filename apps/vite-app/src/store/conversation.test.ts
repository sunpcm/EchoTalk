import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useConversationStore } from "./conversation";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";

vi.mock("@/lib/api", () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    getCallCapabilities: vi.fn(),
    checkHealthReady: vi.fn(),
    createSession: vi.fn(),
    getSessionDetail: vi.fn(),
    getSessionToken: vi.fn(),
    endSession: vi.fn(),
    isValidUuid: vi.fn(
      (val: unknown): val is string => typeof val === "string" && UUID_REGEX.test(val),
    ),
  };
});

const authSnapshotListeners = new Set<(snap: auth.AuthSnapshot) => void>();

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn(
    (a: any, b: any) => a === b || (a && b && a.issuer === b.issuer && a.subject === b.subject),
  ),
  subscribeAuthSnapshot: vi.fn((listener: (snap: auth.AuthSnapshot) => void) => {
    authSnapshotListeners.add(listener);
    return () => {
      authSnapshotListeners.delete(listener);
    };
  }),
}));

describe("useConversationStore", () => {
  beforeEach(() => {
    useConversationStore.getState().goHome();
    vi.clearAllMocks();
    authSnapshotListeners.clear();
    vi.mocked(auth.getAuthSnapshot).mockReturnValue({
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);
    vi.mocked(api.getCallCapabilities).mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "disabled",
    });
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

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
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

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
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

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
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
      await vi.waitFor(() => {
        expect(api.checkHealthReady).toHaveBeenCalled();
      });
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

    it("refuses to start when auth snapshot is not authenticated or principal is null", async () => {
      vi.mocked(auth.getAuthSnapshot).mockReturnValueOnce({
        state: "anonymous",
        principal: null,
      });

      await useConversationStore.getState().startSession("free_talk");

      expect(api.getCallCapabilities).not.toHaveBeenCalled();
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().error).toBe(zhCN.conversation.notAuthenticated);
    });

    it("gates livekit_cloud mode, remaining on dashboard with localized message and no side effects", async () => {
      vi.mocked(api.getCallCapabilities).mockResolvedValueOnce({
        protocol_version: 1,
        call_lease_mode: "livekit_cloud",
      });

      await useConversationStore.getState().startSession("free_talk");

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();
      expect(api.getSessionToken).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe("当前客户端尚未支持此通话模式");
    });

    it("gates capability check failure, remaining on dashboard with generic message and allowing retry", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(api.getCallCapabilities).mockRejectedValueOnce(
        new Error("Sensitive internal backend 500 error details"),
      );

      await useConversationStore.getState().startSession("free_talk");

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe("通话能力检查失败，请稍后重试");
      // 绝不回显服务端敏感错误
      expect(state.error).not.toContain("Sensitive internal backend");

      // 允许用户显式重试
      vi.mocked(api.getCallCapabilities).mockResolvedValueOnce({
        protocol_version: 1,
        call_lease_mode: "disabled",
      });
      vi.mocked(api.checkHealthReady).mockResolvedValueOnce({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValueOnce({
        id: "retry-sess",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockResolvedValueOnce({
        token: "retry-token",
        ws_url: "wss://livekit.test",
      });

      await useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().sessionId).toBe("retry-sess");
      expect(useConversationStore.getState().connectionState).toBe("connecting");
    });

    it("deduplicates in-flight startSession calls during capabilities check", async () => {
      let resolveCaps!: (val: api.CallCapabilitiesResponse) => void;
      vi.mocked(api.getCallCapabilities).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCaps = resolve;
          }),
      );

      const p1 = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      // 第二次并发调用
      const p2 = useConversationStore.getState().startSession("free_talk");

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);

      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValue({
        id: "sess-dedup",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockResolvedValue({
        token: "tok-dedup",
        ws_url: "wss://livekit.test",
      });

      resolveCaps({ protocol_version: 1, call_lease_mode: "disabled" });
      await Promise.all([p1, p2]);

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
      expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      expect(api.createSession).toHaveBeenCalledTimes(1);
    });

    it("drops late capability result if user calls goHome during capability check", async () => {
      let resolveCaps!: (val: api.CallCapabilitiesResponse) => void;
      vi.mocked(api.getCallCapabilities).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCaps = resolve;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      // 用户返回主页
      useConversationStore.getState().goHome();
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().connectionState).toBe("idle");

      // 迟到的 capabilities 返回
      resolveCaps({ protocol_version: 1, call_lease_mode: "disabled" });
      await promise;

      // 绝不继续执行健康检查或创建会话
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().connectionState).toBe("idle");
    });

    it("drops late capability result if auth revision changes for the same principal, resets to idle, and allows new start", async () => {
      let resolveCaps!: (val: api.CallCapabilitiesResponse) => void;
      vi.mocked(api.getCallCapabilities).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCaps = resolve;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      // 模拟同 principal 新 revision（例如刷新了 Token 或会话被重新签发）
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 迟到的 capabilities 返回
      resolveCaps({ protocol_version: 1, call_lease_mode: "disabled" });
      await promise;

      // 绝不能继续用旧启动意图调用健康检查或创建会话
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();

      // 必须释放槽位回到可重试状态
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.sessionId).toBeNull();
      expect(state.token).toBeNull();

      // 新的显式开始可以成功执行
      vi.mocked(api.getCallCapabilities).mockResolvedValueOnce({
        protocol_version: 1,
        call_lease_mode: "disabled",
      });
      vi.mocked(api.checkHealthReady).mockResolvedValueOnce({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValueOnce({
        id: "new-sess",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockResolvedValueOnce({
        token: "new-tok",
        ws_url: "wss://livekit.test",
      });

      await useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().sessionId).toBe("new-sess");
      expect(useConversationStore.getState().token).toBe("new-tok");
      expect(useConversationStore.getState().connectionState).toBe("connecting");
    });

    it("resets to idle on capability rejection when revision changed and allows new start", async () => {
      let rejectCaps!: (err: unknown) => void;
      vi.mocked(api.getCallCapabilities).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectCaps = reject;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      rejectCaps(new Error("Network failed"));
      await promise;

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.sessionId).toBeNull();
      expect(state.token).toBeNull();
    });

    it("releases slot to idle if revision changes during health check resolve", async () => {
      let resolveHealth!: (val: { status: string }) => void;
      vi.mocked(api.checkHealthReady).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveHealth = resolve;
          }),
      );
      const pHealth = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      resolveHealth({ status: "ok" });
      await pHealth;
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(api.createSession).not.toHaveBeenCalled();
    });

    it("releases slot to idle if revision changes during health check reject", async () => {
      let rejectHealth!: (err: unknown) => void;
      vi.mocked(api.checkHealthReady).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectHealth = reject;
          }),
      );
      const pHealthRej = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      rejectHealth(new Error("Health failed"));
      await pHealthRej;
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(api.createSession).not.toHaveBeenCalled();
    });

    it("releases slot to idle if revision changes during createSession resolve", async () => {
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      let resolveCreate!: (s: api.Session) => void;
      vi.mocked(api.createSession).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );
      const pCreate = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalledTimes(1);
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      resolveCreate({
        id: "sess-late",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      await pCreate;
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();
      expect(api.getSessionToken).not.toHaveBeenCalled();
    });

    it("releases slot to idle if revision changes during createSession reject", async () => {
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      let rejectCreate!: (err: unknown) => void;
      vi.mocked(api.createSession).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectCreate = reject;
          }),
      );
      const pCreateRej = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.createSession).toHaveBeenCalledTimes(1);
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      rejectCreate(new Error("Create error"));
      await pCreateRej;
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();
    });

    it("releases slot to idle if revision changes during getSessionToken resolve", async () => {
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValueOnce({
        id: "sess-tok-phase",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      let resolveTok!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.getSessionToken).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTok = resolve;
          }),
      );
      const pTok = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalledWith("sess-tok-phase");
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      resolveTok({ token: "late-tok", ws_url: "wss://lk.test" });
      await pTok;
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().token).toBeNull();
      expect(useConversationStore.getState().sessionId).toBeNull();
    });

    it("releases slot to idle if revision changes during getSessionToken reject", async () => {
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValueOnce({
        id: "sess-tok-rej",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      let rejectTok!: (err: unknown) => void;
      vi.mocked(api.getSessionToken).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectTok = reject;
          }),
      );
      const pTokRej = useConversationStore.getState().startSession("free_talk");
      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalledWith("sess-tok-rej");
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      rejectTok(new Error("Token failed"));
      await pTokRej;
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().token).toBeNull();
    });

    it("releases slot when principal changes with different issuer and same subject", async () => {
      let resolveCaps!: (val: api.CallCapabilitiesResponse) => void;
      vi.mocked(api.getCallCapabilities).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCaps = resolve;
          }),
      );

      const promise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      // 切换不同 issuer 但同 subject 的 principal
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "https://other-issuer.example.com", subject: "user-1" },
      });

      resolveCaps({ protocol_version: 1, call_lease_mode: "disabled" });
      await promise;

      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.createSession).not.toHaveBeenCalled();
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.sessionId).toBeNull();
      expect(state.token).toBeNull();
    });

    it("immediately unblocks in-flight startup upon auth snapshot event without waiting for network", async () => {
      let resolveCaps!: (val: api.CallCapabilitiesResponse) => void;
      vi.mocked(api.getCallCapabilities).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCaps = resolve;
          }),
      );

      const oldPromise = useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().connectionState).toBe("checking_health");

      // 触发认证事件（模拟 OIDC 事件或 Token 刷新更新 snapshot）
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      for (const listener of Array.from(authSnapshotListeners)) {
        listener({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
        });
      }

      // 立即恢复为 idle / dashboard，无需等待旧网络完成
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");

      // 用户立即发起新的显式开始
      vi.mocked(api.getCallCapabilities).mockResolvedValueOnce({
        protocol_version: 1,
        call_lease_mode: "disabled",
      });
      vi.mocked(api.checkHealthReady).mockResolvedValueOnce({ status: "ok" });
      vi.mocked(api.createSession).mockResolvedValueOnce({
        id: "new-concurrent-sess",
        user_id: "u1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.getSessionToken).mockResolvedValueOnce({
        token: "new-concurrent-token",
        ws_url: "wss://livekit.test",
      });

      await useConversationStore.getState().startSession("free_talk");
      expect(useConversationStore.getState().sessionId).toBe("new-concurrent-sess");
      expect(useConversationStore.getState().token).toBe("new-concurrent-token");
      expect(useConversationStore.getState().connectionState).toBe("connecting");

      // 随后旧网络的 capabilities 迟到返回，绝不能冲掉新会话
      resolveCaps({ protocol_version: 1, call_lease_mode: "disabled" });
      await oldPromise;

      expect(useConversationStore.getState().sessionId).toBe("new-concurrent-sess");
      expect(useConversationStore.getState().token).toBe("new-concurrent-token");
      expect(useConversationStore.getState().connectionState).toBe("connecting");
    });

    it("does not abort an ongoing active call on auth snapshot update for the same principal", () => {
      useConversationStore.setState({
        sessionId: "active-call-sess",
        token: "active-token",
        wsUrl: "wss://lk.test",
        connectionState: "active",
      });

      // 触发同 principal 新 revision 认证事件
      vi.mocked(auth.getAuthRevision).mockReturnValue(5);
      for (const listener of Array.from(authSnapshotListeners)) {
        listener({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
        });
      }

      // 正常通话绝不被中止
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("active");
      expect(state.sessionId).toBe("active-call-sess");
      expect(state.token).toBe("active-token");
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
      await vi.waitFor(() => {
        expect(api.checkHealthReady).toHaveBeenCalled();
      });
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

  describe("resumeSession", () => {
    const validUuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const validOrigin = {
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
      revision: 1,
    };

    it("successfully resumes a session with valid origin and active session details without creating a new session", async () => {
      const mockDetail: api.Session = {
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      };
      const mockTokenRes = {
        token: "resumed-livekit-token",
        ws_url: "wss://livekit.resumed.example.com",
      };

      vi.mocked(api.getCallCapabilities).mockResolvedValue({
        protocol_version: 1,
        call_lease_mode: "disabled",
      });
      vi.mocked(api.getSessionDetail).mockResolvedValue(mockDetail);
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockResolvedValue(mockTokenRes);

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
      expect(api.getSessionDetail).toHaveBeenCalledWith(validUuid);
      expect(api.checkHealthReady).toHaveBeenCalledTimes(1);
      expect(api.getSessionToken).toHaveBeenCalledWith(validUuid);
      expect(api.createSession).not.toHaveBeenCalled();
      expect(api.endSession).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("connecting");
      expect(state.appView).toBe("session");
      expect(state.sessionId).toBe(validUuid);
      expect(state.token).toBe("resumed-livekit-token");
      expect(state.wsUrl).toBe("wss://livekit.resumed.example.com");
      expect(state.error).toBeNull();
    });

    it("atomically publishes sessionId, token, wsUrl only after token succeeds, keeping sessionId null before that", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.getSessionDetail).mockResolvedValue({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );

      const promise = useConversationStore.getState().resumeSession(validUuid, validOrigin);

      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalledWith(validUuid);
      });

      // Token 在途期间：sessionId 绝不能提前写入！
      expect(useConversationStore.getState().sessionId).toBeNull();
      expect(useConversationStore.getState().token).toBeNull();
      expect(useConversationStore.getState().connectionState).toBe("checking_health");
      expect(useConversationStore.getState().appView).toBe("dashboard");

      resolveToken({ token: "tok-1", ws_url: "wss://lk.test" });
      await promise;

      // Token 成功后原子发布
      expect(useConversationStore.getState().sessionId).toBe(validUuid);
      expect(useConversationStore.getState().token).toBe("tok-1");
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().appView).toBe("session");
    });

    it("REC-01 regression: checks attribution and drops call if synchronous store subscriber cancels/resets on checking_health set", async () => {
      const unsub = useConversationStore.subscribe((state) => {
        if (state.connectionState === "checking_health") {
          // 同步 store 订阅在 set checking_health 回调里返回主页
          useConversationStore.getState().goHome();
        }
      });

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);
      unsub();

      // 绝不能发出任何 API 请求！
      expect(api.getCallCapabilities).not.toHaveBeenCalled();
      expect(api.getSessionDetail).not.toHaveBeenCalled();
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.getSessionToken).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");
    });

    it("gates livekit_cloud capability mode, remaining on dashboard with localized message and zero token/detail calls", async () => {
      vi.mocked(api.getCallCapabilities).mockResolvedValueOnce({
        protocol_version: 1,
        call_lease_mode: "livekit_cloud",
      });

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
      expect(api.getSessionDetail).not.toHaveBeenCalled();
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.getSessionToken).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe(zhCN.conversation.capabilitiesUnsupported);
    });

    it("refuses to resume and makes zero API calls when sessionId is not a valid UUID", async () => {
      await useConversationStore.getState().resumeSession("not-a-valid-uuid", validOrigin);

      expect(api.getCallCapabilities).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("idle");
    });

    it("refuses to resume and makes zero API calls when origin is invalid or does not match auth snapshot/revision", async () => {
      // 1. 无效 origin 结构
      await useConversationStore.getState().resumeSession(validUuid, null as any);
      expect(api.getCallCapabilities).not.toHaveBeenCalled();

      // 2. revision 不匹配
      await useConversationStore.getState().resumeSession(validUuid, {
        principal: validOrigin.principal,
        revision: 999,
      });
      expect(api.getCallCapabilities).not.toHaveBeenCalled();

      // 3. principal 不匹配
      await useConversationStore.getState().resumeSession(validUuid, {
        principal: { issuer: "https://other.com", subject: "user-1" },
        revision: 1,
      });
      expect(api.getCallCapabilities).not.toHaveBeenCalled();

      // 4. 未登录
      vi.mocked(auth.getAuthSnapshot).mockReturnValueOnce({ state: "anonymous", principal: null });
      await useConversationStore.getState().resumeSession(validUuid, validOrigin);
      expect(api.getCallCapabilities).not.toHaveBeenCalled();
    });

    it("rejects completed or ended session detail without fetching token", async () => {
      vi.mocked(api.getSessionDetail).mockResolvedValueOnce({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "completed",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: "2025-01-01T00:10:00Z",
        transcripts: [],
      });

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      expect(api.getSessionDetail).toHaveBeenCalledWith(validUuid);
      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.getSessionToken).not.toHaveBeenCalled();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.error).toBe(zhCN.activeSessions.resumeError);
    });

    it("rejects mismatched ID or malformed session detail", async () => {
      vi.mocked(api.getSessionDetail).mockResolvedValueOnce({
        id: "e0000000-0000-0000-0000-000000000000",
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      expect(api.getSessionToken).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().error).toBe(zhCN.activeSessions.resumeError);
    });

    it("supports case-insensitive UUID matching in session detail", async () => {
      const upperUuid = validUuid.toUpperCase();
      vi.mocked(api.getSessionDetail).mockResolvedValueOnce({
        id: upperUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockResolvedValue({
        token: "tok-case",
        ws_url: "wss://lk.test",
      });

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().sessionId).toBe(validUuid);
    });

    it("rejects invalid or empty token response without publishing sessionId", async () => {
      vi.mocked(api.getSessionDetail).mockResolvedValueOnce({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockResolvedValueOnce({
        token: "",
        ws_url: "wss://lk.test",
      });

      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      expect(useConversationStore.getState().sessionId).toBeNull();
      expect(useConversationStore.getState().token).toBeNull();
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().error).toBe(zhCN.activeSessions.resumeError);
    });

    it("drops late responses and releases slot if user calls goHome during detail or token fetch", async () => {
      let resolveDetail!: (s: api.Session) => void;
      vi.mocked(api.getSessionDetail).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDetail = resolve;
          }),
      );

      const promise = useConversationStore.getState().resumeSession(validUuid, validOrigin);

      await vi.waitFor(() => {
        expect(api.getSessionDetail).toHaveBeenCalled();
      });

      useConversationStore.getState().goHome();
      expect(useConversationStore.getState().connectionState).toBe("idle");

      resolveDetail({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      await promise;

      expect(api.checkHealthReady).not.toHaveBeenCalled();
      expect(api.getSessionToken).not.toHaveBeenCalled();
      expect(useConversationStore.getState().sessionId).toBeNull();
    });

    it("drops late responses and releases slot when auth snapshot changes during in-flight resume", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.getSessionDetail).mockResolvedValue({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );

      const oldPromise = useConversationStore.getState().resumeSession(validUuid, validOrigin);
      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalled();
      });

      // 触发换号或退出事件
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      for (const listener of Array.from(authSnapshotListeners)) {
        listener({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        });
      }

      // 槽位立即释放回 idle
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();

      // 旧 Token 迟到返回，绝不污染
      resolveToken({ token: "late-tok", ws_url: "wss://late.test" });
      await oldPromise;

      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();
      expect(useConversationStore.getState().token).toBeNull();
    });

    it("drops late responses and releases slot when web lifecycle suspends during in-flight resume", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.getSessionDetail).mockResolvedValue({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );

      const promise = useConversationStore.getState().resumeSession(validUuid, validOrigin);
      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalled();
      });

      // 派发 visibilitychange 到 hidden
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(useConversationStore.getState().connectionState).toBe("idle");

      resolveToken({ token: "tok-hide", ws_url: "wss://lk.test" });
      await promise;

      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();

      // 恢复 visible
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
        writable: true,
      });
    });

    it("calling endSession during in-flight resume cancels local startup and does not call apiEndSession", async () => {
      let resolveToken!: (val: { token: string; ws_url: string }) => void;
      vi.mocked(api.getSessionDetail).mockResolvedValue({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );

      const resumePromise = useConversationStore.getState().resumeSession(validUuid, validOrigin);
      await vi.waitFor(() => {
        expect(api.getSessionToken).toHaveBeenCalled();
      });

      // 用户在恢复在途期间调用 endSession
      await useConversationStore.getState().endSession();

      // 由于此时 sessionId 仍为 null，本地代际取消，绝不能调用 api.endSession
      expect(api.endSession).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("ended");

      // 迟到的 Token 返回
      resolveToken({ token: "late-resumed", ws_url: "wss://lk.test" });
      await resumePromise;

      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(useConversationStore.getState().token).toBeNull();
    });

    it("deduplicates concurrent calls to startSession and resumeSession", async () => {
      let resolveDetail!: (s: api.Session) => void;
      vi.mocked(api.getSessionDetail).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDetail = resolve;
          }),
      );

      const p1 = useConversationStore.getState().resumeSession(validUuid, validOrigin);
      await vi.waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("checking_health");
      });

      // 在途期间调用 startSession 和 resumeSession
      await useConversationStore.getState().startSession("free_talk");
      await useConversationStore.getState().resumeSession(validUuid, validOrigin);

      // capabilities 仅在最初那次调用了一次
      expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);

      resolveDetail({
        id: validUuid,
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      });
      vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ok" });
      vi.mocked(api.getSessionToken).mockResolvedValue({
        token: "tok-dedup",
        ws_url: "wss://lk.test",
      });

      await p1;
      expect(useConversationStore.getState().sessionId).toBe(validUuid);
      expect(useConversationStore.getState().connectionState).toBe("connecting");
    });
  });

  describe("Agent dispatch failure and deduplication (CP-02 §2, §3)", () => {
    it("markDispatched only succeeds once per sessionId and sessionGen pair", () => {
      const store = useConversationStore.getState();
      expect(store.markDispatched("sess-1", 1)).toBe(true);
      // 同一 pair 重复调用返回 false
      expect(store.markDispatched("sess-1", 1)).toBe(false);

      // 新代际允许再次成功
      expect(store.markDispatched("sess-1", 2)).toBe(true);
      expect(store.markDispatched("sess-1", 2)).toBe(false);

      // 新 session 允许再次成功
      expect(store.markDispatched("sess-2", 2)).toBe(true);
      expect(store.markDispatched("sess-2", 2)).toBe(false);
    });

    it("failDispatch clears token and wsUrl and sets state to dispatch_failed when matching", () => {
      useConversationStore.setState({
        sessionId: "sess-fail-target",
        sessionGen: 3,
        token: "tok-to-clear",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
      });

      // 不同的 sessionId 忽略
      useConversationStore.getState().failDispatch("sess-other", 3);
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().token).toBe("tok-to-clear");

      // 不同的 sessionGen 忽略
      useConversationStore.getState().failDispatch("sess-fail-target", 2);
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().token).toBe("tok-to-clear");

      // 匹配时执行
      useConversationStore.getState().failDispatch("sess-fail-target", 3);
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("dispatch_failed");
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();
      expect(state.sessionId).toBe("sess-fail-target");
    });

    it("failDispatch does not mutate state when already ended, ending, or idle", () => {
      for (const nonActive of ["ended", "ending", "end_failed", "idle"] as const) {
        useConversationStore.setState({
          sessionId: "sess-ignore",
          sessionGen: 1,
          token: null,
          connectionState: nonActive,
        });

        useConversationStore.getState().failDispatch("sess-ignore", 1);
        expect(useConversationStore.getState().connectionState).toBe(nonActive);
      }
    });

    it("setActive cannot revive dispatch_failed state", () => {
      useConversationStore.setState({
        sessionId: "sess-cannot-revive",
        sessionGen: 1,
        token: null,
        connectionState: "dispatch_failed",
      });

      useConversationStore.getState().setActive("sess-cannot-revive", 1);
      expect(useConversationStore.getState().connectionState).toBe("dispatch_failed");
    });

    it("goHome resets dispatch_failed state to idle and increments generation", () => {
      useConversationStore.setState({
        sessionId: "sess-go-home",
        sessionGen: 1,
        token: null,
        connectionState: "dispatch_failed",
        appView: "session",
        dispatchedGen: 1,
        dispatchedSessionId: "sess-go-home",
      });

      useConversationStore.getState().goHome();

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("idle");
      expect(state.appView).toBe("dashboard");
      expect(state.sessionId).toBeNull();
      expect(state.sessionGen).toBe(2);
      expect(state.dispatchedGen).toBeNull();
      expect(state.dispatchedSessionId).toBeNull();
    });
  });
});
