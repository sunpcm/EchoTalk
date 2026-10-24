import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

import { getRecommendedCurriculum } from "@/lib/api";

describe("RecommendedScenarios accessibility & rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders recommended scenarios with accessible attributes and badges", async () => {
    vi.mocked(getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "ordering",
      weakest_skill_mastery: 0.2,
      target_level: "A1",
      recommendations: [
        {
          scenario_name: "ordering_coffee",
          difficulty_cefr: "A1",
          category: "daily",
          focus_skills: ["greeting", "ordering"],
          system_prompt_template: "You are a barista...",
        },
        {
          scenario_name: "job_interview",
          difficulty_cefr: "B2",
          category: "work",
          focus_skills: ["self_introduction", "past_experience"],
          system_prompt_template: "You are an interviewer...",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("今日专属推荐")).toBeInTheDocument();
    });

    // Check difficulty badges
    const badgeA1 = screen.getByLabelText("难度: A1");
    expect(badgeA1).toBeInTheDocument();
    expect(badgeA1).toHaveAttribute("title", "难度: A1");

    const badgeB2 = screen.getByLabelText("难度: B2");
    expect(badgeB2).toBeInTheDocument();
    expect(badgeB2).toHaveAttribute("title", "难度: B2");

    // Check enter buttons have descriptive aria-labels and focus ring classes
    const btn1 = screen.getByRole("button", { name: "进入练习: Ordering Coffee" });
    expect(btn1).toBeInTheDocument();
    expect(btn1).toHaveClass("focus-visible:ring-2");
    expect(btn1).toHaveClass("focus-visible:ring-accent");

    const btn2 = screen.getByRole("button", { name: "进入练习: Job Interview" });
    expect(btn2).toBeInTheDocument();
    expect(btn2).toHaveClass("focus-visible:ring-2");
    expect(btn2).toHaveClass("focus-visible:ring-accent");
  });
});
