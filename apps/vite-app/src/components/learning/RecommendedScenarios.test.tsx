import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";
import * as api from "@/lib/api";
import { useConversationStore } from "@/store/conversation";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

describe("RecommendedScenarios", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useConversationStore.setState({ connectionState: "idle" });
  });

  it("renders scenario enter buttons with descriptive aria-label containing scenario title", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      recommendations: [
        {
          scenario_name: "job_interview",
          difficulty_cefr: "B2",
          focus_skills: ["past_tense"],
          reason: "Practice past tense",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("Job Interview")).toBeInTheDocument();
    });

    const enterBtn = screen.getByRole("button", {
      name: "进入练习：Job Interview",
    });
    expect(enterBtn).toBeInTheDocument();
    expect(enterBtn).toHaveClass("focus-visible:ring-2");

    const cefrBadge = screen.getByText("B2");
    expect(cefrBadge).toHaveAttribute("aria-label", "难度等级: B2");
  });

  it("sets aria-busy and checking aria-label on enter button when checking health", async () => {
    useConversationStore.setState({ connectionState: "checking_health" });
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      recommendations: [
        {
          scenario_name: "daily_cafe",
          difficulty_cefr: "A2",
          focus_skills: ["ordering"],
          reason: "Order coffee",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.getByText("Daily Cafe")).toBeInTheDocument();
    });

    const enterBtn = screen.getByRole("button", {
      name: "检测服务中：Daily Cafe",
    });
    expect(enterBtn).toBeInTheDocument();
    expect(enterBtn).toHaveAttribute("aria-busy", "true");
    expect(enterBtn).toBeDisabled();
  });
});
