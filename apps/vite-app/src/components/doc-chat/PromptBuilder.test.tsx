import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("associates label with textarea and renders preset buttons", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const textarea = screen.getByLabelText(t.promptLabel);
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute("id", "doc-prompt");

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    expect(interviewBtn).toBeInTheDocument();
    expect(interviewBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when typing in textarea", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const textarea = screen.getByLabelText(t.promptLabel);
    fireEvent.change(textarea, { target: { value: "Custom prompt" } });

    expect(handleChange).toHaveBeenCalledWith("Custom prompt");
  });

  it("calls onChange with preset prompt and sets aria-pressed when selected", () => {
    const handleChange = vi.fn();
    const { rerender } = render(<PromptBuilder value="" onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    fireEvent.click(interviewBtn);

    expect(handleChange).toHaveBeenCalledWith(t.presets.interviewPrompt);

    rerender(<PromptBuilder value={t.presets.interviewPrompt} onChange={handleChange} />);
    expect(interviewBtn).toHaveAttribute("aria-pressed", "true");
  });
});
