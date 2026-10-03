import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("PromptBuilder", () => {
  it("renders label associated with textarea via htmlFor and id", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const label = screen.getByText(t.promptLabel);
    expect(label).toHaveAttribute("for", "doc-prompt-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "doc-prompt-textarea");
  });

  it("renders preset buttons with correct group role and aria-pressed state", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value={t.presets.interviewPrompt} onChange={handleChange} />);

    const group = screen.getByRole("group", { name: "Prompt 预设模板" });
    expect(group).toBeInTheDocument();

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    const paperBtn = screen.getByRole("button", { name: t.presets.paper });

    expect(interviewBtn).toHaveAttribute("aria-pressed", "true");
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("triggers onChange with preset prompt when a preset button is clicked", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const paperBtn = screen.getByRole("button", { name: t.presets.paper });
    fireEvent.click(paperBtn);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith(t.presets.paperPrompt);
  });

  it("triggers onChange when editing the textarea directly", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Custom prompt" } });

    expect(handleChange).toHaveBeenCalledWith("Custom prompt");
  });
});
