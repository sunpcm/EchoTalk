import React, { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyGrammar } from "./WeeklyGrammar";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as calendar from "@/lib/localDayWindow";
import * as platform from "@/platform";
import { zhCN } from "@/i18n/zh-CN";

vi.mock("@/lib/api", () => ({ getWeeklyGrammar: vi.fn() }));

const t = zhCN.weeklyGrammar;
const context = { endDate: "2026-11-03", timezone: "UTC" };
function summary(endDate = context.endDate, timezone = context.timezone): api.WeeklyGrammarSummary {
  const windows = calendar.getZonedWeekWindows(endDate, timezone);
  const firstDay = windows[0];
  const lastDay = windows[windows.length - 1];
  return {
    start: firstDay.start,
    end: lastDay.end,
    total_errors: 7,
    items: [
      { skill_tag: "article_usage", count: 4 },
      { skill_tag: "other", count: 2 },
      { skill_tag: "preposition", count: 1 },
    ],
  };
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

describe("WeeklyGrammar 请求归属与只读展示", () => {
  let snapshot: auth.AuthSnapshot;
  let revision: number;
  let localContext: typeof context;
  let initialLifecycle: platform.WebLifecycleSnapshot;
  let authListeners: Set<(snapshot: auth.AuthSnapshot) => void>;
  let adapters: Array<{
    snapshot: platform.WebLifecycleSnapshot;
    listeners: Set<(event: platform.WebLifecycleEvent) => void>;
    dispose: ReturnType<typeof vi.fn>;
  }>;
  const authEvent = () =>
    act(() => {
      authListeners.forEach((listener) => listener(snapshot));
    });
  const lifecycle = (
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
    localContext = { ...context };
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
    vi.spyOn(calendar, "getLocalWeekContext").mockImplementation(() => ({ ...localContext }));
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
    vi.mocked(api.getWeeklyGrammar).mockResolvedValue(summary());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("一次只读请求、Top3固定名称与改善提示", async () => {
    render(<WeeklyGrammar />);
    await flush();
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(1);
    expect(api.getWeeklyGrammar).toHaveBeenCalledWith(
      "2026-11-03",
      "UTC",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText("共 7 条记录")).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: t.list })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("冠词使用");
    expect(items[0]).toHaveTextContent("4 条记录");
    expect(items[1]).toBe(screen.getByTestId("weekly-grammar-other"));
    expect(items[1]).toHaveTextContent(t.skills.other);
    expect(items[1]).toHaveTextContent(t.tips.other);
    expect(items[2]).toBe(screen.getByTestId("weekly-grammar-preposition"));
    expect(items[2]).toHaveTextContent(t.skills.preposition);
    expect(items[2]).toHaveTextContent(t.tips.preposition);
  });

  it("loading、安全失败与显式重试；连击合并同一槽位", async () => {
    const first = deferred<api.WeeklyGrammarSummary>();
    const retry = deferred<api.WeeklyGrammarSummary>();
    vi.mocked(api.getWeeklyGrammar)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render(<WeeklyGrammar />);
    expect(screen.getByText(t.loading)).toBeInTheDocument();
    await act(async () => first.reject(new Error("private-response-canary")));
    expect(screen.getByRole("alert")).toHaveTextContent(t.loadError);
    expect(screen.queryByText(/private-response-canary/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: t.retry });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve(summary()));
    expect(screen.getByText("共 7 条记录")).toBeInTheDocument();
  });

  it("空态不声称零错误或分析完成", async () => {
    vi.mocked(api.getWeeklyGrammar).mockResolvedValue({ ...summary(), total_errors: 0, items: [] });
    render(<WeeklyGrammar />);
    await flush();
    expect(screen.getByText(t.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: t.list })).not.toBeInTheDocument();
  });

  it.each(["principal", "revision", "logout"])(
    "%s同步清数据并使旧成功/finally失效，新账号可立即推进",
    async (change) => {
      const old = deferred<api.WeeklyGrammarSummary>();
      const next = deferred<api.WeeklyGrammarSummary>();
      vi.mocked(api.getWeeklyGrammar)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      render(<WeeklyGrammar />);
      revision++;
      if (change === "principal")
        snapshot = {
          state: "authenticated",
          principal: { issuer: "https://other", subject: "one" },
        };
      if (change === "logout") snapshot = { state: "anonymous", principal: null };
      authEvent();
      await act(async () => old.resolve(summary()));
      expect(screen.queryByText("共 7 条记录")).not.toBeInTheDocument();
      if (change === "logout") {
        expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(1);
      } else {
        expect(screen.getByText(t.loading)).toBeInTheDocument();
        lifecycle("resume");
        expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(2);
        await act(async () => next.resolve(summary()));
        expect(screen.getByText("共 7 条记录")).toBeInTheDocument();
      }
    },
  );

  it.each(["success", "failure"])(
    "旧请求迟到%s/finally不污染新请求或释放新槽位",
    async (outcome) => {
      const old = deferred<api.WeeklyGrammarSummary>();
      const next = deferred<api.WeeklyGrammarSummary>();
      vi.mocked(api.getWeeklyGrammar)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      render(<WeeklyGrammar />);
      localContext = { endDate: "2026-11-04", timezone: "UTC" };
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(2);
      await act(async () => {
        if (outcome === "success") old.resolve(summary());
        else old.reject(new Error("old"));
      });
      expect(screen.getByText(t.loading)).toBeInTheDocument();
      await act(async () => next.resolve(summary("2026-11-04")));
      expect(screen.getByText("共 7 条记录")).toBeInTheDocument();
    },
  );

  it.each(["suspend", "offline"])(
    "%s作废在途请求，恢复只读刷新，迟到失败不关闭新请求",
    async (kind) => {
      const old = deferred<api.WeeklyGrammarSummary>();
      const next = deferred<api.WeeklyGrammarSummary>();
      vi.mocked(api.getWeeklyGrammar)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      render(<WeeklyGrammar />);
      lifecycle(
        kind === "suspend" ? "suspend" : "connectivity",
        kind === "suspend" ? "hidden" : "visible",
        kind !== "offline",
      );
      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.getByText(t.paused)).toBeInTheDocument();
      lifecycle(kind === "suspend" ? "resume" : "connectivity");
      await act(async () => old.reject(new Error("old")));
      expect(screen.getByText(t.loading)).toBeInTheDocument();
      await act(async () => next.resolve(summary()));
      expect(screen.getByText("共 7 条记录")).toBeInTheDocument();
    },
  );

  it("本地午夜离线清空旧视图且不调用API，恢复按新日期请求", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 59));
    render(<WeeklyGrammar />);
    await flush();
    expect(screen.getByText("共 7 条记录")).toBeInTheDocument();
    lifecycle("connectivity", "visible", false);
    localContext = { endDate: "2026-11-04", timezone: "UTC" };
    await act(async () => vi.advanceTimersByTimeAsync(1_001));
    expect(screen.queryByText("共 7 条记录")).not.toBeInTheDocument();
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(1);
    vi.mocked(api.getWeeklyGrammar).mockResolvedValue(summary("2026-11-04"));
    lifecycle("connectivity");
    await flush();
    expect(vi.mocked(api.getWeeklyGrammar).mock.lastCall?.slice(0, 2)).toEqual([
      "2026-11-04",
      "UTC",
    ]);
  });

  it("分钟检查只监测日历时区，不轮询API；变化后才刷新", async () => {
    vi.useFakeTimers();
    render(<WeeklyGrammar />);
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(1);
    localContext = { endDate: context.endDate, timezone: "Asia/Singapore" };
    vi.mocked(api.getWeeklyGrammar).mockResolvedValue(summary(context.endDate, "Asia/Singapore"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(2);
  });

  it("卸载后迟到成功失败和事件都不能发出新请求", async () => {
    const pending = deferred<api.WeeklyGrammarSummary>();
    vi.mocked(api.getWeeklyGrammar).mockReturnValueOnce(pending.promise);
    const mounted = render(<WeeklyGrammar />);
    const signal = vi.mocked(api.getWeeklyGrammar).mock.lastCall?.[2]?.signal;
    mounted.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(summary()));
    expect(authListeners.size).toBe(0);
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(1);
  });

  it("StrictMode重挂载清理订阅/timer/旧请求，旧失败不污染新实例", async () => {
    vi.useFakeTimers();
    const old = deferred<api.WeeklyGrammarSummary>();
    vi.mocked(api.getWeeklyGrammar).mockReturnValueOnce(old.promise);
    const mounted = render(
      <StrictMode>
        <WeeklyGrammar />
      </StrictMode>,
    );
    await flush();
    expect(api.getWeeklyGrammar).toHaveBeenCalledTimes(2);
    expect(adapters[0].dispose).toHaveBeenCalledTimes(1);
    await act(async () => old.reject(new Error("strict-old")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    mounted.unmount();
    expect(authListeners.size).toBe(0);
    expect(adapters[1].dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
