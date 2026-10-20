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

  it.each([0, 5, 20, 25])("keeps the accessible value in range for %i turns", async (turns) => {
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
      transcripts: Array.from({ length: turns }, (_, index) => ({
        id: index + 1,
        session_id: "sess-1",
        role: "user" as const,
        content: "synthetic transcript",
        audio_url: null,
        timestamp_ms: (index + 1) * 1000,
      })),
    });

    render(<DailyProgress />);

    await waitFor(() => {
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", String(Math.min(turns, 20)));
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "20");
      expect(progressbar).toHaveAttribute("aria-valuetext", `${turns} / 20`);
      expect(progressbar).toHaveAttribute("aria-label", "对话轮次目标");
      expect(progressbar.firstElementChild).toHaveStyle({
        width: `${Math.min(turns / 20, 1) * 100}%`,
      });
    });
  });
});
