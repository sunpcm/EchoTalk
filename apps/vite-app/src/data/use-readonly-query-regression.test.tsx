import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReadOnlyQuery,
  type ReadOnlyQueryScheduler,
  type UseReadOnlyQueryOptions,
} from "./use-readonly-query";
import type { Fetcher, Page, QueryProfile } from "./readonly-query";
import * as auth from "@/lib/auth";
import * as platform from "@/platform";

interface SessionItem {
  id: string;
}

interface ProbeProps {
  day: string;
}

function page(day: string): Page<SessionItem> {
  return { items: [{ id: day }], nextCursor: null };
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

function createOptions(
  day: string,
  fetcher: Fetcher<{ day: string }, SessionItem>,
): UseReadOnlyQueryOptions<{ day: string }, SessionItem> {
  const profile: QueryProfile<{ day: string }, SessionItem> = {
    resolveContext: () => ({ eligible: true, context: { day } }),
    sameContext: (a, b) => a.day === b.day,
  };
  return { profile, fetcher };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("useReadOnlyQuery options 响应性回归", () => {
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
    vi.restoreAllMocks();
  });

  it("rerender 读取最新 profile/fetcher，语义相同不重复请求", async () => {
    const first = deferred<Page<SessionItem>>();
    const second = deferred<Page<SessionItem>>();
    const fetcherOne = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockReturnValueOnce(first.promise);
    const fetcherTwo = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockReturnValueOnce(second.promise);
    const { result, rerender, unmount } = renderHook(
      (props: ProbeProps) =>
        useReadOnlyQuery(
          props.day === "d1"
            ? createOptions(props.day, fetcherOne)
            : createOptions(props.day, fetcherTwo),
        ),
      { initialProps: { day: "d1" } },
    );

    first.resolve(page("d1"));
    await flush();
    expect(fetcherOne).toHaveBeenCalledTimes(1);
    expect(fetcherTwo).not.toHaveBeenCalled();
    expect(result.current.state.items.map((item) => item.id)).toEqual(["d1"]);

    rerender({ day: "d2" });
    await flush();
    expect(fetcherTwo).toHaveBeenCalledTimes(1);
    expect(fetcherOne).toHaveBeenCalledTimes(1);

    second.resolve(page("d2"));
    await flush();
    expect(result.current.state.items.map((item) => item.id)).toEqual(["d2"]);

    rerender({ day: "d2" });
    await flush();
    expect(fetcherTwo).toHaveBeenCalledTimes(1);
    expect(result.current.state.items.map((item) => item.id)).toEqual(["d2"]);

    unmount();
    expect(authListeners.size).toBe(0);
    expect(adapters[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("语义相同重渲染后显式 retry 使用最新 gate、fetcher 与错误分类", async () => {
    const first = deferred<Page<SessionItem>>();
    const staleRetry = deferred<Page<SessionItem>>();
    const latest = deferred<Page<SessionItem>>();
    const fetcherOne = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(staleRetry.promise);
    const fetcherTwo = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockReturnValueOnce(latest.promise);
    let gateOpen = true;
    type ClassifyError = (error: unknown) => "http" | "parse" | "network";
    const firstClassify = vi.fn<ClassifyError>(() => "parse");
    const latestClassify = vi.fn<ClassifyError>(() => "http");
    const makeOptions = (
      fetcher: Fetcher<{ day: string }, SessionItem>,
      classifyError: (error: unknown) => "http" | "parse" | "network",
    ): UseReadOnlyQueryOptions<{ day: string }, SessionItem> => ({
      profile: {
        resolveContext: () => ({ eligible: true, context: { day: "same" } }),
        sameContext: (a, b) => a.day === b.day,
        gate: () => gateOpen,
      },
      fetcher,
      classifyError,
    });
    const { result, rerender } = renderHook(
      ({ fetcher, classifyError }) => useReadOnlyQuery(makeOptions(fetcher, classifyError)),
      {
        initialProps: {
          fetcher: fetcherOne,
          classifyError: firstClassify,
        },
      },
    );

    first.resolve(page("first"));
    await flush();
    expect(fetcherOne).toHaveBeenCalledTimes(1);

    gateOpen = false;
    rerender({ fetcher: fetcherTwo, classifyError: latestClassify });
    act(() => result.current.retry());
    await flush();
    expect(fetcherTwo).not.toHaveBeenCalled();
    expect(result.current.state.paused).toBe(true);

    gateOpen = true;
    rerender({ fetcher: fetcherTwo, classifyError: latestClassify });
    act(() => result.current.retry());
    expect(fetcherTwo).toHaveBeenCalledTimes(1);

    const error = { status: 500, body: "latest-classifier-canary" };
    latest.reject(error);
    await flush();
    expect(latestClassify).toHaveBeenCalledWith(error);
    expect(firstClassify).not.toHaveBeenCalled();
    expect(result.current.state.errorKind).toBe("http");

    rerender({ fetcher: fetcherTwo, classifyError: latestClassify });
    await flush();
    expect(fetcherTwo).toHaveBeenCalledTimes(1);
  });

  it("gate options 更新立即作废在途，重开不自动请求且同义更新幂等", async () => {
    const first = deferred<Page<SessionItem>>();
    const next = deferred<Page<SessionItem>>();
    const signals: Array<AbortSignal | null> = [];
    const fetcher = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockImplementation((_context, options) => {
        signals.push(options.signal ?? null);
        return signals.length === 1 ? first.promise : next.promise;
      });
    let gateOpen = true;
    let renderCount = 0;
    const makeOptions = (): UseReadOnlyQueryOptions<{ day: string }, SessionItem> => ({
      profile: {
        resolveContext: () => ({ eligible: true, context: { day: "same" } }),
        sameContext: (a, b) => a.day === b.day,
        gate: () => gateOpen,
        abortTransport: true,
      },
      fetcher,
    });
    const { result, rerender } = renderHook(
      ({ version }: { version: number }) => {
        renderCount++;
        void version;
        return useReadOnlyQuery(makeOptions());
      },
      { initialProps: { version: 0 } },
    );
    await flush();

    expect(result.current.state.phase).toBe("loading");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    gateOpen = false;
    rerender({ version: 1 });
    await flush();
    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.state.paused).toBe(true);
    expect(result.current.state.phase).toBe("idle");
    expect(fetcher).toHaveBeenCalledTimes(1);

    gateOpen = true;
    rerender({ version: 2 });
    await flush();
    rerender({ version: 3 });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.state.paused).toBe(true);
    expect(renderCount).toBeLessThan(16);

    act(() => result.current.retry());
    expect(fetcher).toHaveBeenCalledTimes(2);
    next.resolve(page("fresh"));
    await flush();
    first.resolve(page("stale"));
    await flush();
    expect(result.current.state.items.map((item) => item.id)).toEqual(["fresh"]);
  });

  it("注入 clock/scheduler 驱动 context 检查并在卸载时清理", async () => {
    let day = "injected-d1";
    let nextTimerId = 0;
    const callbacks = new Map<number, () => void>();
    const scheduler: ReadOnlyQueryScheduler = {
      setTimeout: vi.fn((callback) => {
        const id = ++nextTimerId;
        callbacks.set(id, callback);
        return id;
      }),
      clearTimeout: vi.fn((handle) => {
        callbacks.delete(handle);
      }),
    };
    const clock = vi.fn(() => 1234);
    const nextContextChange = vi.fn(() => 5000);
    const fetcher = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockImplementation(async (context) => page(context.day));
    const { result, unmount } = renderHook(() =>
      useReadOnlyQuery({
        profile: {
          resolveContext: () => ({ eligible: true, context: { day } }),
          sameContext: (a, b) => a.day === b.day,
          nextContextChange,
        },
        fetcher,
        clock,
        scheduler,
      }),
    );
    await flush();

    expect(clock).toHaveBeenCalled();
    expect(nextContextChange).toHaveBeenLastCalledWith(1234);
    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 5000);
    expect(callbacks.size).toBe(1);

    const firstTimer = [...callbacks.keys()][0];
    const runTimer = (handle: number) => {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.();
    };
    day = "injected-d2";
    await act(async () => {
      runTimer(firstTimer);
    });
    await flush();

    expect(fetcher.mock.lastCall?.[0]).toEqual({ day: "injected-d2" });
    expect(result.current.state.items.map((item) => item.id)).toEqual(["injected-d2"]);
    expect(scheduler.clearTimeout).toHaveBeenCalled();
    expect(callbacks.size).toBe(1);

    const remainingTimer = [...callbacks.keys()][0];
    unmount();
    expect(scheduler.clearTimeout).toHaveBeenLastCalledWith(remainingTimer);
    expect(callbacks.size).toBe(0);
  });
});
