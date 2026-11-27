import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConnectionState } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveConversation } from "./ActiveConversation";
import { useAppStore } from "@/store/appStore";
import { zhCN } from "@/i18n/zh-CN";

// 会话展示元信息（本卡约定，与后续产品代码保持一致）
interface SessionPresentation {
  readonly sessionId: string;
  readonly sessionGen: number;
  readonly startedAt: string | null;
  readonly mode: string | null;
  readonly scenarioName: string | null;
}

type AppStoreWithSessionPresentation = ReturnType<typeof useAppStore.getState> & {
  sessionPresentation: SessionPresentation | null;
};

const h = vi.hoisted(() => ({
  voiceState: { state: "listening", audioTrack: null as unknown },
  connectionState: "connected",
}));

vi.mock("@livekit/components-react", () => ({
  useConnectionState: () => h.connectionState,
  useVoiceAssistant: () => h.voiceState,
  useRoomContext: () => ({}),
  useDataChannel: () => undefined,
  BarVisualizer: () => <div data-testid="bar-visualizer" />,
  VoiceAssistantControlBar: () => <div data-testid="control-bar" />,
}));

vi.mock("./AnswerRecommendations", () => ({
  AnswerRecommendations: () => <div data-testid="answer-recommendations" />,
}));
vi.mock("./ChatSubtitles", () => ({
  ChatSubtitles: () => <div data-testid="chat-subtitles" />,
}));
vi.mock("./roomAudio", () => ({
  stopRoomLocalTracks: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(() => ({
    state: "authenticated",
    principal: { issuer: "https://auth.example.com", subject: "stub-user" },
  })),
  getAuthRevision: vi.fn(() => 1),
  arePrincipalsEqual: vi.fn(
    (a: { issuer?: string; subject?: string }, b: { issuer?: string; subject?: string }) =>
      a === b || (a && b && a.issuer === b.issuer && a.subject === b.subject),
  ),
}));

const baseProps = {
  sessionId: "sess-a",
  sessionGen: 1,
  boundPrincipal: { issuer: "https://auth.example.com", subject: "stub-user" },
  authorizedRevision: 1,
};

function setPresentation(p: SessionPresentation | null): void {
  useAppStore.setState(
    (state) =>
      ({
        ...state,
        sessionPresentation: p,
      }) as AppStoreWithSessionPresentation,
  );
}

function renderActive(props = baseProps) {
  return render(<ActiveConversation {...props} />);
}

describe("R2-11 ActiveConversation header & layout", () => {
  beforeEach(() => {
    useAppStore.getState().goHome();
    setPresentation(null);
    h.voiceState = { state: "listening", audioTrack: null };
    h.connectionState = ConnectionState.Connected;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("thinking 使用独立文案，不再复用 connecting", () => {
    h.voiceState = { state: "thinking", audioTrack: null };
    renderActive();
    expect(screen.getByText("正在思考...")).toBeInTheDocument();
    expect(screen.queryByText(zhCN.conversation.connecting)).not.toBeInTheDocument();
  });

  it("初次 Disconnected 仍展示连接中，不误标为失联", () => {
    h.connectionState = ConnectionState.Disconnected;

    renderActive();

    const connectionView = screen.getByTestId("connecting-view");
    expect(connectionView).toHaveAttribute("data-connection-state", ConnectionState.Connecting);
    expect(connectionView).toHaveTextContent(zhCN.conversation.connecting);
    expect(connectionView).not.toHaveTextContent(zhCN.conversation.connectionFailedTitle);
  });

  it("成功连接后失联才展示断连标题", () => {
    h.connectionState = ConnectionState.Disconnected;
    const { rerender } = renderActive();
    expect(screen.getByTestId("connecting-view")).toHaveAttribute(
      "data-connection-state",
      ConnectionState.Connecting,
    );

    h.connectionState = ConnectionState.Connected;
    rerender(<ActiveConversation {...baseProps} />);
    expect(screen.getByTestId("session-scenario")).toBeInTheDocument();

    h.connectionState = ConnectionState.Disconnected;
    rerender(<ActiveConversation {...baseProps} />);
    const connectionView = screen.getByTestId("connecting-view");
    expect(connectionView).toHaveAttribute("data-connection-state", ConnectionState.Disconnected);
    expect(connectionView).toHaveTextContent(zhCN.conversation.connectionFailedTitle);
  });

  it("startedAt 为 null 时显示不可用文案", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: null,
      mode: null,
      scenarioName: null,
    });
    renderActive();
    expect(screen.getByTestId("session-timer")).toHaveTextContent(
      zhCN.conversation.elapsedUnavailable,
    );
  });

  it("startedAt 非法时显示不可用文案", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "not-a-date",
      mode: null,
      scenarioName: null,
    });
    renderActive();
    expect(screen.getByTestId("session-timer")).toHaveTextContent(
      zhCN.conversation.elapsedUnavailable,
    );
  });

  it("startedAt 为未来时显示不可用文案", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T10:00:00.000Z"));
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:01.000Z",
      mode: null,
      scenarioName: null,
    });
    renderActive();
    expect(screen.getByTestId("session-timer")).toHaveTextContent(
      zhCN.conversation.elapsedUnavailable,
    );
  });

  it("startedAt 合法时按墙钟显示 mm:ss 并每秒 tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T10:01:05.000Z"));
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: null,
    });
    renderActive();

    expect(screen.getByTestId("session-timer")).toHaveTextContent("01:05");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("session-timer")).toHaveTextContent("01:06");
  });

  it("startedAt 超过 1 小时按 hh:mm:ss 显示", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: null,
    });
    renderActive();
    expect(screen.getByTestId("session-timer")).toHaveTextContent("02:00:00");
  });

  it("卸载时清理计时器", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T10:01:05.000Z"));
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: null,
    });
    const { unmount } = renderActive();
    expect(screen.getByTestId("session-timer")).toHaveTextContent("01:05");

    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("场景名优先使用本次客户端所选名", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: "Travel Planning",
    });
    renderActive();
    expect(screen.getByTestId("session-scenario")).toHaveTextContent("Travel Planning");
  });

  it("恢复无场景详情回退服务器模式标签", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "free_talk",
      scenarioName: null,
    });
    renderActive();
    expect(screen.getByTestId("session-scenario")).toHaveTextContent(
      zhCN.activeSessions.modes.free_talk,
    );
  });

  it("无模式且无场景名回退 unknownMode", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: null,
      mode: null,
      scenarioName: null,
    });
    renderActive();
    expect(screen.getByTestId("session-scenario")).toHaveTextContent(
      zhCN.activeSessions.unknownMode,
    );
  });

  it("展示对象归属与当前会话不匹配时按无元信息处理", () => {
    setPresentation({
      sessionId: "other-session",
      sessionGen: 999,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: "Travel Planning",
    });
    renderActive(baseProps);
    expect(screen.getByTestId("session-timer")).toHaveTextContent(
      zhCN.conversation.elapsedUnavailable,
    );
    expect(screen.getByTestId("session-scenario")).toHaveTextContent(
      zhCN.activeSessions.unknownMode,
    );
  });

  it("回答推荐保持单实例且 aria-expanded 控制一个内容区", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: null,
    });
    renderActive();

    expect(screen.getAllByTestId("answer-recommendations")).toHaveLength(1);

    const toggle = screen.getByTestId("answer-recs-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("DOM 顺序为状态卡、字幕、回答推荐，并且无音轨时不渲染可视化器", () => {
    setPresentation({
      sessionId: "sess-a",
      sessionGen: 1,
      startedAt: "2026-11-15T10:00:00.000Z",
      mode: "scenario",
      scenarioName: null,
    });
    renderActive();

    const status = screen.getByText(zhCN.conversation.listening);
    const subtitles = screen.getByTestId("chat-subtitles");
    const recommendations = screen.getByTestId("answer-recommendations");

    expect(screen.queryByTestId("bar-visualizer")).not.toBeInTheDocument();
    expect(status.compareDocumentPosition(subtitles) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(
      subtitles.compareDocumentPosition(recommendations) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
});
