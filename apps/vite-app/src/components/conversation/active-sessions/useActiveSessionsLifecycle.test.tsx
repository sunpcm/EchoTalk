import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RefObject } from "react";
import * as auth from "@/lib/auth";
import {
  createLifecycleAdapter,
  type LifecycleAdapter,
  type WebLifecycleEvent,
  type WebLifecycleSnapshot,
} from "@/platform";
import { createActiveSessionsRuntime, type ActiveSessionsRuntime } from "./shared";
import { useActiveSessionsLifecycle } from "./useActiveSessionsLifecycle";

vi.mock("@/platform", () => ({
  createLifecycleAdapter: vi.fn(),
}));

type Flows = Parameters<typeof useActiveSessionsLifecycle>[1];

const AUTHENTICATED: auth.AuthSnapshot = {
  state: "authenticated",
  principal: { issuer: "https://auth.example.com", subject: "user-1" },
};

function makeFlows() {
  return {
    list: {
      fetchActiveSessions: vi.fn(),
      suspendRequests: vi.fn(),
      stopLoading: vi.fn(),
      resetForAuthChange: vi.fn(),
      clearForUnauthenticated: vi.fn(),
      invalidateOnUnmount: vi.fn(),
    },
    end: {
      resetForAuthChange: vi.fn(),
      invalidateOnUnmount: vi.fn(),
    },
    resume: {
      releaseInFlight: vi.fn(),
      resetForAuthChange: vi.fn(),
      syncWithStore: vi.fn(),
      invalidateOnUnmount: vi.fn(),
    },
  } as unknown as Flows;
}

describe("useActiveSessionsLifecycle live isStarting gating", () => {
  let runtime: ActiveSessionsRuntime;
  let flows: ReturnType<typeof makeFlows>;
  let capturedListener: ((event: WebLifecycleEvent) => void) | null;

  beforeEach(() => {
    runtime = createActiveSessionsRuntime();
    flows = makeFlows();
    capturedListener = null;

    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => AUTHENTICATED);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => 1);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation(() => () => {});
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
    });

    const fakeAdapter: LifecycleAdapter = {
      capabilities: { webEvents: false, nativeAppState: false },
      getSnapshot: (): WebLifecycleSnapshot => ({ visibility: "hidden", online: null }),
      subscribe: (listener) => {
        capturedListener = listener;
        return () => {
          capturedListener = null;
        };
      },
      dispose: vi.fn(),
      whenReady: () => Promise.resolve(),
    };
    vi.mocked(createLifecycleAdapter).mockReturnValue(fakeAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mount(initialIsStarting: boolean) {
    const runtimeRef: RefObject<ActiveSessionsRuntime> = { current: runtime };
    return renderHook(
      ({ isStarting }) => useActiveSessionsLifecycle(runtimeRef, flows, isStarting),
      { initialProps: { isStarting: initialIsStarting } },
    );
  }

  function emitResume() {
    act(() => {
      capturedListener?.({ type: "resume", snapshot: { visibility: "visible", online: true } });
    });
  }

  function emitConnectivity() {
    act(() => {
      capturedListener?.({
        type: "connectivity",
        snapshot: { visibility: "visible", online: true },
      });
    });
  }

  it("reads live isStarting false->true and suppresses resume refresh", () => {
    const { rerender } = mount(false);
    expect(capturedListener).not.toBeNull();

    rerender({ isStarting: true });
    emitResume();

    expect(flows.list.fetchActiveSessions).not.toHaveBeenCalled();
  });

  it("reads live isStarting true->false and allows resume refresh", () => {
    const { rerender } = mount(true);
    rerender({ isStarting: false });
    emitResume();

    expect(flows.list.fetchActiveSessions).toHaveBeenCalledTimes(1);
  });

  it("reads live isStarting false->true and suppresses connectivity refresh", () => {
    const { rerender } = mount(false);
    rerender({ isStarting: true });
    emitConnectivity();

    expect(flows.list.fetchActiveSessions).not.toHaveBeenCalled();
  });

  it("reads live isStarting true->false and allows connectivity refresh", () => {
    const { rerender } = mount(true);
    rerender({ isStarting: false });
    emitConnectivity();

    expect(flows.list.fetchActiveSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps visibility gate: resume while hidden does not refresh", () => {
    const { rerender } = mount(false);
    rerender({ isStarting: false });

    act(() => {
      capturedListener?.({ type: "resume", snapshot: { visibility: "hidden", online: true } });
    });

    expect(flows.list.fetchActiveSessions).not.toHaveBeenCalled();
  });

  it("keeps network gate: resume while offline does not refresh", () => {
    const { rerender } = mount(false);
    rerender({ isStarting: false });

    act(() => {
      capturedListener?.({ type: "resume", snapshot: { visibility: "visible", online: false } });
    });

    expect(flows.list.fetchActiveSessions).not.toHaveBeenCalled();
  });

  it("keeps endInFlight gate", () => {
    const { rerender } = mount(false);
    runtime.endInFlight = true;
    rerender({ isStarting: false });
    emitResume();

    expect(flows.list.fetchActiveSessions).not.toHaveBeenCalled();
  });

  it("keeps resumeInFlight gate", () => {
    const { rerender } = mount(false);
    runtime.resumeInFlight = true;
    rerender({ isStarting: false });
    emitResume();

    expect(flows.list.fetchActiveSessions).not.toHaveBeenCalled();
  });
});
