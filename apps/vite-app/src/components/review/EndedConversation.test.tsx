import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import { zhCN } from "@/i18n/zh-CN";
import { useAssessmentStore } from "@/store/assessment";
import { useConversationStore } from "@/store/conversation";
import { EndedConversation } from "./EndedConversation";

vi.mock("@/hooks/usePollingAssessment", () => ({
  usePollingAssessment: vi.fn(),
}));

vi.mock("./GoalResults", () => ({
  GoalResults: () => <div data-testid="goal-results" />,
}));

vi.mock("@/components/shared/SkillTree", () => ({
  SkillTree: () => <div data-testid="skill-tree" />,
}));

const SESSION_ID = "practice-journal-session";
const t = zhCN.assessment;

describe("EndedConversation practice journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({
      _sessionState: { phase: "ended", sessionId: SESSION_ID },
      agentError: null,
    });
    useAssessmentStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useAssessmentStore.getState().reset();
    useConversationStore.setState({ _sessionState: { phase: "idle" }, agentError: null });
  });

  it("keeps the ended status and return path inside the practice journal page", () => {
    vi.mocked(usePollingAssessment).mockReturnValue("pending");
    useAssessmentStore.setState({ loadState: "pending" });

    render(<EndedConversation />);

    expect(screen.getByRole("heading", { level: 1, name: t.journalTitle })).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.ended)).toBeInTheDocument();
    expect(screen.queryByText(zhCN.conversation.endedHint)).not.toBeInTheDocument();
    expect(screen.getByText(t.pending)).toBeInTheDocument();
    expect(screen.getByTestId("goal-results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zhCN.dashboard.goHome })).toBeInTheDocument();
  });

  it("shows local cancellation once and never starts analysis", () => {
    useConversationStore.setState({ _sessionState: { phase: "idle" }, agentError: null });
    vi.mocked(usePollingAssessment).mockReturnValue("error");

    render(<EndedConversation />);

    expect(usePollingAssessment).toHaveBeenCalledWith(null);
    expect(screen.getByTestId("cancelled-local-view")).toHaveTextContent(
      zhCN.conversation.cancelledBeforeStartTitle,
    );
    expect(screen.getAllByText(zhCN.conversation.cancelledBeforeStartTitle)).toHaveLength(1);
    expect(screen.getAllByText(zhCN.conversation.cancelledBeforeStartMessage)).toHaveLength(1);
    expect(screen.getByRole("button", { name: zhCN.dashboard.goHome })).toBeInTheDocument();
  });

  it("restarts the protected poll loop after a read error", () => {
    const initialPollVersion = useAssessmentStore.getState().pollVersion;
    vi.mocked(usePollingAssessment).mockReturnValue("error");
    useAssessmentStore.setState({ loadState: "error" });

    render(<EndedConversation />);
    expect(screen.getByRole("button", { name: zhCN.sessionGoals.retry })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.retry })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zhCN.sessionGoals.retry }));

    expect(useAssessmentStore.getState().pollVersion).toBe(initialPollVersion + 1);
  });

  it("keeps the explicit analysis retry path for retryable failures", () => {
    const retryFailedAnalysis = vi.fn().mockResolvedValue(undefined);
    vi.mocked(usePollingAssessment).mockReturnValue("failed");
    useAssessmentStore.setState({
      loadState: "failed",
      retryFailedAnalysis,
      job: {
        session_id: SESSION_ID,
        status: "failed",
        attempt_count: 1,
        error_code: "analysis_failed",
        retryable: true,
        started_at: "2026-11-28T00:00:00Z",
        finished_at: "2026-11-28T00:01:00Z",
        updated_at: "2026-11-28T00:01:00Z",
      },
    });

    render(<EndedConversation />);
    expect(screen.getByRole("button", { name: t.retry })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: zhCN.sessionGoals.retry })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.retry }));

    expect(retryFailedAnalysis).toHaveBeenCalledOnce();
    expect(retryFailedAnalysis).toHaveBeenCalledWith(SESSION_ID);
  });

  it("keeps feedback first, then goals, then the skill tree", () => {
    vi.mocked(usePollingAssessment).mockReturnValue("loaded");
    useAssessmentStore.setState({
      loadState: "loaded",
      assessment: {
        id: "assessment-1",
        session_id: SESSION_ID,
        overall_score: 82,
        phoneme_alignment: [],
        source: "real",
        provider: "test",
        model_version: "v1",
        is_synthetic: false,
        confidence: 0.9,
        provider_response_ref: null,
        created_at: "2026-11-28T00:00:00Z",
      },
      grammarErrors: [
        {
          id: "grammar-1",
          session_id: SESSION_ID,
          skill_tag: "verb_tense_past",
          original: "Yesterday I try the pasta.",
          corrected: "Yesterday I tried the pasta.",
          error_type: "tense",
          source: "real",
          provider: "test",
          model_version: "v1",
          is_synthetic: false,
          confidence: 0.9,
          created_at: "2026-11-28T00:00:00Z",
        },
      ],
      knowledgeStates: [
        {
          id: "knowledge-1",
          user_id: "user-1",
          skill_id: "verb_tense_past",
          skill_name: "过去时态",
          skill_category: "grammar",
          p_mastery: 0.6,
          updated_at: "2026-11-28T00:00:00Z",
        },
      ],
    });

    render(<EndedConversation />);

    const feedback = screen.getByRole("heading", { name: `${t.grammarTitle} (1)` });
    const goals = screen.getByTestId("goal-results");
    const skills = screen.getByTestId("skill-tree");
    const isBefore = (first: Element, second: Element) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(isBefore(feedback, goals)).toBe(true);
    expect(isBefore(goals, skills)).toBe(true);
  });
});
