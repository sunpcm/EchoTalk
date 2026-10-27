import React, { useLayoutEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DocUploadCard } from "./DocUploadCard";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

describe("DocUploadCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders correctly with accessibility attributes", () => {
    const handleChange = vi.fn();
    render(<DocUploadCard value="Hello world" onChange={handleChange} />);

    const label = screen.getByText(t.uploadHint);
    expect(label).toHaveAttribute("for", "doc-upload-textarea");

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("id", "doc-upload-textarea");
    expect(textarea).toHaveAttribute("aria-describedby", "doc-upload-char-count");

    const charCounter = screen.getByText(/11 \/ 50,000 字符/i).parentElement;
    expect(charCounter).toHaveAttribute("id", "doc-upload-char-count");
    expect(charCounter).toHaveAttribute("aria-live", "polite");

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

  it("supports .txt and .markdown extensions and handles UTF-8 BOM correctly", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Initial draft" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    // .txt
    fireEvent.change(fileInput, {
      target: { files: [new File(["plain text content"], "notes.TXT")] },
    });
    await waitFor(() => expect(handleChange).toHaveBeenCalledWith("plain text content"));

    // single UTF-8 BOM (\uFEFF): TextDecoder strips the single transport BOM
    const singleBomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x48, 0x69]); // BOM + "# Hi"
    fireEvent.change(fileInput, {
      target: { files: [new File([singleBomBytes], "doc.MARKDOWN")] },
    });
    await waitFor(() => expect(handleChange).toHaveBeenCalledWith("# Hi"));
  });

  it("strips only transport BOM and preserves body leading FEFF on double-BOM input", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Keep me" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    // Double BOM: EF BB BF + EF BB BF + "literal"
    // Transport BOM should be stripped, but body FEFF must be retained as \uFEFFliteral
    const doubleBomBytes = new Uint8Array([
      0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x6c, 0x69, 0x74, 0x65, 0x72, 0x61, 0x6c,
    ]);
    const file = new File([doubleBomBytes], "double_bom.txt");

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    await waitFor(() => expect(handleChange).toHaveBeenCalledWith("\uFEFFliteral"));
  });

  it("rejects unsupported extensions and preserves draft", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Preserved draft" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, {
      target: { files: [new File(["binary content"], "archive.pdf")] },
    });

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent(t.importErrorUnsupportedType);
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Preserved draft");
  });

  it("rejects empty files and preserves draft", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Keep me" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, {
      target: { files: [new File([], "empty.txt")] },
    });

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent(t.importErrorEmpty);
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Keep me");
  });

  it("rejects files exceeding conservative byte limit (200,003 bytes) without reading", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Keep me" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const largeFile = new File(["a".repeat(200_004)], "too_big.md");
    fireEvent.change(fileInput, {
      target: { files: [largeFile] },
    });

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent(t.importErrorOverLimit);
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("rejects decoded text exceeding 50,000 characters and preserves draft", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Keep me" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const overLimitContent = "x".repeat(50_001);
    const file = new File([overLimitContent], "overlimit.txt");

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent(t.importErrorOverLimit);
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("rejects invalid UTF-8 encoding safely", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Draft before" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const invalidBytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
    const file = new File([invalidBytes], "bad_encoding.txt");

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent(t.importErrorInvalidEncoding);
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Draft before");
  });

  it("handles read error cleanly and preserves draft", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="Stable draft" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const OriginalFileReader = window.FileReader;
    class MockErrorFileReader {
      onload: any = null;
      onerror: any = null;
      onabort: any = null;
      result: any = null;
      readAsArrayBuffer() {
        setTimeout(() => {
          this.onerror?.(new Event("error"));
        }, 10);
      }
      abort() {}
    }
    window.FileReader = MockErrorFileReader as any;

    try {
      fireEvent.change(fileInput, {
        target: { files: [new File(["valid"], "doc.txt")] },
      });

      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert).toHaveTextContent(t.importErrorReadFailed);
      expect(handleChange).not.toHaveBeenCalled();
    } finally {
      window.FileReader = OriginalFileReader;
    }
  });

  it("allows selecting the same file again after error or success", async () => {
    const handleChange = vi.fn();
    const { container } = render(<DocUploadCard value="" onChange={handleChange} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const file = new File(["Same file content"], "same.txt");

    // First selection
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(handleChange).toHaveBeenCalledWith("Same file content"));

    // Second selection of the same file
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(handleChange).toHaveBeenCalledTimes(2));
  });

  it("cancelling file selection retains draft and does not report error", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <DocUploadCard value="My current draft" onChange={handleChange} />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent(fileInput, new Event("cancel"));
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("Controllable asynchronous race and lifecycle tests", () => {
    let readers: any[] = [];
    const OriginalFileReader = window.FileReader;

    beforeEach(() => {
      readers = [];
      class MockControlledReader {
        onload: any = null;
        onerror: any = null;
        onabort: any = null;
        result: ArrayBuffer | null = null;
        aborted = false;

        constructor() {
          readers.push(this);
        }

        readAsArrayBuffer() {
          // controlled manually by test
        }

        abort() {
          this.aborted = true;
          this.onabort?.(new Event("abort"));
        }
      }
      window.FileReader = MockControlledReader as any;
    });

    afterEach(() => {
      window.FileReader = OriginalFileReader;
    });

    it("late load from old read does not overwrite newer successful read even when invoked directly", async () => {
      const handleChange = vi.fn();
      const { container } = render(<DocUploadCard value="" onChange={handleChange} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Read A started
      fireEvent.change(fileInput, {
        target: { files: [new File(["Content A"], "a.txt")] },
      });
      expect(readers.length).toBe(1);
      const readerA = readers[0];

      // Capture stale callback reference before invalidation
      const staleOnloadA = readerA.onload;
      expect(typeof staleOnloadA).toBe("function");

      // Read B started (invalidates A)
      fireEvent.change(fileInput, {
        target: { files: [new File(["Content B"], "b.txt")] },
      });
      expect(readers.length).toBe(2);
      const readerB = readers[1];
      expect(readerA.aborted).toBe(true);

      // Reader B finishes first
      readerB.result = new TextEncoder().encode("Content B").buffer;
      act(() => {
        readerB.onload?.(new Event("load"));
      });

      expect(handleChange).toHaveBeenCalledWith("Content B");
      expect(handleChange).toHaveBeenCalledTimes(1);

      // Reader A finishes late: directly invoke captured stale callback
      readerA.result = new TextEncoder().encode("Content A").buffer;
      act(() => {
        staleOnloadA(new Event("load"));
      });

      // Still only Content B
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it("late error or abort from old read does not clobber new state even when invoked directly", async () => {
      const handleChange = vi.fn();
      const { container } = render(<DocUploadCard value="" onChange={handleChange} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Read A started
      fireEvent.change(fileInput, {
        target: { files: [new File(["Content A"], "a.txt")] },
      });
      const readerA = readers[0];
      const staleOnerrorA = readerA.onerror;
      const staleOnabortA = readerA.onabort;
      expect(typeof staleOnerrorA).toBe("function");
      expect(typeof staleOnabortA).toBe("function");

      // Read B started
      fireEvent.change(fileInput, {
        target: { files: [new File(["Content B"], "b.txt")] },
      });
      const readerB = readers[1];

      // Reader B finishes successfully
      readerB.result = new TextEncoder().encode("Content B").buffer;
      act(() => {
        readerB.onload?.(new Event("load"));
      });
      expect(handleChange).toHaveBeenCalledWith("Content B");

      // Directly invoke captured stale error and abort handlers from Read A
      act(() => {
        staleOnerrorA(new Event("error"));
        staleOnabortA(new Event("abort"));
      });

      // No error alert should be shown for the invalidated read A
      expect(screen.queryByRole("alert")).toBeNull();
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it("manual user edit invalidates pending read and invoking stale callback does not overwrite", async () => {
      const handleChange = vi.fn();
      const { container } = render(<DocUploadCard value="" onChange={handleChange} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Start read A
      fireEvent.change(fileInput, {
        target: { files: [new File(["Pending file"], "pending.txt")] },
      });
      const readerA = readers[0];
      const staleOnloadA = readerA.onload;
      expect(typeof staleOnloadA).toBe("function");

      // User types manually in textarea
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "User typed content" } });
      expect(handleChange).toHaveBeenCalledWith("User typed content");
      expect(readerA.aborted).toBe(true);

      // Invoke stale callback directly
      readerA.result = new TextEncoder().encode("Pending file").buffer;
      act(() => {
        staleOnloadA(new Event("load"));
      });

      // Should not overwrite user input
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it("substantial change of parent value invalidates pending read and stale callback is inert", async () => {
      const handleChange = vi.fn();
      const { container, rerender } = render(<DocUploadCard value="V1" onChange={handleChange} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Start read A
      fireEvent.change(fileInput, {
        target: { files: [new File(["File A"], "a.txt")] },
      });
      const readerA = readers[0];
      const staleOnloadA = readerA.onload;
      expect(typeof staleOnloadA).toBe("function");

      // Parent updates value substantially
      rerender(<DocUploadCard value="V2" onChange={handleChange} />);
      expect(readerA.aborted).toBe(true);

      // Invoke stale callback directly
      readerA.result = new TextEncoder().encode("File A").buffer;
      act(() => {
        staleOnloadA(new Event("load"));
      });

      expect(handleChange).not.toHaveBeenCalled();
    });

    it("healthy rerender without value change does NOT cancel active read", async () => {
      const handleChange = vi.fn();
      const { container, rerender } = render(
        <DocUploadCard value="Same" onChange={handleChange} />,
      );
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Start read
      fireEvent.change(fileInput, {
        target: { files: [new File(["Healthy"], "healthy.txt")] },
      });
      const reader = readers[0];

      // Healthy rerender with identical value
      rerender(<DocUploadCard value="Same" onChange={handleChange} />);
      expect(reader.aborted).toBe(false);

      // Reader finishes cleanly
      reader.result = new TextEncoder().encode("Healthy").buffer;
      act(() => {
        reader.onload?.(new Event("load"));
      });

      expect(handleChange).toHaveBeenCalledWith("Healthy");
    });

    it("unmounting cancels active read and invoking stale callback directly is inert", () => {
      const handleChange = vi.fn();
      const { container, unmount } = render(<DocUploadCard value="" onChange={handleChange} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(fileInput, {
        target: { files: [new File(["Unmounted"], "unmount.txt")] },
      });
      const reader = readers[0];
      const staleOnload = reader.onload;
      expect(typeof staleOnload).toBe("function");

      unmount();
      expect(reader.aborted).toBe(true);

      reader.result = new TextEncoder().encode("Unmounted").buffer;
      expect(() => {
        act(() => {
          staleOnload(new Event("load"));
        });
      }).not.toThrow();
      expect(handleChange).not.toHaveBeenCalled();
    });

    it("DOC24-01: parent layout effect calling stale reader.onload during committed value update cannot overwrite", () => {
      let capturedOnload: any = null;
      let setParentVal: (val: string) => void;
      const onCardChange = vi.fn();

      function Parent() {
        const [val, setVal] = useState("committed initial");
        setParentVal = setVal;

        useLayoutEffect(() => {
          if (val === "committed edit" && capturedOnload) {
            // Parent's layout effect fires immediately upon committing new value
            capturedOnload(new Event("load"));
          }
        }, [val]);

        return <DocUploadCard value={val} onChange={onCardChange} />;
      }

      const { container } = render(<Parent />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Start read A
      fireEvent.change(fileInput, {
        target: { files: [new File(["stale-file"], "stale.txt")] },
      });
      const readerA = readers[0];
      readerA.result = new TextEncoder().encode("stale-file").buffer;
      capturedOnload = readerA.onload;
      expect(typeof capturedOnload).toBe("function");

      // Parent rerenders with committed edit
      act(() => {
        setParentVal("committed edit");
      });

      // Assert stale-file was NOT propagated
      expect(onCardChange).not.toHaveBeenCalledWith("stale-file");
    });

    it("DOC24-01: parent layout effect calling stale reader.onload during unmount cannot overwrite", () => {
      let capturedOnload: any = null;
      let setMounted: (m: boolean) => void;
      const onCardChange = vi.fn();

      function Parent() {
        const [mounted, setMount] = useState(true);
        setMounted = setMount;

        useLayoutEffect(() => {
          if (!mounted && capturedOnload) {
            // Parent's layout effect fires when child has been unmounted
            capturedOnload(new Event("load"));
          }
        }, [mounted]);

        return mounted ? <DocUploadCard value="initial" onChange={onCardChange} /> : null;
      }

      const { container } = render(<Parent />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Start read A
      fireEvent.change(fileInput, {
        target: { files: [new File(["late-unmounted"], "late.txt")] },
      });
      const readerA = readers[0];
      readerA.result = new TextEncoder().encode("late-unmounted").buffer;
      capturedOnload = readerA.onload;
      expect(typeof capturedOnload).toBe("function");

      // Unmount child
      act(() => {
        setMounted(false);
      });

      // Assert late-unmounted was NOT propagated
      expect(onCardChange).not.toHaveBeenCalledWith("late-unmounted");
    });
  });
});
