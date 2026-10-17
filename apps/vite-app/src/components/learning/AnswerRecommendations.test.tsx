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
});
