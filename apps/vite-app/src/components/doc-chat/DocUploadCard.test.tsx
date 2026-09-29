import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DocUploadCard } from "./DocUploadCard";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("DocUploadCard", () => {
  it("renders correctly with accessibility attributes", () => {
    const handleChange = vi.fn();
    render(<DocUploadCard value="Hello world" onChange={handleChange} />);

    const label = screen.getByText(t.uploadHint);
    expect(label).toHaveAttribute("for", "doc-upload-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "doc-upload-textarea");

    const uploadBtn = screen.getByRole("button", { name: /点击选择 .txt 或 .md 文件/i });
    expect(uploadBtn).toHaveAttribute("tabindex", "0");
  });

  it("triggers file click when Enter or Space key is pressed on upload dropzone", () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="" onChange={handleChange} />);

    const uploadBtn = screen.getByRole("button", { name: /点击选择 .txt 或 .md 文件/i });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const clickSpy = vi.spyOn(fileInput, "click");

    fireEvent.keyDown(uploadBtn, { key: "Enter" });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(uploadBtn, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it("opens the picker once and reads the selected file", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="" onChange={handleChange} />);
    const uploadBtn = screen.getByRole("button", { name: /点击选择 .txt 或 .md 文件/i });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    fireEvent.click(uploadBtn);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.change(fileInput, {
      target: { files: [new File(["Sample document"], "sample.md", { type: "text/markdown" })] },
    });
    await waitFor(() => expect(handleChange).toHaveBeenCalledWith("Sample document"));
  });

  it("shows over-limit warning with alert role when character count exceeds 50,000", () => {
    const handleChange = vi.fn();
    const overLimitText = "a".repeat(50_001);

    render(<DocUploadCard value={overLimitText} onChange={handleChange} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(t.charOverLimit);
    expect(alert).toHaveAttribute("aria-live", "polite");
  });
});
