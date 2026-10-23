import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { useAssessmentStore } from "@/store/assessment";
import { usePollingAssessment } from "./usePollingAssessment";

const fakeAppListeners = new Set<(state: { isActive: boolean }) => void>();
let fakeAppGetState = vi.fn().mockImplementation(() => Promise.resolve({ isActive: true }));
let fakeAppAddListener = vi
  .fn()
  .mockImplementation((_event: string, listener: (state: { isActive: boolean }) => void) => {
    fakeAppListeners.add(listener);
    return Promise.resolve({
      remove: vi.fn().mockImplementation(() => {
        fakeAppListeners.delete(listener);
        return Promise.resolve();
      }),
    });
  });

vi.mock("@capacitor/app", () => ({
  App: {
    getState: (...args: unknown[]) => fakeAppGetState(...args),
    addListener: (...args: unknown[]) => fakeAppAddListener(...args),
  },
}));

let mockAuthSnapshot: auth.AuthSnapshot = {
  state: "authenticated",
  principal: { issuer: "https://auth.example.com", subject: "user-1" },
};
let mockAuthRevision = 1;
const authListeners = new Set<(snap: auth.AuthSnapshot) => void>();

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof auth>();
  return {
    ...actual,
    getAuthSnapshot: () => mockAuthSnapshot,
    getAuthRevision: () => mockAuthRevision,
    subscribeAuthSnapshot: (listener: (snap: auth.AuthSnapshot) => void) => {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    },
  };
});

vi.mock("@/lib/api", () => ({
  getAnalysisStatus: vi.fn(),
  retryAnalysis: vi.fn(),
  getAssessment: vi.fn(),
  getGrammarErrors: vi.fn(),
  getKnowledgeStates: vi.fn(),
}));

const baseJob: api.AnalysisStatusResponse = {
  session_id: "session-1",
  status: "pending",
  attempt_count: 0,
  error_code: null,
  retryable: false,
  started_at: null,
  finished_at: null,
  updated_at: "2026-09-21T00:00:00Z",
};

const baseAssessment: api.AssessmentResponse = {
  id: "assessment-1",
  session_id: "session-1",
  overall_score: 92,
  phoneme_alignment: [],
  source: "test",
  provider: null,
  model_version: "v1",
  is_synthetic: false,
  confidence: 0.9,
  provider_response_ref: null,
  created_at: "2026-09-21T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePollingAssessment hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAssessmentStore.getState().reset();
    vi.clearAllMocks();

    mockAuthSnapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    };
    mockAuthRevision = 1;
    authListeners.clear();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("初始组合与未知状态", () => {
    it("sessionId 为 null 时不发起任何请求与监听", () => {
      renderHook(() => usePollingAssessment(null));

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
      expect(api.getAssessment).not.toHaveBeenCalled();
      expect(authListeners.size).toBe(0);
    });

    it("sessionId 为空字符串时不发起任何请求", () => {
      renderHook(() => usePollingAssessment(""));

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
      expect(authListeners.size).toBe(0);
    });

    it("未认证 (anonymous 或无 principal) 时不发起任何请求与监听", () => {
      mockAuthSnapshot = { state: "anonymous", principal: null };

      renderHook(() => usePollingAssessment("session-1"));

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
      expect(authListeners.size).toBe(0);
    });

    it("初始 visibility=unknown 且 online=null 时保持兼容并执行读取", async () => {
      Object.defineProperty(document, "visibilityState", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, "onLine", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);
      vi.mocked(api.getKnowledgeStates).mockResolvedValue([]);

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledWith("session-1");
      expect(api.getAssessment).toHaveBeenCalledWith("session-1");
    });

    it("初始 visibility=hidden 时不发起初始读取", () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
        writable: true,
      });

      renderHook(() => usePollingAssessment("session-1"));

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
    });

    it("初始 online=false 时不发起初始读取", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });

      renderHook(() => usePollingAssessment("session-1"));

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
    });
  });

  describe("pending 退避与终态停止", () => {
    it("遵循 1s -> 2s -> 4s -> 5s (最大5s) 串行退避策略", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));

      // 首次立即执行 (attempt 1)
      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 1s 退避 (attempt 2)
      await act(async () => {
        vi.advanceTimersByTime(999);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);

      // 2s 退避 (attempt 3)
      await act(async () => {
        vi.advanceTimersByTime(1999);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(3);

      // 4s 退避 (attempt 4)
      await act(async () => {
        vi.advanceTimersByTime(3999);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(3);
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(4);

      // 5s 上限退避 (attempt 5)
      await act(async () => {
        vi.advanceTimersByTime(4999);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(4);
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(5);
    });

    it("succeeded 时拉取结果与一次 knowledge 并停止计时器", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);
      vi.mocked(api.getKnowledgeStates).mockResolvedValue([]);

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(api.getAssessment).toHaveBeenCalledWith("session-1");
      expect(api.getGrammarErrors).toHaveBeenCalledWith("session-1");
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);

      // 前进计时器确认不会再轮询
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);
    });

    it("failed 时停止计时器且不调用 knowledge", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "failed",
        error_code: "timeout",
      });

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.getAssessment).not.toHaveBeenCalled();
      expect(api.getKnowledgeStates).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });

    it("网络/协议错误时停止自动循环", async () => {
      vi.mocked(api.getAnalysisStatus).mockRejectedValue(new Error("500 Internal Error"));

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(useAssessmentStore.getState().loadState).toBe("error");

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("前后台与网络生命周期恢复与合并", () => {
    it("页面进入后台 (suspend) 时清理定时器且不轮询", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 进入后台
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // 原本 1s 的定时器已清理，不应触发请求
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });

    it("页面从后台恢复前台 (resume) 时立即发起查询", async () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
        writable: true,
      });

      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));
      expect(api.getAnalysisStatus).not.toHaveBeenCalled();

      // 切回前台
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });

    it("离线 (offline) 时清理定时器，恢复联网 (online) 且非 hidden 时立即查询", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 离线
      await act(async () => {
        Object.defineProperty(navigator, "onLine", {
          value: false,
          configurable: true,
          writable: true,
        });
        window.dispatchEvent(new Event("offline"));
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 联网恢复
      await act(async () => {
        Object.defineProperty(navigator, "onLine", {
          value: true,
          configurable: true,
          writable: true,
        });
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);
    });

    it("当前已有请求在途时，重复的合格 resume 与 connectivity 事件合并，不排队重放", async () => {
      const def = deferred<api.AnalysisStatusResponse>();
      vi.mocked(api.getAnalysisStatus).mockReturnValue(def.promise);

      renderHook(() => usePollingAssessment("session-1"));

      // 首次请求已在途
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 连续多次合格事件触发
      await act(async () => {
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // 合并，不新增请求
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 完成当前请求
      await act(async () => {
        def.resolve({ ...baseJob, status: "pending" });
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });

    it("status succeeded 且 knowledge 挂起在途时，重复的 pageshow 和 online 合并，不重复请求 status 或 knowledge", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);

      const defKnowledge = deferred<api.KnowledgeStateResponse[]>();
      vi.mocked(api.getKnowledgeStates).mockReturnValue(defKnowledge.promise);

      renderHook(() => usePollingAssessment("session-1"));

      // 等待 status 与 assessment/grammar 完成，进入 knowledge 挂起在途状态
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);

      // 在 knowledge 仍挂起时触发 pageshow 和 online
      await act(async () => {
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("online"));
      });

      // 应当合并，status 和 knowledge 仍各保持 1 次
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);

      // 完成 knowledge
      await act(async () => {
        defKnowledge.resolve([]);
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);
    });

    it("前台恢复只发起 GET 查询，不调用 retryAnalysis POST", async () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
        writable: true,
      });

      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.retryAnalysis).not.toHaveBeenCalled();
    });
  });

  describe("挂起旧请求不阻新循环 & 旧成功/失败/finally 隔离", () => {
    it("旧请求在后台迟到完成不回写数据、不污染新槽位、不触发 knowledge", async () => {
      const defOld = deferred<api.AnalysisStatusResponse>();
      const defNew = deferred<api.AnalysisStatusResponse>();

      // 首次请求挂起
      vi.mocked(api.getAnalysisStatus).mockReturnValueOnce(defOld.promise);

      renderHook(() => usePollingAssessment("session-1"));
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 进入后台 (suspend)
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // 切回前台 (resume)，新请求立即启动，不受挂起旧请求阻塞
      vi.mocked(api.getAnalysisStatus).mockReturnValueOnce(defNew.promise);
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);

      // 迟到的旧请求返回 succeeded
      await act(async () => {
        defOld.resolve({ ...baseJob, status: "succeeded" });
        await Promise.resolve();
        await Promise.resolve();
      });

      // 旧请求不应拉取评估结果或 knowledge
      expect(api.getAssessment).not.toHaveBeenCalled();
      expect(api.getKnowledgeStates).not.toHaveBeenCalled();

      // 新请求正常返回 pending
      await act(async () => {
        defNew.resolve({ ...baseJob, status: "pending" });
        await Promise.resolve();
      });

      expect(useAssessmentStore.getState().loadState).toBe("pending");
    });

    it("挂起旧 knowledge 在后台作废后前台新请求推进且旧写隔离", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);

      const defKnowledgeOld = deferred<api.KnowledgeStateResponse[]>();
      const defKnowledgeNew = deferred<api.KnowledgeStateResponse[]>();

      vi.mocked(api.getKnowledgeStates)
        .mockReturnValueOnce(defKnowledgeOld.promise)
        .mockReturnValueOnce(defKnowledgeNew.promise);

      renderHook(() => usePollingAssessment("session-1"));

      // Cycle 1 进入 knowledge 挂起
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);

      // 进入后台 (suspend)
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // 切回前台 (resume)，新请求立即启动，不受挂起旧 knowledge 阻塞
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
          writable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Cycle 2 正常发起 status 查询与第二次 knowledge 查询
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(2);

      // 迟到的旧 knowledge 返回，旧写被隔离，不应写入 store
      const staleKnowledge = [
        {
          id: "k-old",
          user_id: "u-1",
          skill_id: "s-1",
          skill_name: "Grammar Old",
          skill_category: "grammar" as const,
          p_mastery: 0.1,
          updated_at: "2026-01-01",
        },
      ];
      await act(async () => {
        defKnowledgeOld.resolve(staleKnowledge);
        await Promise.resolve();
      });

      expect(useAssessmentStore.getState().knowledgeStates).toEqual([]);

      // 新 knowledge 正常写入
      const freshKnowledge = [
        {
          id: "k-new",
          user_id: "u-1",
          skill_id: "s-1",
          skill_name: "Grammar New",
          skill_category: "grammar" as const,
          p_mastery: 0.99,
          updated_at: "2026-01-02",
        },
      ];
      await act(async () => {
        defKnowledgeNew.resolve(freshKnowledge);
        await Promise.resolve();
      });

      expect(useAssessmentStore.getState().knowledgeStates).toEqual(freshKnowledge);
    });
  });

  describe("会话切换、pollVersion、StrictMode 与卸载", () => {
    it("切换 sessionId 时作废旧轮询并为新 session 开启轮询", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      const { rerender } = renderHook(({ sid }) => usePollingAssessment(sid), {
        initialProps: { sid: "session-1" },
      });

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledWith("session-1");

      rerender({ sid: "session-2" });

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledWith("session-2");
    });

    it("人工重试递增 pollVersion 时重建轮询循环", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 模拟 retryFailedAnalysis 递增 pollVersion
      await act(async () => {
        useAssessmentStore.setState((s) => ({ pollVersion: s.pollVersion + 1 }));
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);
    });

    it("组件卸载时取消订阅、清理定时器且旧响应不写入", async () => {
      const def = deferred<api.AnalysisStatusResponse>();
      vi.mocked(api.getAnalysisStatus).mockReturnValue(def.promise);

      const { unmount } = renderHook(() => usePollingAssessment("session-1"));
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      unmount();

      // 卸载后返回
      await act(async () => {
        def.resolve({ ...baseJob, status: "succeeded" });
        await Promise.resolve();
      });

      expect(api.getAssessment).not.toHaveBeenCalled();
      expect(api.getKnowledgeStates).not.toHaveBeenCalled();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("认证 principal 变更或 revision 递增时立即释放旧循环", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 变更 principal 并通知
      await act(async () => {
        mockAuthSnapshot = {
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        };
        mockAuthRevision = 2;
        for (const listener of authListeners) {
          listener(mockAuthSnapshot);
        }
      });

      // 定时器不应再触发旧 session 的轮询
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("同步通知取消后的防护", () => {
    it("refreshAnalysis 成功后，若同步 store 通知触发取消，则绝不调用 knowledge", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);

      const { unmount } = renderHook(() => usePollingAssessment("session-1"));

      // 订阅 store，在 store 变为 loaded 瞬间同步 unmount
      const unsub = useAssessmentStore.subscribe((state) => {
        if (state.loadState === "loaded") {
          unmount();
        }
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      unsub();

      // 即使 status="succeeded"，由于同步通知导致 unmount，绝不能调用 knowledge
      expect(api.getKnowledgeStates).not.toHaveBeenCalled();
    });
  });

  describe("Native iOS Lifecycle Consumer (CP-05)", () => {
    beforeEach(() => {
      fakeAppListeners.clear();
      fakeAppGetState = vi.fn().mockImplementation(() => Promise.resolve({ isActive: true }));
      fakeAppAddListener = vi
        .fn()
        .mockImplementation((_event: string, listener: (state: { isActive: boolean }) => void) => {
          fakeAppListeners.add(listener);
          return Promise.resolve({
            remove: vi.fn().mockImplementation(() => {
              fakeAppListeners.delete(listener);
              return Promise.resolve();
            }),
          });
        });

      (window as unknown as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
    });

    afterEach(() => {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
      fakeAppListeners.clear();
    });

    it("initial native pending does not trigger query until registered and active", async () => {
      const addListenerDeferred = deferred<{ remove(): Promise<void> }>();
      const getStateDeferred = deferred<{ isActive: boolean }>();
      let capturedListener: ((state: { isActive: boolean }) => void) | null = null;

      fakeAppAddListener.mockImplementationOnce(
        (_event: string, listener: (state: { isActive: boolean }) => void) => {
          capturedListener = listener;
          fakeAppListeners.add(listener);
          return addListenerDeferred.promise;
        },
      );
      fakeAppGetState.mockImplementationOnce(() => getStateDeferred.promise);

      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);
      vi.mocked(api.getKnowledgeStates).mockResolvedValue([]);

      renderHook(() => usePollingAssessment("session-1"));

      // pending 期间：不发起 GET
      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).not.toHaveBeenCalled();

      // addListener resolve
      await act(async () => {
        addListenerDeferred.resolve({
          remove: async () => {
            if (capturedListener) fakeAppListeners.delete(capturedListener);
          },
        });
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).not.toHaveBeenCalled();

      // getState resolve active
      await act(async () => {
        getStateDeferred.resolve({ isActive: true });
        await Promise.resolve();
      });

      // 仅触发一次查询，不与 whenReady 重复发起
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);
    });

    it("initial native getState returning inactive does not trigger query", async () => {
      fakeAppGetState.mockImplementationOnce(() => Promise.resolve({ isActive: false }));

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
    });

    it("initial native registration failure does not trigger query", async () => {
      fakeAppAddListener.mockImplementationOnce(() =>
        Promise.reject(new Error("Registration failed")),
      );

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
    });

    it("query in flight when native transitions to inactive cancels active cycle and leaves timer cleared, then recovers on active", async () => {
      const deferredStatus1 = deferred<api.AnalysisStatusResponse>();
      const deferredStatus2 = deferred<api.AnalysisStatusResponse>();

      vi.mocked(api.getAnalysisStatus)
        .mockReturnValueOnce(deferredStatus1.promise)
        .mockReturnValueOnce(deferredStatus2.promise);

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 原生切后台 (inactive)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });

      // 旧请求迟到返回 pending
      await act(async () => {
        deferredStatus1.resolve({
          ...baseJob,
          status: "pending",
        });
        await Promise.resolve();
      });

      // 因为已被取消，定时器不得触发旧代际重试
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 原生切前台 (active)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      // 立即重新发起查询
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);

      // 第二次返回 pending，开始正常退避调度 (1000ms)
      await act(async () => {
        deferredStatus2.resolve({
          ...baseJob,
          status: "pending",
        });
        await Promise.resolve();
      });

      vi.mocked(api.getAnalysisStatus).mockResolvedValueOnce({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockResolvedValueOnce(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValueOnce([]);
      vi.mocked(api.getKnowledgeStates).mockResolvedValueOnce([]);

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(3);
    });

    it("initial fetch failure can recover on subsequent valid native resume event", async () => {
      vi.mocked(api.getAnalysisStatus)
        .mockRejectedValueOnce(new Error("Network failure"))
        .mockResolvedValueOnce({
          ...baseJob,
          status: "succeeded",
        });
      vi.mocked(api.getAssessment).mockResolvedValue(baseAssessment);
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);
      vi.mocked(api.getKnowledgeStates).mockResolvedValue([]);

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 错误后不自动重试，advanceTimers 不发新请求
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      // 原生切后台再切前台（触发 resume）
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      // 成功恢复读取
      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);
      expect(api.getKnowledgeStates).toHaveBeenCalledTimes(1);
    });

    it("native inactive overrides DOM visibilitychange and window online/pageshow", async () => {
      fakeAppGetState.mockImplementationOnce(() => Promise.resolve({ isActive: false }));

      renderHook(() => usePollingAssessment("session-1"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getAnalysisStatus).not.toHaveBeenCalled();

      // DOM 触发 visibilitychange visible、pageshow、online
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
    });

    it("two consumer instances independently register and unmounting one does not remove the other's listener", async () => {
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "pending",
      });

      const hookA = renderHook(() => usePollingAssessment("session-1"));
      const hookB = renderHook(() => usePollingAssessment("session-2"));

      await act(async () => {
        await Promise.resolve();
      });
      expect(fakeAppListeners.size).toBe(2);

      hookA.unmount();
      expect(fakeAppListeners.size).toBe(1);

      vi.mocked(api.getAnalysisStatus).mockClear();

      // 原生状态变更触发（后台到前台），hookB 依然能响应
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      expect(api.getAnalysisStatus).toHaveBeenCalledTimes(1);

      hookB.unmount();
      expect(fakeAppListeners.size).toBe(0);
    });
  });
});
