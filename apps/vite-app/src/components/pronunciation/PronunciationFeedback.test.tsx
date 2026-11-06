import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PronunciationFeedback } from "./PronunciationFeedback";
import type { AssessmentResponse, GrammarErrorResponse } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

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

  it("renders grammar errors with semantic del and ins tags and ARIA labels", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={mockGrammarErrors} />);

    // Verify del element for first error using i18n label definition
    const expectedOriginalLabel = t.grammarOriginalLabel.replace("{text}", "He go there yesterday");
    const delElem = screen.getByLabelText(expectedOriginalLabel);
    expect(delElem.tagName.toLowerCase()).toBe("del");
    expect(delElem).toHaveTextContent("He go there yesterday");

    // Verify ins element for corrected version using i18n label definition
    const expectedCorrectedLabel = t.grammarCorrectedLabel.replace(
      "{text}",
      "He went there yesterday",
    );
    const insElem = screen.getByLabelText(expectedCorrectedLabel);
    expect(insElem.tagName.toLowerCase()).toBe("ins");
    expect(insElem).toHaveTextContent("He went there yesterday");

    // Verify directional arrow exists
    expect(screen.getByText("→")).toBeInTheDocument();

    // Verify second error without correction does not render ins
    const expectedOriginalLabel2 = t.grammarOriginalLabel.replace("{text}", "She don't know");
    const delElem2 = screen.getByLabelText(expectedOriginalLabel2);
    expect(delElem2.tagName.toLowerCase()).toBe("del");
  });

  it("renders grammar error items within a standard list structure without cluttering tab stops", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={mockGrammarErrors} />);

    const listItems = screen.getAllByRole("listitem");
    expect(listItems.length).toBe(2);
    expect(listItems[0]).not.toHaveAttribute("tabindex");
    expect(listItems[1]).not.toHaveAttribute("tabindex");
  });
});
