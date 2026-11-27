import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import type { AuthSnapshot } from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { useAssessmentStore } from "@/store/assessment";
import { useConversationStore } from "@/store/conversation";
import { EndedConversation } from "./EndedConversation";

const SESSION_ID = "practice-journal-retry-session";
const t = zhCN.assessment;

const authControl = vi.hoisted(() => ({
  snapshot: {
    state: "authenticated",
    principal: { issuer: "https://auth.example", subject: "user-one" },
  } as AuthSnapshot,
  revision: 1,
}));

const lifecycleControl = vi.hoisted(() => ({
  snapshot: { visibility: "visible" as const, online: true },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthSnapshot: () => authControl.snapshot,
    getAuthRevision: () => authControl.revision,
    subscribeAuthSnapshot: () => () => undefined,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAnalysisStatus: vi.fn(),
    getAssessment: vi.fn(),
    getGrammarErrors: vi.fn(),
    getKnowledgeStates: vi.fn(),
  };
});

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    createLifecycleAdapter: () => ({
      capabilities: { webEvents: true, nativeAppState: false },
      getSnapshot: () => lifecycleControl.snapshot,
      subscribe: () => () => undefined,
      dispose: vi.fn(),
      whenReady: () => Promise.resolve(),
    }),
  };
});

vi.mock("./GoalResults", () => ({
  GoalResults: () => <div data-testid="goal-results" />,
}));

const baseJob: api.AnalysisStatusResponse = {
  session_id: SESSION_ID,
  status: "pending",
  attempt_count: 0,
  error_code: null,
  retryable: false,
  started_at: null,
  finished_at: null,
  updated_at: "2026-11-28T00:00:00Z",
};

const assessment: api.AssessmentResponse = {
  id: "assessment-real",
  session_id: SESSION_ID,
  overall_score: 88,
  phoneme_alignment: [],
  source: "real",
  provider: "test",
  model_version: "v1",
  is_synthetic: false,
  confidence: 0.9,
  provider_response_ref: null,
  created_at: "2026-11-28T00:00:00Z",
};

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("EndedConversation read retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useAssessmentStore.getState().reset();
    useConversationStore.setState({
      _sessionState: { phase: "ended", sessionId: SESSION_ID },
      agentError: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    useAssessmentStore.getState().reset();
    useConversationStore.setState({ _sessionState: { phase: "idle" }, agentError: null });
  });

  it("recovers from a read error through pending polling and renders the report", async () => {
    vi.mocked(api.getAnalysisStatus)
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce({ ...baseJob, status: "pending" })
      .mockResolvedValueOnce({ ...baseJob, status: "succeeded" });
    vi.mocked(api.getAssessment).mockResolvedValue(assessment);
    vi.mocked(api.getGrammarErrors).mockResolvedValue([]);
    vi.mocked(api.getKnowledgeStates).mockResolvedValue([]);

    render(<EndedConversation />);
    await flushPromises();

    expect(screen.getByText(t.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zhCN.sessionGoals.retry }));
    await flushPromises();

    expect(api.getAnalysisStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText(t.pending)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await flushPromises();

    expect(api.getAnalysisStatus).toHaveBeenCalledTimes(3);
    expect(api.getKnowledgeStates).toHaveBeenCalledOnce();
    expect(screen.getByText(t.scoreLabel)).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.retry })).not.toBeInTheDocument();
  });
});
