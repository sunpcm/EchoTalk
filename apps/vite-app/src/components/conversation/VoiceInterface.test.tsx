import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceInterface, stopRoomLocalTracks } from "./VoiceInterface";
import * as roomAudio from "./roomAudio";
import { useConversationStore } from "@/store/conversation";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as platform from "@/platform";
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
let onLiveKitRoomLayoutEffect: (() => void) | null = null;
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

const capturedDataChannelListeners: Array<{
  topic: string;
  callback: (msg: { payload: Uint8Array }) => void;
}> = [];
const capturedAuthSnapshotListeners = new Set<(snapshot: auth.AuthSnapshot) => void>();

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

    React.useLayoutEffect(() => {
      onLiveKitRoomLayoutEffect?.();
    }, []);

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
  useDataChannel: vi.fn((topic: string, callback: (msg: { payload: Uint8Array }) => void) => {
    capturedDataChannelListeners.push({ topic, callback });
  }),
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
  dispatchAgent: vi.fn().mockResolvedValue({ dispatched: true }),
  endSession: vi.fn(),
  checkHealthReady: vi.fn(),
  createSession: vi.fn(),
  getSessionToken: vi.fn(),
}));

// Mock Auth
vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(() => ({
    state: "authenticated",
    principal: { issuer: "https://auth.example.com", subject: "user-1" },
  })),
  getAuthRevision: vi.fn(() => 1),
  arePrincipalsEqual: vi.fn(
    (a: any, b: any) => a === b || (a && b && a.issuer === b.issuer && a.subject === b.subject),
  ),
  subscribeAuthSnapshot: vi.fn((listener: (snapshot: auth.AuthSnapshot) => void) => {
    capturedAuthSnapshotListeners.add(listener);
    return () => {
      capturedAuthSnapshotListeners.delete(listener);
    };
  }),
}));

function createFakeApp(initialActive = true) {
  let capturedListener: ((state: { isActive: boolean }) => void) | null = null;
  const removeMock = vi.fn(async () => {});

  const getState = vi.fn(async () => ({ isActive: initialActive }));
  const addListener = vi.fn(
    async (
      eventName: string,
      listener: (state: { isActive: boolean }) => void,
    ): Promise<{ remove(): Promise<void> }> => {
      if (eventName === "appStateChange") {
        capturedListener = listener;
      }
      return { remove: removeMock };
    },
  );

  return {
    getState,
    addListener,
    triggerAppStateChange(state: { isActive: boolean }) {
      capturedListener?.(state);
    },
    get capturedListener() {
      return capturedListener;
    },
    removeMock,
  };
}

type FakeAppType = ReturnType<typeof createFakeApp>;
let currentFakeApp: FakeAppType | null = null;

vi.mock("@capacitor/app", () => ({
  App: {
    getState: vi.fn((...args: any[]) => {
      if (!currentFakeApp) return Promise.resolve({ isActive: true });
      return (currentFakeApp.getState as any)(...args);
    }),
    addListener: vi.fn((...args: any[]) => {
      if (!currentFakeApp) return Promise.resolve({ remove: async () => {} });
      return (currentFakeApp.addListener as any)(...args);
    }),
  },
}));

// Mock platform
const mockWebLifecycleListeners = new Set<(event: any) => void>();
let mockCurrentSnapshot = {
  visibility: "visible" as "visible" | "hidden" | "unknown",
  online: true as boolean | null,
};
const mockLifecycleDispose = vi.fn();

function createHealthyWebLifecycleAdapter(): platform.WebLifecycleAdapter {
  const ownedListeners = new Set<(event: any) => void>();
  return {
    capabilities: { webEvents: true, nativeAppState: false },
    getSnapshot: () => ({ ...mockCurrentSnapshot }),
    subscribe: (listener: (event: any) => void) => {
      ownedListeners.add(listener);
      mockWebLifecycleListeners.add(listener);
      return () => {
        ownedListeners.delete(listener);
        mockWebLifecycleListeners.delete(listener);
      };
    },
    dispose: vi.fn(() => {
      mockLifecycleDispose();
      for (const listener of ownedListeners) {
        mockWebLifecycleListeners.delete(listener);
      }
      ownedListeners.clear();
    }),
  };
}

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    getLiveKitWsUrl: vi.fn(({ tokenWsUrl }) => tokenWsUrl || "wss://test.livekit.io"),
    createWebLifecycleAdapter: vi.fn(createHealthyWebLifecycleAdapter),
    createLifecycleAdapter: vi.fn((options?: any) => {
      const resolvedPlatform = options?.platform ?? actual.detectPlatform();
      if (resolvedPlatform === "ios") {
        return actual.createLifecycleAdapter({
          ...options,
          platform: "ios",
        });
      }
      const web = (platform.createWebLifecycleAdapter as any)(options?.webOptions);
      return {
        capabilities: web.capabilities,
        getSnapshot: () => web.getSnapshot(),
        subscribe: (listener: (event: any) => void) => web.subscribe(listener),
        dispose: () => web.dispose(),
        whenReady: () => Promise.resolve(),
      };
    }),
  };
});

describe("VoiceInterface - CP-02 client end release & generation protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform.createWebLifecycleAdapter)
      .mockReset()
      .mockImplementation(createHealthyWebLifecycleAdapter);
    delete (window as any).Capacitor;
    currentFakeApp = null;
    onLiveKitRoomLayoutEffect = null;
    mockWebLifecycleListeners.clear();
    mockCurrentSnapshot = { visibility: "visible", online: true };
    mockLifecycleDispose.mockClear();
    roomInstanceCounter = 0;
    capturedRoomCallbacks.clear();
    capturedDataChannelListeners.length = 0;
    capturedAuthSnapshotListeners.clear();
    currentMockRoom = createMockRoom();
    useConversationStore.getState().goHome();
    vi.mocked(api.dispatchAgent).mockResolvedValue({ dispatched: true });
    vi.mocked(auth.getAuthSnapshot).mockReturnValue({
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the stopRoomLocalTracks export from the pure roomAudio boundary", () => {
    expect(stopRoomLocalTracks).toBe(roomAudio.stopRoomLocalTracks);
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

  it("renders the idle fallback and mounts a room for credentials-ready connecting", () => {
    useConversationStore.setState({
      connectionState: "idle",
      appView: "session",
      sessionId: null,
      token: null,
      wsUrl: null,
      error: "idle safeguard",
    });
    const { rerender } = render(<VoiceInterface />);

    expect(screen.getByText("idle safeguard")).toBeInTheDocument();
    expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

    useConversationStore.setState({
      connectionState: "connecting",
      appView: "session",
      sessionId: "sess-ready",
      token: "tok-ready",
      wsUrl: "wss://lk.test",
      error: null,
    });
    rerender(<VoiceInterface />);

    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
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

  it("does not enter connection_failed when old Room onError or onDisconnected fires after generation change", () => {
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
      token: "tok-2",
      wsUrl: "wss://lk.test",
      connectionState: "active",
      appView: "session",
    });

    // 旧 Room 的错误与断开回调触发
    const errBtn = screen.getByTestId("trigger-error");
    fireEvent.click(errBtn);

    const disconnBtn = screen.getByTestId("trigger-disconnected");
    fireEvent.click(disconnBtn);

    // 绝不进入 connection_failed，新会话保持正常
    expect(useConversationStore.getState().connectionState).toBe("active");
    expect(useConversationStore.getState().sessionId).toBe("sess-gen-2");
    expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
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

  describe("A12 Agent dispatch failure and recovery (CP-02 §2, §3, §4)", () => {
    it("actively stops owned local tracks, clears tokens, unmounts room, and renders dispatch failed view without raw error echo or polling", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(api.dispatchAgent).mockRejectedValue(
        new Error("Sensitive backend 502 Bad Gateway: livekit token leaked"),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-dispatch-fail",
        token: "tok-fail-123",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 触发 onConnected 引起 dispatch
      act(() => {
        callbacks.onConnected?.();
      });

      // 验证仅调用了一次 dispatchAgent，无自动重试
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);
      expect(api.dispatchAgent).toHaveBeenCalledWith("sess-dispatch-fail");

      // 等待异步失败关闭完成
      await waitFor(() => {
        expect(screen.getByTestId("dispatch-failed-view")).toBeInTheDocument();
      });

      // 1. 同步停止了所属本地音轨
      expect(callbacks.trackStopMock).toHaveBeenCalled();
      expect(mockTrackStop).toHaveBeenCalled();

      // 2. Room 卸载，Token/URL 清除
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("dispatch_failed");
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();

      // 3. 绝不回显原始异常信息
      expect(screen.getByText(zhCN.conversation.dispatchFailedTitle)).toBeInTheDocument();
      expect(screen.getByText(zhCN.conversation.dispatchFailedMessage)).toBeInTheDocument();
      expect(screen.queryByText(/502 Bad Gateway/)).not.toBeInTheDocument();
      expect(screen.queryByText(/tok-fail-123/)).not.toBeInTheDocument();

      // 4. 零自动 endSession 与零分析轮询
      expect(api.endSession).not.toHaveBeenCalled();
      expect(usePollingAssessment).not.toHaveBeenCalledWith("sess-dispatch-fail");

      // 5. 只有一个返回主页按钮，点击后恢复为 idle，允许后续操作
      const goHomeBtn = screen.getByRole("button", { name: zhCN.dashboard.goHome });
      expect(screen.queryByRole("button", { name: /重试/ })).not.toBeInTheDocument();

      fireEvent.click(goHomeBtn);
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().sessionId).toBeNull();
    });

    it("treats invalid success response (dispatched !== true) as failure and triggers safe shutdown", async () => {
      // 模拟旧假 fixture { status: 'dispatched' } 或 { dispatched: false }
      vi.mocked(api.dispatchAgent).mockResolvedValueOnce({
        status: "dispatched",
      } as any);

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-invalid-resp",
        token: "tok-resp-1",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      act(() => {
        callbacks.onConnected?.();
      });

      await waitFor(() => {
        expect(screen.getByTestId("dispatch-failed-view")).toBeInTheDocument();
      });

      expect(callbacks.trackStopMock).toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("dispatch_failed");
      expect(useConversationStore.getState().token).toBeNull();
    });

    it("deduplicates dispatchAgent requests across repeated onConnected calls during in-flight and after success", async () => {
      let resolveDispatch!: (val: { dispatched: boolean }) => void;
      vi.mocked(api.dispatchAgent).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDispatch = resolve;
          }),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-dedup",
        token: "tok-dedup",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 第一次触发
      act(() => {
        callbacks.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);

      // 在途重复触发
      act(() => {
        callbacks.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);

      // 解析成功
      await act(async () => {
        resolveDispatch({ dispatched: true });
      });

      // 成功后再次触发
      act(() => {
        callbacks.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);
    });

    it("drops stale dispatch failure if user ended session or went home during in-flight request", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let rejectDispatch!: (err: Error) => void;
      vi.mocked(api.dispatchAgent).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectDispatch = reject;
          }),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-stale-fail",
        token: "tok-stale",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      act(() => {
        callbacks.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);

      // 在途期间用户返回主页
      act(() => {
        useConversationStore.getState().goHome();
      });
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().sessionId).toBeNull();

      // 迟到的调度失败到达
      await act(async () => {
        rejectDispatch(new Error("Network drop"));
      });

      // 绝不篡改主页状态为 dispatch_failed
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(screen.queryByTestId("dispatch-failed-view")).not.toBeInTheDocument();
    });

    it("drops stale dispatch result if auth revision or principal changed during in-flight request", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let rejectDispatch!: (err: Error) => void;
      vi.mocked(api.dispatchAgent).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectDispatch = reject;
          }),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-change",
        token: "tok-auth",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      act(() => {
        callbacks.onConnected?.();
      });

      // 认证 revision 改变（如换号或重新登录）
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 迟到的调度失败到达
      await act(async () => {
        rejectDispatch(new Error("Network drop"));
      });

      // 绝不进入 dispatch_failed 状态，旧失败结果被隔离
      expect(useConversationStore.getState().connectionState).not.toBe("dispatch_failed");
      expect(screen.queryByTestId("dispatch-failed-view")).not.toBeInTheDocument();
    });

    it("drops late dispatch failure after component unmounts without mutating store", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let rejectDispatch!: (err: Error) => void;
      vi.mocked(api.dispatchAgent).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectDispatch = reject;
          }),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-unmount-fail",
        token: "tok-unmount",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      const { unmount } = render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      act(() => {
        callbacks.onConnected?.();
      });

      // 组件卸载
      unmount();

      // 迟到的调度失败到达
      await act(async () => {
        rejectDispatch(new Error("Late error after unmount"));
      });

      // 卸载后的迟到失败绝不更新当前 store
      expect(useConversationStore.getState().connectionState).not.toBe("dispatch_failed");
    });

    it("does not revive room via setActive or stale callbacks when in dispatch_failed state", () => {
      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-dead",
        token: null,
        wsUrl: null,
        connectionState: "dispatch_failed",
        appView: "session",
      });

      render(<VoiceInterface />);

      // 绝不渲染 LiveKitRoom
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(screen.getByTestId("dispatch-failed-view")).toBeInTheDocument();

      // 调用 setActive
      useConversationStore.getState().setActive("sess-dead", 1);
      expect(useConversationStore.getState().connectionState).toBe("dispatch_failed");
    });

    describe("DSP-01 synchronous reentrancy protection", () => {
      it("drops dispatchAgent when subscriber calls goHome on dispatchedSessionId write (0 calls)", () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-reentrant-gohome",
          token: "tok-reentrant",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        const unsub = useConversationStore.subscribe((state) => {
          if (state.dispatchedSessionId === "sess-reentrant-gohome") {
            useConversationStore.getState().goHome();
          }
        });

        render(<VoiceInterface />);
        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const callbacks = capturedRoomCallbacks.get(instanceId)!;

        act(() => {
          callbacks.onConnected?.();
        });
        unsub();

        expect(api.dispatchAgent).not.toHaveBeenCalled();
        expect(useConversationStore.getState().connectionState).toBe("idle");
      });

      it("drops dispatchAgent when subscriber calls endSession on dispatchedSessionId write (0 calls)", async () => {
        vi.mocked(api.endSession).mockResolvedValue({} as api.Session);

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-reentrant-end",
          token: "tok-reentrant",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        const unsub = useConversationStore.subscribe((state) => {
          if (state.dispatchedSessionId === "sess-reentrant-end") {
            void useConversationStore.getState().endSession();
          }
        });

        render(<VoiceInterface />);
        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const callbacks = capturedRoomCallbacks.get(instanceId)!;

        act(() => {
          callbacks.onConnected?.();
        });
        unsub();

        expect(api.dispatchAgent).not.toHaveBeenCalled();
        expect(useConversationStore.getState().connectionState).toBe("ending");
      });

      it("drops dispatchAgent when subscriber changes revision for same principal on dispatchedSessionId write (0 calls)", () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-reentrant-rev",
          token: "tok-reentrant",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        const unsub = useConversationStore.subscribe((state) => {
          if (state.dispatchedSessionId === "sess-reentrant-rev") {
            vi.mocked(auth.getAuthRevision).mockReturnValue(2);
          }
        });

        render(<VoiceInterface />);
        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const callbacks = capturedRoomCallbacks.get(instanceId)!;

        act(() => {
          callbacks.onConnected?.();
        });
        unsub();

        expect(api.dispatchAgent).not.toHaveBeenCalled();
      });

      it("drops dispatchAgent when subscriber unmounts component on dispatchedSessionId write (0 calls)", () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-reentrant-unmount",
          token: "tok-reentrant",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        const unmountHolder = { current: () => {} };
        const unsub = useConversationStore.subscribe((state) => {
          if (state.dispatchedSessionId === "sess-reentrant-unmount") {
            unmountHolder.current();
          }
        });

        const { unmount } = render(<VoiceInterface />);
        unmountHolder.current = unmount;

        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const callbacks = capturedRoomCallbacks.get(instanceId)!;

        act(() => {
          callbacks.onConnected?.();
        });
        unsub();

        expect(api.dispatchAgent).not.toHaveBeenCalled();
      });
    });
  });

  describe("A13 Web connection failure, interruption, and Web lifecycle (CP-02/CP-05)", () => {
    it("stops owned local tracks, clears token and wsUrl, unmounts room, and renders connection_failed view on SDK onError", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-err-test",
        token: "tok-err-test",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      act(() => {
        callbacks.onError?.(new Error("Sensitive WebSocket token rejected 401"));
      });

      // 1. 同步停止所属本地音轨
      expect(callbacks.trackStopMock).toHaveBeenCalled();
      expect(mockTrackStop).toHaveBeenCalled();

      // 2. Room 卸载，Token/wsUrl 清除，进入 connection_failed 状态
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("connection_failed");
      expect(state.token).toBeNull();
      expect(state.wsUrl).toBeNull();
      expect(state.sessionId).toBe("sess-err-test");

      // 3. 渲染 connection_failed 视图与本地化文案，不回显原始敏感错误
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
      expect(screen.getByText(zhCN.conversation.connectionFailedTitle)).toBeInTheDocument();
      expect(screen.getByText(zhCN.conversation.connectionFailedMessage)).toBeInTheDocument();
      expect(screen.queryByText(/token rejected/i)).not.toBeInTheDocument();

      // 4. 零自动 endSession 与零分析轮询
      expect(api.endSession).not.toHaveBeenCalled();
      expect(usePollingAssessment).not.toHaveBeenCalledWith("sess-err-test");

      // 5. 点击返回主页重置为 idle
      const goHomeBtn = screen.getByRole("button", { name: zhCN.dashboard.goHome });
      fireEvent.click(goHomeBtn);
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");
      expect(useConversationStore.getState().sessionId).toBeNull();
    });

    it("stops owned local tracks, clears token, and enters connection_failed on SDK onDisconnected for any reason while active with token", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      for (const reason of [undefined, 0, 3, "network_loss"]) {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: `sess-disconn-${String(reason)}`,
          token: "tok-active",
          wsUrl: "wss://lk.test",
          connectionState: "active",
          appView: "session",
        });

        const { unmount } = render(<VoiceInterface />);
        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const callbacks = capturedRoomCallbacks.get(instanceId)!;

        act(() => {
          callbacks.onDisconnected?.(reason);
        });

        expect(callbacks.trackStopMock).toHaveBeenCalled();
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        expect(useConversationStore.getState().token).toBeNull();
        expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();

        unmount();
      }
    });

    it("does not enter connection_failed on onDisconnected when session is already ending or ended by user", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-user-ending",
        token: "tok-active",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 用户点击结束
      const endBtn = screen.getByRole("button", { name: zhCN.conversation.endButton });
      fireEvent.click(endBtn);

      expect(useConversationStore.getState().connectionState).toBe("ending");
      expect(useConversationStore.getState().token).toBeNull();

      // 随后 Room 触发 onDisconnected
      act(() => {
        callbacks.onDisconnected?.(0);
      });

      // 绝不进入 connection_failed，保持 ending
      expect(useConversationStore.getState().connectionState).toBe("ending");
      expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
    });

    it("does not enter connection_failed on onDisconnected when agentError already ended the session", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-agent-err",
        token: "tok-active",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 收到 agent_error
      act(() => {
        useConversationStore.getState().setAgentError(
          {
            code: "PROVIDER_ERROR",
            message: "Custom key failed",
          },
          { sessionId: "sess-agent-err", sessionGen: 1 },
        );
      });

      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(useConversationStore.getState().token).toBeNull();

      // 随后 Room 触发 onDisconnected
      act(() => {
        callbacks.onDisconnected?.(3);
      });

      // 绝不覆盖 agentError，保持 ended
      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(useConversationStore.getState().agentError?.code).toBe("PROVIDER_ERROR");
      expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
    });

    it("blocks mounting LiveKitRoom when initial Web snapshot is hidden, entering connection_failed with zero audio tracks", async () => {
      mockCurrentSnapshot = { visibility: "hidden", online: true };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-initial-hidden",
        token: "tok-initial-hidden",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      // LiveKitRoom 绝不被挂载，音频绝不被初始化
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      // 即刻自动进入 connection_failed 状态
      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    });

    it("blocks mounting LiveKitRoom when initial Web snapshot is offline (online === false), entering connection_failed", async () => {
      mockCurrentSnapshot = { visibility: "visible", online: false };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-initial-offline",
        token: "tok-initial-offline",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
    });

    it("does not block mounting LiveKitRoom when initial Web snapshot has visibility unknown and online null", () => {
      mockCurrentSnapshot = { visibility: "unknown", online: null };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-initial-unknown",
        token: "tok-initial-unknown",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      // 正常挂载 LiveKitRoom
      expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
    });

    it("stops local tracks, unmounts room, and enters connection_failed on Web suspend event", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-suspend",
        token: "tok-suspend",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      expect(mockWebLifecycleListeners.size).toBeGreaterThan(0);

      // 触发 suspend 事件（如切后台或 pagehide）
      act(() => {
        for (const listener of Array.from(mockWebLifecycleListeners)) {
          listener({
            type: "suspend",
            snapshot: { visibility: "hidden", online: true },
          });
        }
      });

      expect(callbacks.trackStopMock).toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
    });

    it("stops local tracks, unmounts room, and enters connection_failed on Web connectivity offline event", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-offline-evt",
        token: "tok-offline-evt",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 触发 online === false 事件
      act(() => {
        for (const listener of Array.from(mockWebLifecycleListeners)) {
          listener({
            type: "connectivity",
            snapshot: { visibility: "visible", online: false },
          });
        }
      });

      expect(callbacks.trackStopMock).toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
    });

    it("does not auto-resume audio or revive room when Web resume or online event fires after connection_failed", () => {
      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-no-resume",
        token: null,
        wsUrl: null,
        connectionState: "connection_failed",
        appView: "session",
      });

      render(<VoiceInterface />);

      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      // 模拟外部 resume / online 事件
      act(() => {
        for (const listener of Array.from(mockWebLifecycleListeners)) {
          listener({
            type: "resume",
            snapshot: { visibility: "visible", online: true },
          });
          listener({
            type: "connectivity",
            snapshot: { visibility: "visible", online: true },
          });
        }
      });

      // 绝不复活房间
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    });

    it("disposes Web lifecycle adapter on unmount, leaving zero listeners", () => {
      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-dispose",
        token: "tok-dispose",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      const { unmount } = render(<VoiceInterface />);
      expect(mockWebLifecycleListeners.size).toBeGreaterThan(0);

      unmount();

      expect(mockLifecycleDispose).toHaveBeenCalled();
      expect(mockWebLifecycleListeners.size).toBe(0);
    });

    it("drops in-flight dispatchAgent success or failure if connection_failed occurs in-flight", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      let resolveDispatch!: (val: { dispatched: boolean }) => void;
      vi.mocked(api.dispatchAgent).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDispatch = resolve;
          }),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-in-flight-cf",
        token: "tok-in-flight",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 触发 onConnected 发起 dispatchAgent
      act(() => {
        callbacks.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);

      // 在途期间发生连接断开 -> 进入 connection_failed
      act(() => {
        callbacks.onDisconnected?.();
      });
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");

      // dispatchAgent 随后成功返回
      await act(async () => {
        resolveDispatch({ dispatched: true });
      });

      // 绝不能被改为 active，保持 connection_failed
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
    });

    it("drops Room onError or onDisconnected if auth revision or principal changed", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-drop",
        token: "tok-auth-drop",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 认证 revision 变更（如用户重新登录或换号）
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      act(() => {
        callbacks.onError?.(new Error("Stale error"));
      });

      // 绝不以旧 Room 身份影响新认证
      expect(useConversationStore.getState().connectionState).toBe("active");
      expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
    });

    it("drops retained Room onError, onDisconnected, and lifecycle events after unmount (CON-01)", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-unmount-guard",
        token: "tok-unmount-guard",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      let capturedLifecycleListener: ((event: any) => void) | null = null;
      const { unmount } = render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      for (const listener of Array.from(mockWebLifecycleListeners)) {
        capturedLifecycleListener = listener;
      }

      // 卸载组件
      unmount();
      mockTrackStop.mockClear();

      // 触发保留的 Room onError 和 onDisconnected
      act(() => {
        callbacks.onError?.(new Error("Late error after unmount"));
        callbacks.onDisconnected?.();
      });

      // 触发保留的生命周期监听器
      act(() => {
        capturedLifecycleListener?.({
          type: "pause",
          snapshot: { visibility: "hidden", online: true },
        });
      });

      // 验证未对 store 造成副作用，也未调用 track.stop
      expect(useConversationStore.getState().connectionState).toBe("active");
      expect(mockTrackStop).not.toHaveBeenCalled();
    });

    it("silently drops onConnected when auth revision or principal changes (CON-02)", async () => {
      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-conn",
        token: "tok-auth-conn",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      // 认证 revision 变更
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      mockTrackStop.mockClear();

      act(() => {
        callbacks.onConnected?.();
      });

      // 静默丢弃：不调用 dispatchAgent，不调用 failDispatch，不停止 tracks
      expect(api.dispatchAgent).not.toHaveBeenCalled();
      expect(mockTrackStop).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
    });

    it("detects hidden or offline environment in post-subscribe snapshot check and fails closed immediately (CON-04)", () => {
      let snapshotReadCount = 0;
      mockCurrentSnapshot = { visibility: "visible", online: true };

      // 初次渲染与订阅生效会各自创建 adapter，计数必须跨 adapter 实例共享：
      // 第一次 snapshot 读取返回 visible，订阅后的第二次读取返回 hidden。
      vi.mocked(platform.createWebLifecycleAdapter).mockImplementation(() => {
        const ownedListeners = new Set<(event: any) => void>();
        return {
          capabilities: { webEvents: true, nativeAppState: false },
          getSnapshot: () => {
            snapshotReadCount += 1;
            if (snapshotReadCount === 1) {
              return { visibility: "visible", online: true };
            }
            return { visibility: "hidden", online: true };
          },
          subscribe: (listener: (event: any) => void) => {
            ownedListeners.add(listener);
            mockWebLifecycleListeners.add(listener);
            return () => {
              ownedListeners.delete(listener);
              mockWebLifecycleListeners.delete(listener);
            };
          },
          dispose: vi.fn(() => {
            mockLifecycleDispose();
            for (const listener of ownedListeners) {
              mockWebLifecycleListeners.delete(listener);
            }
            ownedListeners.clear();
          }),
        };
      });

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-gap-fail",
        token: "tok-gap",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      // 渲染后立即因订阅后的快照检查进入 connection_failed
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
      expect(mockTrackStop).toHaveBeenCalled();
    });
  });

  describe("A19 Native Room mounting, gating and interruption (CP-05 §§1–5)", () => {
    it("does not mount LiveKitRoom and zero dispatchAgent while native listener registration/state is pending", async () => {
      let resolveGetState!: (val: { isActive: boolean }) => void;
      currentFakeApp = createFakeApp(true);
      currentFakeApp.getState.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetState = resolve;
          }),
      );
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-native-pending",
        token: "tok-native-pending",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      // 1. 原生 pending 期间零挂载 LiveKitRoom
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      // 2. 处于连接等待中
      expect(screen.getByText(zhCN.conversation.connecting)).toBeInTheDocument();
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().token).not.toBeNull();
      expect(screen.queryByTestId("connection-failed-view")).not.toBeInTheDocument();
      // 3. 零 dispatchAgent
      expect(api.dispatchAgent).not.toHaveBeenCalled();

      // 4. 等待 getState 真实被调用后，后续 getState 解析为 true
      await waitFor(() => {
        expect(currentFakeApp!.getState).toHaveBeenCalled();
      });

      await act(async () => {
        resolveGetState({ isActive: true });
      });

      // 5. 挂载 LiveKitRoom
      await waitFor(() => {
        expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      });
    });

    it("mounts LiveKitRoom exactly once after native becomes active, without duplicate rooms", async () => {
      currentFakeApp = createFakeApp(true);
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-native-active-once",
        token: "tok-active-once",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      await waitFor(() => {
        expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      });
      expect(screen.getAllByTestId("livekit-room")).toHaveLength(1);
    });

    it("fails connection and never mounts room when native addListener rejects", async () => {
      currentFakeApp = createFakeApp(true);
      currentFakeApp.addListener.mockRejectedValue(new Error("Native plugin unavailable"));
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-reg-fail",
        token: "tok-reg-fail",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
    });

    it("fails connection and never mounts room when native initial getState returns isActive: false", async () => {
      currentFakeApp = createFakeApp(false);
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-inactive-start",
        token: "tok-inactive-start",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(screen.getByTestId("connection-failed-view")).toBeInTheDocument();
    });

    it("fails connection and clears token safely when native pending times out after 10 seconds", async () => {
      vi.useFakeTimers();
      try {
        currentFakeApp = createFakeApp(true);
        currentFakeApp.getState.mockImplementation(() => new Promise(() => {})); // never resolves
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-timeout",
          token: "tok-timeout",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
        expect(useConversationStore.getState().connectionState).toBe("connecting");

        // 前进 9.9 秒，仍 pending
        act(() => {
          vi.advanceTimersByTime(9900);
        });
        expect(useConversationStore.getState().connectionState).toBe("connecting");

        // 达到 10 秒
        act(() => {
          vi.advanceTimersByTime(100);
        });

        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        expect(useConversationStore.getState().token).toBeNull();
        expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("drops delayed native ready and does not mount room or dispatch when session cancelled during pending", async () => {
      let resolveGetState!: (val: { isActive: boolean }) => void;
      currentFakeApp = createFakeApp(true);
      currentFakeApp.getState.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetState = resolve;
          }),
      );
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-cancelled-during-pending",
        token: "tok-pending-1",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      // 在 pending 期间用户返回主页前，等待 listener 和 getState 建立
      await waitFor(() => {
        expect(currentFakeApp!.getState).toHaveBeenCalled();
      });

      act(() => {
        useConversationStore.getState().goHome();
      });
      expect(useConversationStore.getState().connectionState).toBe("idle");

      // 随后迟到的 native ready 到达
      await act(async () => {
        resolveGetState({ isActive: true });
      });

      // 绝不复活或挂载房间，也不 dispatch
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(api.dispatchAgent).not.toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("idle");
    });

    it("releases late listener handle via remove() in StrictMode unmount without leaks", async () => {
      let resolveListenerHandle!: (val: { remove(): Promise<void> }) => void;
      const removeMock = vi.fn(async () => {});
      currentFakeApp = createFakeApp(true);
      currentFakeApp.addListener.mockImplementation(
        () =>
          new Promise<{ remove(): Promise<void> }>((resolve) => {
            resolveListenerHandle = resolve;
          }),
      );
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-strict-mode",
        token: "tok-strict",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      const { unmount } = render(<VoiceInterface />);

      // 第一次卸载（模拟 StrictMode unmount）
      unmount();

      // 卸载后，延迟的 addListener 才 resolve
      await act(async () => {
        resolveListenerHandle({ remove: removeMock });
      });

      // 验证必须调用了 remove() 释放句柄
      expect(removeMock).toHaveBeenCalled();
    });

    it("fails connection and stops audio if native inactive occurs right when ready before room completes mounting", async () => {
      currentFakeApp = createFakeApp(true);
      currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-gap-inactive",
        token: "tok-gap-inactive",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      // getState 尚未 resolve 时触发了 inactive 事件
      act(() => {
        currentFakeApp!.triggerAppStateChange({ isActive: false });
      });

      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    });

    it("synchronously stops all owned local tracks BEFORE native event callback returns when connected", async () => {
      currentFakeApp = createFakeApp(true);
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-sync-stop",
        token: "tok-sync-stop",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      await waitFor(() => {
        expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      });

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const callbacks = capturedRoomCallbacks.get(instanceId)!;

      expect(mockTrackStop).not.toHaveBeenCalled();

      // 关键断言：在 triggerAppStateChange 回调返回前，pub.track.stop 必须已被同步调用！
      let stopCalledDuringCallback = false;
      mockTrackStop.mockImplementationOnce(() => {
        stopCalledDuringCallback = true;
      });

      act(() => {
        currentFakeApp!.triggerAppStateChange({ isActive: false });
        expect(stopCalledDuringCallback).toBe(true);
      });

      expect(callbacks.trackStopMock).toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    });

    it("does not auto-reconnect, auto-dispatch, or revive room when native active fires after connection_failed", async () => {
      currentFakeApp = createFakeApp(true);
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-no-auto-revive",
        token: "tok-auto-revive",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);

      await waitFor(() => {
        expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      });

      // 切后台 -> 进入 connection_failed
      act(() => {
        currentFakeApp!.triggerAppStateChange({ isActive: false });
      });
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      vi.mocked(api.dispatchAgent).mockClear();

      // 切回前台
      act(() => {
        currentFakeApp!.triggerAppStateChange({ isActive: true });
      });

      // 绝不自动重连、复活房间或 dispatchAgent
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(api.dispatchAgent).not.toHaveBeenCalled();
    });

    it("allows explicit return to dashboard and starting a new session successfully after native failure", async () => {
      currentFakeApp = createFakeApp(false);
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-fail-first",
        token: "tok-fail-1",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      const { rerender } = render(<VoiceInterface />);

      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });

      // 用户点击返回主页
      const goHomeBtn = screen.getByRole("button", { name: zhCN.dashboard.goHome });
      fireEvent.click(goHomeBtn);
      expect(useConversationStore.getState().connectionState).toBe("idle");
      expect(useConversationStore.getState().appView).toBe("dashboard");

      // 用户重新进入前台并开启新会话
      currentFakeApp = createFakeApp(true);
      useConversationStore.setState({
        sessionGen: 2,
        sessionId: "sess-retry-success",
        token: "tok-retry-success",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      rerender(<VoiceInterface />);

      await waitFor(() => {
        expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      });
      expect(useConversationStore.getState().connectionState).toBe("connecting");
    });

    describe("ROOM-01: Auth revision/issuer/subject guards on pending timeout", () => {
      it("does not failConnection or clear token when auth revision changes from 1 to 2 during native pending timeout", () => {
        vi.useFakeTimers();
        try {
          currentFakeApp = createFakeApp(true);
          currentFakeApp.getState.mockImplementation(() => new Promise(() => {})); // never resolves
          (window as any).Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => "ios",
          };

          useConversationStore.setState({
            sessionGen: 1,
            sessionId: "sess-auth-rev-change",
            token: "tok-preserved",
            wsUrl: "wss://lk.test",
            connectionState: "connecting",
            appView: "session",
          });

          render(<VoiceInterface />);
          expect(useConversationStore.getState().connectionState).toBe("connecting");
          expect(useConversationStore.getState().token).toBe("tok-preserved");

          // 认证 revision 从 1 变 2（sessionGen / sessionId 不变）
          vi.mocked(auth.getAuthRevision).mockReturnValue(2);

          // 模拟 10000ms 超时到达
          act(() => {
            vi.advanceTimersByTime(10000);
          });

          // 关键断言：旧 timer 必须静默，不得 clear token，不得 failConnection！
          expect(useConversationStore.getState().connectionState).toBe("connecting");
          expect(useConversationStore.getState().token).toBe("tok-preserved");
        } finally {
          vi.useRealTimers();
        }
      });

      it("does not failConnection or clear token when auth issuer changes during native pending timeout", () => {
        vi.useFakeTimers();
        try {
          currentFakeApp = createFakeApp(true);
          currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
          (window as any).Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => "ios",
          };

          useConversationStore.setState({
            sessionGen: 1,
            sessionId: "sess-issuer-change",
            token: "tok-issuer-preserve",
            wsUrl: "wss://lk.test",
            connectionState: "connecting",
            appView: "session",
          });

          render(<VoiceInterface />);

          // 认证 issuer 变化
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "https://other-auth.example.com", subject: "user-1" },
          });

          act(() => {
            vi.advanceTimersByTime(10000);
          });

          expect(useConversationStore.getState().connectionState).toBe("connecting");
          expect(useConversationStore.getState().token).toBe("tok-issuer-preserve");
        } finally {
          vi.useRealTimers();
        }
      });

      it("does not failConnection or clear token when auth subject changes during native pending timeout", () => {
        vi.useFakeTimers();
        try {
          currentFakeApp = createFakeApp(true);
          currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
          (window as any).Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => "ios",
          };

          useConversationStore.setState({
            sessionGen: 1,
            sessionId: "sess-subj-change",
            token: "tok-subj-preserve",
            wsUrl: "wss://lk.test",
            connectionState: "connecting",
            appView: "session",
          });

          render(<VoiceInterface />);

          // 认证 subject 变化
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-2" },
          });

          act(() => {
            vi.advanceTimersByTime(10000);
          });

          expect(useConversationStore.getState().connectionState).toBe("connecting");
          expect(useConversationStore.getState().token).toBe("tok-subj-preserve");
        } finally {
          vi.useRealTimers();
        }
      });

      it("truly current session with matching auth exits safely on 10s timeout", () => {
        vi.useFakeTimers();
        try {
          currentFakeApp = createFakeApp(true);
          currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
          (window as any).Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => "ios",
          };

          useConversationStore.setState({
            sessionGen: 1,
            sessionId: "sess-current-timeout",
            token: "tok-curr",
            wsUrl: "wss://lk.test",
            connectionState: "connecting",
            appView: "session",
          });

          render(<VoiceInterface />);

          act(() => {
            vi.advanceTimersByTime(10000);
          });

          expect(useConversationStore.getState().connectionState).toBe("connection_failed");
          expect(useConversationStore.getState().token).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("ROOM-02: Commit/layout timing guard for synchronous track stop", () => {
      it("synchronously stops owned local tracks before native event returns even if inactive occurs during commit/layout effect before passive effects run", async () => {
        currentFakeApp = createFakeApp(true);
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        let stopOccurredBeforeCallbackReturn = false;
        mockTrackStop.mockImplementation(() => {
          stopOccurredBeforeCallbackReturn = true;
        });

        // 模拟 LiveKitRoom 在 commit 阶段的 layout effect（子组件已提交而 passive useEffect 未运行）
        onLiveKitRoomLayoutEffect = () => {
          currentFakeApp!.triggerAppStateChange({ isActive: false });
          // 断言：在 triggerAppStateChange 回调返回的同一同步时刻，track 必须已被停止
          expect(stopOccurredBeforeCallbackReturn).toBe(true);
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-layout-inactive",
          token: "tok-layout",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        // 等待挂载并中断
        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        });

        // 验证停止确已调用且进入 connection_failed
        expect(mockTrackStop).toHaveBeenCalled();
        expect(useConversationStore.getState().token).toBeNull();
        expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      });
    });

    describe("ROOM-03: Stable room ownership and cleanup without stopping tracks on normal re-renders", () => {
      it("does not stop tracks during normal connection, dispatch, setActive, and unrelated store re-renders on native", async () => {
        currentFakeApp = createFakeApp(true);
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-room-03",
          token: "tok-room-03",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        // 等待原生就绪并挂载 LiveKitRoom
        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        // 初始挂载期间未 stop
        expect(mockTrackStop).not.toHaveBeenCalled();

        // 触发连接就绪，进入 onConnected -> markDispatched -> dispatchAgent -> setActive 流程
        const triggerConnectedBtn = screen.getByTestId("trigger-connected");
        await act(async () => {
          fireEvent.click(triggerConnectedBtn);
        });

        // 等待状态成功流转至 active
        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("active");
        });

        // 核心验证 (ROOM-03): connected -> dispatch -> active 正常重渲染期间绝不能调用 stopRoomLocalTracks
        expect(mockTrackStop).not.toHaveBeenCalled();

        // 验证不相关的 store 更新引起的重渲染也不会触发 stop
        act(() => {
          useConversationStore.setState({ error: "transient-warning" });
        });
        expect(mockTrackStop).not.toHaveBeenCalled();

        // 验证真实生命周期中断（如原生进入后台/inactive）时，音轨被正确停止
        act(() => {
          currentFakeApp!.triggerAppStateChange({ isActive: false });
        });
        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        });
        expect(mockTrackStop).toHaveBeenCalled();
      });

      it("stops tracks when component unmounts on user leaving session or navigating home", async () => {
        currentFakeApp = createFakeApp(true);
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-room-03-unmount",
          token: "tok-room-03-unmount",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        const { unmount } = render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        expect(mockTrackStop).not.toHaveBeenCalled();

        // 组件正常卸载退出
        unmount();
        expect(mockTrackStop).toHaveBeenCalled();
      });
    });

    describe("VoiceInterface Safe Diagnostics (CP-06)", () => {
      let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
      let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
      let consoleLogSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        currentFakeApp = createFakeApp(true);
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };
        capturedDataChannelListeners.length = 0;
      });

      afterEach(() => {
        delete (window as any).Capacitor;
        currentFakeApp = null;
        vi.restoreAllMocks();
      });

      it("captures DataChannel agent_error, emits safe whitelist record without leaking parsed object, and updates UI & store", async () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-diag-data-channel",
          token: "tok-diag-dc",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        // 找到注册的 agent_error callback
        const agentErrorListener = capturedDataChannelListeners.find(
          (l) => l.topic === "agent_error",
        );
        expect(agentErrorListener).toBeDefined();

        // 构造包含恶意 canary 与超限私有字段的真实 payload
        const sensitivePayload = {
          type: "agent_error",
          code: "ERR_CUSTOM_KEY_INVALID",
          message: "自定义密钥配置无效，请重新检查",
          canary_secret_token: "leaked-token-xyz-12345",
          canary_document_context: "confidential user exam text",
          canary_account_id: "user-private-uuid-999",
        };

        const encoded = new TextEncoder().encode(JSON.stringify(sensitivePayload));

        act(() => {
          agentErrorListener!.callback({ payload: encoded });
        });

        // 1. 验证诊断记录发出且完全脱敏
        expect(consoleErrorSpy).toHaveBeenCalled();
        const diagnosticCalls = consoleErrorSpy.mock.calls.filter(
          (call: any[]) => call[0] === "[diagnostic]",
        );
        expect(diagnosticCalls.length).toBe(1);

        const record = diagnosticCalls[0][1] as any;
        expect(record).toEqual({
          schema_version: 1,
          app_version: expect.any(String),
          platform: expect.any(String),
          event: "agent_error_received",
          agent_code: "ERR_CUSTOM_KEY_INVALID",
        });

        // 序列化断言：控制台绝无 parsed 对象或 canary 泄漏
        const serialized = JSON.stringify(record);
        expect(serialized).not.toContain("leaked-token-xyz-12345");
        expect(serialized).not.toContain("confidential user exam text");
        expect(serialized).not.toContain("user-private-uuid-999");
        expect(serialized).not.toContain("自定义密钥配置无效");

        // 2. 验证原有 store 与 UI 终态行为按原行为正确保持
        expect(useConversationStore.getState().agentError).toEqual({
          code: "ERR_CUSTOM_KEY_INVALID",
          message: "自定义密钥配置无效，请重新检查",
        });

        // 验证 UI 渲染出了错误卡片提示
        expect(screen.getByText("自定义密钥配置无效，请重新检查")).toBeInTheDocument();
      });

      it("sanitizes unknown or secret-like agent_code to 'unknown' in DataChannel error event", async () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-diag-unknown-code",
          token: "tok-diag-unknown",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        const agentErrorListener = capturedDataChannelListeners.find(
          (l) => l.topic === "agent_error",
        );
        expect(agentErrorListener).toBeDefined();

        const sensitivePayload = {
          type: "agent_error",
          code: "SECRET_LEAK_TOKEN_KEY_999",
          message: "发生未知错误",
        };

        act(() => {
          agentErrorListener!.callback({
            payload: new TextEncoder().encode(JSON.stringify(sensitivePayload)),
          });
        });

        const diagnosticCalls = consoleErrorSpy.mock.calls.filter(
          (call: any[]) => call[0] === "[diagnostic]",
        );
        expect(diagnosticCalls.length).toBe(1);
        const record = diagnosticCalls[0][1] as any;

        expect(record.agent_code).toBe("unknown");
        expect(JSON.stringify(record)).not.toContain("SECRET_LEAK_TOKEN_KEY_999");
      });

      it("emits agent_dispatch_failed on dispatchAgent failure", async () => {
        vi.mocked(api.dispatchAgent).mockRejectedValue(new Error("Agent offline"));

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-diag-dispatch-fail",
          token: "tok-diag-dispatch",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        const triggerConnectedBtn = screen.getByTestId("trigger-connected");
        await act(async () => {
          fireEvent.click(triggerConnectedBtn);
        });

        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("dispatch_failed");
        });

        const diagnosticCalls = consoleErrorSpy.mock.calls.filter(
          (call: any[]) => call[0] === "[diagnostic]",
        );
        expect(diagnosticCalls.length).toBe(1);
        const record = diagnosticCalls[0][1] as any;
        expect(record.event).toBe("agent_dispatch_failed");
        expect(mockTrackStop).toHaveBeenCalled();
      });

      it("emits livekit_connection_failed on LiveKitRoom onError", async () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-diag-lk-error",
          token: "tok-diag-lk-err",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        const triggerErrorBtn = screen.getByTestId("trigger-error");
        act(() => {
          fireEvent.click(triggerErrorBtn);
        });

        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        });

        const diagnosticCalls = consoleErrorSpy.mock.calls.filter(
          (call: any[]) => call[0] === "[diagnostic]",
        );
        expect(diagnosticCalls.length).toBe(1);
        const record = diagnosticCalls[0][1] as any;
        expect(record.event).toBe("livekit_connection_failed");
        expect(mockTrackStop).toHaveBeenCalled();
      });

      it("emits livekit_disconnected on LiveKitRoom onDisconnected", async () => {
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-diag-lk-disconnected",
          token: "tok-diag-lk-disc",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        const triggerDisconnectBtn = screen.getByTestId("trigger-disconnected");
        act(() => {
          fireEvent.click(triggerDisconnectBtn);
        });

        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        });

        const diagnosticCalls = consoleLogSpy.mock.calls.filter(
          (call: any[]) => call[0] === "[diagnostic]",
        );
        expect(diagnosticCalls.length).toBe(1);
        const record = diagnosticCalls[0][1] as any;
        expect(record.event).toBe("livekit_disconnected");
        expect(mockTrackStop).toHaveBeenCalled();
      });

      it("emits lifecycle_audio_interrupted on native lifecycle inactive", async () => {
        currentFakeApp = createFakeApp(true);
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-diag-interrupted",
          token: "tok-diag-interrupted",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        await waitFor(() => {
          expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
        });

        act(() => {
          currentFakeApp!.triggerAppStateChange({ isActive: false });
        });

        await waitFor(() => {
          expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        });

        const diagnosticCalls = consoleWarnSpy.mock.calls.filter(
          (call: any[]) => call[0] === "[diagnostic]",
        );
        expect(diagnosticCalls.length).toBe(1);
        const record = diagnosticCalls[0][1] as any;
        expect(record.event).toBe("lifecycle_audio_interrupted");
      });

      it("emits native_lifecycle_ready_timeout when native pending exceeds 10s", async () => {
        vi.useFakeTimers();
        try {
          currentFakeApp = createFakeApp(true);
          currentFakeApp.getState.mockImplementation(
            () => new Promise(() => {}), // 永久 pending
          );
          (window as any).Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => "ios",
          };

          useConversationStore.setState({
            sessionGen: 1,
            sessionId: "sess-diag-timeout",
            token: "tok-diag-timeout",
            wsUrl: "wss://lk.test",
            connectionState: "connecting",
            appView: "session",
          });

          render(<VoiceInterface />);

          act(() => {
            vi.advanceTimersByTime(10001);
          });

          expect(useConversationStore.getState().connectionState).toBe("connection_failed");

          const diagnosticCalls = consoleWarnSpy.mock.calls.filter(
            (call: any[]) => call[0] === "[diagnostic]",
          );
          expect(diagnosticCalls.length).toBe(1);
          const record = diagnosticCalls[0][1] as any;
          expect(record.event).toBe("native_lifecycle_ready_timeout");
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("A77 same-principal Room auth ownership refresh", () => {
    const principal = {
      issuer: "https://auth.example.com",
      subject: "user-1",
    };
    const refreshedSnapshot = {
      state: "authenticated" as const,
      principal,
    };

    function stageAuthRefresh(revision: number) {
      vi.mocked(auth.getAuthSnapshot).mockReturnValue(refreshedSnapshot);
      vi.mocked(auth.getAuthRevision).mockReturnValue(revision);
    }

    function notifyAuthRefresh(revision: number) {
      stageAuthRefresh(revision);
      act(() => {
        for (const listener of capturedAuthSnapshotListeners) {
          listener(refreshedSnapshot);
        }
      });
    }

    it.each(["onError", "onDisconnected"] as const)(
      "rejects old %s after refresh and lets the new callback fail closed",
      async (callbackName) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-auth-refresh-sdk",
          token: "auth-refresh-sdk-token",
          wsUrl: "wss://lk.test",
          connectionState: "active",
          appView: "session",
        });

        render(<VoiceInterface />);

        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const oldCallbacks = capturedRoomCallbacks.get(instanceId)!;
        const oldCallback =
          callbackName === "onError" ? oldCallbacks.onError : oldCallbacks.onDisconnected;

        notifyAuthRefresh(2);
        await waitFor(() => {
          expect(capturedRoomCallbacks.get(instanceId)?.[callbackName]).not.toBe(oldCallback);
        });

        expect(screen.getByTestId("livekit-room").getAttribute("data-instance-id")).toBe(
          instanceId,
        );
        expect(mockTrackStop).not.toHaveBeenCalled();
        expect(api.dispatchAgent).not.toHaveBeenCalled();

        act(() => {
          oldCallback?.(new Error("old revision"));
        });
        expect(useConversationStore.getState().connectionState).toBe("active");
        expect(mockTrackStop).not.toHaveBeenCalled();

        const currentCallbacks = capturedRoomCallbacks.get(instanceId)!;
        const currentCallback =
          callbackName === "onError" ? currentCallbacks.onError : currentCallbacks.onDisconnected;
        act(() => {
          currentCallback?.(new Error("current revision"));
        });
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        expect(mockTrackStop).toHaveBeenCalled();
      },
    );

    it.each([
      {
        label: "suspend",
        event: {
          type: "suspend",
          snapshot: { visibility: "hidden" as const, online: true },
        },
      },
      {
        label: "offline",
        event: {
          type: "connectivity",
          snapshot: { visibility: "visible" as const, online: false },
        },
      },
    ])(
      "keeps an old Web $label listener inert and rotates to the refreshed listener",
      async ({ event }) => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-auth-refresh-suspend",
          token: "auth-refresh-suspend-token",
          wsUrl: "wss://lk.test",
          connectionState: "active",
          appView: "session",
        });

        render(<VoiceInterface />);

        const roomEl = screen.getByTestId("livekit-room");
        const instanceId = roomEl.getAttribute("data-instance-id")!;
        const [oldLifecycleListener] = Array.from(mockWebLifecycleListeners);
        expect(oldLifecycleListener).toBeDefined();

        stageAuthRefresh(2);
        act(() => {
          oldLifecycleListener(event);
        });
        expect(mockTrackStop).not.toHaveBeenCalled();
        expect(useConversationStore.getState().connectionState).toBe("active");

        notifyAuthRefresh(2);
        let currentLifecycleListener!: (event: any) => void;
        await waitFor(() => {
          const lifecycleListeners = Array.from(mockWebLifecycleListeners);
          expect(lifecycleListeners).toHaveLength(1);
          expect(lifecycleListeners[0]).not.toBe(oldLifecycleListener);
          currentLifecycleListener = lifecycleListeners[0];
          expect(screen.getByTestId("livekit-room").getAttribute("data-instance-id")).toBe(
            instanceId,
          );
        });

        expect(mockLifecycleDispose).not.toHaveBeenCalled();
        expect(mockTrackStop).not.toHaveBeenCalled();

        act(() => {
          oldLifecycleListener(event);
        });
        expect(mockTrackStop).not.toHaveBeenCalled();
        expect(useConversationStore.getState().connectionState).toBe("active");

        act(() => {
          currentLifecycleListener(event);
        });

        expect(mockTrackStop).toHaveBeenCalled();
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        expect(useConversationStore.getState().token).toBeNull();
      },
    );

    it("keeps the rotated native business listener able to stop current tracks", async () => {
      currentFakeApp = createFakeApp(true);
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-refresh-native-listener",
        token: "{{SECRET_u2n5r8fk}}",
        wsUrl: "wss://lk.test",
        connectionState: "active",
        appView: "session",
      });

      render(<VoiceInterface />);
      await waitFor(() => {
        expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
      });

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const oldDisconnected = capturedRoomCallbacks.get(instanceId)?.onDisconnected;

      notifyAuthRefresh(2);
      await waitFor(() => {
        expect(capturedRoomCallbacks.get(instanceId)?.onDisconnected).not.toBe(oldDisconnected);
      });
      expect(screen.getByTestId("livekit-room").getAttribute("data-instance-id")).toBe(instanceId);
      expect(mockLifecycleDispose).not.toHaveBeenCalled();

      act(() => {
        currentFakeApp!.triggerAppStateChange({ isActive: false });
      });

      expect(mockTrackStop).toHaveBeenCalled();
      expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
    });

    it("keeps a saved onConnected inert after refresh while the current callback dispatches", async () => {
      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-refresh-connected",
        token: "tok-auth-refresh-connected",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const oldCallbacks = capturedRoomCallbacks.get(instanceId)!;

      notifyAuthRefresh(2);
      await waitFor(() => {
        expect(capturedRoomCallbacks.get(instanceId)?.onConnected).not.toBe(
          oldCallbacks.onConnected,
        );
      });

      act(() => {
        oldCallbacks.onConnected?.();
      });
      expect(api.dispatchAgent).not.toHaveBeenCalled();
      expect(mockTrackStop).not.toHaveBeenCalled();

      await act(async () => {
        capturedRoomCallbacks.get(instanceId)!.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);
      expect(api.dispatchAgent).toHaveBeenCalledWith("sess-auth-refresh-connected");
    });

    it("keeps session/gen dispatch deduplication and drops its stale in-flight result after refresh", async () => {
      let rejectDispatch!: (err: Error) => void;
      vi.mocked(api.dispatchAgent).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectDispatch = reject;
          }),
      );

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-refresh-dispatch",
        token: "auth-refresh-dispatch-token",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);

      const roomEl = screen.getByTestId("livekit-room");
      const instanceId = roomEl.getAttribute("data-instance-id")!;
      const oldCallbacks = capturedRoomCallbacks.get(instanceId)!;

      act(() => {
        oldCallbacks.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);

      notifyAuthRefresh(2);
      await waitFor(() => {
        expect(capturedRoomCallbacks.get(instanceId)?.onConnected).not.toBe(
          oldCallbacks.onConnected,
        );
      });

      act(() => {
        capturedRoomCallbacks.get(instanceId)!.onConnected?.();
      });
      expect(api.dispatchAgent).toHaveBeenCalledTimes(1);

      await act(async () => {
        rejectDispatch(new Error("stale refresh result"));
      });

      expect(useConversationStore.getState().connectionState).toBe("active");
      expect(useConversationStore.getState().token).toBe("auth-refresh-dispatch-token");
      expect(screen.queryByTestId("dispatch-failed-view")).not.toBeInTheDocument();
      expect(mockTrackStop).not.toHaveBeenCalled();
    });

    it("waits for the same-principal notification before mounting a native ready Room", async () => {
      let resolveGetState!: (state: { isActive: boolean }) => void;
      currentFakeApp = createFakeApp(true);
      currentFakeApp.getState.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetState = resolve;
          }),
      );
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-refresh-native",
        token: "auth-refresh-native-token",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);
      await waitFor(() => {
        expect(currentFakeApp!.getState).toHaveBeenCalled();
      });

      vi.mocked(auth.getAuthSnapshot).mockReturnValue(refreshedSnapshot);
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);
      await act(async () => {
        resolveGetState({ isActive: true });
      });
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      act(() => {
        for (const listener of capturedAuthSnapshotListeners) {
          listener(refreshedSnapshot);
        }
      });
      await waitFor(() => {
        expect(screen.getAllByTestId("livekit-room")).toHaveLength(1);
      });
      expect(api.dispatchAgent).not.toHaveBeenCalled();
      expect(mockTrackStop).not.toHaveBeenCalled();
    });

    it("defers a notification-gap inactive ready result until the refreshed receipt fails safely", async () => {
      let resolveGetState!: (state: { isActive: boolean }) => void;
      currentFakeApp = createFakeApp(false);
      currentFakeApp.getState.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetState = resolve;
          }),
      );
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-refresh-native-inactive",
        token: "{{SECRET_zzf3t7rc}}",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);
      await waitFor(() => {
        expect(currentFakeApp!.getState).toHaveBeenCalled();
      });

      stageAuthRefresh(2);
      await act(async () => {
        resolveGetState({ isActive: false });
      });
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      notifyAuthRefresh(2);
      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(useConversationStore.getState().token).toBeNull();
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(mockTrackStop).not.toHaveBeenCalled();
      expect(api.dispatchAgent).not.toHaveBeenCalled();
      expect(api.endSession).not.toHaveBeenCalled();
    });

    it("re-reads the current snapshot before a notification-gap active ready result mounts audio", async () => {
      let resolveGetState!: (state: { isActive: boolean }) => void;
      currentFakeApp = createFakeApp(true);
      currentFakeApp.getState.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGetState = resolve;
          }),
      );
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };

      useConversationStore.setState({
        sessionGen: 1,
        sessionId: "sess-auth-refresh-native-background",
        token: "{{SECRET_76w7xbbo}}",
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
      });

      render(<VoiceInterface />);
      await waitFor(() => {
        expect(currentFakeApp!.getState).toHaveBeenCalled();
      });

      stageAuthRefresh(2);
      await act(async () => {
        resolveGetState({ isActive: true });
      });
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      act(() => {
        currentFakeApp!.triggerAppStateChange({ isActive: false });
      });
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();

      notifyAuthRefresh(2);
      await waitFor(() => {
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
      });
      expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
      expect(useConversationStore.getState().token).toBeNull();
      expect(mockTrackStop).not.toHaveBeenCalled();
      expect(api.dispatchAgent).not.toHaveBeenCalled();
    });

    it("keeps the original native 10s budget across same-principal refreshes", () => {
      vi.useFakeTimers();
      try {
        currentFakeApp = createFakeApp(true);
        currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-auth-refresh-budget",
          token: "auth-refresh-budget-token",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        act(() => {
          vi.advanceTimersByTime(9000);
        });
        notifyAuthRefresh(2);
        act(() => {
          vi.advanceTimersByTime(999);
        });
        expect(useConversationStore.getState().connectionState).toBe("connecting");

        notifyAuthRefresh(3);
        act(() => {
          vi.advanceTimersByTime(1);
        });

        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        expect(useConversationStore.getState().token).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not let a stale native timer callback clear the refreshed timer handle", () => {
      vi.useFakeTimers();
      const pendingToken = ["tok", "auth", "refresh", "stale", "timer"].join("-");
      const fakeSetTimeout = globalThis.setTimeout;
      const originalSetTimeout = fakeSetTimeout.bind(globalThis);
      const queuedCallbacks = new Map<
        ReturnType<typeof setTimeout>,
        { callback: () => void; delay: number }
      >();
      const timerCountBeforeRender = vi.getTimerCount();
      const captureSetTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        const handle = originalSetTimeout(handler, timeout, ...args);
        if ((timeout === 10000 || timeout === 1000) && typeof handler === "function") {
          queuedCallbacks.set(handle, {
            callback: () => {
              if (typeof handler === "function") {
                handler(...args);
              }
            },
            delay: timeout,
          });
        }
        return handle;
      }) as typeof setTimeout;

      try {
        // Directly wrap the fake function instead of registering another spy restore. The outer
        // restoreAllMocks() must not be able to reinstall a fake clock after useRealTimers().
        globalThis.setTimeout = captureSetTimeout;
        currentFakeApp = createFakeApp(true);
        currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-auth-refresh-stale-timer",
          token: pendingToken,
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        const { unmount } = render(<VoiceInterface />);
        expect(queuedCallbacks.size).toBe(1);
        expect(vi.getTimerCount()).toBe(timerCountBeforeRender + 1);

        act(() => {
          vi.advanceTimersByTime(9000);
        });
        notifyAuthRefresh(2);
        expect(queuedCallbacks.size).toBe(2);
        expect(vi.getTimerCount()).toBe(timerCountBeforeRender + 1);
        const [, staleTimer] = Array.from(queuedCallbacks.entries())[0];
        const [, currentTimer] = Array.from(queuedCallbacks.entries())[1];
        expect(Array.from(queuedCallbacks.values()).map(({ delay }) => delay)).toEqual([
          10000, 1000,
        ]);

        act(() => {
          staleTimer.callback();
        });
        expect(useConversationStore.getState().connectionState).toBe("connecting");
        expect(useConversationStore.getState().token).toBe(pendingToken);
        expect(vi.getTimerCount()).toBe(timerCountBeforeRender + 1);

        act(() => {
          vi.advanceTimersByTime(999);
        });
        expect(useConversationStore.getState().connectionState).toBe("connecting");
        expect(vi.getTimerCount()).toBe(timerCountBeforeRender + 1);

        unmount();
        expect(vi.getTimerCount()).toBe(timerCountBeforeRender);

        // Clearing the current handle must make even a saved callback inert after unmount.
        act(() => {
          staleTimer.callback();
          currentTimer.callback();
        });
        const retiredState = useConversationStore.getState();
        expect(retiredState.sessionGen).toBe(1);
        expect(retiredState.sessionId).toBe("sess-auth-refresh-stale-timer");
        expect(retiredState.connectionState).toBe("connecting");
        expect(retiredState.token).toBe(pendingToken);
        expect(retiredState.wsUrl).toBe("wss://lk.test");
        expect(retiredState.appView).toBe("session");
        expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
        expect(api.dispatchAgent).not.toHaveBeenCalled();
        expect(api.endSession).not.toHaveBeenCalled();
        expect(mockTrackStop).not.toHaveBeenCalled();

        act(() => {
          vi.advanceTimersByTime(10001);
        });
        const advancedState = useConversationStore.getState();
        expect(advancedState.connectionState).toBe("connecting");
        expect(advancedState.token).toBe(pendingToken);
        expect(advancedState.sessionId).toBe("sess-auth-refresh-stale-timer");
        expect(screen.queryByTestId("livekit-room")).not.toBeInTheDocument();
        expect(api.dispatchAgent).not.toHaveBeenCalled();
        expect(api.endSession).not.toHaveBeenCalled();
        expect(mockTrackStop).not.toHaveBeenCalled();
      } finally {
        // Restore the fake function first, then let Vitest atomically install the real clock.
        globalThis.setTimeout = fakeSetTimeout;
        vi.useRealTimers();
      }
    });

    it("reconciles an elapsed native deadline after a notification gap without another 10s window", () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        currentFakeApp = createFakeApp(true);
        currentFakeApp.getState.mockImplementation(() => new Promise(() => {}));
        (window as any).Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        };

        useConversationStore.setState({
          sessionGen: 1,
          sessionId: "sess-auth-refresh-expired-gap",
          token: "{{SECRET_bq2elzxa}}",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
        });

        render(<VoiceInterface />);

        act(() => {
          vi.advanceTimersByTime(9999);
        });
        stageAuthRefresh(2);
        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(useConversationStore.getState().connectionState).toBe("connecting");

        notifyAuthRefresh(2);
        expect(useConversationStore.getState().connectionState).toBe("connection_failed");
        expect(useConversationStore.getState().token).toBeNull();

        const timeoutDiagnostics = vi
          .mocked(console.warn)
          .mock.calls.filter(
            (call) =>
              call[0] === "[diagnostic]" &&
              (call[1] as { event?: string } | undefined)?.event ===
                "native_lifecycle_ready_timeout",
          );
        expect(timeoutDiagnostics).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("A76 Agent error ownership and payload boundary", () => {
    const principal = {
      issuer: "https://auth.example.com",
      subject: "user-1",
    };

    function agentErrorListeners() {
      return capturedDataChannelListeners.filter((listener) => listener.topic === "agent_error");
    }

    function seedRoom(sessionId: string, sessionGen = 1) {
      useConversationStore.setState({
        sessionGen,
        sessionId,
        token: `tok-${sessionGen}`,
        wsUrl: "wss://lk.test",
        connectionState: "connecting",
        appView: "session",
        agentError: null,
      });
    }

    function encodeAgentError(value: unknown): Uint8Array {
      return new TextEncoder().encode(JSON.stringify(value));
    }

    it("silently rejects malformed and incorrectly typed payloads before any state write", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      seedRoom("sess-invalid-payload");
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const listener = agentErrorListeners()[0];
      const invalidPayloads = [
        new TextEncoder().encode("{"),
        encodeAgentError(null),
        encodeAgentError([]),
        encodeAgentError({ type: "other", code: "CODE", message: "message" }),
        encodeAgentError({ type: "agent_error", code: null, message: "message" }),
        encodeAgentError({ type: "agent_error", code: 42, message: "message" }),
        encodeAgentError({ type: "agent_error", code: "CODE", message: null }),
        encodeAgentError({ type: "agent_error", code: "CODE", message: false }),
        encodeAgentError({ type: "agent_error", code: {}, message: "message" }),
        encodeAgentError({ type: "agent_error", code: "CODE", message: [] }),
        encodeAgentError({ type: "agent_error", code: "   ", message: "message" }),
        encodeAgentError({ type: "agent_error", code: "CODE", message: "\n\t" }),
      ];

      act(() => {
        for (const payload of invalidPayloads) {
          listener.callback({ payload });
        }
      });

      const state = useConversationStore.getState();
      expect(state.connectionState).toBe("connecting");
      expect(state.sessionId).toBe("sess-invalid-payload");
      expect(state.token).toBe("tok-1");
      expect(state.agentError).toBeNull();
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        0,
      );
    });

    it("rejects a saved old-generation callback and lets the replacement Room receive errors", async () => {
      seedRoom("sess-generation-old", 4);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const oldListener = agentErrorListeners()[0];

      act(() => {
        useConversationStore.setState({
          sessionGen: 5,
          sessionId: "sess-generation-new",
          token: "tok-generation-new",
          wsUrl: "wss://lk.test",
          connectionState: "connecting",
          appView: "session",
          agentError: null,
        });
      });
      await waitFor(() => {
        expect(agentErrorListeners().length).toBeGreaterThan(1);
      });
      const newListener = agentErrorListeners().at(-1)!;

      act(() => {
        oldListener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "OLD_ROOM",
            message: "old",
          }),
        });
      });
      expect(useConversationStore.getState().sessionId).toBe("sess-generation-new");
      expect(useConversationStore.getState().sessionGen).toBe(5);
      expect(useConversationStore.getState().agentError).toBeNull();

      act(() => {
        newListener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "NEW_ROOM",
            message: "new",
          }),
        });
      });

      expect(useConversationStore.getState().agentError).toEqual({
        code: "NEW_ROOM",
        message: "new",
      });
      expect(useConversationStore.getState().connectionState).toBe("ended");
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        1,
      );
    });

    it("rejects an old callback when the principal changes before its auth subscription is notified", async () => {
      seedRoom("sess-principal-gap");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const listener = agentErrorListeners()[0];

      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { ...principal, subject: "user-2" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      act(() => {
        listener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "STALE_PRINCIPAL",
            message: "stale",
          }),
        });
      });

      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().agentError).toBeNull();
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        0,
      );
    });

    it("rejects an old callback after logout before the component receives the auth notification", async () => {
      seedRoom("sess-logout-gap");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const listener = agentErrorListeners()[0];

      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "anonymous",
        principal: null,
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      act(() => {
        listener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "STALE_LOGOUT",
            message: "stale",
          }),
        });
      });

      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().agentError).toBeNull();
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        0,
      );
    });

    it("rejects the old revision during the notification gap and adopts a same-principal event for new callbacks", async () => {
      seedRoom("sess-revision");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
        expect(capturedAuthSnapshotListeners.size).toBeGreaterThanOrEqual(2);
      });
      const oldListener = agentErrorListeners()[0];
      const initialListenerCount = agentErrorListeners().length;
      const refreshedSnapshot = { state: "authenticated" as const, principal };

      vi.mocked(auth.getAuthSnapshot).mockReturnValue(refreshedSnapshot);
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // Revision has advanced, but React/auth listeners have not observed it yet.
      act(() => {
        oldListener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "GAP_REVISION",
            message: "stale revision",
          }),
        });
      });
      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        0,
      );

      act(() => {
        for (const listener of capturedAuthSnapshotListeners) {
          listener(refreshedSnapshot);
        }
      });
      await waitFor(() => {
        expect(agentErrorListeners().length).toBeGreaterThan(initialListenerCount);
      });
      const currentListener = agentErrorListeners().at(-1)!;

      act(() => {
        oldListener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "OLD_REVISION",
            message: "old revision",
          }),
        });
      });
      expect(useConversationStore.getState().agentError).toBeNull();
      expect(mockTrackStop).not.toHaveBeenCalled();
      expect(api.dispatchAgent).not.toHaveBeenCalled();
      expect(api.endSession).not.toHaveBeenCalled();

      act(() => {
        currentListener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "REFRESHED_REVISION",
            message: "current revision",
          }),
        });
      });
      expect(useConversationStore.getState().agentError).toEqual({
        code: "REFRESHED_REVISION",
        message: "current revision",
      });
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        1,
      );
    });

    it("keeps the active callback valid across an unrelated render without stopping tracks", async () => {
      seedRoom("sess-unrelated-render");
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const initialListener = agentErrorListeners()[0];

      act(() => {
        useConversationStore.setState({ error: "transient warning" });
      });
      await waitFor(() => {
        expect(agentErrorListeners().length).toBeGreaterThan(1);
      });

      expect(agentErrorListeners().at(-1)!.callback).toBe(initialListener.callback);
      expect(mockTrackStop).not.toHaveBeenCalled();

      act(() => {
        initialListener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "CURRENT_ERROR",
            message: "current",
          }),
        });
      });
      expect(useConversationStore.getState().agentError?.code).toBe("CURRENT_ERROR");
    });

    it("does not modify state or emit diagnostics when an old callback fires after unmount", async () => {
      seedRoom("sess-unmounted");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { unmount } = render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const listener = agentErrorListeners()[0];
      unmount();

      act(() => {
        listener.callback({
          payload: encodeAgentError({
            type: "agent_error",
            code: "AFTER_UNMOUNT",
            message: "late",
          }),
        });
      });

      expect(useConversationStore.getState().connectionState).toBe("connecting");
      expect(useConversationStore.getState().agentError).toBeNull();
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        0,
      );
    });

    it("silently ignores a terminal callback replay after the first valid error", async () => {
      seedRoom("sess-terminal");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(<VoiceInterface />);

      await waitFor(() => {
        expect(agentErrorListeners()).toHaveLength(1);
      });
      const listener = agentErrorListeners()[0];
      const payload = encodeAgentError({
        type: "agent_error",
        code: "TERMINAL_ERROR",
        message: "terminal",
      });

      act(() => {
        listener.callback({ payload });
      });
      const endedState = useConversationStore.getState();
      await waitFor(() => {
        expect(screen.getByText("terminal")).toBeInTheDocument();
      });
      expect(mockTrackStop).toHaveBeenCalled();
      expect(endedState.token).toBeNull();

      act(() => {
        listener.callback({ payload });
      });

      const replayedState = useConversationStore.getState();
      expect(replayedState.sessionGen).toBe(endedState.sessionGen);
      expect(replayedState.agentError).toEqual(endedState.agentError);
      expect(consoleErrorSpy.mock.calls.filter((call) => call[0] === "[diagnostic]")).toHaveLength(
        1,
      );
    });

    it("recovers a current listener after StrictMode effect re-entry", async () => {
      seedRoom("sess-strict");
      render(
        <React.StrictMode>
          <VoiceInterface />
        </React.StrictMode>,
      );

      await waitFor(() => {
        expect(agentErrorListeners().length).toBeGreaterThan(0);
      });
      act(() => {
        agentErrorListeners()
          .at(-1)!
          .callback({
            payload: encodeAgentError({
              type: "agent_error",
              code: "STRICT_MODE_ERROR",
              message: "current",
            }),
          });
      });

      expect(useConversationStore.getState().agentError?.code).toBe("STRICT_MODE_ERROR");
    });
  });
});
