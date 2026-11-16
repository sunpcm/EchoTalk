import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatSubtitles } from "./ChatSubtitles";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.chat;

const mockUseVoiceAssistant = vi.fn();
const mockUseLocalParticipant = vi.fn();
const mockUseTrackTranscription = vi.fn();

vi.mock("@livekit/components-react", () => ({
  useVoiceAssistant: () => mockUseVoiceAssistant(),
  useLocalParticipant: () => mockUseLocalParticipant(),
  useTrackTranscription: (trackRef: unknown) => mockUseTrackTranscription(trackRef),
}));

describe("ChatSubtitles accessibility & display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVoiceAssistant.mockReturnValue({
      audioTrack: { track: {} },
    });
    mockUseLocalParticipant.mockReturnValue({
      localParticipant: {},
      microphoneTrack: { track: {} },
    });
    mockUseTrackTranscription.mockReturnValue({
      segments: [],
    });
  });

  it("renders log container with aria-live and aria-label", () => {
    render(<ChatSubtitles />);

    const logContainer = screen.getByRole("log");
    expect(logContainer).toBeInTheDocument();
    expect(logContainer).toHaveAttribute("aria-live", "polite");
    expect(logContainer).toHaveAttribute("aria-relevant", "additions text");
    expect(logContainer).toHaveAttribute("aria-label", t.title);
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });

  it("renders messages with accessible labels distinguishing user and agent", () => {
    // Agent transcription
    mockUseTrackTranscription.mockImplementation((trackRef: unknown) => {
      // If voiceAssistant.audioTrack
      if (trackRef && !(trackRef as { source?: unknown }).source) {
        return {
          segments: [
            {
              id: "seg-1",
              text: "Hello! How can I help you today?",
              firstReceivedTime: 1000,
              final: true,
            },
          ],
        };
      }
      // User mic transcription
      return {
        segments: [
          {
            id: "seg-2",
            text: "Hi, I want to practice English.",
            firstReceivedTime: 2000,
            final: true,
          },
        ],
      };
    });

    render(<ChatSubtitles />);

    expect(screen.queryByText(t.empty)).not.toBeInTheDocument();

    const agentBubble = screen.getByLabelText(`${t.aiCoach}: Hello! How can I help you today?`);
    expect(agentBubble).toBeInTheDocument();
    expect(agentBubble).toHaveTextContent(t.aiCoach);
    expect(agentBubble).toHaveTextContent("Hello! How can I help you today?");

    const userBubble = screen.getByLabelText(`${t.you}: Hi, I want to practice English.`);
    expect(userBubble).toBeInTheDocument();
    expect(userBubble).toHaveTextContent(t.you);
    expect(userBubble).toHaveTextContent("Hi, I want to practice English.");
  });
});
