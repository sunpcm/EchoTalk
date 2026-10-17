import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnswerRecommendations } from "./AnswerRecommendations";

// Mock @livekit/components-react hook
const mockUseVoiceAssistant = vi.fn();
vi.mock("@livekit/components-react", () => ({
  useVoiceAssistant: () => mockUseVoiceAssistant(),
}));

describe("AnswerRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders waiting text when no question is detected", () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [],
      state: "listening",
    });

    render(<AnswerRecommendations />);
    expect(screen.getByText(/等待 AI 提问中/i)).toBeInTheDocument();
  });

  it("renders recommendation buttons when a question is detected", () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "1",
          text: "What is your name?",
          final: true,
          firstReceivedTime: Date.now(),
        },
      ],
      state: "listening",
    });

    render(<AnswerRecommendations />);
    expect(screen.getByRole("region", { name: /回答推荐/i })).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0]).toHaveAttribute("aria-label");
  });

  it("copies text on button click and shows '已复制' indicator", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "1",
          text: "What is your name?",
          final: true,
          firstReceivedTime: Date.now(),
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    expect(writeTextMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("已复制")).toBeInTheDocument();
    });
  });

  it("keeps the full recommendation visible and reports clipboard failures", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "1",
          text: "What is your name?",
          final: true,
          firstReceivedTime: Date.now(),
        },
      ],
      state: "listening",
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("clipboard unavailable")),
      },
    });

    render(<AnswerRecommendations />);
    const answer = screen.getByText("My name is ... and I'm learning English.");
    expect(answer).not.toHaveClass("truncate");

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
  });
});
