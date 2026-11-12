import { describe, expect, it, vi } from "vitest";
import { createReadQuery } from "./readonly-query";
import type {
  Fetcher,
  Page,
  PagePolicy,
  QueryProfile,
  QueryState,
  ReadErrorKind,
  ReadQuerySource,
} from "./readonly-query";
import type { AuthPrincipal } from "@/lib/auth";
import type { WebLifecycleSnapshot } from "@/platform";

interface SessionItem {
  id: string;
}

const principalOf = (subject = "one"): AuthPrincipal => ({
  issuer: "https://auth.example",
  subject,
});

const visibleLifecycle = (): WebLifecycleSnapshot => ({ visibility: "visible", online: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function pages(items: string[], cursor: string | null = null): Page<SessionItem> {
  return {
    items: items.map((id) => ({ id })),
    nextCursor: cursor,
  };
}

interface QuerySourceFixture {
  principal: AuthPrincipal | null;
  revision: number;
  lifecycle: WebLifecycleSnapshot;
  classifyError?: (error: unknown) => ReadErrorKind;
}

function makeQueryHarness<C, D>(
  profile: QueryProfile<C, D>,
  fetcher: Fetcher<C, D>,
  source: QuerySourceFixture,
) {
  const states: QueryState<D>[] = [];
  const querySource: ReadQuerySource = {
    getPrincipal: () => source.principal,
    getRevision: () => source.revision,
    getLifecycle: () => source.lifecycle,
    ...(source.classifyError ? { classifyError: source.classifyError } : {}),
  };
  const query = createReadQuery(profile, fetcher, querySource, (next) => states.push(next));
  return { query, states };
}

function makeQuery<C, D extends { id: string }>(
  profile: QueryProfile<C, D>,
  fetcher: Fetcher<C, D>,
  source: QuerySourceFixture,
) {
  return makeQueryHarness(
    {
      ...profile,
      page: {
        keyOf: (item) => item.id,
        ...profile.page,
      },
    },
    fetcher,
    source,
  );
}

function makeQueryWithPage<C, D>(
  profile: QueryProfile<C, D> & { page: PagePolicy<C, D> },
  fetcher: Fetcher<C, D>,
  source: QuerySourceFixture,
) {
  return makeQueryHarness(profile, fetcher, source);
}

describe("readonly-query origin 与分页回归", () => {
  it("认证 origin 变化清空 tombstone，新账号或 revision 的同 ID 不被误删", async () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValueOnce(pages(["shared"], null))
      .mockResolvedValueOnce(pages(["shared", "other"], null))
      .mockResolvedValueOnce(pages(["shared", "revision"], null));
    let principal = principalOf();
    let revision = 1;
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        get principal() {
          return principal;
        },
        get revision() {
          return revision;
        },
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    await flush();
    query.query.removeItem("shared");
    expect(query.query.getState().items).toEqual([]);

    principal = principalOf("two");
    query.query.reconcile();
    query.query.refresh();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["shared", "other"]);

    query.query.removeItem("shared");
    revision = 2;
    query.query.reconcile();
    query.query.refresh();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["shared", "revision"]);
  });

  it("首页 refresh 作废旧 more，且不释放 more 槽位", async () => {
    const first = deferred<Page<SessionItem>>();
    const oldMore = deferred<Page<SessionItem>>();
    const fresh = deferred<Page<SessionItem>>();
    const newMore = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(oldMore.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockReturnValueOnce(newMore.promise);
    const query = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        resetOnFirstPage: true,
      },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    first.resolve(pages(["a"], "c1"));
    await flush();
    query.query.loadMore();
    query.query.refresh();
    fresh.resolve(pages(["fresh"], "c2"));
    await flush();

    query.query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(4);

    oldMore.resolve(pages(["stale"], "c3"));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["fresh"]);
    expect(query.query.getState().cursor).toBe("c2");
    expect(query.query.getState().more).toBe("loading");

    newMore.resolve(pages(["next"], null));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["fresh", "next"]);
    expect(query.query.getState().cursor).toBeNull();
    expect(query.query.getState().more).toBe("ready");
  });

  it("首页 refresh 后旧 more 的 error/finally 不污染或释放新轮", async () => {
    const first = deferred<Page<SessionItem>>();
    const oldMore = deferred<Page<SessionItem>>();
    const fresh = deferred<Page<SessionItem>>();
    const newMore = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(oldMore.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockReturnValueOnce(newMore.promise);
    const query = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        resetOnFirstPage: true,
      },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    first.resolve(pages(["a"], "c1"));
    await flush();
    query.query.loadMore();
    query.query.refresh();
    fresh.resolve(pages(["fresh"], "c2"));
    await flush();
    query.query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(4);

    oldMore.reject(new Error("old-more-error-canary"));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["fresh"]);
    expect(query.query.getState().cursor).toBe("c2");
    expect(query.query.getState().more).toBe("loading");
    expect(query.query.getState().moreErrorKind).toBeNull();
    expect(JSON.stringify(query.query.getState())).not.toContain("old-more-error-canary");

    query.query.loadMore();
    expect(fetcher).toHaveBeenCalledTimes(4);

    newMore.resolve(pages(["next"], null));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["fresh", "next"]);
    expect(query.query.getState().cursor).toBeNull();
    expect(query.query.getState().more).toBe("ready");
  });

  it("首页 refresh 清空已消费 cursor，同一 cursor 可重新合法使用", async () => {
    const fetcher = vi.fn<Fetcher<null, SessionItem>>().mockImplementation((_context, options) => {
      if (options.cursor === null) return Promise.resolve(pages(["a"], "c1"));
      if (options.cursor === "c1") return Promise.resolve(pages(["b"], "c2"));
      if (options.cursor === "c2") return Promise.resolve(pages(["c"], null));
      return Promise.resolve(pages(["unexpected"], "unexpected"));
    });
    const query = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        resetOnFirstPage: true,
        page: {
          keyOf: (item) => item.id,
          detectRepeatedCursor: true,
        },
      },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    await flush();
    query.query.loadMore();
    await flush();
    query.query.loadMore();
    await flush();
    expect(query.query.getState().cursor).toBeNull();

    query.query.refresh();
    await flush();
    query.query.loadMore();
    await flush();

    expect(query.query.getState().more).toBe("ready");
    expect(query.query.getState().cursor).toBe("c2");
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("readonly-query gate 与业务组合回归", () => {
  it("业务 gate 关闭作废首屏在途，重开 retry 不等旧请求", async () => {
    const old = deferred<Page<SessionItem>>();
    const next = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    let allowed = true;
    const query = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        gate: () => allowed,
      },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    expect(query.query.getState().phase).toBe("loading");

    allowed = false;
    query.query.refresh();
    expect(query.query.getState().paused).toBe(true);
    expect(query.query.getState().phase).toBe("idle");
    expect(query.query.getState().errorKind).toBeNull();

    allowed = true;
    query.query.retry();
    expect(fetcher).toHaveBeenCalledTimes(2);

    next.resolve(pages(["new"], null));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["new"]);

    old.resolve(pages(["old"], null));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["new"]);
  });

  it("WP weekly 成功后加载 history，且两个阶段错误互不串写", async () => {
    const weeklyReady = deferred<Page<SessionItem>>();
    const historyError = deferred<Page<SessionItem>>();
    const weeklyError = deferred<Page<SessionItem>>();
    const historyFetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(historyError.promise);
    const weeklyStates: QueryState<SessionItem>[] = [];
    const historyStates: QueryState<SessionItem>[] = [];
    const sourceState = {
      principal: principalOf(),
      revision: 1,
      lifecycle: visibleLifecycle(),
    };
    const source: ReadQuerySource = {
      getPrincipal: () => sourceState.principal,
      getRevision: () => sourceState.revision,
      getLifecycle: () => sourceState.lifecycle,
    };
    let historyStarted = false;
    const historyQuery = createReadQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        concurrent: "ignore",
      },
      historyFetcher,
      source,
      (next) => historyStates.push(next),
    );
    const weeklyFetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(weeklyReady.promise)
      .mockReturnValueOnce(weeklyError.promise);
    const weeklyQuery = createReadQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        concurrent: "ignore",
      },
      weeklyFetcher,
      source,
      (next) => {
        weeklyStates.push(next);
        if (next.phase === "ready" && !historyStarted) {
          historyStarted = true;
          historyQuery.refresh();
        }
      },
    );

    weeklyQuery.refresh();
    expect(historyFetcher).not.toHaveBeenCalled();
    weeklyReady.resolve(pages(["weekly"], "c1"));
    await flush();
    expect(weeklyQuery.getState().phase).toBe("ready");
    expect(historyFetcher).toHaveBeenCalledTimes(1);

    historyError.reject(new Error("history-body-canary"));
    await flush();
    expect(historyQuery.getState().phase).toBe("error");
    expect(weeklyQuery.getState().phase).toBe("ready");
    expect(weeklyQuery.getState().errorKind).toBeNull();

    weeklyQuery.refresh();
    weeklyError.reject(new Error("weekly-body-canary"));
    await flush();
    expect(weeklyQuery.getState().phase).toBe("error");
    expect(historyQuery.getState().phase).toBe("error");
  });

  it("DP 并行首屏 all-or-nothing，单路失败不写部分结果", async () => {
    const stats = deferred<string>();
    const list = deferred<Page<SessionItem>>();
    const fetcher = vi.fn<Fetcher<null, { stats: string; items: string[] }>>(() => {
      return Promise.all([stats.promise, list.promise]).then(([statsValue, page]) => ({
        items: [{ stats: statsValue, items: page.items.map((item) => item.id) }],
        nextCursor: null,
      }));
    });
    const query = makeQueryWithPage(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        page: { keyOf: (item) => item.stats },
      },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    stats.resolve("ok");
    list.reject(new Error("partial-body-canary"));
    await flush();

    expect(query.query.getState().phase).toBe("error");
    expect(query.query.getState().items).toEqual([]);
    expect(JSON.stringify(query.query.getState())).not.toContain("partial-body-canary");

    const successfulFetcher = vi.fn<Fetcher<null, { stats: string; items: string[] }>>(() =>
      Promise.all([Promise.resolve("ready"), Promise.resolve(pages(["a", "b"]))]).then(
        ([statsValue, page]) => ({
          items: [{ stats: statsValue, items: page.items.map((item) => item.id) }],
          nextCursor: null,
        }),
      ),
    );
    const successfulQuery = makeQueryWithPage(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        page: { keyOf: (item) => item.stats },
      },
      successfulFetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    successfulQuery.query.refresh();
    await flush();

    expect(successfulQuery.query.getState()).toMatchObject({
      phase: "ready",
      items: [{ stats: "ready", items: ["a", "b"] }],
      cursor: null,
      errorKind: null,
    });
  });

  it("AS mutation gate 同时拦 list 与 more，挂起不释放 mutation", async () => {
    const first = deferred<Page<SessionItem>>();
    const listRetry = deferred<Page<SessionItem>>();
    const more = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(listRetry.promise)
      .mockReturnValueOnce(more.promise);
    const mutations = {
      isStarting: false,
      end: false,
      resume: false,
    };
    const query = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        gate: () => !mutations.isStarting && !mutations.end && !mutations.resume,
        concurrent: "ignore",
      },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    first.resolve(pages(["session"], "cursor"));
    await flush();

    for (const mutation of ["isStarting", "end", "resume"] as const) {
      mutations[mutation] = true;
      query.query.refresh();
      query.query.loadMore();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(query.query.getState().errorKind).toBeNull();
      mutations[mutation] = false;
    }

    mutations.end = true;
    query.query.suspend();
    expect(mutations.end).toBe(true);
    query.query.resume();
    expect(fetcher).toHaveBeenCalledTimes(1);

    mutations.end = false;
    query.query.retry();
    expect(fetcher).toHaveBeenCalledTimes(2);
    listRetry.resolve(pages(["retry"], "cursor-2"));
    await flush();

    query.query.loadMore();
    more.resolve(pages(["more"], null));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["retry", "more"]);
    expect(query.query.getState().cursor).toBeNull();
  });
});

describe("readonly-query 认证代际与错误安全回归", () => {
  it("旧 401 不影响新 revision，新请求可先于旧请求完成", async () => {
    const old = deferred<Page<SessionItem>>();
    const next = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    let revision = 1;
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        get revision() {
          return revision;
        },
        principal: principalOf(),
        lifecycle: visibleLifecycle(),
      },
    );

    query.query.refresh();
    revision = 2;
    query.query.reconcile();
    query.query.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);

    old.reject({
      status: 401,
      body: "old-401-body-canary",
      message: "old-401-message-canary",
    });
    await flush();
    expect(query.query.getState().phase).toBe("loading");
    expect(query.query.getState().errorKind).toBeNull();

    next.resolve(pages(["new"], null));
    await flush();
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["new"]);
    expect(JSON.stringify(query.query.getState())).not.toContain("401-body-canary");
    expect(JSON.stringify(query.query.getState())).not.toContain("401-message-canary");
  });

  it("错误分类收到完整 body/message canary，但状态不透出正文", async () => {
    const thrownError = {
      status: 500,
      body: "secret-body-canary",
      message: "secret-message-canary",
    };
    const classified: unknown[] = [];
    const classifyError = (error: unknown): ReadErrorKind => {
      classified.push(error);
      return "http";
    };
    const fetcher = vi.fn<Fetcher<null, SessionItem>>(async () => {
      throw thrownError;
    });
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
        classifyError,
      },
    );

    query.query.refresh();
    await flush();

    expect(classified).toEqual([thrownError]);
    expect(query.query.getState().phase).toBe("error");
    expect(query.query.getState().errorKind).toBe("http");
    expect(JSON.stringify(query.query.getState())).not.toContain("secret-body-canary");
    expect(JSON.stringify(query.query.getState())).not.toContain("secret-message-canary");
  });
});

describe("readonly-query 同步回调与传输代际 R2 回归", () => {
  it("fetcher 同步抛 TypeError 时安全分类并允许 retry", async () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockImplementationOnce(() => {
        throw new TypeError("sync-network-canary");
      })
      .mockResolvedValueOnce(pages(["retry"], null));
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
      },
    );

    expect(() => query.query.refresh()).not.toThrow();
    await flush();
    expect(query.query.getState()).toMatchObject({
      phase: "error",
      errorKind: "network",
    });
    expect(JSON.stringify(query.query.getState())).not.toContain("sync-network-canary");

    query.query.retry();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(query.query.getState()).toMatchObject({
      phase: "ready",
      items: [{ id: "retry" }],
      errorKind: null,
    });
  });

  it("primary loading 通知内同步 dispose 后不得发起 fetch", () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValueOnce(pages(["unexpected"], null));
    const states: QueryState<SessionItem>[] = [];
    const source: ReadQuerySource = {
      getPrincipal: () => principalOf(),
      getRevision: () => 1,
      getLifecycle: () => visibleLifecycle(),
    };

    const query = createReadQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      source,
      (next) => {
        states.push(next);
        if (next.phase === "loading") query.dispose();
      },
    );
    query.refresh();

    expect(states.some((next) => next.phase === "loading")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("more loading 通知内同步 dispose 后不得发起 more fetch", async () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockImplementation(async (_context, options) =>
        options.cursor ? pages(["more"], null) : pages(["first"], "c1"),
      );
    const states: QueryState<SessionItem>[] = [];
    const source: ReadQuerySource = {
      getPrincipal: () => principalOf(),
      getRevision: () => 1,
      getLifecycle: () => visibleLifecycle(),
    };

    const query = createReadQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      source,
      (next) => {
        states.push(next);
        if (next.more === "loading") query.dispose();
      },
    );
    query.refresh();
    await flush();
    expect(query.getState().cursor).toBe("c1");

    query.loadMore();
    expect(states.some((next) => next.more === "loading")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("primary loading 通知同步切换 principal/revision 时只发新 origin 一次", async () => {
    let principal = principalOf();
    let revision = 1;
    let context = "old-context";
    const fetcher = vi
      .fn<Fetcher<string, SessionItem>>()
      .mockImplementation(async (nextContext) => pages([nextContext], null));
    const source: ReadQuerySource = {
      getPrincipal: () => principal,
      getRevision: () => revision,
      getLifecycle: () => visibleLifecycle(),
    };
    const query = createReadQuery(
      { resolveContext: () => ({ eligible: true, context }) },
      fetcher,
      source,
      (next) => {
        if (next.phase === "loading" && context === "old-context") {
          principal = principalOf("two");
          revision = 2;
          context = "new-context";
        }
      },
    );

    query.refresh();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("new-context", expect.objectContaining({ cursor: null }));
    expect(query.getState().items.map((item) => item.id)).toEqual(["new-context"]);
  });

  it("override 在 abort 旧 primary 后若监听器同步 dispose，不得继续发布或发起新传输", async () => {
    const oldRequest = deferred<Page<SessionItem>>();
    const newRequest = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const states: QueryState<SessionItem>[] = [];
    const source: ReadQuerySource = {
      getPrincipal: () => principalOf(),
      getRevision: () => 1,
      getLifecycle: () => visibleLifecycle(),
    };

    const query = createReadQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        abortTransport: true,
        concurrent: "override",
      },
      fetcher,
      source,
      (next) => states.push(next),
    );
    query.refresh();
    const oldSignal = fetcher.mock.calls[0][1].signal;
    expect(oldSignal).not.toBeNull();
    const stateCount = states.length;
    oldSignal?.addEventListener("abort", () => query.dispose(), { once: true });

    query.refresh();
    expect(oldSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(states.length).toBe(stateCount);

    oldRequest.resolve(pages(["old"], null));
    await flush();
    expect(query.getState().phase).toBe("loading");
    expect(states.length).toBe(stateCount);
  });

  it("refresh abort 旧 more 后若监听器同步 dispose，不得继续发布或发起新 primary", async () => {
    const first = deferred<Page<SessionItem>>();
    const more = deferred<Page<SessionItem>>();
    const fresh = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(more.promise)
      .mockReturnValueOnce(fresh.promise);
    const states: QueryState<SessionItem>[] = [];
    const source: ReadQuerySource = {
      getPrincipal: () => principalOf(),
      getRevision: () => 1,
      getLifecycle: () => visibleLifecycle(),
    };

    const query = createReadQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        abortTransport: true,
        resetOnFirstPage: true,
      },
      fetcher,
      source,
      (next) => states.push(next),
    );
    query.refresh();
    first.resolve(pages(["first"], "c1"));
    await flush();
    query.loadMore();
    const moreSignal = fetcher.mock.calls[1][1].signal;
    expect(moreSignal).not.toBeNull();
    const stateCount = states.length;
    moreSignal?.addEventListener("abort", () => query.dispose(), { once: true });

    query.refresh();
    expect(moreSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(states.length).toBe(stateCount);

    more.resolve(pages(["old-more"], null));
    fresh.resolve(pages(["fresh"], null));
    await flush();
    expect(states.length).toBe(stateCount);
  });
});

describe("readonly-query 未配置 page 的默认键回归", () => {
  interface UnkeyedItem {
    label: string;
  }

  const source = (): ReadQuerySource => ({
    getPrincipal: () => principalOf(),
    getRevision: () => 1,
    getLifecycle: () => visibleLifecycle(),
  });

  it("未配置 page 时首屏完整保留三个对象", async () => {
    const firstPage: UnkeyedItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];
    const fetcher = vi
      .fn<Fetcher<null, UnkeyedItem>>()
      .mockResolvedValue({ items: firstPage, nextCursor: null });
    const query = createReadQuery<null, UnkeyedItem>(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      source(),
      () => undefined,
    );

    query.refresh();
    await flush();

    expect(query.getState().items).toEqual(firstPage);
  });

  it("未配置 page 时更多页对象完整追加且不被任意去重", async () => {
    const firstPage: UnkeyedItem[] = [{ label: "first" }];
    const morePage: UnkeyedItem[] = [{ label: "second" }, { label: "third" }];
    const fetcher = vi
      .fn<Fetcher<null, UnkeyedItem>>()
      .mockImplementation(async (_context, options) =>
        options.cursor === null
          ? { items: firstPage, nextCursor: "next" }
          : { items: morePage, nextCursor: null },
      );
    const query = createReadQuery<null, UnkeyedItem>(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      source(),
      () => undefined,
    );

    query.refresh();
    await flush();
    query.loadMore();
    await flush();

    expect(query.getState().items).toEqual([...firstPage, ...morePage]);
    expect(query.getState().cursor).toBeNull();
  });

  it("未配置 page 时 removeItem 不得以对象字符串误删无键对象", async () => {
    const item: UnkeyedItem = { label: "unkeyed" };
    const fetcher = vi
      .fn<Fetcher<null, UnkeyedItem>>()
      .mockResolvedValue({ items: [item], nextCursor: null });
    const query = createReadQuery<null, UnkeyedItem>(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      source(),
      () => undefined,
    );

    query.refresh();
    await flush();
    expect(query.getState().items).toEqual([item]);

    query.removeItem(String(item));
    expect(query.getState().items).toEqual([item]);
  });
});
