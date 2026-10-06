import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";

describe("PromptBuilder", () => {
  it("renders preset buttons with proper accessibility attributes and triggers onChange when clicked", () => {
    const onChange = vi.fn();
    render(<PromptBuilder value="" onChange={onChange} />);

    const interviewBtn = screen.getByRole("button", {
      name: `使用 ${zhCN.docChat.presets.interview} 预设`,
    });
    expect(interviewBtn).toBeInTheDocument();
    expect(interviewBtn).toHaveClass("focus-visible:ring-2");

    fireEvent.click(interviewBtn);
    expect(onChange).toHaveBeenCalledWith(zhCN.docChat.presets.interviewPrompt);
  });
});
