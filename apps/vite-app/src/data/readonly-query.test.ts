import { describe, expect, it, vi } from "vitest";
import { createReadQuery } from "./readonly-query";
import type { Fetcher, Page, QueryProfile, QueryState, ReadQuerySource } from "./readonly-query";
import type { AuthPrincipal } from "@/lib/auth";
import type { WebLifecycleSnapshot } from "@/platform";

interface SessionItem {
  id: string;
  status: string;
  startedAt: number;
}

const principalOf = (subject = "one"): AuthPrincipal => ({
  issuer: "https://auth.example",
  subject,
});

const visibleLifecycle = (): WebLifecycleSnapshot => ({ visibility: "visible", online: true });
const hiddenLifecycle = (): WebLifecycleSnapshot => ({ visibility: "hidden", online: true });

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

interface SourceBox {
  principal: AuthPrincipal | null;
  revision: number;
  lifecycle: WebLifecycleSnapshot;
}

function makeBox(overrides: Partial<SourceBox> = {}): SourceBox {
  return {
    principal: principalOf(),
    revision: 1,
    lifecycle: visibleLifecycle(),
    ...overrides,
  };
}

function makeQuery<C, D>(
  profile: QueryProfile<C, D>,
  fetcher: Fetcher<C, D>,
  box: SourceBox,
  classifyError?: (error: unknown) => "http" | "parse" | "network",
) {
  const states: QueryState<D>[] = [];
  const source: ReadQuerySource = {
    getPrincipal: () => box.principal,
    getRevision: () => box.revision,
    getLifecycle: () => box.lifecycle,
    ...(classifyError ? { classifyError } : {}),
  };
  const query = createReadQuery(profile, fetcher, source, (next) => states.push(next));
  return { query, states, box };
}

function pages(items: string[], cursor: string | null = null): Page<SessionItem> {
  return {
    items: items.map((id) => ({ id, status: "completed", startedAt: 0 })),
    nextCursor: cursor,
  };
}

describe("readonly-query origin 与 gate", () => {
  it("未认证不请求且清空", async () => {
    const fetcher = vi.fn(async () => pages(["a"]));
    const box = makeBox({ principal: null });
    const { query, states } = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(query.getState().phase).toBe("idle");
    expect(query.getState().items).toEqual([]);
    expect(states.length).toBe(0);
  });

  it("无资格(eligible:false)与合法 context=null 可区分", async () => {
    const fetcher = vi.fn(async () => pages(["a"]));
    const box = makeBox();
    const eligibleNull = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      box,
    );
    eligibleNull.query.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    const fetcher2 = vi.fn(async () => pages(["b"]));
    const ineligible = makeQuery({ resolveContext: () => ({ eligible: false }) }, fetcher2, box);
    ineligible.query.refresh();
    await flush();
    expect(fetcher2).not.toHaveBeenCalled();
    expect(ineligible.query.getState().items).toEqual([]);
  });

  it("issuer/subject 任一不同即换号，同 principal 新 revision 也重置", async () => {
    const fetcher = vi.fn(async (context: { subject: string }) => pages([context.subject]));
    const box = makeBox();
    const { query } = makeQuery(
      { resolveContext: () => ({ eligible: true, context: { subject: box.principal!.subject } }) },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["one"]);

    box.principal = { issuer: "https://other", subject: "one" };
    query.reconcile();
    query.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    box.revision = 2;
    query.reconcile();
    query.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("同语义 context 重新创建对象不误判换 origin", async () => {
    const fetcher = vi.fn(async () => pages(["a"]));
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: { endDate: "2026-11-12", tz: "UTC" } }),
      },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // reconcile 使用结构等价而不是引用等价
    expect(query.reconcile()).toBe(false);
    expect(query.getState().items.map((i) => i.id)).toEqual(["a"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("context 值变化(日窗口/时区)重置", async () => {
    const fetcher = vi.fn(async () => pages(["a"]));
    const box = makeBox();
    let day = "2026-11-12";
    const { query } = makeQuery(
      { resolveContext: () => ({ eligible: true, context: { day } }) },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    day = "2026-11-13";
    expect(query.reconcile()).toBe(true);
    expect(query.getState().items).toEqual([]);
    expect(query.getState().phase).toBe("idle");
  });

  it("同 origin 重复触发按 profile：ignore 不排队，override 最新覆盖", async () => {
    const first = deferred<Page<SessionItem>>();
    const second = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const box = makeBox();
    const ignore = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }), concurrent: "ignore" },
      fetcher,
      box,
    );
    ignore.query.refresh();
    ignore.query.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);

    const fetcher2 = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const override = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }), concurrent: "override" },
      fetcher2,
      box,
    );
    override.query.refresh();
    override.query.refresh();
    expect(fetcher2).toHaveBeenCalledTimes(2);
    first.resolve(pages(["old"]));
    await flush();
    expect(override.query.getState().phase).toBe("loading");
    second.resolve(pages(["new"]));
    await flush();
    expect(override.query.getState().items.map((i) => i.id)).toEqual(["new"]);
  });

  it("hidden/offline 初始不请求且 paused；unknown/null 允许", async () => {
    const fetcher = vi.fn(async () => pages(["a"]));
    const hiddenBox = makeBox({ lifecycle: hiddenLifecycle() });
    const hiddenQuery = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      hiddenBox,
    );
    hiddenQuery.query.refresh();
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(hiddenQuery.query.getState().paused).toBe(true);

    const unknownBox = makeBox({
      lifecycle: { visibility: "unknown", online: null },
    });
    const unknownQuery = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }) },
      fetcher,
      unknownBox,
    );
    unknownQuery.query.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("业务 gate=false 静默拒绝、不排队、不制造错误", async () => {
    const fetcher = vi.fn(async () => pages(["a"]));
    let allowed = false;
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        gate: () => allowed,
      },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(query.getState().paused).toBe(true);
    expect(query.getState().errorKind).toBeNull();

    allowed = true;
    query.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(query.getState().items.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("readonly-query 竞态与命名槽位", () => {
  it("旧 success/error 不写入新 origin，旧 finally 不释放新槽位", async () => {
    const oldReq = deferred<Page<SessionItem>>();
    const newReq = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(oldReq.promise)
      .mockReturnValueOnce(newReq.promise);
    const box = makeBox();
    const { query } = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }), concurrent: "ignore" },
      fetcher,
      box,
    );
    query.refresh();
    box.principal = { issuer: "https://other", subject: "one" };
    query.reconcile();
    query.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);

    oldReq.resolve(pages(["old"]));
    await flush();
    expect(query.getState().items).toEqual([]);
    expect(query.getState().phase).toBe("loading");

    // 旧 finally 已运行，但不释放新槽位：并发 ignore 仍拒绝第三次触发
    query.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);

    newReq.resolve(pages(["new"]));
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["new"]);
  });

  it("旧 error/finally 不污染新 origin", async () => {
    const oldReq = deferred<Page<SessionItem>>();
    const newReq = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(oldReq.promise)
      .mockReturnValueOnce(newReq.promise);
    const box = makeBox();
    const { query } = makeQuery(
      { resolveContext: () => ({ eligible: true, context: null }), concurrent: "override" },
      fetcher,
      box,
    );
    query.refresh();
    box.revision = 2;
    query.reconcile();
    query.refresh();
    oldReq.reject(new Error("http-body-canary"));
    await flush();
    expect(query.getState().errorKind).toBeNull();
    expect(query.getState().phase).toBe("loading");
    newReq.resolve(pages(["fresh"]));
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["fresh"]);
  });
});

describe("readonly-query 分页与去重", () => {
  it("首页重置(resetOnFirstPage)与首页保留旧数据", async () => {
    const first = deferred<Page<SessionItem>>();
    const second = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<null, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        resetOnFirstPage: true,
      },
      fetcher,
      box,
    );
    query.refresh();
    first.resolve(pages(["a"]));
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["a"]);
    query.refresh();
    expect(query.getState().items).toEqual([]);
    second.resolve(pages(["b"]));
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["b"]);
  });

  it("更多页追加、大小写不敏感去重、重复 cursor 拒绝整页并保留可重试", async () => {
    let moreCalls = 0;
    const fetcher = vi
      .fn<Fetcher<{ start: number }, SessionItem>>()
      .mockImplementation(async (_ctx, opts) => {
        if (!opts.cursor) return pages(["A1"], "c1");
        moreCalls += 1;
        if (moreCalls === 1) {
          return {
            items: [
              { id: "a1", status: "completed", startedAt: 10 },
              { id: "B2", status: "completed", startedAt: 20 },
            ],
            nextCursor: "c1",
          };
        }
        return pages(["C3"], null);
      });
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: { start: 0 } }),
        page: {
          keyOf: (item) => item.id,
          dedupeKey: (item) => item.id.toLowerCase(),
          detectRepeatedCursor: true,
          validatePage: (items, ctx) => {
            if (items.some((i) => i.startedAt < ctx.start)) {
              throw new Error("out of window");
            }
          },
        },
      },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(query.getState().cursor).toBe("c1");
    query.loadMore();
    await flush();
    // 重复 cursor 检测必须在追加前失败，因此整页（含 B2）都不能保留
    expect(query.getState().items.map((i) => i.id)).toEqual(["A1"]);
    expect(query.getState().more).toBe("error");
    expect(query.getState().moreErrorKind).toBe("parse");
    expect(query.getState().cursor).toBe("c1");

    // 收紧：错误页整体被拒绝后，cursor 保留，显式重试应能恢复并正确追加
    query.loadMore();
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["A1", "C3"]);
    expect(query.getState().more).toBe("ready");
    expect(query.getState().cursor).toBeNull();
  });

  it("窗口校验失败归类 parse；more 失败保留 cursor 供显式重试", async () => {
    const first = deferred<Page<SessionItem>>();
    const badMore = deferred<Page<SessionItem>>();
    const goodMore = deferred<Page<SessionItem>>();
    const fetcher = vi
      .fn<Fetcher<{ start: number }, SessionItem>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(badMore.promise)
      .mockReturnValueOnce(goodMore.promise);
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: { start: 100 } }),
        page: {
          keyOf: (item) => item.id,
          validatePage: (items, ctx) => {
            if (items.some((i) => i.startedAt < ctx.start)) {
              throw new Error("out of window");
            }
          },
        },
      },
      fetcher,
      box,
    );
    query.refresh();
    first.resolve({ items: [{ id: "a", status: "completed", startedAt: 200 }], nextCursor: "c1" });
    await flush();
    query.loadMore();
    badMore.resolve({ items: [{ id: "b", status: "completed", startedAt: 5 }], nextCursor: "c2" });
    await flush();
    expect(query.getState().more).toBe("error");
    expect(query.getState().moreErrorKind).toBe("parse");
    expect(query.getState().cursor).toBe("c1");

    query.loadMore();
    goodMore.resolve({
      items: [{ id: "b", status: "completed", startedAt: 300 }],
      nextCursor: null,
    });
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(query.getState().more).toBe("ready");
    expect(query.getState().cursor).toBeNull();
  });

  it("tombstone 移除并阻止旧页复活", async () => {
    const fetcher = vi.fn<Fetcher<null, SessionItem>>().mockImplementation(async (_ctx, opts) => {
      if (!opts.cursor) return pages(["a", "b"], "c1");
      return pages(["a", "c"], null);
    });
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        page: { keyOf: (item) => item.id },
      },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["a", "b"]);
    query.removeItem("a");
    expect(query.getState().items.map((i) => i.id)).toEqual(["b"]);
    query.loadMore();
    await flush();
    expect(query.getState().items.map((i) => i.id)).toEqual(["b", "c"]);
  });
});

describe("readonly-query 错误分类与挂起", () => {
  it("错误只安全分类 http/parse/network，不回显正文", async () => {
    const cases: Array<[unknown, "http" | "parse" | "network"]> = [
      [{ status: 401 }, "http"],
      [new TypeError("fetch failed"), "network"],
      [new Error("invalid json"), "parse"],
    ];
    for (const [error, kind] of cases) {
      const fetcher = vi.fn(async () => {
        throw error;
      });
      const box = makeBox();
      const { query } = makeQuery(
        { resolveContext: () => ({ eligible: true, context: null }) },
        fetcher,
        box,
      );
      query.refresh();
      await flush();
      expect(query.getState().errorKind).toBe(kind);
      expect(JSON.stringify(query.getState())).not.toContain("canary");
    }
  });

  it("挂起按 profile 保留/清空数据、清 cursor、清/保留首屏错误", async () => {
    const fetcher = vi.fn(async () => pages(["a"], "c1"));
    const box = makeBox();
    const wg = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        preserveOnSuspend: false,
        clearPrimaryErrorOnSuspend: true,
      },
      fetcher,
      box,
    );
    wg.query.refresh();
    await flush();
    box.lifecycle = hiddenLifecycle();
    wg.query.suspend();
    expect(wg.query.getState().items).toEqual([]);
    expect(wg.query.getState().phase).toBe("idle");
    expect(wg.query.getState().cursor).toBeNull();
    expect(wg.query.getState().paused).toBe(true);

    const fetcher2 = vi.fn(async () => pages(["a"], "c1"));
    box.lifecycle = visibleLifecycle();
    const dp = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        preserveOnSuspend: true,
        clearPrimaryErrorOnSuspend: false,
      },
      fetcher2,
      box,
    );
    dp.query.refresh();
    await flush();
    box.lifecycle = hiddenLifecycle();
    dp.query.suspend();
    expect(dp.query.getState().items.map((i) => i.id)).toEqual(["a"]);
    expect(dp.query.getState().cursor).toBeNull();
    expect(dp.query.getState().paused).toBe(true);
  });

  it("挂起清 more 错误但按 profile 保留首屏错误", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("primary parse");
    });
    const box = makeBox();
    const { query } = makeQuery(
      {
        resolveContext: () => ({ eligible: true, context: null }),
        clearPrimaryErrorOnSuspend: false,
      },
      fetcher,
      box,
    );
    query.refresh();
    await flush();
    expect(query.getState().errorKind).toBe("parse");
    box.lifecycle = hiddenLifecycle();
    query.suspend();
    expect(query.getState().errorKind).toBe("parse");
  });
});
