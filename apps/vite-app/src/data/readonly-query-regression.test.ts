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
  it("换号重置清空 tombstone，新账号同 ID 不被误删", async () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValueOnce(pages(["shared"], null))
      .mockResolvedValueOnce(pages(["shared", "other"], null));
    let principal = principalOf();
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        get principal() {
          return principal;
        },
        revision: 1,
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
  });

  it("同 principal 的 revision 变化也清空 tombstone", async () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValueOnce(pages(["shared"], null))
      .mockResolvedValueOnce(pages(["shared", "revision"], null));
    let revision = 1;
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        principal: principalOf(),
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

    revision = 2;
    query.query.reconcile();
    query.query.refresh();
    await flush();

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

  it("primary fetcher 同步 throw 仍走安全错误边界并释放锁", async () => {
    const thrownError = {
      status: 503,
      body: "primary-sync-body-canary",
      message: "primary-sync-message-canary",
    };
    const classified: unknown[] = [];
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockImplementationOnce(() => {
        throw thrownError;
      })
      .mockResolvedValueOnce(pages(["retry"], null));
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
        classifyError: (error) => {
          classified.push(error);
          return "http";
        },
      },
    );

    expect(() => query.query.refresh()).not.toThrow();
    await flush();
    expect(query.query.getState().phase).toBe("error");
    expect(query.query.getState().errorKind).toBe("http");
    expect(classified).toEqual([thrownError]);
    expect(JSON.stringify(query.query.getState())).not.toContain("primary-sync-body-canary");
    expect(JSON.stringify(query.query.getState())).not.toContain("primary-sync-message-canary");

    expect(() => query.query.retry()).not.toThrow();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["retry"]);
  });

  it("more fetcher 同步 throw 保 cursor、释放锁并允许显式重试", async () => {
    const thrownError = {
      status: 502,
      body: "more-sync-body-canary",
      message: "more-sync-message-canary",
    };
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValueOnce(pages(["a"], "c1"))
      .mockImplementationOnce(() => {
        throw thrownError;
      })
      .mockResolvedValueOnce(pages(["b"], null));
    const query = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      {
        principal: principalOf(),
        revision: 1,
        lifecycle: visibleLifecycle(),
        classifyError: () => "http",
      },
    );

    query.query.refresh();
    await flush();
    expect(() => query.query.loadMore()).not.toThrow();
    await flush();
    expect(query.query.getState().more).toBe("error");
    expect(query.query.getState().moreErrorKind).toBe("http");
    expect(query.query.getState().cursor).toBe("c1");
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["a"]);
    expect(JSON.stringify(query.query.getState())).not.toContain("more-sync-body-canary");
    expect(JSON.stringify(query.query.getState())).not.toContain("more-sync-message-canary");

    expect(() => query.query.loadMore()).not.toThrow();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(query.query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(query.query.getState().cursor).toBeNull();
  });

  it("hidden 经 refresh/loadMore/updateOptions 清 cursor，业务 gate 保留", async () => {
    const fetcher = vi.fn<Fetcher<null, SessionItem>>().mockResolvedValue(pages(["a"], "c1"));
    const source = {
      principal: principalOf(),
      revision: 1,
      lifecycle: visibleLifecycle(),
    };
    let businessAllowed = true;
    const profile: QueryProfile<null, SessionItem> & {
      page: PagePolicy<null, SessionItem>;
    } = {
      resolveContext: () => ({ eligible: true, context: null }),
      gate: () => businessAllowed,
      preserveOnSuspend: false,
      clearPrimaryErrorOnSuspend: true,
      page: { keyOf: (item) => item.id },
    };
    const query = makeQuery(profile, fetcher, source);

    query.query.refresh();
    await flush();
    expect(query.query.getState()).toMatchObject({
      phase: "ready",
      items: [{ id: "a" }],
      cursor: "c1",
    });

    source.lifecycle = { visibility: "hidden", online: true };
    query.query.refresh();
    expect(query.query.getState()).toMatchObject({
      phase: "idle",
      items: [],
      cursor: null,
      errorKind: null,
      paused: true,
      more: "idle",
      moreErrorKind: null,
    });

    source.lifecycle = visibleLifecycle();
    query.query.refresh();
    await flush();
    expect(query.query.getState().cursor).toBe("c1");

    source.lifecycle = { visibility: "hidden", online: true };
    query.query.loadMore();
    expect(query.query.getState()).toMatchObject({
      cursor: null,
      paused: true,
      more: "idle",
    });

    source.lifecycle = visibleLifecycle();
    query.query.refresh();
    await flush();
    expect(query.query.getState().cursor).toBe("c1");

    source.lifecycle = { visibility: "hidden", online: true };
    query.query.updateOptions(profile, fetcher);
    expect(query.query.getState()).toMatchObject({
      cursor: null,
      paused: true,
    });

    source.lifecycle = visibleLifecycle();
    query.query.refresh();
    await flush();
    expect(query.query.getState().cursor).toBe("c1");
    businessAllowed = false;
    const callsBeforeBusinessGate = fetcher.mock.calls.length;
    query.query.refresh();
    expect(fetcher).toHaveBeenCalledTimes(callsBeforeBusinessGate);
    expect(query.query.getState()).toMatchObject({
      cursor: "c1",
      paused: true,
    });
  });

  it("refresh 遇 offline 按 profile 清除首屏错误", async () => {
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValueOnce(pages(["a"], "c1"))
      .mockRejectedValueOnce({
        status: 500,
        body: "offline-error-body-canary",
      })
      .mockResolvedValue(pages(["later"], "c2"));
    const source = {
      principal: principalOf(),
      revision: 1,
      lifecycle: visibleLifecycle(),
    };
    const query = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        preserveOnSuspend: true,
        clearPrimaryErrorOnSuspend: true,
      },
      fetcher,
      source,
    );

    query.query.refresh();
    await flush();
    expect(query.query.getState()).toMatchObject({
      phase: "ready",
      items: [{ id: "a" }],
      cursor: "c1",
    });

    query.query.refresh();
    await flush();
    expect(query.query.getState()).toMatchObject({
      phase: "error",
      errorKind: "http",
      paused: false,
      cursor: "c1",
    });

    source.lifecycle = { visibility: "visible", online: false };
    query.query.refresh();
    expect(query.query.getState()).toMatchObject({
      phase: "ready",
      items: [{ id: "a" }],
      cursor: null,
      errorKind: null,
      paused: true,
      more: "idle",
      moreErrorKind: null,
    });
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
    let historyStarted = false;
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
    weeklyReady.resolve(pages(["weekly"], "c1"));
    await flush();
    expect(weeklyQuery.getState().phase).toBe("ready");

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

  it("WP 只在 current weekly 提交后启动 history，旧 weekly 晚到不跨代", async () => {
    const oldWeekly = deferred<Page<SessionItem>>();
    const currentWeekly = deferred<Page<SessionItem>>();
    const historyFetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockResolvedValue(pages(["history"], null));
    const weeklyFetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(oldWeekly.promise)
      .mockReturnValueOnce(currentWeekly.promise);
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
    const historyQuery = createReadQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      historyFetcher,
      source,
      () => undefined,
    );
    const weeklyQuery = createReadQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      weeklyFetcher,
      source,
      (next) => {
        if (next.phase === "ready") historyQuery.refresh();
      },
    );

    weeklyQuery.refresh();
    sourceState.revision = 2;
    oldWeekly.resolve(pages(["stale"], null));
    await flush();

    expect(historyFetcher).not.toHaveBeenCalled();
    expect(weeklyFetcher).toHaveBeenCalledTimes(2);
    expect(weeklyQuery.getState().phase).toBe("loading");

    currentWeekly.resolve(pages(["current"], null));
    await flush();

    expect(historyFetcher).toHaveBeenCalledTimes(1);
    expect(historyQuery.getState().items.map((item) => item.id)).toEqual(["history"]);
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
