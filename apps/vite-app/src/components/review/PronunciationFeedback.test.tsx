import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EndedConversation } from "./EndedConversation";
import { PronunciationFeedback } from "./PronunciationFeedback";
import type { AssessmentResponse, GrammarErrorResponse } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";
import { useAssessmentStore } from "@/store/assessment";
import { useConversationStore } from "@/store/conversation";

const t = zhCN.assessment;

describe("PronunciationFeedback", () => {
  const mockAssessment: AssessmentResponse = {
    id: "test-assessment-id",
    session_id: "test-session-id",
    overall_score: 85,
    phoneme_alignment: [],
    source: "real",
    provider: "cartesia",
    model_version: "v1",
    is_synthetic: false,
    confidence: 0.9,
    provider_response_ref: null,
    created_at: new Date().toISOString(),
  };

  const mockGrammarErrors: GrammarErrorResponse[] = [
    {
      id: "err-1",
      session_id: "test-session-id",
      skill_tag: "past_tense",
      original: "He go there yesterday",
      corrected: "He went there yesterday",
      error_type: "tense",
      source: "real",
      provider: "llm",
      model_version: "v1",
      is_synthetic: false,
      confidence: 0.95,
      created_at: new Date().toISOString(),
    },
    {
      id: "err-2",
      session_id: "test-session-id",
      skill_tag: "subject_verb_agreement",
      original: "She don't know",
      corrected: "",
      error_type: "agreement",
      source: "real",
      provider: "llm",
      model_version: "v1",
      is_synthetic: false,
      confidence: 0.95,
      created_at: new Date().toISOString(),
    },
  ];

  it("renders score and score region label with group role", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={[]} />);
    expect(screen.getByText(t.scoreLabel)).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    const scoreGroup = screen.getByRole("group", { name: `${t.scoreLabel}: 85/100` });
    expect(scoreGroup).toBeInTheDocument();
  });

  it("renders synthetic warning banner with role note when is_synthetic is true", () => {
    render(
      <PronunciationFeedback
        assessment={{ ...mockAssessment, is_synthetic: true }}
        grammarErrors={[]}
      />,
    );
    const noteBanner = screen.getByRole("note");
    expect(noteBanner).toBeInTheDocument();
    expect(noteBanner).toHaveTextContent(t.syntheticBadge);
    expect(noteBanner).toHaveTextContent(t.syntheticHint);
  });

  it("marks synthetic grammar output while real pronunciation remains distinct", () => {
    render(
      <PronunciationFeedback
        assessment={{ ...mockAssessment, is_synthetic: false }}
        grammarErrors={[{ ...mockGrammarErrors[0], is_synthetic: true }]}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(t.syntheticBadge);
    expect(screen.getAllByText(t.syntheticBadge)).toHaveLength(2);
  });

  it("renders grammar errors with semantic del and ins tags and ARIA labels", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={mockGrammarErrors} />);

    const grammarHeading = screen.getByRole("heading", {
      level: 2,
      name: `${t.grammarTitle} (${mockGrammarErrors.length})`,
    });
    expect(grammarHeading).toHaveTextContent(`${t.grammarTitle} (${mockGrammarErrors.length})`);

    // Verify del element for first error using i18n label definition
    const expectedOriginalLabel = t.grammarOriginalLabel.replace("{text}", "He go there yesterday");
    const delElem = screen.getByLabelText(expectedOriginalLabel);
    expect(delElem.tagName.toLowerCase()).toBe("del");
    expect(delElem).toHaveTextContent("He go there yesterday");
    const originalDefinition = delElem.closest("dd");
    expect(originalDefinition).toHaveTextContent("He go there yesterday");
    expect(originalDefinition).toHaveAttribute("lang", "en");

    // Verify ins element for corrected version using i18n label definition
    const expectedCorrectedLabel = t.grammarCorrectedLabel.replace(
      "{text}",
      "He went there yesterday",
    );
    const insElem = screen.getByLabelText(expectedCorrectedLabel);
    expect(insElem.tagName.toLowerCase()).toBe("ins");
    expect(insElem).toHaveTextContent("He went there yesterday");
    const correctedDefinition = insElem.closest("dd");
    expect(correctedDefinition).toHaveTextContent("He went there yesterday");
    expect(correctedDefinition).toHaveAttribute("lang", "en");

    const firstItem = delElem.closest("li");
    expect(within(firstItem!).getByText(t.originalCaption)).toBeInTheDocument();
    expect(within(firstItem!).getByText(t.correctedCaption)).toBeInTheDocument();

    // Verify second error without correction does not render ins
    const expectedOriginalLabel2 = t.grammarOriginalLabel.replace("{text}", "She don't know");
    const delElem2 = screen.getByLabelText(expectedOriginalLabel2);
    expect(delElem2.tagName.toLowerCase()).toBe("del");
  });

  it("preserves complete sentences and emoji in whole-sentence corrections", () => {
    const original = "I love this cafe 😊☕";
    const corrected = "I really love this cafe 😊☕";

    render(
      <PronunciationFeedback
        assessment={mockAssessment}
        grammarErrors={[
          {
            ...mockGrammarErrors[0],
            original,
            corrected,
          },
        ]}
      />,
    );

    expect(
      screen.getByLabelText(t.grammarOriginalLabel.replace("{text}", original)),
    ).toHaveTextContent(original);
    expect(
      screen.getByLabelText(t.grammarCorrectedLabel.replace("{text}", corrected)),
    ).toHaveTextContent(corrected);
  });

  it("maps every seeded backend skill ID to Chinese without changing established labels", () => {
    const skillLabels = [
      ["article_usage", "冠词使用"],
      ["verb_tense_past", "过去时态"],
      ["verb_tense_present", "现在时态"],
      ["subject_verb_agreement", "主谓一致"],
      ["preposition", "介词使用"],
      ["vowel_sounds", "元音发音"],
      ["consonant_clusters", "辅音连缀"],
      ["word_stress", "单词重音"],
      ["linking_sounds", "连读"],
      ["th_sounds", "TH 发音"],
      ["other", "其他语法"],
    ] as const;
    const grammarErrors = skillLabels.map(([skillTag], index) => ({
      ...mockGrammarErrors[0],
      id: `seeded-skill-${index}`,
      skill_tag: skillTag,
      original: `source ${skillTag}`,
      corrected: "",
    }));

    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={grammarErrors} />);

    for (const [, label] of skillLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("keeps unknown and prototype property tags unchanged", () => {
    const skillTags = ["future_skill", "constructor", "toString", "__proto__"];
    const grammarErrors = skillTags.map((skillTag, index) => ({
      ...mockGrammarErrors[0],
      id: `unknown-skill-${index}`,
      skill_tag: skillTag,
      original: `source ${skillTag}`,
      corrected: "",
    }));

    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={grammarErrors} />);

    for (const skillTag of skillTags) {
      expect(screen.getByText(skillTag)).toBeInTheDocument();
    }
  });

  it("renders grammar error items within a standard list structure without cluttering tab stops", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={mockGrammarErrors} />);

    const listItems = screen.getAllByRole("listitem");
    expect(listItems.length).toBe(2);
    expect(listItems[0]).not.toHaveAttribute("tabindex");
    expect(listItems[1]).not.toHaveAttribute("tabindex");
  });

  it("shows a neutral saved notice when there is neither pronunciation nor grammar feedback", () => {
    render(<PronunciationFeedback assessment={null} grammarErrors={[]} />);

    expect(screen.getByText(t.noFeedbackTitle)).toBeInTheDocument();
    expect(screen.getByText(t.noFeedbackBody)).toBeInTheDocument();
    expect(screen.getByText(t.noFeedbackNote)).toBeInTheDocument();
    // 不再承诺“仅展示语法提示”，也不渲染空的语法标题或评分
    expect(screen.queryByText(t.pronunciationUnavailable)).not.toBeInTheDocument();
    expect(screen.queryByText(t.scoreLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("keeps the grammar-only notice when grammar hints exist without pronunciation", () => {
    render(<PronunciationFeedback assessment={null} grammarErrors={mockGrammarErrors} />);

    expect(screen.getByText(t.pronunciationUnavailable)).toBeInTheDocument();
    expect(screen.queryByTestId("assessment-no-feedback")).not.toBeInTheDocument();
  });

  it("does not show the no-feedback notice when pronunciation exists without grammar hints", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={[]} />);

    expect(screen.getByText(t.scoreLabel)).toBeInTheDocument();
    expect(screen.queryByTestId("assessment-no-feedback")).not.toBeInTheDocument();
    expect(screen.queryByText(t.pronunciationUnavailable)).not.toBeInTheDocument();
  });

  it("renders grammar list and unavailable notice in EndedConversation", () => {
    const originalRefresh = useAssessmentStore.getState().refreshAnalysis;
    const originalFetchKnowledge = useAssessmentStore.getState().fetchKnowledgeStates;
    useConversationStore.setState({
      _sessionState: { phase: "ended", sessionId: "grammar-only-session" },
      agentError: null,
    });
    useAssessmentStore.setState({
      loadState: "loaded",
      assessment: null,
      grammarErrors: mockGrammarErrors,
      knowledgeStates: [],
      error: null,
      refreshAnalysis: vi.fn().mockResolvedValue("succeeded"),
      fetchKnowledgeStates: vi.fn().mockResolvedValue(undefined),
    });

    try {
      render(<EndedConversation />);

      expect(screen.getByRole("heading", { level: 1, name: t.journalTitle })).toBeInTheDocument();
      expect(screen.getByText(zhCN.conversation.ended)).toBeInTheDocument();
      expect(screen.getByText(t.pronunciationUnavailable)).toBeInTheDocument();
      const definitions = screen.getAllByRole("definition");
      expect(
        definitions.some((definition) => definition.textContent === "He go there yesterday"),
      ).toBe(true);
      expect(
        definitions.some((definition) => definition.textContent === "He went there yesterday"),
      ).toBe(true);
      expect(screen.queryByText(t.scoreLabel)).not.toBeInTheDocument();
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: zhCN.dashboard.goHome })).toBeInTheDocument();
    } finally {
      useAssessmentStore.setState({
        refreshAnalysis: originalRefresh,
        fetchKnowledgeStates: originalFetchKnowledge,
      });
      useAssessmentStore.getState().reset();
      useConversationStore.setState({ _sessionState: { phase: "idle" }, agentError: null });
    }
  });
});
