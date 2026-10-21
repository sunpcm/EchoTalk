import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceInterface } from "./VoiceInterface";
import { useConversationStore } from "@/store/conversation";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import * as api from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

const mockTrackStop = vi.fn();
const mockDisconnectNeverResolves = vi.fn(() => new Promise<void>(() => {}));

// 创建一个与 Room 结构一致的真实 Mock 对象
function createMockRoom(id = "default") {
  return {
    disconnect: mockDisconnectNeverResolves,
    localParticipant: {
      trackPublications: new Map([
        [
          `track-pub-${id}`,
          {
            track: {
              stop: mockTrackStop,
            },
          },
        ],
      ]),
    },
  };
}

let currentMockRoom = createMockRoom();

interface MockRoomContextValue {
  instanceId: string;
  room: {
    disconnect: () => Promise<void>;
    localParticipant: {
      trackPublications: Map<unknown, { track?: { stop?: () => void } }>;
    };
  };
  trackStopMock: ReturnType<typeof vi.fn>;
  connectionState: string;
}

const MockRoomContext = React.createContext<MockRoomContextValue | null>(null);

let roomInstanceCounter = 0;
const capturedRoomCallbacks = new Map<
  string,
  {
    instanceId: string;
    onConnected?: () => void;
    onError?: (err: Error) => void;
    onDisconnected?: (reason?: unknown) => void;
    trackStopMock: ReturnType<typeof vi.fn>;
  }
>();

// Mock LiveKit react components
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({
    children,
    onConnected,
    onError,
    onDisconnected,
  }: {
    children: React.ReactNode;
    onConnected?: () => void;
    onError?: (err: Error) => void;
    onDisconnected?: (reason?: unknown) => void;
  }) => {
    // 关键 P1：用 useState 生成独立实例标识与独立 Room
    const initialConnState =
      useConversationStore.getState().connectionState === "active" ? "connected" : "connecting";
    const [connState, setConnState] = React.useState(initialConnState);

    const [{ instanceId, room, trackStopMock }] = React.useState(() => {
      roomInstanceCounter += 1;
      const id = `room-instance-${roomInstanceCounter}`;
      const stopFn = vi.fn(() => {
        mockTrackStop();
      });
      const instRoom = {
        disconnect: mockDisconnectNeverResolves,
        localParticipant: {
          trackPublications: new Map([
            [
              `track-pub-${id}`,
              {
                track: {
                  stop: stopFn,
                },
              },
            ],
          ]),
        },
      };
      return { instanceId: id, room: instRoom, trackStopMock: stopFn };
    });

    const handleConnected = React.useCallback(() => {
      setConnState("connected");
      onConnected?.();
    }, [onConnected]);

    React.useEffect(() => {
      capturedRoomCallbacks.set(instanceId, {
        instanceId,
        onConnected: handleConnected,
        onError,
        onDisconnected,
        trackStopMock,
      });
    }, [instanceId, handleConnected, onError, onDisconnected, trackStopMock]);

    return (
      <MockRoomContext.Provider
        value={{ instanceId, room, trackStopMock, connectionState: connState }}
      >
        <div data-testid="livekit-room" data-instance-id={instanceId}>
          <button data-testid="trigger-connected" onClick={handleConnected}>
            trigger-connected
          </button>
          <button
            data-testid="trigger-error"
            onClick={() => onError?.(new Error("Simulated network drop"))}
          >
            trigger-error
          </button>
          <button data-testid="trigger-disconnected" onClick={() => onDisconnected?.(3)}>
            trigger-disconnected
          </button>
          {children}
        </div>
      </MockRoomContext.Provider>
    );
  },
  useRoomContext: () => {
    const ctx = React.useContext(MockRoomContext);
    return ctx ? ctx.room : currentMockRoom;
  },
  RoomAudioRenderer: () => <div data-testid="room-audio-renderer" />,
  useConnectionState: () => {
    const ctx = React.useContext(MockRoomContext);
    return ctx ? ctx.connectionState : "connected";
  },
  useVoiceAssistant: () => ({
    state: "idle",
    audioTrack: { track: {} },
  }),
  useDataChannel: vi.fn(),
  BarVisualizer: () => <div data-testid="bar-visualizer" />,
  VoiceAssistantControlBar: () => <div data-testid="control-bar" />,
}));

// Mock sub-components
vi.mock("@/components/pronunciation/PronunciationFeedback", () => ({
  PronunciationFeedback: () => <div data-testid="pronunciation-feedback" />,
}));
vi.mock("@/components/learning/SkillTree", () => ({
  SkillTree: () => <div data-testid="skill-tree" />,
}));
vi.mock("@/components/learning/AnswerRecommendations", () => ({
  AnswerRecommendations: () => <div data-testid="answer-recommendations" />,
}));
vi.mock("@/components/conversation/ChatSubtitles", () => ({
  ChatSubtitles: () => <div data-testid="chat-subtitles" />,
}));

// Mock assessment hook
vi.mock("@/hooks/usePollingAssessment", () => ({
  usePollingAssessment: vi.fn((sessionId: string | null) => {
    return sessionId ? "pending" : "idle";
  }),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  dispatchAgent: vi.fn().mockResolvedValue({ status: "dispatched" }),
  endSession: vi.fn(),
  checkHealthReady: vi.fn(),
  createSession: vi.fn(),
  getSessionToken: vi.fn(),
}));

// Mock platform
vi.mock("@/platform", () => ({
  getLiveKitWsUrl: vi.fn(({ tokenWsUrl }) => tokenWsUrl || "wss://test.livekit.io"),
}));

describe("VoiceInterface - CP-02 client end release & generation protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomInstanceCounter = 0;
    capturedRoomCallbacks.clear();
    currentMockRoom = createMockRoom();
    useConversationStore.getState().goHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("actively stops owned local tracks synchronously when user ends session even if disconnect never completes", async () => {
    let resolveEndApi!: (val: api.Session) => void;
    const endPromise = new Promise<api.Session>((res) => {
      resolveEndApi = res;
    });

    vi.mocked(api.endSession).mockImplementation(() => endPromise);

    useConversationStore.setState({
      connectionState: "active",
      appView: "session",
      sessionId: "sess-deferred",
      token: "tok-deferred",
      wsUrl: "wss://lk.test",
      error: null,
    });

    render(<VoiceInterface />);

    // 初始渲染有 LiveKitRoom，此时 track.stop 未被调用
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
    expect(mockTrackStop).not.toHaveBeenCalled();

    // 点击结束对话按钮
    const endBtn = screen.getByRole("button", { name: zhCN.conversation.endButton });
    fireEvent.click(endBtn);

    // 关键验证 P1-1：
    // 在 API 未 resolve、disconnect 永不完成的情况下，产品代码已同步主动调用了本地音轨的 stop()！
    expect(mockTrackStop).toHaveBeenCalled();

    // 页面即刻进入 ending 视图，无 Room、无 Token
    await waitFor(() => {
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("ending-view")).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.ending)).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.endingHint)).toBeInTheDocument();

    expect(useConversationStore.getState().token).toBeNull();
    expect(useConversationStore.getState().wsUrl).toBeNull();
    expect(useConversationStore.getState().connectionState).toBe("ending");

    // 分析轮询绝不在此阶段执行
    expect(usePollingAssessment).not.toHaveBeenCalledWith("sess-deferred");

    // 解析 API 结束
    resolveEndApi({
      id: "sess-deferred",
      user_id: "u1",
      mode: "free_talk",
      status: "completed",
      started_at: "2025-01-01T00:00:00Z",
      ended_at: "2025-01-01T00:10:00Z",
      transcripts: [],
    });
    await waitFor(() => {
      expect(screen.getByText(zhCN.conversation.ended)).toBeInTheDocument();
    });
    expect(useConversationStore.getState().connectionState).toBe("ended");
  });

  it("actively stops owned local tracks on unmount when user navigates home", () => {
    useConversationStore.setState({
      connectionState: "active",
      appView: "session",
      sessionId: "sess-leave",
      token: "tok-leave",
      wsUrl: "wss://lk.test",
    });

    const { unmount } = render(<VoiceInterface />);
    expect(mockTrackStop).not.toHaveBeenCalled();

    // 组件卸载（如切换视图或退出）
    unmount();

    // 关键验证 P1-1：Room cleanup 路径同步停止本地 tracks
    expect(mockTrackStop).toHaveBeenCalled();
  });

  it("isolates room instances across generations, stops old owned tracks on unmount, and rejects stale callbacks", () => {
    // 1. 先进入会话 1 的 active 状态
    useConversationStore.setState({
      sessionGen: 1,
      sessionId: "sess-1",
      token: "tok-1",
      wsUrl: "wss://lk.test",
      connectionState: "active",
      appView: "session",
    });

    render(<VoiceInterface />);

    // 确认初始挂载了 LiveKitRoom 且生成了实例标识
    const oldRoomEl = screen.getByTestId("livekit-room");
    const oldInstanceId = oldRoomEl.getAttribute("data-instance-id")!;
    expect(oldInstanceId).toBeTruthy();

    const oldCallbacks = capturedRoomCallbacks.get(oldInstanceId);
    expect(oldCallbacks).toBeDefined();
    expect(oldCallbacks!.trackStopMock).not.toHaveBeenCalled();

    // 2. 同一次 act 内由旧 active 状态切换到新 sessionGen、新 sessionId 和新 Token 的 connecting 状态
    act(() => {
      useConversationStore.setState({
        sessionGen: 2,
        sessionId: "sess-2",
        token: "tok-2",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });
    });

    // 3. 确认旧实例卸载、owned track 停止且新实例不同
    expect(oldCallbacks!.trackStopMock).toHaveBeenCalled();

    const newRoomEl = screen.getByTestId("livekit-room");
    const newInstanceId = newRoomEl.getAttribute("data-instance-id")!;
    expect(newInstanceId).toBeTruthy();
    expect(newInstanceId).not.toBe(oldInstanceId);

    const newCallbacks = capturedRoomCallbacks.get(newInstanceId);
    expect(newCallbacks).toBeDefined();
    expect(newCallbacks!.trackStopMock).not.toHaveBeenCalled();

    // 4. 再调用捕获的旧回调，不能激活/dispatch新会话
    act(() => {
      oldCallbacks!.onConnected?.();
    });

    // 验证旧回调不触发 dispatchAgent，也不能把状态激活为 active
    expect(api.dispatchAgent).not.toHaveBeenCalled();
    const currentState = useConversationStore.getState();
    expect(currentState.connectionState).toBe("connecting");
    expect(currentState.sessionId).toBe("sess-2");
    expect(currentState.sessionGen).toBe(2);

    // 调用新实例的回调，应正常工作
    act(() => {
      newCallbacks!.onConnected?.();
    });
    expect(api.dispatchAgent).toHaveBeenCalledWith("sess-2");
    expect(useConversationStore.getState().connectionState).toBe("active");
  });

  it("renders end_failed view on rejection with stopped audio and allows retry for the same session", async () => {
    useConversationStore.setState({
      connectionState: "end_failed",
      appView: "session",
      sessionId: "sess-failed-1",
      token: null,
      wsUrl: null,
      error: "Network failure 503",
    });

    render(<VoiceInterface />);

    // 验证展示 end_failed 视图与契约文案
    expect(screen.getByTestId("end-failed-view")).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.endFailedTitle)).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.endFailedMessage)).toBeInTheDocument();
    expect(screen.getByText("Network failure 503")).toBeInTheDocument();

    // 绝不渲染 LiveKitRoom，音频不自动恢复
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    expect(useConversationStore.getState().token).toBeNull();

    // 绝不启动分析轮询
    expect(usePollingAssessment).not.toHaveBeenCalledWith("sess-failed-1");

    // 点击重试结束按钮，验证调用 endSession 重试同一会话
    const retryBtn = screen.getByRole("button", { name: zhCN.conversation.retryEndButton });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(api.endSession).toHaveBeenCalledWith("sess-failed-1");
    });
    expect(useConversationStore.getState().sessionId).toBe("sess-failed-1");
  });

  it("renders ConnectingView in checking_health state and never mounts LiveKitRoom without valid connecting/active token", () => {
    // checking_health 状态
    useConversationStore.setState({
      connectionState: "checking_health",
      appView: "session",
      sessionId: null,
      token: "residual-token",
    });
    const { rerender } = render(<VoiceInterface />);

    expect(screen.getByText(zhCN.conversation.connecting)).toBeInTheDocument();
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

    // connecting 但无 token
    useConversationStore.setState({
      connectionState: "connecting",
      appView: "session",
      sessionId: "sess-no-token",
      token: null,
    });
    rerender(<VoiceInterface />);
    expect(screen.getByText(zhCN.conversation.connecting)).toBeInTheDocument();
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

    // active 但无 token 异常情况防御
    useConversationStore.setState({
      connectionState: "active",
      appView: "session",
      sessionId: "sess-anomaly",
      token: null,
    });
    rerender(<VoiceInterface />);
    expect(screen.getByText(zhCN.conversation.connecting)).toBeInTheDocument();
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
  });

  it("renders cancelled local view without polling assessment when cancelled in-flight without sessionId", () => {
    useConversationStore.setState({
      connectionState: "ended",
      appView: "session",
      sessionId: null,
      token: null,
      wsUrl: null,
    });

    render(<VoiceInterface />);

    // 验证展示本地已取消视图，文案明确提示服务端状态未知
    expect(screen.getByTestId("cancelled-local-view")).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.cancelledBeforeStartTitle)).toBeInTheDocument();
    expect(screen.getByText(zhCN.conversation.cancelledBeforeStartMessage)).toBeInTheDocument();

    // 绝不展示“对话已结束”误导用户以为服务端已成功关闭
    expect(screen.queryByText(zhCN.conversation.ended)).not.toBeInTheDocument();

    // 绝不挂载 LiveKitRoom
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

    // 绝不启动分析轮询
    expect(usePollingAssessment).not.toHaveBeenCalledWith(expect.anything());

    // 保留返回主页路径
    const goHomeBtn = screen.getByRole("button", { name: zhCN.dashboard.goHome });
    fireEvent.click(goHomeBtn);
    expect(useConversationStore.getState().connectionState).toBe("idle");
    expect(useConversationStore.getState().appView).toBe("dashboard");
  });

  it("only starts polling assessment after session successfully ends", () => {
    // 处于 ending 状态
    useConversationStore.setState({
      connectionState: "ending",
      appView: "session",
      sessionId: "sess-poll-check",
      token: null,
    });
    const { rerender } = render(<VoiceInterface />);
    expect(usePollingAssessment).not.toHaveBeenCalledWith("sess-poll-check");

    // 处于 end_failed 状态
    useConversationStore.setState({
      connectionState: "end_failed",
      appView: "session",
      sessionId: "sess-poll-check",
      token: null,
    });
    rerender(<VoiceInterface />);
    expect(usePollingAssessment).not.toHaveBeenCalledWith("sess-poll-check");

    // 切换到 ended 状态
    useConversationStore.setState({
      connectionState: "ended",
      appView: "session",
      sessionId: "sess-poll-check",
      token: null,
    });
    rerender(<VoiceInterface />);
    expect(usePollingAssessment).toHaveBeenCalledWith("sess-poll-check");
  });

  it("does not dispatch agent when onConnected fires after state changed to ending or new session", () => {
    useConversationStore.setState({
      connectionState: "connecting",
      appView: "session",
      sessionId: "sess-old",
      token: "tok-old",
      wsUrl: "wss://lk.test",
      sessionGen: 1,
    });

    render(<VoiceInterface />);

    // 在 onConnected 触发前，用户点击了结束或切到了新 session
    useConversationStore.setState({
      connectionState: "ending",
      sessionId: "sess-old",
      token: null,
      sessionGen: 1,
    });

    const triggerBtn = screen.getByTestId("trigger-connected");
    fireEvent.click(triggerBtn);

    expect(api.dispatchAgent).not.toHaveBeenCalled();
  });

  it("does not trigger warnings when old Room onError or onDisconnected fires after generation change", () => {
    useConversationStore.setState({
      connectionState: "active",
      appView: "session",
      sessionId: "sess-gen-1",
      token: "tok-1",
      wsUrl: "wss://lk.test",
      sessionGen: 1,
    });

    render(<VoiceInterface />);

    // 代际发生改变
    useConversationStore.setState({
      sessionGen: 2,
      sessionId: "sess-gen-2",
    });

    // 旧 Room 的错误与断开回调触发
    const errBtn = screen.getByTestId("trigger-error");
    fireEvent.click(errBtn);

    const disconnBtn = screen.getByTestId("trigger-disconnected");
    fireEvent.click(disconnBtn);

    // 绝不展示错误 Toast
    expect(screen.queryByText(zhCN.connectionWarning.title)).not.toBeInTheDocument();
  });

  it("allows returning to dashboard from ending or end_failed view", () => {
    useConversationStore.setState({
      connectionState: "end_failed",
      appView: "session",
      sessionId: "sess-leave",
      token: null,
    });

    render(<VoiceInterface />);

    const goHomeBtn = screen.getByRole("button", { name: zhCN.dashboard.goHome });
    fireEvent.click(goHomeBtn);

    expect(useConversationStore.getState().connectionState).toBe("idle");
    expect(useConversationStore.getState().appView).toBe("dashboard");
    expect(useConversationStore.getState().sessionId).toBeNull();
  });
});
