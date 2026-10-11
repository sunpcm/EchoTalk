import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DailyProgress } from "./DailyProgress";
import { listSessions, getSessionDetail } from "@/lib/api";
import type { SessionListItem, Session, Transcript } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

vi.mock("@/lib/api", () => ({
  listSessions: vi.fn(),
  getSessionDetail: vi.fn(),
}));

const t = zhCN.dashboard;

describe("DailyProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders progressbar attributes correctly when turns are below goal", async () => {
    const todayStr = new Date().toISOString();
    const mockSessions: SessionListItem[] = [
      { id: "s1", mode: "scenario", status: "completed", started_at: todayStr, ended_at: null },
    ];
    vi.mocked(listSessions).mockResolvedValue(mockSessions);

    const mockDetail: Session = {
      id: "s1",
      user_id: "u1",
      mode: "scenario",
      status: "completed",
      started_at: todayStr,
      ended_at: null,
      transcripts: [
        {
          id: 1,
          session_id: "s1",
          role: "user",
          content: "Hi",
          audio_url: null,
          timestamp_ms: 1000,
        },
        {
          id: 2,
          session_id: "s1",
          role: "assistant",
          content: "Hello",
          audio_url: null,
          timestamp_ms: 2000,
        },
      ],
    };
    vi.mocked(getSessionDetail).mockResolvedValue(mockDetail);

    render(<DailyProgress />);

    await waitFor(() => {
      const progressbar = screen.getByRole("progressbar", { name: t.dailyProgressTitle });
      expect(progressbar).toHaveAttribute("aria-valuenow", "2");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "20");
      expect(progressbar).toHaveAttribute("aria-valuetext", "2 / 20");
    });
  });

  it("caps aria-valuenow at 20 while preserving actual turns in aria-valuetext when turns exceed goal", async () => {
    const todayStr = new Date().toISOString();
    const mockSessions: SessionListItem[] = [
      { id: "s1", mode: "scenario", status: "completed", started_at: todayStr, ended_at: null },
    ];
    vi.mocked(listSessions).mockResolvedValue(mockSessions);

    // Generate 25 transcript turns
    const transcripts: Transcript[] = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      session_id: "s1",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Turn ${i}`,
      audio_url: null,
      timestamp_ms: 1000 + i * 100,
    }));

    const mockDetail: Session = {
      id: "s1",
      user_id: "u1",
      mode: "scenario",
      status: "completed",
      started_at: todayStr,
      ended_at: null,
      transcripts,
    };
    vi.mocked(getSessionDetail).mockResolvedValue(mockDetail);

    render(<DailyProgress />);

    await waitFor(() => {
      const progressbar = screen.getByRole("progressbar", { name: t.dailyProgressTitle });
      // aria-valuenow should be capped at 20 (aria-valuemax)
      expect(progressbar).toHaveAttribute("aria-valuenow", "20");
      expect(progressbar).toHaveAttribute("aria-valuemax", "20");
      // aria-valuetext should accurately reflect the actual 25 turns completed
      expect(progressbar).toHaveAttribute("aria-valuetext", "25 / 20");
    });
  });
});
