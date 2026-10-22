import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

import { getRecommendedCurriculum } from "@/lib/api";

describe("RecommendedScenarios component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders recommendations with accessible button labels and difficulty badges", async () => {
    vi.mocked(getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "formal_vocabulary",
      weakest_skill_mastery: 0.45,
      target_level: "B2",
      recommendations: [
        {
          scenario_name: "business_meeting",
          difficulty_cefr: "B2",
          category: "business",
          focus_skills: ["formal_vocabulary", "turn_taking"],
          system_prompt_template: "You are a business professional...",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("今日专属推荐")).toBeInTheDocument();
    });

    // Check CEFR difficulty badge accessibility
    const badge = screen.getByText("B2");
    expect(badge).toHaveAttribute("aria-label", "难度等级：B2");

    // Check practice button explicit aria-label and focus visible styling
    const practiceButton = screen.getByRole("button", {
      name: "进入练习：Business Meeting",
    });
    expect(practiceButton).toBeInTheDocument();
    expect(practiceButton.className).toContain("focus-visible:ring-2");
    expect(practiceButton.className).toContain("focus-visible:ring-accent");
  });
});
