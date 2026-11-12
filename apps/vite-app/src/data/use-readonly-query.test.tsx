import { StrictMode } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadOnlyQuery } from "./use-readonly-query";
import type { Fetcher, Page, QueryProfile } from "./readonly-query";
import * as auth from "@/lib/auth";
import * as platform from "@/platform";

interface SessionItem {
  id: string;
}

function page(ids: string[], cursor: string | null = null): Page<SessionItem> {
  return { items: ids.map((id) => ({ id })), nextCursor: cursor };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("useReadOnlyQuery 认证、生命周期与清理", () => {
  let snapshot: auth.AuthSnapshot;
  let revision: number;
  let authListeners: Set<(snapshot: auth.AuthSnapshot) => void>;
  let adapters: Array<{
    snapshot: platform.WebLifecycleSnapshot;
    listeners: Set<(event: platform.WebLifecycleEvent) => void>;
    dispose: ReturnType<typeof vi.fn>;
  }>;
  let initialLifecycle: platform.WebLifecycleSnapshot;

  const authEvent = () =>
    act(() => {
      authListeners.forEach((listener) => listener(snapshot));
    });

  const lifecycleEvent = (
    type: platform.WebLifecycleEvent["type"],
    visibility: platform.WebLifecycleVisibility = "visible",
    online = true,
  ) => {
    act(() => {
      const adapter = adapters[adapters.length - 1];
      adapter.snapshot = { visibility, online };
      adapter.listeners.forEach((listener) => listener({ type, snapshot: adapter.snapshot }));
    });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    revision = 1;
    snapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example", subject: "one" },
    };
    initialLifecycle = { visibility: "visible", online: true };
    authListeners = new Set();
    adapters = [];
    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => snapshot);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => revision);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((listener) => {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    });
    vi.spyOn(platform, "createLifecycleAdapter").mockImplementation(() => {
      const state = {
        snapshot: { ...initialLifecycle },
        listeners: new Set<(event: platform.WebLifecycleEvent) => void>(),
        dispose: vi.fn(),
      };
      adapters.push(state);
      state.dispose.mockImplementation(() => state.listeners.clear());
      return {
        capabilities: { webEvents: true, nativeAppState: false },
        getSnapshot: () => state.snapshot,
        subscribe: (listener: (event: platform.WebLifecycleEvent) => void) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        dispose: state.dispose,
        whenReady: () => Promise.resolve(),
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("首次挂载只读请求一次并渲染结果", async () => {
    const fetcher = vi.fn<Fetcher<null, SessionItem>>().mockResolvedValue(page(["a"]));
    const profile: QueryProfile<null, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: null }),
    };
    const { result } = renderHook(() => useReadOnlyQuery({ profile, fetcher }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("ready");
    expect(result.current.state.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("认证变化重查，登出清空且不再请求", async () => {
    const old = deferred<Page<SessionItem>>();
    const next = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const profile: QueryProfile<null, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: null }),
    };
    const { result } = renderHook(() => useReadOnlyQuery({ profile, fetcher }));

    snapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example", subject: "two" },
    };
    authEvent();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve(page(["old"])));
    expect(result.current.state.items).toEqual([]);
    await act(async () => next.resolve(page(["new"])));
    expect(result.current.state.items.map((i) => i.id)).toEqual(["new"]);

    snapshot = { state: "anonymous", principal: null };
    authEvent();
    expect(result.current.state.items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("suspend 作废在途并 paused，resume 只读重查", async () => {
    const old = deferred<Page<SessionItem>>();
    const next = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const profile: QueryProfile<null, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: null }),
    };
    const { result } = renderHook(() => useReadOnlyQuery({ profile, fetcher }));

    lifecycleEvent("suspend", "hidden");
    expect(result.current.state.paused).toBe(true);
    expect(result.current.state.phase).toBe("idle");

    lifecycleEvent("resume");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve(page(["old"])));
    expect(result.current.state.items).toEqual([]);
    await act(async () => next.resolve(page(["new"])));
    expect(result.current.state.items.map((i) => i.id)).toEqual(["new"]);
  });

  it("connectivity 恢复且非 hidden 时重查", async () => {
    const fetcher = vi.fn<Fetcher<null, SessionItem>>().mockResolvedValue(page(["a"]));
    const profile: QueryProfile<null, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: null }),
    };
    renderHook(() => useReadOnlyQuery({ profile, fetcher }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    lifecycleEvent("connectivity", "visible", false);
    lifecycleEvent("connectivity", "visible", true);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("StrictMode 重挂载清理订阅并继续请求，旧实例不写回", async () => {
    const old = deferred<Page<SessionItem>>();
    const next = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const profile: QueryProfile<null, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: null }),
    };

    let latestItems: string[] = [];
    function Probe() {
      const { state } = useReadOnlyQuery({ profile, fetcher });
      latestItems = state.items.map((item) => item.id);
      return <div />;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(adapters[0].dispose).toHaveBeenCalledTimes(1);

    await act(async () => {
      old.resolve(page(["old"]));
    });
    expect(latestItems).toEqual([]);

    await act(async () => {
      next.resolve(page(["new"]));
    });
    expect(latestItems).toEqual(["new"]);

    unmount();
    expect(authListeners.size).toBe(0);
    expect(adapters[1].dispose).toHaveBeenCalledTimes(1);
  });

  it("卸载后迟到结果不能写回", async () => {
    const pending = deferred<Page<SessionItem>>();
    const fetcher = vi.fn<Fetcher<null, SessionItem>>().mockReturnValueOnce(pending.promise);
    const profile: QueryProfile<null, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: null }),
    };
    const { unmount } = renderHook(() => useReadOnlyQuery({ profile, fetcher }));
    unmount();
    await act(async () => pending.resolve(page(["late"])));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(authListeners.size).toBe(0);
  });
});

describe("useReadOnlyQuery 时钟与跨午夜", () => {
  let snapshot: auth.AuthSnapshot;
  let revision: number;
  let authListeners: Set<(snapshot: auth.AuthSnapshot) => void>;
  let adapters: Array<{
    snapshot: platform.WebLifecycleSnapshot;
    listeners: Set<(event: platform.WebLifecycleEvent) => void>;
    dispose: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    vi.resetAllMocks();
    revision = 1;
    snapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example", subject: "one" },
    };
    authListeners = new Set();
    adapters = [];
    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => snapshot);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => revision);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((listener) => {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    });
    vi.spyOn(platform, "createLifecycleAdapter").mockImplementation(() => {
      const state = {
        snapshot: { visibility: "visible", online: true } as platform.WebLifecycleSnapshot,
        listeners: new Set<(event: platform.WebLifecycleEvent) => void>(),
        dispose: vi.fn(),
      };
      adapters.push(state);
      state.dispose.mockImplementation(() => state.listeners.clear());
      return {
        capabilities: { webEvents: true, nativeAppState: false },
        getSnapshot: () => state.snapshot,
        subscribe: (listener: (event: platform.WebLifecycleEvent) => void) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        dispose: state.dispose,
        whenReady: () => Promise.resolve(),
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("跨午夜清旧 context 并按新 context 重查", async () => {
    vi.useFakeTimers();
    let day = "2026-11-12";
    const first = deferred<Page<SessionItem>>();
    const second = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const profile: QueryProfile<{ day: string }, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: { day } }),
      nextContextChange: () => 1000,
    };
    const { result } = renderHook(() => useReadOnlyQuery({ profile, fetcher }));
    await act(async () => {
      first.resolve(page(["a"]));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.state.items.map((i) => i.id)).toEqual(["a"]);

    day = "2026-11-13";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.state.items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(page(["b"]));
    });
    expect(result.current.state.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("离线跨午夜不请求，恢复按新 context 请求", async () => {
    vi.useFakeTimers();
    let day = "2026-11-12";
    const fetcher = vi.fn<Fetcher<{ day: string }, SessionItem>>().mockResolvedValue(page(["a"]));
    const profile: QueryProfile<{ day: string }, SessionItem> = {
      resolveContext: () => ({ eligible: true, context: { day } }),
      nextContextChange: () => 1000,
    };
    renderHook(() => useReadOnlyQuery({ profile, fetcher }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    const adapter = adapters[adapters.length - 1];
    adapter.snapshot = { visibility: "visible", online: false };
    day = "2026-11-13";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    adapter.snapshot = { visibility: "visible", online: true };
    act(() => {
      adapter.listeners.forEach((listener) =>
        listener({ type: "connectivity", snapshot: adapter.snapshot }),
      );
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.lastCall?.[0]).toEqual({ day: "2026-11-13" });
  });
});
