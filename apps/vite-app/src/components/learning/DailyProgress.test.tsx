import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DailyProgress } from "./DailyProgress";

vi.mock("@/lib/api", () => ({
  listSessions: vi.fn(),
  getSessionDetail: vi.fn(),
}));

import { listSessions, getSessionDetail } from "@/lib/api";

describe("DailyProgress accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders progressbar with correct accessibility attributes", async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    vi.mocked(listSessions).mockResolvedValue([
      {
        id: "sess-1",
        mode: "scenario",
        status: "completed",
        started_at: `${todayStr}T10:00:00Z`,
        ended_at: `${todayStr}T10:05:00Z`,
      },
    ]);
    vi.mocked(getSessionDetail).mockResolvedValue({
      id: "sess-1",
      user_id: "u-1",
      mode: "scenario",
      status: "completed",
      started_at: `${todayStr}T10:00:00Z`,
      ended_at: `${todayStr}T10:05:00Z`,
      transcripts: [
        {
          id: 1,
          session_id: "sess-1",
          role: "user",
          content: "hello",
          audio_url: null,
          timestamp_ms: 1000,
        },
        {
          id: 2,
          session_id: "sess-1",
          role: "assistant",
          content: "hi",
          audio_url: null,
          timestamp_ms: 2000,
        },
        {
          id: 3,
          session_id: "sess-1",
          role: "user",
          content: "how are you",
          audio_url: null,
          timestamp_ms: 3000,
        },
        {
          id: 4,
          session_id: "sess-1",
          role: "assistant",
          content: "good",
          audio_url: null,
          timestamp_ms: 4000,
        },
        {
          id: 5,
          session_id: "sess-1",
          role: "user",
          content: "nice",
          audio_url: null,
          timestamp_ms: 5000,
        },
      ],
    });

    render(<DailyProgress />);

    await waitFor(() => {
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "5");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "20");
      expect(progressbar).toHaveAttribute("aria-valuetext", "5 / 20");
      expect(progressbar).toHaveAttribute("aria-label", "对话轮次目标");
    });
  });
});
