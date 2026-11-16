import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RoomSession } from "./RoomSession";
import * as roomAudio from "./roomAudio";
import * as auth from "@/lib/auth";
import { useAppStore } from "@/store/appStore";

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
  useAppStore.setState({
    sessionGen: baseProps.sessionGen,
    sessionId: baseProps.sessionId,
    token: baseProps.token,
    wsUrl: baseProps.wsUrl,
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

  it("stops the newly rendered replacement room via render-phase binding while a transition suspends", async () => {
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
          resolveSuspense = resolve;
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

    // 挂起窗口内，render 期绑定已把 roomRef 前进到替换 Room，因此 suspend 停止新 Room 音轨。
    expect(replacementStop).toHaveBeenCalled();

    await act(async () => {
      resolveSuspense();
    });
  });
});
