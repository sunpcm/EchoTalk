import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SkillTree } from "./SkillTree";
import type { KnowledgeStateResponse } from "@/lib/api";

describe("SkillTree accessibility", () => {
  it("renders progressbar elements with accessibility attributes for skill mastery levels", () => {
    const states: KnowledgeStateResponse[] = [
      {
        id: "ks-1",
        user_id: "u1",
        skill_id: "pron_1",
        skill_name: "元音 /æ/ 发音",
        skill_category: "pronunciation",
        p_mastery: 0.82,
        updated_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "ks-2",
        user_id: "u1",
        skill_id: "gram_1",
        skill_name: "现在完成时",
        skill_category: "grammar",
        p_mastery: 0.96,
        updated_at: "2025-01-01T00:00:00Z",
      },
    ];

    render(<SkillTree states={states} />);

    const progressbars = screen.getAllByRole("progressbar");
    expect(progressbars).toHaveLength(2);

    expect(progressbars[0]).toHaveAttribute("aria-valuenow", "82");
    expect(progressbars[0]).toHaveAttribute("aria-valuemin", "0");
    expect(progressbars[0]).toHaveAttribute("aria-valuemax", "100");
    expect(progressbars[0]).toHaveAttribute("aria-valuetext", "82%");
    expect(progressbars[0]).toHaveAttribute("aria-label", "元音 /æ/ 发音");

    expect(progressbars[1]).toHaveAttribute("aria-valuenow", "96");
    expect(progressbars[1]).toHaveAttribute("aria-valuetext", "96%");
    expect(progressbars[1]).toHaveAttribute("aria-label", "现在完成时");
  });
});
