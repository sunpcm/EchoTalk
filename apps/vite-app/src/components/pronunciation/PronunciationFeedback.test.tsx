import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PronunciationFeedback } from "./PronunciationFeedback";
import type { AssessmentResponse, GrammarErrorResponse } from "@/lib/api";

describe("PronunciationFeedback", () => {
  const mockAssessment: AssessmentResponse = {
    session_id: "test-session",
    overall_score: 85,
    is_synthetic: false,
    phoneme_alignment: [
      { position: 0, phoneme: "AE", type: "correct", expected: "AE", actual: "AE" },
    ],
  };

  const mockGrammarErrors: GrammarErrorResponse[] = [
    {
      id: "err-1",
      session_id: "test-session",
      original: "he go to school",
      corrected: "he goes to school",
      skill_tag: "subject-verb-agreement",
    },
  ];

  it("renders overall score with accessible aria-label", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={[]} />);

    const scoreElement = screen.getByLabelText(/发音评分: 85 \/ 100/);
    expect(scoreElement).toBeInTheDocument();
  });

  it("renders grammar errors using semantic <del> and <ins> elements with accessible sr-only text", () => {
    render(<PronunciationFeedback assessment={mockAssessment} grammarErrors={mockGrammarErrors} />);

    const delElement = screen.getByText("he go to school").closest("del");
    expect(delElement).not.toBeNull();
    expect(delElement).toHaveTextContent("Original: he go to school");

    const insElement = screen.getByText("he goes to school").closest("ins");
    expect(insElement).not.toBeNull();
    expect(insElement).toHaveTextContent("Correction: he goes to school");
  });
});
