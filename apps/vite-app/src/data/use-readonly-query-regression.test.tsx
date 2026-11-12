import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadOnlyQuery, type UseReadOnlyQueryOptions } from "./use-readonly-query";
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
    const fetcherOne = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockReturnValueOnce(first.promise);
    const fetcherTwo = vi
      .fn<Fetcher<{ day: string }, SessionItem>>()
      .mockImplementationOnce(async (context) => page(context.day));
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
    expect(fetcherTwo).toHaveBeenCalledWith({ day: "d2" }, { cursor: null, signal: null });
    expect(fetcherOne).toHaveBeenCalledTimes(1);

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
});
