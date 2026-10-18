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
      },
    ]);
    vi.mocked(getSessionDetail).mockResolvedValue({
      id: "sess-1",
      mode: "scenario",
      status: "completed",
      started_at: `${todayStr}T10:00:00Z`,
      ended_at: `${todayStr}T10:05:00Z`,
      transcripts: [
        { id: "t1", speaker: "user", text: "hello", timestamp: 1 },
        { id: "t2", speaker: "agent", text: "hi", timestamp: 2 },
        { id: "t3", speaker: "user", text: "how are you", timestamp: 3 },
        { id: "t4", speaker: "agent", text: "good", timestamp: 4 },
        { id: "t5", speaker: "user", text: "nice", timestamp: 5 },
      ],
    } as any);

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
