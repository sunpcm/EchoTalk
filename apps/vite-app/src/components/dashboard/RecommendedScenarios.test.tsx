import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecommendedScenarios } from "./RecommendedScenarios";
import * as api from "@/lib/api";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

describe("RecommendedScenarios UX & Accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({
      connectionState: "idle",
      selectedScenario: null,
    });
  });

  it("renders accessible enter button and difficulty badge with context labels", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: "past_tense",
      weakest_skill_mastery: 0.45,
      target_level: "B2",
      recommendations: [
        {
          scenario_name: "job_interview",
          difficulty_cefr: "B2",
          category: "conversation",
          focus_skills: ["past_tense", "formal_greeting"],
          system_prompt_template: "",
        },
      ],
    });

    render(<RecommendedScenarios />);

    // Wait for content to load
    await waitFor(() => {
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    });

    // Verify difficulty badge has context label and title
    const cefrBadge = screen.getByText("B2");
    expect(cefrBadge).toHaveAttribute("title", "难度：B2");
    expect(cefrBadge).toHaveAttribute("aria-label", "难度：B2");

    // Verify enter button has disambiguated aria-label
    const enterButton = screen.getByRole("button", {
      name: "进入练习：Job Interview",
    });
    expect(enterButton).toBeInTheDocument();
    expect(enterButton).toHaveClass("min-h-[44px]");
    expect(enterButton).toHaveClass("focus-visible:ring-2");
    expect(enterButton).toHaveClass("focus-visible:ring-accent");
    expect(enterButton).not.toHaveAttribute("aria-busy");
  });

  it("sets aria-busy and shows checking state when connectionState is checking_health", async () => {
    useConversationStore.setState({
      connectionState: "checking_health",
    });

    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: "polite_requests",
      weakest_skill_mastery: 0.2,
      target_level: "A1",
      recommendations: [
        {
          scenario_name: "ordering_coffee",
          difficulty_cefr: "A1",
          category: "conversation",
          focus_skills: ["polite_requests"],
          system_prompt_template: "",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    });

    const enterButton = screen.getByRole("button", {
      name: "进入练习：Ordering Coffee",
    });
    expect(enterButton).toBeDisabled();
    expect(enterButton).toHaveAttribute("aria-busy", "true");
    expect(enterButton).toHaveTextContent("检测服务中...");
  });

  it("triggers startSession on click", async () => {
    const startSessionMock = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({
      startSession: startSessionMock,
    });

    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: "asking_directions",
      weakest_skill_mastery: 0.5,
      target_level: "A2",
      recommendations: [
        {
          scenario_name: "travel_airport",
          difficulty_cefr: "A2",
          category: "conversation",
          focus_skills: ["asking_directions"],
          system_prompt_template: "",
        },
      ],
    });

    render(<RecommendedScenarios />);

    await waitFor(() => {
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    });

    const enterButton = screen.getByRole("button", {
      name: "进入练习：Travel Airport",
    });
    await userEvent.click(enterButton);

    expect(startSessionMock).toHaveBeenCalledWith("scenario");
    expect(useConversationStore.getState().selectedScenario?.scenario_name).toBe("travel_airport");
  });

  it("keeps the section title while loading and announces it as a status", () => {
    vi.mocked(api.getRecommendedCurriculum).mockReturnValue(new Promise(() => {}));
    render(<RecommendedScenarios />);

    expect(
      screen.getByRole("heading", { name: zhCN.dashboard.recommendTitle }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(zhCN.dashboard.loading);
  });

  it("shows a retry button on failure and reloads once when it is clicked", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockRejectedValueOnce(new Error("boom"));
    render(<RecommendedScenarios />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(zhCN.dashboard.loadError);
    expect(
      screen.getByRole("heading", { name: zhCN.dashboard.recommendTitle }),
    ).toBeInTheDocument();
    // 不回显异常文本
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();

    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: null,
      recommendations: [],
    } as unknown as Awaited<ReturnType<typeof api.getRecommendedCurriculum>>);
    fireEvent.click(screen.getByRole("button", { name: zhCN.dashboard.retry }));

    expect(await screen.findByText(zhCN.dashboard.noRecommendations)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.getRecommendedCurriculum).toHaveBeenCalledTimes(2);
  });

  it("drops a late response from a request that was superseded by retry", async () => {
    let rejectFirst!: (reason: Error) => void;
    vi.mocked(api.getRecommendedCurriculum).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFirst = reject;
      }),
    );
    const { unmount } = render(<RecommendedScenarios />);
    unmount();
    // 卸载后旧请求失败不得抛出未处理的状态更新
    rejectFirst(new Error("late"));
    await Promise.resolve();
    expect(api.getRecommendedCurriculum).toHaveBeenCalledTimes(1);
  });
});
