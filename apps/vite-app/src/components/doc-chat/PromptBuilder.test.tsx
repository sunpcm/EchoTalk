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
    expect(label).toHaveAttribute("for", "prompt-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "prompt-textarea");
  });

  it("renders preset buttons group with aria-pressed state", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value={t.presets.interviewPrompt} onChange={handleChange} />);

    const group = screen.getByRole("group", { name: "Prompt 预设模板" });
    expect(group).toBeInTheDocument();

    const interviewBtn = screen.getByRole("button", { name: t.presets.interview });
    expect(interviewBtn).toHaveAttribute("aria-pressed", "true");

    const paperBtn = screen.getByRole("button", { name: t.presets.paper });
    expect(paperBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with preset prompt when a preset button is clicked", () => {
    const handleChange = vi.fn();
    render(<PromptBuilder value="" onChange={handleChange} />);

    const paperBtn = screen.getByRole("button", { name: t.presets.paper });
    fireEvent.click(paperBtn);

    expect(handleChange).toHaveBeenCalledWith(t.presets.paperPrompt);
  });
});
