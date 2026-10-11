import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("renders label and textarea linked with htmlFor and id", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const label = screen.getByText(t.promptLabel);
    expect(label).toHaveAttribute("for", "doc-prompt-builder-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "doc-prompt-builder-textarea");
  });

  it("renders preset buttons with correct aria-pressed state and triggers onChange", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value={t.presets.interviewPrompt} onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    const paperBtn = screen.getByRole("button", { name: t.presets.paper });

    expect(interviewBtn).toHaveAttribute("aria-pressed", "true");
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(paperBtn);
    expect(handleChange).toHaveBeenCalledWith(t.presets.paperPrompt);
  });
});
