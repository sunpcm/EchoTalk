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
});
