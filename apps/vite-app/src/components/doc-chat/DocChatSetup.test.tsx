import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocChatSetup } from "./DocChatSetup";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

vi.mock("@/store/conversation", () => ({
  useConversationStore: vi.fn(),
}));

describe("DocChatSetup", () => {
  const mockStartSession = vi.fn();
  const mockGoHome = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useConversationStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: any) => any) =>
        selector({
          startSession: mockStartSession,
          connectionState: "idle",
          goHome: mockGoHome,
        }),
    );
  });

  it("renders with start button disabled and correct empty tooltip explanation", () => {
    render(<DocChatSetup />);

    const startBtn = screen.getByRole("button", { name: t.startButton });
    expect(startBtn).toBeDisabled();
    expect(startBtn).toHaveAttribute("title", t.emptyDocError);
  });

  it("enables start button when document content is provided", () => {
    render(<DocChatSetup />);

    const textarea = screen.getByPlaceholderText("或在此直接粘贴文档内容...");
    fireEvent.change(textarea, { target: { value: "Sample doc content" } });

    const startBtn = screen.getByRole("button", { name: t.startButton });
    expect(startBtn).not.toBeDisabled();
    expect(startBtn).not.toHaveAttribute("title");
  });

  it("disables start button and shows over-limit tooltip when content exceeds max characters", () => {
    render(<DocChatSetup />);

    const textarea = screen.getByPlaceholderText("或在此直接粘贴文档内容...");
    fireEvent.change(textarea, { target: { value: "a".repeat(50_001) } });

    const startBtn = screen.getByRole("button", { name: t.startButton });
    expect(startBtn).toBeDisabled();
    expect(startBtn).toHaveAttribute("title", t.charOverLimit);
  });

  it("calls goHome when back button is clicked", () => {
    render(<DocChatSetup />);

    const backBtn = screen.getByRole("button", { name: t.goBack });
    fireEvent.click(backBtn);

    expect(mockGoHome).toHaveBeenCalledTimes(1);
  });
});
