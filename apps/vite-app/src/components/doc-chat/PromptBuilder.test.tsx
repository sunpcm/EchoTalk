import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("renders correctly with associated label and textarea ID", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const label = screen.getByText(t.promptLabel);
    expect(label).toHaveAttribute("for", "prompt-builder-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "prompt-builder-textarea");
  });

  it("triggers onChange with preset prompt when a preset button is clicked", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    fireEvent.click(interviewBtn);

    expect(handleChange).toHaveBeenCalledWith(t.presets.interviewPrompt);
  });
});
