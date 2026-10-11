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

  it("renders preset buttons with correct aria-pressed attributes when inactive", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    const paperBtn = screen.getByRole("button", { name: t.presets.paper });
    const freeBtn = screen.getByRole("button", { name: t.presets.free });

    expect(interviewBtn).toHaveAttribute("aria-pressed", "false");
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");
    expect(freeBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("triggers onChange with preset prompt when a preset button is clicked", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    fireEvent.click(interviewBtn);

    expect(handleChange).toHaveBeenCalledWith(t.presets.interviewPrompt);
  });

  it("marks active preset button with aria-pressed=true", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value={t.presets.interviewPrompt} onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    const paperBtn = screen.getByRole("button", { name: t.presets.paper });

    expect(interviewBtn).toHaveAttribute("aria-pressed", "true");
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");
  });
});
