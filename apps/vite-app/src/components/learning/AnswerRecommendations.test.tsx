import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnswerRecommendations } from "./AnswerRecommendations";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.answerRecommendations;

// Mock @livekit/components-react hook
const mockUseVoiceAssistant = vi.fn();
vi.mock("@livekit/components-react", () => ({
  useVoiceAssistant: () => mockUseVoiceAssistant(),
}));

describe("AnswerRecommendations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders waiting text when no question is detected", () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [],
      state: "listening",
    });

    render(<AnswerRecommendations />);
    expect(screen.getByText(new RegExp(t.waiting, "i"))).toBeInTheDocument();
  });

  it("renders recommendation buttons when a question is detected", () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "1",
          text: "What is your name?",
          final: true,
          firstReceivedTime: Date.now(),
        },
      ],
      state: "listening",
    });

    render(<AnswerRecommendations />);
    expect(screen.getByRole("region", { name: new RegExp(t.title, "i") })).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0]).toHaveAttribute("aria-label");
  });

  it("copies text on button click and shows '已复制' indicator", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "1",
          text: "What is your name?",
          final: true,
          firstReceivedTime: Date.now(),
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    expect(writeTextMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(t.copied)).toBeInTheDocument();
    });
  });

  it("copies the exact full raw recommendation string without prefix, index, or hint", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-100",
          text: "What is your name?",
          final: true,
          firstReceivedTime: Date.now(),
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(3);

    fireEvent.click(buttons[0]);
    expect(writeTextMock).toHaveBeenCalledWith("My name is ... and I'm learning English.");

    fireEvent.click(buttons[1]);
    expect(writeTextMock).toHaveBeenCalledWith("I'm ... Nice to meet you!");
  });

  it("handles clipboard rejection gracefully without crashing or showing copied status", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });

    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("supports delayed promise resolution and rejection", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    let resolvePromise!: () => void;
    let rejectPromise!: (err: unknown) => void;

    const delayedWriteText = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res, rej) => {
          resolvePromise = res;
          rejectPromise = rej;
        }),
    );

    Object.assign(navigator, {
      clipboard: {
        writeText: delayedWriteText,
      },
    });

    render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");

    fireEvent.click(buttons[0]);
    expect(delayedWriteText).toHaveBeenCalled();
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();

    await act(async () => {
      resolvePromise();
    });

    expect(screen.getByText(t.copied)).toBeInTheDocument();

    delayedWriteText.mockImplementation(
      () =>
        new Promise<void>((res, rej) => {
          rejectPromise = rej;
        }),
    );

    fireEvent.click(buttons[1]);
    await act(async () => {
      rejectPromise(new Error("Async fail"));
    });

    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("invalidates feedback when switching to a different question", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { rerender } = render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText(t.copied)).toBeInTheDocument();
    });

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-2",
          text: "Why are you learning English?",
          final: true,
        },
      ],
      state: "listening",
    });

    rerender(<AnswerRecommendations />);
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("invalidates feedback when question has same text but different segment id", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-first-instance",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { rerender } = render(<AnswerRecommendations />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    await waitFor(() => {
      expect(screen.getByText(t.copied)).toBeInTheDocument();
    });

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-second-instance",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    rerender(<AnswerRecommendations />);
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("R1 回归 (P1 身份覆盖文本)：同 segment id 更新为不同文本时，旧 Promise 完成不污染新推荐", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-reuse",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    let resolvePromise1!: () => void;
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolvePromise1 = res;
        }),
    );
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { rerender } = render(<AnswerRecommendations />);
    // 点击姓名题的第一个推荐并挂起
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(writeTextMock).toHaveBeenCalledTimes(1);

    // 同一 segment id 被更新为 Why 问题
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-reuse",
          text: "Why do you learn English?",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);

    // 旧姓名题的 Promise 延迟完成
    await act(async () => {
      resolvePromise1();
    });

    // 关键断言：旧 Promise 绝不能污染新的 Why 推荐面板！
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
    expect(screen.getByText("I think it's because ...")).toBeInTheDocument();

    // 在新题目上点击显式复制，正常工作
    writeTextMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();
  });

  it("clears feedback and prevents stale callbacks when entering thinking/speaking waiting states", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    let resolvePromise!: () => void;
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolvePromise = res;
        }),
    );
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { rerender } = render(<AnswerRecommendations />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "thinking",
    });
    rerender(<AnswerRecommendations />);

    expect(screen.getByText(t.waiting)).toBeInTheDocument();

    await act(async () => {
      resolvePromise();
    });

    expect(screen.getByText(t.waiting)).toBeInTheDocument();

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);

    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("handles overlapping clicks and ensures captured old timer callback does not clear new feedback", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const capturedTimeouts: Array<{ fn: () => void; ms: number }> = [];
    vi.spyOn(window, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      capturedTimeouts.push({ fn, ms: ms ?? 0 });
      return 9999 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<AnswerRecommendations />);
    const buttons = screen.getAllByRole("button");

    await act(async () => {
      fireEvent.click(buttons[0]);
    });
    expect(capturedTimeouts.length).toBe(1);
    const oldTimer = capturedTimeouts[0];
    expect(typeof oldTimer.fn).toBe("function");

    expect(screen.getByText(t.copied)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(buttons[1]);
    });
    expect(capturedTimeouts.length).toBe(2);

    // 真正执行捕获的旧定时器回调
    act(() => {
      oldTimer.fn();
    });

    // 旧定时器不得清除新按钮的已复制状态
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    act(() => {
      capturedTimeouts[1].fn();
    });

    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("preserves active feedback across healthy parent re-renders", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    function Wrapper({ extraProp }: { extraProp: number }) {
      return (
        <div data-testid={`wrapper-${extraProp}`}>
          <AnswerRecommendations />
        </div>
      );
    }

    const { rerender } = render(<Wrapper extraProp={1} />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    await waitFor(() => {
      expect(screen.getByText(t.copied)).toBeInTheDocument();
    });

    rerender(<Wrapper extraProp={2} />);
    expect(screen.getByText(t.copied)).toBeInTheDocument();
  });

  it("R1 回归 (P1 未提交渲染不破坏已提交资源)：未提交 render 不取消已提交页面的 1500ms 定时器", async () => {
    vi.useFakeTimers();

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const neverResolvingPromise = new Promise(() => {});
    function NeverResolvingSuspenseSibling({ shouldSuspend }: { shouldSuspend: boolean }) {
      if (shouldSuspend) {
        throw neverResolvingPromise;
      }
      return null;
    }

    function TestContainer({ shouldSuspend }: { shouldSuspend: boolean }) {
      return (
        <React.Suspense fallback={<div>Loading...</div>}>
          <AnswerRecommendations />
          <NeverResolvingSuspenseSibling shouldSuspend={shouldSuspend} />
        </React.Suspense>
      );
    }

    const { rerender } = render(<TestContainer shouldSuspend={false} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 以 startTransition 呈现新题，后续兄弟组件 Suspense 永不完成，旧已提交页面仍显示
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-2",
          text: "Where are you going?",
          final: true,
        },
      ],
      state: "listening",
    });

    React.startTransition(() => {
      rerender(<TestContainer shouldSuspend={true} />);
    });

    // 旧已提交页面依然可见
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 推进 1400ms，提示仍在已提交页面可见
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 推进到达 1600ms，已提交页面的定时器必须正常触发清除，不能被未提交 render 破坏
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("R1 回归 (P2 StrictMode 真实挂载)：在 StrictMode 效果重放后立即点击第一按钮可正常复制", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-strict-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    // 挂载在真实 React.StrictMode 下，React 会自动执行 mount -> cleanup -> remount
    const { rerender } = render(
      <React.StrictMode>
        <AnswerRecommendations />
      </React.StrictMode>,
    );

    const buttons = screen.getAllByRole("button");
    // 立即点击第一按钮
    await act(async () => {
      fireEvent.click(buttons[0]);
    });

    // 关键断言：StrictMode 重放后绝不能为 0 次调用！必须调用一次并正常显示反馈
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith("My name is ... and I'm learning English.");
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 后续切题仍完全正常
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-strict-2",
          text: "How are you doing today?",
          final: true,
        },
      ],
      state: "listening",
    });

    rerender(
      <React.StrictMode>
        <AnswerRecommendations />
      </React.StrictMode>,
    );
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("prevents commit-to-passive cleanup race where old delayed promise resolves during question transition", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    let resolvePromise1!: () => void;
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolvePromise1 = res;
        }),
    );
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { rerender } = render(<AnswerRecommendations />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(writeTextMock).toHaveBeenCalledTimes(1);

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-2",
          text: "Why are you here?",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);

    await act(async () => {
      resolvePromise1();
    });

    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();

    writeTextMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });

    expect(screen.getByText(t.copied)).toBeInTheDocument();
  });

  it("safely unmounts and discards pending promise and captured timer callbacks without warnings", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    let resolvePromise!: () => void;
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolvePromise = res;
        }),
    );
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const capturedTimeouts: Array<() => void> = [];
    vi.spyOn(window, "setTimeout").mockImplementation(((fn: () => void) => {
      capturedTimeouts.push(fn);
      return 1111 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    const { unmount } = render(<AnswerRecommendations />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    unmount();

    await act(async () => {
      resolvePromise();
    });

    for (const cb of capturedTimeouts) {
      expect(typeof cb).toBe("function");
      act(() => {
        cb();
      });
    }
  });

  it("automatically clears copied status after 1500ms timer expiration", async () => {
    vi.useFakeTimers();

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-1",
          text: "What is your name?",
          final: true,
        },
      ],
      state: "listening",
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<AnswerRecommendations />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });

    expect(screen.getByText(t.copied)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1480);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });
});
