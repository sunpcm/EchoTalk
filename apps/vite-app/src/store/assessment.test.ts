import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { useAssessmentStore } from "./assessment";

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

describe("assessment store", () => {
  beforeEach(() => {
    useAssessmentStore.getState().reset();
    vi.clearAllMocks();
  });

  it.each(["pending", "running"] as const)("shows the explicit %s state", async (status) => {
    vi.mocked(api.getAnalysisStatus).mockResolvedValue({ ...baseJob, status });

    await expect(useAssessmentStore.getState().refreshAnalysis("session-1")).resolves.toBe(status);
    expect(useAssessmentStore.getState()).toMatchObject({
      loadState: status,
      error: null,
    });
    expect(api.getAssessment).not.toHaveBeenCalled();
  });

  it("loads result resources in parallel after the job succeeds", async () => {
    const assessment = {
      id: "assessment-1",
      session_id: "session-1",
      overall_score: 90,
      phoneme_alignment: [],
      source: "demo_mock",
      provider: null,
      model_version: "demo-phoneme-rules-v1",
      is_synthetic: true,
      confidence: 0,
      provider_response_ref: null,
      created_at: "2026-09-21T00:00:00Z",
    };
    vi.mocked(api.getAnalysisStatus).mockResolvedValue({
      ...baseJob,
      status: "succeeded",
      finished_at: "2026-09-21T00:00:01Z",
    });
    vi.mocked(api.getAssessment).mockResolvedValue(assessment);
    vi.mocked(api.getGrammarErrors).mockResolvedValue([]);

    await expect(useAssessmentStore.getState().refreshAnalysis("session-1")).resolves.toBe(
      "succeeded",
    );
    expect(useAssessmentStore.getState()).toMatchObject({
      loadState: "loaded",
      assessment,
      grammarErrors: [],
      error: null,
    });
  });

  it("exposes a final failure without requesting missing assessment data", async () => {
    vi.mocked(api.getAnalysisStatus).mockResolvedValue({
      ...baseJob,
      status: "failed",
      attempt_count: 3,
      error_code: "analysis_failed",
      retryable: true,
    });

    await expect(useAssessmentStore.getState().refreshAnalysis("session-1")).resolves.toBe(
      "failed",
    );
    expect(useAssessmentStore.getState()).toMatchObject({
      loadState: "failed",
      error: "analysis_failed",
    });
    expect(api.getAssessment).not.toHaveBeenCalled();
  });

  it("requeues a failed analysis", async () => {
    vi.mocked(api.retryAnalysis).mockResolvedValue({ ...baseJob, attempt_count: 3 });

    await useAssessmentStore.getState().retryFailedAnalysis("session-1");

    expect(api.retryAnalysis).toHaveBeenCalledWith("session-1");
    expect(useAssessmentStore.getState()).toMatchObject({
      loadState: "pending",
      error: null,
      pollVersion: 1,
    });
  });

  describe("generation isolation on reset", () => {
    it("discards two-phase refreshAnalysis results if reset occurs between status and result fetches", async () => {
      let resolveAssessment!: (data: api.AssessmentResponse) => void;
      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAssessment = resolve;
          }),
      );
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);

      const refreshPromise = useAssessmentStore.getState().refreshAnalysis("session-1");
      // 等待状态检查完成，进入结果获取阶段
      await Promise.resolve();
      await Promise.resolve();

      // 在阶段2等待期间重置（代际递增）
      useAssessmentStore.getState().reset();

      resolveAssessment({
        id: "assess-old",
        session_id: "session-1",
        overall_score: 95,
        phoneme_alignment: [],
        source: "test",
        provider: null,
        model_version: null,
        is_synthetic: false,
        confidence: null,
        provider_response_ref: null,
        created_at: "2026-09-21T00:00:00Z",
      });

      await refreshPromise;

      // 验证重置后的 store 保持纯净，旧结果不回填
      expect(useAssessmentStore.getState().assessment).toBeNull();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("discards stale errors on refreshAnalysis after reset", async () => {
      let rejectStatus!: (err: Error) => void;
      vi.mocked(api.getAnalysisStatus).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectStatus = reject;
          }),
      );

      const refreshPromise = useAssessmentStore.getState().refreshAnalysis("session-1");
      useAssessmentStore.getState().reset();

      rejectStatus(new Error("Server error"));

      await expect(refreshPromise).rejects.toThrow("Server error");
      expect(useAssessmentStore.getState().error).toBeNull();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("discards retry and knowledge state results across resets", async () => {
      let resolveKnowledge!: (states: api.KnowledgeStateResponse[]) => void;
      vi.mocked(api.getKnowledgeStates).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveKnowledge = resolve;
          }),
      );

      const fetchPromise = useAssessmentStore.getState().fetchKnowledgeStates();
      useAssessmentStore.getState().reset();

      resolveKnowledge([
        {
          id: "k-1",
          user_id: "u-1",
          skill_id: "s-1",
          skill_name: "Grammar",
          skill_category: "grammar",
          p_mastery: 0.9,
          updated_at: "2026-01-01",
        },
      ]);
      await fetchPromise;

      expect(useAssessmentStore.getState().knowledgeStates).toEqual([]);
    });
  });

  describe("isCurrent predicate cancellation", () => {
    it("aborts before getAnalysisStatus if isCurrent is initially false", async () => {
      const isCurrent = vi.fn().mockReturnValue(false);
      const res = await useAssessmentStore.getState().refreshAnalysis("session-1", isCurrent);

      expect(res).toBeNull();
      expect(api.getAnalysisStatus).not.toHaveBeenCalled();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("aborts after status check before result GET if isCurrent becomes false", async () => {
      let current = true;
      const isCurrent = () => current;

      vi.mocked(api.getAnalysisStatus).mockImplementationOnce(async () => {
        current = false;
        return { ...baseJob, status: "succeeded" };
      });

      const res = await useAssessmentStore.getState().refreshAnalysis("session-1", isCurrent);

      expect(res).toBeNull();
      expect(api.getAssessment).not.toHaveBeenCalled();
      expect(api.getGrammarErrors).not.toHaveBeenCalled();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("aborts before writing loaded state if isCurrent becomes false after result GET", async () => {
      let current = true;
      const isCurrent = () => current;

      vi.mocked(api.getAnalysisStatus).mockResolvedValue({
        ...baseJob,
        status: "succeeded",
      });
      vi.mocked(api.getAssessment).mockImplementationOnce(async () => {
        current = false;
        return {
          id: "assess-1",
          session_id: "session-1",
          overall_score: 80,
          phoneme_alignment: [],
          source: "test",
          provider: null,
          model_version: null,
          is_synthetic: false,
          confidence: null,
          provider_response_ref: null,
          created_at: "2026-09-21T00:00:00Z",
        };
      });
      vi.mocked(api.getGrammarErrors).mockResolvedValue([]);

      const res = await useAssessmentStore.getState().refreshAnalysis("session-1", isCurrent);

      expect(res).toBeNull();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
      expect(useAssessmentStore.getState().assessment).toBeNull();
    });

    it("silently swallows error without writing error state or throwing if isCurrent is false", async () => {
      vi.mocked(api.getAnalysisStatus).mockRejectedValue(new Error("Network failed"));

      const isCurrent = vi.fn().mockReturnValue(false);
      const res = await useAssessmentStore.getState().refreshAnalysis("session-1", isCurrent);

      expect(res).toBeNull();
      expect(useAssessmentStore.getState().error).toBeNull();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("swallows error if isCurrent becomes false during getAnalysisStatus rejection", async () => {
      let current = true;
      const isCurrent = () => current;
      vi.mocked(api.getAnalysisStatus).mockImplementationOnce(async () => {
        current = false;
        throw new Error("Network timeout");
      });

      const res = await useAssessmentStore.getState().refreshAnalysis("session-1", isCurrent);

      expect(res).toBeNull();
      expect(useAssessmentStore.getState().error).toBeNull();
      expect(useAssessmentStore.getState().loadState).toBe("idle");
    });

    it("cancels fetchKnowledgeStates without requesting or writing if isCurrent is false", async () => {
      const isCurrent = vi.fn().mockReturnValue(false);
      await useAssessmentStore.getState().fetchKnowledgeStates(isCurrent);

      expect(api.getKnowledgeStates).not.toHaveBeenCalled();
      expect(useAssessmentStore.getState().knowledgeStates).toEqual([]);
    });

    it("discards knowledge results if isCurrent becomes false before write", async () => {
      let current = true;
      const isCurrent = () => current;
      vi.mocked(api.getKnowledgeStates).mockImplementationOnce(async () => {
        current = false;
        return [
          {
            id: "k-1",
            user_id: "u-1",
            skill_id: "s-1",
            skill_name: "Grammar",
            skill_category: "grammar",
            p_mastery: 0.95,
            updated_at: "2026-01-01",
          },
        ];
      });

      await useAssessmentStore.getState().fetchKnowledgeStates(isCurrent);

      expect(useAssessmentStore.getState().knowledgeStates).toEqual([]);
    });

    it("does not reset store or cancel in-flight retry POST when read is cancelled", async () => {
      let resolveRetry!: (val: api.AnalysisStatusResponse) => void;
      vi.mocked(api.retryAnalysis).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve;
          }),
      );

      const retryPromise = useAssessmentStore.getState().retryFailedAnalysis("session-1");

      const cancelledReadRes = await useAssessmentStore
        .getState()
        .refreshAnalysis("session-1", () => false);

      expect(cancelledReadRes).toBeNull();

      resolveRetry({ ...baseJob, attempt_count: 4, status: "pending" });
      await retryPromise;

      expect(useAssessmentStore.getState().loadState).toBe("pending");
      expect(useAssessmentStore.getState().pollVersion).toBe(1);
    });
  });
});
