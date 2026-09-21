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
      elsa_response: null,
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
});
