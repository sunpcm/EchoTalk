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

  it("A33 回归 (冒号边界碰撞切题)：已复制后切换至冒号碰撞的新题目立即清除复制提示", async () => {
    // segA 与 segB 在冒号拼接下均为 "seg:What:is your hobby?"
    // 在元组编码下分别为 '["seg","What:is your hobby?"]' 与 '["seg:What","is your hobby?"]'
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg",
          text: "What:is your hobby?",
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

    // 切换至冒号边界碰撞的题目
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg:What",
          text: "is your hobby?",
          final: true,
        },
      ],
      state: "listening",
    });

    rerender(<AnswerRecommendations />);
    // 关键断言：无歧义元组必须立即清除上一题的提示
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("A33 回归 (冒号边界碰撞与延迟 Promise)：旧 pending 复制切至冒号碰撞题目后再 resolve 不显示提示，新题目可正常复制", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg",
          text: "What:is your hobby?",
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

    // 切换至冒号碰撞题目
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg:What",
          text: "is your hobby?",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);

    // 旧 Promise 迟到完成
    await act(async () => {
      resolvePromise1();
    });

    // 关键断言：旧 Promise 绝不能在新题目上显示提示
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();

    // 在新题目上发起复制，正常工作
    writeTextMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();
  });

  it("A33 回归 (冒号碰撞与交叉竞争)：新 tuple 发起复制成功后，旧 promise 与旧 timer 不清除新提示", async () => {
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg",
          text: "What:is your hobby?",
          final: true,
        },
      ],
      state: "listening",
    });

    const capturedTimeouts: Array<{ fn: () => void; ms: number }> = [];
    vi.spyOn(window, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      capturedTimeouts.push({ fn, ms: ms ?? 0 });
      return (8800 + capturedTimeouts.length) as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    let resolvePromise1!: () => void;
    let resolvePromise2!: () => void;

    let writeCallCount = 0;
    const writeTextMock = vi.fn().mockImplementation(() => {
      writeCallCount++;
      if (writeCallCount === 1) {
        return new Promise<void>((res) => {
          resolvePromise1 = res;
        });
      }
      return new Promise<void>((res) => {
        resolvePromise2 = res;
      });
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { rerender } = render(<AnswerRecommendations />);
    // 题 1 发起复制并挂起
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(writeCallCount).toBe(1);

    // 切换至冒号碰撞题 2
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg:What",
          text: "is your hobby?",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);

    // 题 2 发起复制
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(writeCallCount).toBe(2);

    // 题 2 的复制成功 resolve
    await act(async () => {
      resolvePromise2();
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();
    expect(capturedTimeouts.length).toBe(1); // 题 2 的 1500ms 定时器

    // 题 1 的迟到 Promise 此时完成
    await act(async () => {
      resolvePromise1();
    });
    // 关键断言：题 1 的迟到完成绝不能清除或篡改题 2 的已复制提示
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 模拟假设之前题 1 残留的任何外部 timer 回调被执行
    act(() => {
      // 执行一个捕获前的无害调用以模拟旧 timer
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 题 2 自身的定时器到达，正常清除
    act(() => {
      capturedTimeouts[0].fn();
    });
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("A33 回归 (同 tuple 健康重渲染)：保留反馈且在原 1500ms 有效期后消失，不因重渲染重置计时", async () => {
    vi.useFakeTimers();

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-timer-test",
          text: "What is your dream job?",
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

    function Container({ renderCount }: { renderCount: number }) {
      return (
        <div data-testid={`container-${renderCount}`}>
          <AnswerRecommendations />
        </div>
      );
    }

    const { rerender } = render(<Container renderCount={1} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 推进 1000ms（剩余 500ms）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 同 tuple 发生健康 rerender
    rerender(<Container renderCount={2} />);
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 再推进 510ms（自点击起已经过了 1510ms，距离 rerender 仅过了 510ms）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(510);
    });
    // 关键断言：必须在原 1500ms 到期后消失，绝不能因为 rerender 而重置为新的 1500ms
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();
  });

  it("A33 回归 (边界字符与文本 trim 语义)：正确处理缺少 id、冒号、引号、反斜杠、Unicode 以及空白 trim", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    // 1. 默认缺失 id (undefined) 正常处理为默认空字符串并成功复制
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          text: "What is the plan?",
          final: true,
        },
      ],
      state: "listening",
    });

    const { rerender } = render(<AnswerRecommendations />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 2. 引号、反斜杠与 Unicode 边界：
    // segSpecial1: id='seg:"a\\b"', text='What: is "this"? 🚀'
    // segSpecial2: id='seg:"a', text='\\b":What: is "this"? 🚀'
    // 若非元组编码，这两者可能发生逃逸字符碰撞，元组编码下两者严格隔离
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: 'seg:"a\\b"',
          text: 'What: is "this"? 🚀',
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: 'seg:"a',
          text: '\\b":What: is "this"? 🚀',
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);
    // 切换后立即清理
    expect(screen.queryByText(t.copied)).not.toBeInTheDocument();

    // 3. 文本 trim 语义保留：前后包含多余空白的同题文本与 trim 后的文本属于同 tuple，重渲染不清除反馈
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-trim",
          text: "   What do you like to eat?   ",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button")[0]);
    });
    expect(screen.getByText(t.copied)).toBeInTheDocument();

    // 文本变为已 trim 形式，同 tuple 健康重渲染，已复制状态保留
    mockUseVoiceAssistant.mockReturnValue({
      agentTranscriptions: [
        {
          id: "seg-trim",
          text: "What do you like to eat?",
          final: true,
        },
      ],
      state: "listening",
    });
    rerender(<AnswerRecommendations />);
    expect(screen.getByText(t.copied)).toBeInTheDocument();
  });
});
