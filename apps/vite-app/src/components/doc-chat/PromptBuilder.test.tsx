import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("associates label with textarea and renders preset buttons", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const label = screen.getByText(t.promptLabel);
    expect(label).toHaveAttribute("for", "doc-prompt-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "doc-prompt-textarea");

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    expect(interviewBtn).toBeDefined();

    fireEvent.click(interviewBtn);
    expect(handleChange).toHaveBeenCalledWith(t.presets.interviewPrompt);
  });
});
