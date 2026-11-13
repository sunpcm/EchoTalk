import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as calendar from "@/lib/localDayWindow";
import * as platform from "@/platform";
import type { WebLifecycleSnapshot } from "@/platform";
import { createReadQuery } from "./readonly-query";
import type { Fetcher, Page, QueryProfile, QueryState, ReadQuerySource } from "./readonly-query";
import { useActiveSessionsQuery } from "./use-active-sessions-query";
import { useDailyProgressQuery } from "./use-daily-progress-query";
import { useWeeklyProgressQuery } from "./use-weekly-progress-query";

vi.mock("@/lib/api", () => ({
  getDailyProgress: vi.fn(),
  getWeeklyProgress: vi.fn(),
  listSessions: vi.fn(),
  listActiveSessions: vi.fn(),
}));

interface Item {
  id: string;
}

interface SourceBox {
  principal: auth.AuthPrincipal | null;
  revision: number;
  lifecycle: WebLifecycleSnapshot;
  day: string;
}

const principalOf = (subject = "one"): auth.AuthPrincipal => ({
  issuer: "https://auth.example",
  subject,
});

const visible = (): WebLifecycleSnapshot => ({ visibility: "visible", online: true });
const hidden = (): WebLifecycleSnapshot => ({ visibility: "hidden", online: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function page(ids: string[], nextCursor: string | null = null): Page<Item> {
  return { items: ids.map((id) => ({ id })), nextCursor };
}

function session(id: string): api.SessionListItem {
  return {
    id,
    mode: "free_talk",
    status: "active",
    started_at: "2026-11-13T00:00:00.000Z",
    ended_at: "2026-11-13T00:05:00.000Z",
  };
}

function makeBox(): SourceBox {
  return { principal: principalOf(), revision: 1, lifecycle: visible(), day: "2026-11-13" };
}

function makeController(options: Partial<QueryProfile<{ day: string }, Item>> = {}) {
  const box = makeBox();
  const states: QueryState<Item>[] = [];
  const profile: QueryProfile<{ day: string }, Item> = {
    resolveContext: () => ({ eligible: true, context: { day: box.day } }),
    ...options,
  };
  let fetcher: Fetcher<{ day: string }, Item> = async () => page([]);
  const source: ReadQuerySource = {
    getPrincipal: () => box.principal,
    getRevision: () => box.revision,
    getLifecycle: () => box.lifecycle,
  };
  const query = createReadQuery(
    profile,
    (context, requestOptions) => fetcher(context, requestOptions),
    source,
    (next) => states.push(next),
  );
  return {
    box,
    query,
    states,
    setFetcher(next: Fetcher<{ day: string }, Item>) {
      fetcher = next;
    },
  };
}

const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const actFlush = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

describe("F1：data 层结算与身份契约", () => {
  let snapshot: auth.AuthSnapshot;
  let revision: number;

  beforeEach(() => {
    vi.resetAllMocks();
    revision = 1;
    snapshot = { state: "authenticated", principal: principalOf() };
    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => snapshot);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => revision);
    vi.mocked(api.listActiveSessions).mockResolvedValue({ items: [], next_cursor: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("discard 仅 lifecycle 漂移仍接受结果", async () => {
    const pending = deferred<Page<Item>>();
    const fetcher = vi.fn<Fetcher<{ day: string }, Item>>().mockReturnValue(pending.promise);
    const { box, query, setFetcher } = makeController({ settlementDrift: "discard" });
    setFetcher(fetcher);

    query.refresh();
    box.lifecycle = hidden();
    pending.resolve(page(["accepted"]));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(query.getState().phase).toBe("ready");
    expect(query.getState().items.map((item) => item.id)).toEqual(["accepted"]);
    expect(query.getState().paused).toBe(false);
  });

  it("discard 仅 context 漂移仍接受结果", async () => {
    const pending = deferred<Page<Item>>();
    const fetcher = vi.fn<Fetcher<{ day: string }, Item>>().mockReturnValue(pending.promise);
    const { box, query, setFetcher } = makeController({ settlementDrift: "discard" });
    setFetcher(fetcher);

    query.refresh();
    box.day = "2026-11-14";
    pending.resolve(page(["accepted"]));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(query.getState().phase).toBe("ready");
    expect(query.getState().items.map((item) => item.id)).toEqual(["accepted"]);
  });

  it("revalidate 仅 lifecycle 漂移时丢弃结果", async () => {
    const pending = deferred<Page<Item>>();
    const fetcher = vi.fn<Fetcher<{ day: string }, Item>>().mockReturnValue(pending.promise);
    const { box, query, setFetcher } = makeController();
    setFetcher(fetcher);

    query.refresh();
    box.lifecycle = hidden();
    pending.resolve(page(["discarded"]));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(query.getState().items).toEqual([]);
    expect(query.getState().paused).toBe(true);
  });

  it("revalidate 仅 context 漂移时丢弃结果", async () => {
    const stale = deferred<Page<Item>>();
    const next = deferred<Page<Item>>();
    const fetcher = vi
      .fn<Fetcher<{ day: string }, Item>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(next.promise);
    const { box, query, setFetcher } = makeController();
    setFetcher(fetcher);

    query.refresh();
    box.day = "2026-11-14";
    stale.resolve(page(["discarded"]));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(query.getState().items).toEqual([]);
  });

  it("settlementDrift=discard 仍拒绝身份、revision 与 seq 漂移", async () => {
    const identityPending = deferred<Page<Item>>();
    const revisionPending = deferred<Page<Item>>();
    const sequencePending = deferred<Page<Item>>();
    const identity = makeController({ settlementDrift: "discard" });
    const revisionCase = makeController({ settlementDrift: "discard" });
    const sequence = makeController({ settlementDrift: "discard" });
    identity.setFetcher(vi.fn().mockReturnValue(identityPending.promise));
    revisionCase.setFetcher(vi.fn().mockReturnValue(revisionPending.promise));
    sequence.setFetcher(vi.fn().mockReturnValue(sequencePending.promise));

    identity.query.refresh();
    identity.box.principal = principalOf("two");
    identityPending.resolve(page(["identity-drift"]));
    await flush();
    expect(identity.query.getState().items).toEqual([]);

    revisionCase.query.refresh();
    revisionCase.box.revision = 2;
    revisionPending.resolve(page(["revision-drift"]));
    await flush();
    expect(revisionCase.query.getState().items).toEqual([]);

    sequence.query.refresh();
    sequence.query.cancel();
    sequencePending.resolve(page(["sequence-drift"]));
    await flush();
    expect(sequence.query.getState().items).toEqual([]);
    expect(sequence.query.getState().phase).toBe("idle");
  });

  async function startMore(profile?: Partial<QueryProfile<{ day: string }, Item>>) {
    const first = deferred<Page<Item>>();
    const fetcher = vi.fn<Fetcher<{ day: string }, Item>>();
    const { box, query, setFetcher } = makeController(profile);
    setFetcher(fetcher);
    fetcher.mockReturnValueOnce(first.promise);
    query.refresh();
    first.resolve(page(["a"], "cursor-1"));
    await flush();
    return { box, query, fetcher };
  }

  it("discard more 仅 lifecycle 漂移仍接受结果", async () => {
    const { box, query, fetcher } = await startMore({ settlementDrift: "discard" });
    const more = deferred<Page<Item>>();
    fetcher.mockReturnValueOnce(more.promise);

    query.loadMore();
    box.lifecycle = hidden();
    more.resolve(page(["b"], "cursor-2"));
    await flush();

    expect(query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(query.getState().cursor).toBe("cursor-2");
    expect(query.getState().more).toBe("ready");
  });

  it("discard more 仅 context 漂移仍接受结果", async () => {
    const { box, query, fetcher } = await startMore({ settlementDrift: "discard" });
    const more = deferred<Page<Item>>();
    fetcher.mockReturnValueOnce(more.promise);

    query.loadMore();
    box.day = "2026-11-14";
    more.resolve(page(["b"], "cursor-2"));
    await flush();

    expect(query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(query.getState().cursor).toBe("cursor-2");
    expect(query.getState().more).toBe("ready");
  });

  it("revalidate more 仅 lifecycle 漂移时丢弃结果", async () => {
    const { box, query, fetcher } = await startMore();
    const more = deferred<Page<Item>>();
    fetcher.mockReturnValueOnce(more.promise);

    query.loadMore();
    box.lifecycle = hidden();
    more.resolve(page(["b"], "cursor-2"));
    await flush();

    expect(query.getState().items.map((item) => item.id)).not.toContain("b");
    expect(query.getState().paused).toBe(true);
  });

  it("revalidate more 仅 context 漂移时丢弃结果", async () => {
    const { box, query, fetcher } = await startMore();
    const more = deferred<Page<Item>>();
    const nextPrimary = deferred<Page<Item>>();
    fetcher.mockReturnValueOnce(more.promise).mockReturnValueOnce(nextPrimary.promise);

    query.loadMore();
    box.day = "2026-11-14";
    more.resolve(page(["b"], "cursor-2"));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(query.getState().items.map((item) => item.id)).not.toContain("b");
  });

  it("discard more 仍拒绝身份、revision 与 seq 漂移", async () => {
    const identity = await startMore({ settlementDrift: "discard" });
    const identityMore = deferred<Page<Item>>();
    identity.fetcher.mockReturnValueOnce(identityMore.promise);
    identity.query.loadMore();
    identity.box.principal = principalOf("two");
    identityMore.resolve(page(["b"], "cursor-2"));
    await flush();
    expect(identity.query.getState().items.map((item) => item.id)).toEqual(["a"]);
    expect(identity.query.getState().cursor).toBe("cursor-1");

    const revisionCase = await startMore({ settlementDrift: "discard" });
    const revisionMore = deferred<Page<Item>>();
    revisionCase.fetcher.mockReturnValueOnce(revisionMore.promise);
    revisionCase.query.loadMore();
    revisionCase.box.revision = 2;
    revisionMore.resolve(page(["b"], "cursor-2"));
    await flush();
    expect(revisionCase.query.getState().items.map((item) => item.id)).toEqual(["a"]);
    expect(revisionCase.query.getState().cursor).toBe("cursor-1");

    const sequence = await startMore({ settlementDrift: "discard" });
    const sequenceMore = deferred<Page<Item>>();
    sequence.fetcher.mockReturnValueOnce(sequenceMore.promise);
    sequence.query.loadMore();
    sequence.query.cancel();
    sequenceMore.resolve(page(["b"], "cursor-2"));
    await flush();
    expect(sequence.query.getState().items.map((item) => item.id)).toEqual(["a"]);
    expect(sequence.query.getState().cursor).toBe("cursor-1");
  });

  it("AS queriedIdentity 仅首屏成功提交，取消与 more 成功都不提交", async () => {
    const primary = deferred<api.SessionListResponse>();
    const canceledPrimary = deferred<api.SessionListResponse>();
    vi.mocked(api.listActiveSessions)
      .mockReturnValueOnce(primary.promise)
      .mockResolvedValueOnce({ items: [session("more-1")], next_cursor: null })
      .mockReturnValueOnce(canceledPrimary.promise);
    const { result } = renderHook(() =>
      useActiveSessionsQuery({ getLifecycle: visible, isWriteBlocked: () => false }),
    );

    act(() => result.current.fetchActiveSessions());
    expect(result.current.queriedIdentity).toBeNull();
    await act(async () => {
      primary.resolve({ items: [session("primary-1")], next_cursor: "cursor-1" });
      await Promise.resolve();
    });
    expect(result.current.queriedIdentity).toEqual({ principal: principalOf(), revision: 1 });

    act(() => result.current.resetForAuthChange());
    expect(result.current.queriedIdentity).toBeNull();
    act(() => result.current.loadMore());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.sessions.map((item) => item.id)).toEqual(["primary-1", "more-1"]);
    expect(result.current.queriedIdentity).toBeNull();

    act(() => result.current.fetchActiveSessions());
    act(() => result.current.cancelInFlightRequests());
    await act(async () => {
      canceledPrimary.resolve({ items: [session("late")], next_cursor: "cursor-late" });
      await Promise.resolve();
    });
    expect(result.current.queriedIdentity).toBeNull();
    expect(result.current.sessions.map((item) => item.id)).toEqual(["primary-1", "more-1"]);
    expect(result.current.nextCursor).toBeNull();
  });
});

describe("F1：data 层 cursor 首页清空与取消", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clearCursorOnFirstPage 首页开始清 cursor，失败后仍为空且 loadMore 不发请求", async () => {
    const first = deferred<Page<Item>>();
    const second = deferred<Page<Item>>();
    const fetcher = vi
      .fn<Fetcher<{ day: string }, Item>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { query, setFetcher } = makeController({ clearCursorOnFirstPage: true });
    setFetcher(fetcher);

    query.refresh();
    first.resolve(page(["a"], "cursor-1"));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(query.getState().cursor).toBe("cursor-1");

    query.refresh();
    expect(query.getState().cursor).toBeNull();
    second.reject(new Error("boom"));
    await flush();
    expect(query.getState().phase).toBe("error");
    expect(query.getState().cursor).toBeNull();

    const callsBefore = fetcher.mock.calls.length;
    query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(callsBefore);
  });

  it("clearCursorOnFirstPage 取消后 cursor 仍为空且 loadMore 不发请求", async () => {
    const first = deferred<Page<Item>>();
    const second = deferred<Page<Item>>();
    const fetcher = vi
      .fn<Fetcher<{ day: string }, Item>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { query, setFetcher } = makeController({ clearCursorOnFirstPage: true });
    setFetcher(fetcher);

    query.refresh();
    first.resolve(page(["a"], "cursor-1"));
    await flush();
    query.refresh();
    expect(query.getState().cursor).toBeNull();
    query.cancel();
    expect(query.getState().cursor).toBeNull();
    expect(query.getState().items.map((item) => item.id)).toEqual(["a"]);

    const callsBefore = fetcher.mock.calls.length;
    query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(callsBefore);
  });

  it("cancel more 保留 cursor 且可用同一 cursor 重试，迟到结果不写回", async () => {
    const first = deferred<Page<Item>>();
    const more1 = deferred<Page<Item>>();
    const more2 = deferred<Page<Item>>();
    const fetcher = vi
      .fn<Fetcher<{ day: string }, Item>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(more1.promise)
      .mockReturnValueOnce(more2.promise);
    const { query, setFetcher } = makeController({ clearCursorOnFirstPage: true });
    setFetcher(fetcher);

    query.refresh();
    first.resolve(page(["a"], "cursor-1"));
    await flush();

    query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]).toEqual({ signal: null, cursor: "cursor-1" });
    expect(query.getState().cursor).toBe("cursor-1");

    query.cancel();
    expect(query.getState().more).toBe("idle");
    expect(query.getState().cursor).toBe("cursor-1");

    query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][1]).toEqual({ signal: null, cursor: "cursor-1" });

    more1.resolve(page(["late"], "cursor-2"));
    await flush();
    expect(query.getState().items.map((item) => item.id)).toEqual(["a"]);

    more2.resolve(page(["b"], "cursor-2"));
    await flush();
    expect(query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(query.getState().cursor).toBe("cursor-2");
  });

  it("cancel primary 保留 items 且迟到结果不写回", async () => {
    const first = deferred<Page<Item>>();
    const second = deferred<Page<Item>>();
    const fetcher = vi
      .fn<Fetcher<{ day: string }, Item>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { query, setFetcher } = makeController();
    setFetcher(fetcher);

    query.refresh();
    first.resolve(page(["a"]));
    await flush();
    expect(query.getState().items.map((item) => item.id)).toEqual(["a"]);

    query.refresh();
    expect(query.getState().phase).toBe("loading");
    query.cancel();
    expect(query.getState().items.map((item) => item.id)).toEqual(["a"]);
    expect(query.getState().phase).toBe("ready");

    second.resolve(page(["late"]));
    await flush();
    expect(query.getState().items.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("F1：data 层真实 DP profile", () => {
  let snapshot: auth.AuthSnapshot;
  let revision: number;
  let authListeners: Set<(snapshot: auth.AuthSnapshot) => void>;
  let adapters: Array<{
    snapshot: platform.WebLifecycleSnapshot;
    listeners: Set<(event: platform.WebLifecycleEvent) => void>;
    dispose: ReturnType<typeof vi.fn>;
  }>;

  const sessionItem = (id: string): api.SessionListItem => ({
    id,
    mode: "free_talk",
    status: "completed",
    started_at: "2026-11-13T10:00:00Z",
    ended_at: "2026-11-13T10:05:00Z",
  });

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
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
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

  it("真实 DP profile concurrent=override 最新覆盖，旧迟到结果不写回", async () => {
    const firstSessions = deferred<api.SessionListResponse>();
    const secondSessions = deferred<api.SessionListResponse>();
    vi.mocked(api.getDailyProgress).mockResolvedValue({ completed_sessions: 1, total_turns: 10 });
    vi.mocked(api.listSessions)
      .mockReturnValueOnce(firstSessions.promise)
      .mockReturnValueOnce(secondSessions.promise);
    const { result } = renderHook(() => useDailyProgressQuery());

    expect(api.listSessions).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    expect(api.listSessions).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondSessions.resolve({ items: [sessionItem("new")], next_cursor: null });
      await Promise.resolve();
    });
    expect(result.current.sessions.map((item) => item.id)).toEqual(["new"]);

    await act(async () => {
      firstSessions.resolve({ items: [sessionItem("old")], next_cursor: null });
      await Promise.resolve();
    });
    expect(result.current.sessions.map((item) => item.id)).toEqual(["new"]);
  });

  it("真实 DP profile 午夜 timer 在 window end+100ms 触发，+99ms 未触发", async () => {
    vi.useFakeTimers();
    const nowMs = Date.parse("2026-11-13T10:00:00.000Z");
    vi.setSystemTime(nowMs);
    const window = calendar.getLocalDayWindow();
    const delay = window.localEndDate.getTime() - Date.now();

    vi.mocked(api.getDailyProgress).mockResolvedValue({ completed_sessions: 0, total_turns: 0 });
    vi.mocked(api.listSessions).mockResolvedValue({ items: [], next_cursor: null });

    renderHook(() => useDailyProgressQuery());
    expect(api.listSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay + 99);
    });
    expect(api.listSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.listSessions).toHaveBeenCalledTimes(2);
  });
});

describe("F1：data 层真实 WP profile 大小写去重", () => {
  const context = { endDate: "2026-11-13", timezone: "UTC" };
  let snapshot: auth.AuthSnapshot;
  let revision: number;
  let authListeners: Set<(snapshot: auth.AuthSnapshot) => void>;
  let adapters: Array<{
    snapshot: platform.WebLifecycleSnapshot;
    listeners: Set<(event: platform.WebLifecycleEvent) => void>;
    dispose: ReturnType<typeof vi.fn>;
  }>;

  const week = (): api.WeeklyProgressResponse => ({
    days: calendar.getZonedWeekWindows(context.endDate, context.timezone).map((day) => ({
      ...day,
      completed_sessions: 0,
    })),
  });

  const sessionById = (id: string): api.SessionListItem => ({
    id,
    mode: "free_talk",
    status: "completed",
    started_at: "2026-11-13T10:00:00Z",
    ended_at: "2026-11-13T10:05:00Z",
  });

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
    vi.spyOn(calendar, "getLocalWeekContext").mockImplementation(() => ({ ...context }));
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
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(week());
    vi.mocked(api.listSessions).mockResolvedValue({ items: [], next_cursor: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("history 分页按大小写不敏感 ID 去重", async () => {
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce({ items: [sessionById("session-A")], next_cursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [sessionById("session-a")], next_cursor: null });
    const { result } = renderHook(() => useWeeklyProgressQuery());
    await actFlush();
    expect(result.current.items.map((item) => item.id)).toEqual(["session-A"]);
    expect(result.current.cursor).toBe("cursor-1");

    act(() => result.current.moreRetry());
    await actFlush();
    expect(result.current.items.map((item) => item.id)).toEqual(["session-A"]);
    expect(result.current.cursor).toBeNull();
  });
});
