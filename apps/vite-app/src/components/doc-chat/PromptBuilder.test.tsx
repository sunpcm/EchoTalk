import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("associates label correctly with textarea", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="Initial prompt" onChange={handleChange} />);

    const textarea = screen.getByLabelText(t.promptLabel);
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute("id", "doc-chat-prompt");
    expect(textarea).toHaveValue("Initial prompt");
  });

  it("calls onChange with preset prompt when a preset button is clicked", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    expect(interviewBtn).toHaveAttribute("type", "button");

    fireEvent.click(interviewBtn);
    expect(handleChange).toHaveBeenCalledWith(t.presets.interviewPrompt);
  });

  it("calls onChange when typing in textarea", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const textarea = screen.getByLabelText(t.promptLabel);
    fireEvent.change(textarea, { target: { value: "Custom prompt" } });
    expect(handleChange).toHaveBeenCalledWith("Custom prompt");
  });
});
