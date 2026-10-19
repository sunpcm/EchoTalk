import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SkillTree } from "./SkillTree";
import type { KnowledgeStateResponse } from "@/lib/api";

describe("SkillTree", () => {
  it("renders null when states array is empty", () => {
    const { container } = render(<SkillTree states={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders progress bars with role progressbar and ARIA attributes", () => {
    const mockStates: KnowledgeStateResponse[] = [
      {
        id: "ks_1",
        user_id: "user_1",
        skill_id: "pron_th",
        skill_name: "/θ/ Sound",
        skill_category: "pronunciation",
        p_mastery: 0.85,
        updated_at: "2025-03-01T00:00:00Z",
      },
      {
        id: "ks_2",
        user_id: "user_1",
        skill_id: "gram_past_simple",
        skill_name: "Past Simple Tense",
        skill_category: "grammar",
        p_mastery: 0.96,
        updated_at: "2025-03-01T00:00:00Z",
      },
    ];

    render(<SkillTree states={mockStates} />);

    expect(screen.getByText(/发音/i)).toBeInTheDocument();
    expect(screen.getByText(/语法/i)).toBeInTheDocument();

    const progressBars = screen.getAllByRole("progressbar");
    expect(progressBars).toHaveLength(2);

    expect(progressBars[0]).toHaveAttribute("aria-valuenow", "85");
    expect(progressBars[0]).toHaveAttribute("aria-valuemin", "0");
    expect(progressBars[0]).toHaveAttribute("aria-valuemax", "100");
    expect(progressBars[0]).toHaveAttribute("aria-label", "/θ/ Sound");

    expect(progressBars[1]).toHaveAttribute("aria-valuenow", "96");
    expect(progressBars[1]).toHaveAttribute("aria-valuemin", "0");
    expect(progressBars[1]).toHaveAttribute("aria-valuemax", "100");
    expect(progressBars[1]).toHaveAttribute("aria-label", "Past Simple Tense");
  });
});
