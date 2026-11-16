import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RoomSession } from "./RoomSession";
import * as roomAudio from "./roomAudio";
import * as auth from "@/lib/auth";
import { useAppStore } from "@/store/appStore";
import { createCredentialsReadyConversationSessionState } from "@/store/conversationState";

/** 带独立 stop 探针的可变 TrackHolderRoom；音轨可在挂载后按需发布。 */
function createTrackRoom(id: string) {
  const room: roomAudio.TrackHolderRoom = {
    localParticipant: { trackPublications: new Map() },
  };
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const addTrack = (): ReturnType<typeof vi.fn> => {
    const stop = vi.fn();
    room.localParticipant!.trackPublications!.set(`pub-${id}-${stops.length}`, {
      track: { stop },
    });
    stops.push(stop);
    return stop;
  };
  return { room, stops, addTrack };
}

let currentRoom: roomAudio.TrackHolderRoom | null = null;

vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="livekit-room">{children}</div>
  ),
  useRoomContext: () => currentRoom,
  RoomAudioRenderer: () => <div data-testid="room-audio-renderer" />,
}));

vi.mock("./ActiveConversation", () => ({
  ActiveConversation: () => <div data-testid="active-conversation" />,
}));

vi.mock("./ConversationStatusViews", () => ({
  ConnectingView: () => <div data-testid="connecting-view" />,
  RoomUnavailableView: () => <div data-testid="room-unavailable-view" />,
}));

vi.mock("@/lib/api", () => ({
  dispatchAgent: vi.fn().mockResolvedValue({ dispatched: true }),
}));

vi.mock("@/lib/diagnostics", () => ({
  logDiagnostic: vi.fn(),
}));

const capturedAuthListeners = new Set<(snapshot: auth.AuthSnapshot) => void>();

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(() => ({
    state: "authenticated",
    principal: { issuer: "https://auth.example.com", subject: "user-1" },
  })),
  getAuthRevision: vi.fn(() => 1),
  arePrincipalsEqual: vi.fn(
    (a: auth.AuthPrincipal | null, b: auth.AuthPrincipal | null) =>
      a === b || Boolean(a && b && a.issuer === b.issuer && a.subject === b.subject),
  ),
  subscribeAuthSnapshot: vi.fn((listener: (snapshot: auth.AuthSnapshot) => void) => {
    capturedAuthListeners.add(listener);
    return () => {
      capturedAuthListeners.delete(listener);
    };
  }),
}));

const capturedLifecycleListeners = new Set<(event: unknown) => void>();
let mockSnapshot: {
  visibility: "visible" | "hidden" | "unknown";
  online: boolean | null;
} = { visibility: "visible", online: true };

vi.mock("@/platform", () => ({
  detectPlatform: () => "web",
  getWebLifecycleSnapshot: () => ({ ...mockSnapshot }),
  getLiveKitWsUrl: ({ tokenWsUrl }: { tokenWsUrl?: string | null }) =>
    tokenWsUrl || "wss://test.livekit.io",
  createLifecycleAdapter: () => ({
    capabilities: { webEvents: true, nativeAppState: false },
    getSnapshot: () => ({ ...mockSnapshot }),
    subscribe: (listener: (event: unknown) => void) => {
      capturedLifecycleListeners.add(listener);
      return () => {
        capturedLifecycleListeners.delete(listener);
      };
    },
    dispose: vi.fn(),
    whenReady: () => Promise.resolve(),
  }),
}));

let forceRender: () => void = () => {};

function RoomSessionHarness(props: {
  sessionId: string;
  sessionGen: number;
  token: string;
  wsUrl: string;
}) {
  const [, setTick] = React.useState(0);
  forceRender = () => setTick((tick) => tick + 1);
  return <RoomSession {...props} />;
}

const baseProps = {
  sessionId: "sess-ownership",
  sessionGen: 1,
  token: "tok-ownership",
  wsUrl: "wss://lk.test",
};

function seedStore(): void {
  const credentialsReady = createCredentialsReadyConversationSessionState({
    sessionId: baseProps.sessionId,
    token: baseProps.token,
    wsUrl: baseProps.wsUrl,
  });
  if (!credentialsReady) {
    throw new Error("RoomSessionOwnership fixture requires complete room credentials");
  }

  useAppStore.setState({
    sessionGen: baseProps.sessionGen,
    sessionId: baseProps.sessionId,
    token: baseProps.token,
    wsUrl: baseProps.wsUrl,
    _sessionState: credentialsReady,
    connectionState: "connecting",
    appView: "session",
  });
}

describe("RoomSession ownership - reference sync and cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRoom = null;
    mockSnapshot = { visibility: "visible", online: true };
    capturedLifecycleListeners.clear();
    capturedAuthListeners.clear();
    forceRender = () => {};
    useAppStore.getState().goHome();
    vi.mocked(auth.getAuthSnapshot).mockReturnValue({
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);
    seedStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the room owned across healthy re-renders without stopping a published track", () => {
    const owned = createTrackRoom("healthy");
    currentRoom = owned.room;
    render(<RoomSessionHarness {...baseProps} />);
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();

    const stop = owned.addTrack();

    act(() => forceRender());
    act(() => forceRender());

    expect(stop).not.toHaveBeenCalled();
  });

  it("does not stop a post-mount track under StrictMode re-renders", () => {
    const owned = createTrackRoom("strict");
    currentRoom = owned.room;
    render(
      <React.StrictMode>
        <RoomSessionHarness {...baseProps} />
      </React.StrictMode>,
    );
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();

    const stop = owned.addTrack();

    act(() => forceRender());
    act(() => forceRender());

    expect(stop).not.toHaveBeenCalled();
  });

  it("stops the replaced SDK room's tracks, preserves the replacement room, and owns it after the swap", () => {
    const previous = createTrackRoom("previous");
    const replacement = createTrackRoom("replacement");
    currentRoom = previous.room;
    const { unmount } = render(<RoomSessionHarness {...baseProps} />);
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();

    const previousStop = previous.addTrack();
    const replacementStop = replacement.addTrack();

    act(() => {
      currentRoom = replacement.room;
      forceRender();
    });

    expect(previousStop).toHaveBeenCalledTimes(1);
    expect(replacementStop).not.toHaveBeenCalled();

    unmount();

    expect(replacementStop).toHaveBeenCalled();
  });

  it("does not stop an uncommitted replacement when the first suspend fails ownership closed", async () => {
    const previous = createTrackRoom("concurrent-prev");
    const replacement = createTrackRoom("concurrent-next");
    currentRoom = previous.room;
    const replacementStop = replacement.addTrack();

    let startSuspending!: () => void;
    let resolveSuspense!: () => void;

    function Suspender() {
      const [suspended, setSuspended] = React.useState(false);
      startSuspending = () => setSuspended(true);
      if (suspended) {
        throw new Promise<void>((resolve) => {
          resolveSuspense = () => {
            setSuspended(false);
            resolve();
          };
        });
      }
      return null;
    }

    render(
      <React.Suspense fallback={<div data-testid="suspense-fallback" />}>
        <RoomSessionHarness {...baseProps} />
        <Suspender />
      </React.Suspense>,
    );
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();

    // 低优先级 transition 中替换 useRoomContext 返回的 Room 身份并令兄弟挂起：
    // 旧 UI 仍 commit，新 Room 已完成 render 但尚未 commit。
    await act(async () => {
      React.startTransition(() => {
        currentRoom = replacement.room;
        forceRender();
        startSuspending();
      });
    });

    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
    expect(screen.queryByTestId("suspense-fallback")).not.toBeInTheDocument();

    act(() => {
      for (const listener of Array.from(capturedLifecycleListeners)) {
        listener({ type: "suspend", snapshot: { visibility: "hidden", online: true } });
      }
    });

    // 挂起窗口内的 Room 尚未提交，共享 ref 不得前进到未提交实例。
    expect(replacementStop).not.toHaveBeenCalled();

    await act(async () => {
      resolveSuspense();
    });

    // 第一次 suspend 已按协议 fail closed 所有权，不能假设失去所有权后仍可停止替换 room。
    expect(replacementStop).not.toHaveBeenCalled();
  });

  it("stops a healthy committed replacement once on its first suspend", () => {
    const previous = createTrackRoom("healthy-prev");
    const replacement = createTrackRoom("healthy-next");
    currentRoom = previous.room;

    render(<RoomSessionHarness {...baseProps} />);
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();

    const replacementStop = replacement.addTrack();

    act(() => {
      currentRoom = replacement.room;
      forceRender();
    });

    expect(replacementStop).not.toHaveBeenCalled();

    act(() => {
      for (const listener of Array.from(capturedLifecycleListeners)) {
        listener({ type: "suspend", snapshot: { visibility: "hidden", online: true } });
      }
      for (const listener of Array.from(capturedLifecycleListeners)) {
        listener({ type: "suspend", snapshot: { visibility: "hidden", online: true } });
      }
    });

    // 健康替换在 layout effect 提交后由 ref 发布；首次 suspend 停止一次，后续保持幂等。
    expect(replacementStop).toHaveBeenCalledTimes(1);
  });
});
