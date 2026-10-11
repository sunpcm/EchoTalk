import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("associates label with prompt textarea", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const label = screen.getByText(t.promptLabel);
    expect(label).toHaveAttribute("for", "doc-prompt-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "doc-prompt-textarea");
  });

  it("renders preset buttons with correct aria-pressed states", () => {
    const handleChange = vi.fn();
    const { rerender } = render(<PromptBuilder value="" onChange={handleChange} />);

    const presetGroup = screen.getByRole("group", { name: t.presetGroupLabel });
    expect(presetGroup).toBeInTheDocument();

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    const paperBtn = screen.getByRole("button", { name: t.presets.paper });
    const freeBtn = screen.getByRole("button", { name: t.presets.free });

    expect(interviewBtn).toHaveAttribute("aria-pressed", "false");
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");
    expect(freeBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(interviewBtn);
    expect(handleChange).toHaveBeenCalledWith(t.presets.interviewPrompt);

    rerender(<PromptBuilder value={t.presets.interviewPrompt} onChange={handleChange} />);
    expect(interviewBtn).toHaveAttribute("aria-pressed", "true");
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");
  });
});
