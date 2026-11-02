import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";
import { useConversationStore } from "@/store/conversation";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

import { getRecommendedCurriculum } from "@/lib/api";

describe("RecommendedScenarios accessibility and UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({
      connectionState: "idle",
      selectedScenario: null,
    });
  });

  it("renders loading indicator with role='status' and aria-live='polite'", () => {
    vi.mocked(getRecommendedCurriculum).mockImplementation(() => new Promise(() => {}));

    render(<RecommendedScenarios />);

    const loadingStatus = screen.getByRole("status");
    expect(loadingStatus).toBeInTheDocument();
    expect(loadingStatus).toHaveAttribute("aria-live", "polite");
    expect(loadingStatus).toHaveTextContent("加载中...");
  });

  it("renders scenario cards with contextual aria-label on enter button and difficulty badge", async () => {
    vi.mocked(getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "grammar_past_tense",
      weakest_skill_mastery: 0.45,
      target_level: "B2",
      recommendations: [
        {
          scenario_name: "job_interview",
          difficulty_cefr: "B2",
          category: "career",
          focus_skills: ["formal_greeting", "past_experience"],
          system_prompt_template: "You are an interviewer.",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("Job Interview")).toBeInTheDocument();
    });

    // Difficulty badge accessibility
    const badge = screen.getByLabelText("难度: B2");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("B2");

    // Enter practice button accessibility & touch target
    const enterBtn = screen.getByRole("button", { name: "进入练习：Job Interview" });
    expect(enterBtn).toBeInTheDocument();
    expect(enterBtn).toHaveAttribute("aria-label", "进入练习：Job Interview");
    expect(enterBtn).toHaveClass("min-h-[44px]");
    expect(enterBtn).toHaveClass("focus-visible:ring-accent");
    expect(enterBtn).not.toBeDisabled();
    expect(enterBtn).toHaveAttribute("aria-busy", "false");
  });

  it("disables enter button and sets aria-busy='true' during health checking", async () => {
    useConversationStore.setState({
      connectionState: "checking_health",
    });

    vi.mocked(getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "vocabulary_daily",
      weakest_skill_mastery: 0.3,
      target_level: "A2",
      recommendations: [
        {
          scenario_name: "coffee_shop",
          difficulty_cefr: "A2",
          category: "daily",
          focus_skills: ["ordering_food"],
          system_prompt_template: "You are a barista.",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
    });

    const enterBtn = screen.getByRole("button", { name: "进入练习：Coffee Shop" });
    expect(enterBtn).toBeDisabled();
    expect(enterBtn).toHaveAttribute("aria-busy", "true");
    expect(enterBtn).toHaveTextContent("检测服务中...");
  });

  it("triggers startSession with selected scenario when enter button is clicked", async () => {
    const user = userEvent.setup();
    const startSessionMock = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({
      startSession: startSessionMock,
    });

    const scenario = {
      scenario_name: "travel_airport",
      difficulty_cefr: "B1",
      category: "travel",
      focus_skills: ["asking_directions"],
      system_prompt_template: "You are an airport assistant.",
    };

    vi.mocked(getRecommendedCurriculum).mockResolvedValue({
      weakest_skill: "travel_vocab",
      weakest_skill_mastery: 0.5,
      target_level: "B1",
      recommendations: [scenario],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("Travel Airport")).toBeInTheDocument();
    });

    const enterBtn = screen.getByRole("button", { name: "进入练习：Travel Airport" });
    await user.click(enterBtn);

    expect(useConversationStore.getState().selectedScenario).toEqual(scenario);
    expect(startSessionMock).toHaveBeenCalledWith("scenario");
  });
});
