import { fireEvent, render, screen } from "@testing-library/react";
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

  it("preserves segment language metadata and omits an empty language", () => {
    mockUseTrackTranscription.mockImplementation((trackRef: unknown) => {
      if (trackRef && !(trackRef as { source?: unknown }).source) {
        return {
          segments: [
            {
              id: "seg-zh",
              text: "早上好，今天想练习什么？",
              language: "zh-CN",
              firstReceivedTime: 1000,
              final: true,
            },
          ],
        };
      }

      return {
        segments: [
          {
            id: "seg-mixed",
            text: "I want to practice English.",
            language: "",
            firstReceivedTime: 2000,
            final: true,
          },
        ],
      };
    });

    render(<ChatSubtitles />);

    const agentText = screen
      .getByLabelText(`${t.aiCoach}: 早上好，今天想练习什么？`)
      .querySelector("p");
    const userText = screen
      .getByLabelText(`${t.you}: I want to practice English.`)
      .querySelector("p");

    expect(agentText).toHaveAttribute("lang", "zh-CN");
    expect(userText).not.toHaveAttribute("lang");
  });

  it("collapses earlier turns while keeping the latest turn and log semantics", () => {
    mockUseTrackTranscription.mockImplementation((trackRef: unknown) => {
      if (trackRef && !(trackRef as { source?: unknown }).source) {
        return {
          segments: [
            {
              id: "seg-1",
              text: "What did you do today?",
              firstReceivedTime: 1000,
              final: true,
            },
          ],
        };
      }
      return {
        segments: [
          {
            id: "seg-2",
            text: "I practiced speaking after work.",
            firstReceivedTime: 2000,
            final: true,
          },
        ],
      };
    });

    render(<ChatSubtitles />);

    const log = screen.getByRole("log");
    const foldButton = screen.getByRole("button", { name: t.collapseTranscript });
    expect(foldButton).toHaveAttribute("aria-expanded", "true");
    expect(foldButton).toHaveAttribute("aria-controls", log.id);

    fireEvent.click(foldButton);

    expect(screen.getByRole("button", { name: t.expandTranscript })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("log", { name: t.title })).toBe(log);

    const turns = log.querySelectorAll("article");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveAttribute("hidden");
    expect(turns[1]).not.toHaveAttribute("hidden");
    expect(turns[1]).toHaveAttribute("aria-current", "true");
  });
});
