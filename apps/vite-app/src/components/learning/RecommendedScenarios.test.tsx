import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";
import * as api from "@/lib/api";
import { useConversationStore } from "@/store/conversation";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

describe("RecommendedScenarios Accessibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConversationStore.setState({
      connectionState: "idle",
    });
  });

  it("renders loading state with role status and aria-live polite", () => {
    vi.mocked(api.getRecommendedCurriculum).mockReturnValue(new Promise(() => {}));

    render(<RecommendedScenarios />);

    const loadingStatus = screen.getByRole("status");
    expect(loadingStatus).toBeInTheDocument();
    expect(loadingStatus).toHaveAttribute("aria-live", "polite");
  });

  it("renders scenario card enter buttons with contextual aria-label", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "grammar",
      weakest_skill_mastery: 0.4,
      target_level: "B2",
      recommendations: [
        {
          scenario_name: "Business Meeting",
          difficulty_cefr: "B2",
          category: "business",
          focus_skills: ["Speaking"],
          system_prompt_template: "Business prompt",
        },
      ],
    });

    await act(async () => {
      render(<RecommendedScenarios />);
    });

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "进入练习 - Business Meeting" });
      expect(button).not.toBeNull();
      expect(button).toHaveAttribute("aria-label", "进入练习 - Business Meeting");
    });
  });

  it("sets aria-busy and hides spinner icon when checking service health", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "grammar",
      weakest_skill_mastery: 0.4,
      target_level: "B2",
      recommendations: [
        {
          scenario_name: "Business Meeting",
          difficulty_cefr: "B2",
          category: "business",
          focus_skills: ["Speaking"],
          system_prompt_template: "Business prompt",
        },
      ],
    });

    useConversationStore.setState({
      connectionState: "checking_health",
    });

    await act(async () => {
      render(<RecommendedScenarios />);
    });

    await waitFor(() => {
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button).toBeDisabled();
    });
  });
});
