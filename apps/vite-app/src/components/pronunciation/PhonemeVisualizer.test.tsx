import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhonemeVisualizer } from "./PhonemeVisualizer";
import type { PhonemeAlignmentItem } from "@/lib/api";

describe("PhonemeVisualizer", () => {
  const mockAlignment: PhonemeAlignmentItem[] = [
    { phoneme: "k", type: "correct" },
    { phoneme: "æ", type: "substitution", expected: "æ", actual: "e" },
    { phoneme: "t", type: "deletion", expected: "t" },
    { phoneme: "s", type: "insertion", actual: "s" },
  ];

  it("renders nothing when alignment is empty", () => {
    const { container } = render(<PhonemeVisualizer alignment={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders phoneme blocks with keyboard focusability and aria-labels", () => {
    render(<PhonemeVisualizer alignment={mockAlignment} />);

    const correctBlock = screen.getByLabelText(/k: 正确/i);
    expect(correctBlock).toBeInTheDocument();
    expect(correctBlock).toHaveAttribute("tabindex", "0");

    const subBlock = screen.getByLabelText(/æ: 替换：期望 æ，实际 e/i);
    expect(subBlock).toBeInTheDocument();
    expect(subBlock).toHaveAttribute("tabindex", "0");

    const delBlock = screen.getByLabelText(/t: 缺失：t/i);
    expect(delBlock).toBeInTheDocument();
    expect(delBlock).toHaveAttribute("tabindex", "0");

    const insBlock = screen.getByLabelText(/s: 多余：s/i);
    expect(insBlock).toBeInTheDocument();
    expect(insBlock).toHaveAttribute("tabindex", "0");
  });

  it("renders tooltips with role='tooltip'", () => {
    render(<PhonemeVisualizer alignment={mockAlignment} />);

    const tooltips = screen.getAllByRole("tooltip", { hidden: true });
    expect(tooltips).toHaveLength(4);
    expect(tooltips[0]).toHaveTextContent("正确");
  });
});
