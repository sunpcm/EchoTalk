import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

import { getRecommendedCurriculum } from "@/lib/api";

describe("RecommendedScenarios accessibility & interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders scenario cards with descriptive aria-label on enter buttons", async () => {
    vi.mocked(getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "grammar",
      weakest_skill_mastery: 0.4,
      target_level: "B2",
      recommendations: [
        {
          scenario_name: "job_interview",
          category: "career",
          difficulty_cefr: "B2",
          focus_skills: ["formal_expression", "confidence"],
          system_prompt_template: "Prompt template",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("今日专属推荐")).toBeInTheDocument();
      const enterButton = screen.getByRole("button", { name: "进入练习：Job Interview" });
      expect(enterButton).toBeInTheDocument();
      expect(enterButton).toHaveAttribute("aria-label", "进入练习：Job Interview");
      expect(enterButton.className).toContain("focus-visible:ring-2");
    });
  });
});
