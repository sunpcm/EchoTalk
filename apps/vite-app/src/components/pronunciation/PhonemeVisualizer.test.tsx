import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhonemeVisualizer } from "./PhonemeVisualizer";
import type { PhonemeAlignmentItem } from "@/lib/api";

describe("PhonemeVisualizer", () => {
  it("renders nothing when alignment list is empty", () => {
    const { container } = render(<PhonemeVisualizer alignment={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders phonemes with accessible aria-label and tabIndex", () => {
    const mockAlignment: PhonemeAlignmentItem[] = [
      { phoneme: "AE", type: "correct" },
      { phoneme: "K", type: "substitution", expected: "K", actual: "G" },
      { phoneme: "T", type: "deletion", expected: "T" },
      { phoneme: "S", type: "insertion", actual: "S" },
    ];

    render(<PhonemeVisualizer alignment={mockAlignment} />);

    const blocks = screen.getAllByLabelText(/./);
    expect(blocks).toHaveLength(4);

    expect(blocks[0]).toHaveAttribute("tabindex", "0");
    expect(blocks[0]).toHaveAttribute("aria-label", expect.stringContaining("AE"));
    expect(blocks[0]).toHaveAttribute("aria-label", expect.stringContaining("正确"));

    expect(blocks[1]).toHaveAttribute("aria-label", expect.stringContaining("替换"));
    expect(blocks[2]).toHaveAttribute("aria-label", expect.stringContaining("缺失"));
    expect(blocks[3]).toHaveAttribute("aria-label", expect.stringContaining("多余"));
  });
});
