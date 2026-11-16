import React, { StrictMode } from "react";
import { act, fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyProgress } from "./WeeklyProgress";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as calendar from "@/lib/localDayWindow";
import * as platform from "@/platform";
import { zhCN } from "@/i18n/zh-CN";

vi.mock("@/lib/api", () => ({ getWeeklyProgress: vi.fn(), listSessions: vi.fn() }));

const t = zhCN.weeklyProgress;
const context = { endDate: "2026-11-03", timezone: "UTC" };
function week(endDate = context.endDate, timezone = context.timezone): api.WeeklyProgressResponse {
  return {
    days: calendar
      .getZonedWeekWindows(endDate, timezone)
      .map((day) => ({ ...day, completed_sessions: 2 })),
  };
}
function item(id: number, date = context.endDate): api.SessionListItem {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    mode: "free_talk",
    status: "completed",
    started_at: `${date}T10:00:00Z`,
    ended_at: `${date}T10:05:00Z`,
  };
}
function page(items: api.SessionListItem[] = [], next_cursor: string | null = null) {
  return { items, next_cursor };
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
const choose = (date: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${date}，`) }));
const row = (id: number) => screen.queryByTestId(`weekly-session-${item(id).id}`);

describe("WeeklyProgress 请求归属与只读历史", () => {
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
        subscribe: (listener) => {
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
    vi.mocked(api.listSessions).mockResolvedValue(page());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("一次聚合、七个可访问按钮、默认今天、空态和精确单日只读请求", async () => {
    render(<WeeklyProgress />);
    await flush();
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
    expect(api.getWeeklyProgress).toHaveBeenCalledWith(
      "2026-11-03",
      "UTC",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const buttons = within(screen.getByRole("list", { name: t.dayList })).getAllByRole("button");
    expect(buttons).toHaveLength(7);
    expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true")).toEqual([
      buttons[6],
    ]);
    buttons.forEach((button) => expect(button.className).toContain("min-h-[44px]"));
    expect(api.listSessions).toHaveBeenCalledWith(
      {
        status: "completed",
        start: "2026-11-03T00:00:00.000Z",
        end: "2026-11-04T00:00:00.000Z",
        limit: 50,
      },
      expect.anything(),
    );
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });

  it("概览 loading、失败安全本地化与显式重试；连击在同步槽位合并", async () => {
    const first = deferred<api.WeeklyProgressResponse>();
    const retry = deferred<api.WeeklyProgressResponse>();
    vi.mocked(api.getWeeklyProgress)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render(<WeeklyProgress />);
    expect(screen.getByText(t.loading)).toBeInTheDocument();
    await act(async () => first.reject(new Error("private-response-canary")));
    expect(screen.getByRole("alert")).toHaveTextContent(t.loadError);
    expect(screen.queryByText(/private-response-canary/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: t.retry });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
    expect(api.listSessions).not.toHaveBeenCalled();
    await act(async () => retry.resolve(week()));
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });

  it("历史失败独立重试，不重新抓取七桶", async () => {
    vi.mocked(api.listSessions).mockRejectedValueOnce(new Error("raw-history"));
    render(<WeeklyProgress />);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(t.historyError);
    fireEvent.click(screen.getByRole("button", { name: t.retryHistory }));
    await flush();
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
    expect(api.listSessions).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("显式分页、单页/跨页去重、失败用同一个 cursor 重试与双击去重", async () => {
    const more = deferred<api.SessionListResponse>();
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce(page([item(1), item(1)], "cursor-one"))
      .mockRejectedValueOnce(new Error("unsafe"))
      .mockReturnValueOnce(more.promise);
    render(<WeeklyProgress />);
    await flush();
    expect(screen.getAllByTestId(`weekly-session-${item(1).id}`)).toHaveLength(1);
    expect(api.listSessions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
    await flush();
    expect(row(1)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: t.retryMore });
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(api.listSessions).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.listSessions).mock.calls[1][0]).toEqual(
      vi.mocked(api.listSessions).mock.calls[2][0],
    );
    await act(async () => more.resolve(page([item(1), item(2), item(2)])));
    expect(
      within(screen.getByRole("list", { name: t.historyList })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: t.loadMore })).not.toBeInTheDocument();
  });

  it.each(["success", "failure"])(
    "首屏历史旧 %s/finally 晚于切日的新请求，不清除新 loading 或槽位",
    async (outcome) => {
      const old = deferred<api.SessionListResponse>();
      const next = deferred<api.SessionListResponse>();
      vi.mocked(api.listSessions)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      render(<WeeklyProgress />);
      await flush();
      choose("2026-11-02");
      await act(async () => {
        if (outcome === "success") old.resolve(page([item(99)]));
        else old.reject(new Error("old"));
      });
      expect(screen.getByText(t.historyLoading)).toBeInTheDocument();
      expect(row(99)).not.toBeInTheDocument();
      choose("2026-11-02");
      expect(api.listSessions).toHaveBeenCalledTimes(2);
      await act(async () => next.resolve(page([item(2, "2026-11-02")])));
      expect(row(2)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each(["success", "failure"])(
    "more 旧 %s/finally 不释放切日后的新 more 槽位",
    async (outcome) => {
      const old = deferred<api.SessionListResponse>();
      const next = deferred<api.SessionListResponse>();
      vi.mocked(api.listSessions)
        .mockResolvedValueOnce(page([item(1)], "old-cursor"))
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(page([item(2, "2026-11-02")], "new-cursor"))
        .mockReturnValueOnce(next.promise);
      render(<WeeklyProgress />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
      choose("2026-11-02");
      await flush();
      fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
      await act(async () => {
        if (outcome === "success") old.resolve(page([item(99)]));
        else old.reject(new Error("old"));
      });
      const loading = screen.getByRole("button", { name: t.loadingMore });
      expect(loading).toBeDisabled();
      fireEvent.click(loading);
      expect(api.listSessions).toHaveBeenCalledTimes(4);
      expect(row(99)).not.toBeInTheDocument();
      await act(async () => next.resolve(page([item(3, "2026-11-02")])));
      expect(row(3)).toBeInTheDocument();
      expect(row(1)).not.toBeInTheDocument();
    },
  );

  it.each(["principal", "revision", "logout"])(
    "%s 同步清数据并使旧 aggregate/finally 失效，新账号可立即推进",
    async (change) => {
      const old = deferred<api.WeeklyProgressResponse>();
      const next = deferred<api.WeeklyProgressResponse>();
      vi.mocked(api.getWeeklyProgress)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      render(<WeeklyProgress />);
      revision++;
      if (change === "principal")
        snapshot = {
          state: "authenticated",
          principal: { issuer: "https://other", subject: "one" },
        };
      if (change === "logout") snapshot = { state: "anonymous", principal: null };
      authEvent();
      await act(async () => old.resolve(week()));
      expect(api.listSessions).not.toHaveBeenCalled();
      if (change === "logout") {
        expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("list", { name: t.dayList })).not.toBeInTheDocument();
      } else {
        expect(screen.getByText(t.loading)).toBeInTheDocument();
        lifecycle("resume");
        expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
        await act(async () => next.resolve(week()));
        expect(screen.getByText(t.empty)).toBeInTheDocument();
      }
    },
  );

  it.each(["principal", "revision"])(
    "%s 使旧 more 失败失效且新 more 的 loading 不被旧 finally 清除",
    async (change) => {
      const old = deferred<api.SessionListResponse>();
      const next = deferred<api.SessionListResponse>();
      vi.mocked(api.listSessions)
        .mockResolvedValueOnce(page([item(1)], "one"))
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(page([item(2)], "two"))
        .mockReturnValueOnce(next.promise);
      render(<WeeklyProgress />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
      revision++;
      if (change === "principal")
        snapshot = {
          state: "authenticated",
          principal: { issuer: "https://auth.example", subject: "two" },
        };
      authEvent();
      expect(row(1)).not.toBeInTheDocument();
      await flush();
      fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
      await act(async () => old.reject(new Error("old-account")));
      expect(screen.getByRole("button", { name: t.loadingMore })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await act(async () => next.resolve(page([item(3)])));
      expect(row(3)).toBeInTheDocument();
      expect(row(1)).not.toBeInTheDocument();
    },
  );

  it.each(["suspend", "offline"])(
    "%s 作废 aggregate，恢复只读刷新，迟到失败/finally 不关闭新请求",
    async (kind) => {
      const old = deferred<api.WeeklyProgressResponse>();
      const next = deferred<api.WeeklyProgressResponse>();
      vi.mocked(api.getWeeklyProgress)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      render(<WeeklyProgress />);
      lifecycle(
        kind === "suspend" ? "suspend" : "connectivity",
        kind === "suspend" ? "hidden" : "visible",
        kind !== "offline",
      );
      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      lifecycle(kind === "suspend" ? "resume" : "connectivity");
      await act(async () => old.reject(new Error("old")));
      expect(screen.getByText(t.loading)).toBeInTheDocument();
      lifecycle("resume");
      expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
      await act(async () => next.resolve(week()));
      expect(screen.getByText(t.empty)).toBeInTheDocument();
    },
  );

  it("suspend 在途 more 后立即移除游标，恢复的首屏和 more 不被旧结果污染", async () => {
    const old = deferred<api.SessionListResponse>();
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce(page([item(1)], "one"))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page([item(2)], "two"));
    render(<WeeklyProgress />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
    lifecycle("suspend", "hidden");
    expect(screen.queryByRole("button", { name: t.loadingMore })).not.toBeInTheDocument();
    lifecycle("resume");
    await flush();
    await act(async () => old.resolve(page([item(99)])));
    expect(row(99)).not.toBeInTheDocument();
    expect(row(2)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.loadMore })).toBeEnabled();
  });

  it("时区变更在旧请求结算时同步作废并重新取桶，不能等旧 finally 释放", async () => {
    const old = deferred<api.WeeklyProgressResponse>();
    vi.mocked(api.getWeeklyProgress)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(week(context.endDate, "Asia/Singapore"));
    render(<WeeklyProgress />);
    localContext = { endDate: context.endDate, timezone: "Asia/Singapore" };
    await act(async () => old.resolve(week()));
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.getWeeklyProgress).mock.calls[1].slice(0, 2)).toEqual([
      context.endDate,
      "Asia/Singapore",
    ]);
    expect(vi.mocked(api.listSessions).mock.calls[0][0]?.start).toBe("2026-11-02T16:00:00.000Z");
  });

  it("本地午夜离线仍清空旧日期和列表，恢复只刷新新的七天", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59, 59));
    vi.mocked(api.listSessions).mockResolvedValue(page([item(1)]));
    render(<WeeklyProgress />);
    await flush();
    expect(row(1)).toBeInTheDocument();
    lifecycle("connectivity", "visible", false);
    localContext = { endDate: "2026-11-04", timezone: "UTC" };
    await act(async () => vi.advanceTimersByTimeAsync(1_001));
    expect(row(1)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: t.dayList })).not.toBeInTheDocument();
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(week("2026-11-04"));
    vi.mocked(api.listSessions).mockResolvedValue(page());
    lifecycle("connectivity");
    await flush();
    expect(vi.mocked(api.getWeeklyProgress).mock.lastCall?.slice(0, 2)).toEqual([
      "2026-11-04",
      "UTC",
    ]);
  });

  it("分钟检查只检测时区，不轮询 API；时区变化后才刷新", async () => {
    vi.useFakeTimers();
    render(<WeeklyProgress />);
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
    localContext = { endDate: context.endDate, timezone: "Asia/Singapore" };
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(week(context.endDate, "Asia/Singapore"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
  });

  it("跳过的自然日直接空态，不调用旧接口的零长度日窗口", async () => {
    localContext = { endDate: "2011-12-31", timezone: "Pacific/Apia" };
    const result = week(localContext.endDate, localContext.timezone);
    result.days.forEach((day) => {
      day.completed_sessions = 0;
    });
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(result);
    render(<WeeklyProgress />);
    await flush();
    const count = vi.mocked(api.listSessions).mock.calls.length;
    choose("2011-12-30");
    expect(screen.getByText(t.empty)).toBeInTheDocument();
    expect(api.listSessions).toHaveBeenCalledTimes(count);
  });

  it("重复游标或窗外历史失败关闭，绝不把其他日期数据混入", async () => {
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce(page([item(1)], "same"))
      .mockResolvedValueOnce(page([item(2)], "same"));
    render(<WeeklyProgress />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(t.moreError);
    expect(row(2)).not.toBeInTheDocument();
    vi.mocked(api.listSessions).mockResolvedValueOnce(page([item(3, "2026-11-01")]));
    choose("2026-11-02");
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(t.historyError);
    expect(row(3)).not.toBeInTheDocument();
  });

  it.each(["anonymous", "loading", "misconfigured"] as const)("认证 %s 不发请求", async (state) => {
    snapshot = { state, principal: null };
    render(<WeeklyProgress />);
    await flush();
    expect(api.getWeeklyProgress).not.toHaveBeenCalled();
    expect(api.listSessions).not.toHaveBeenCalled();
  });

  it.each(["hidden", "offline"])("初始 %s 暂停；unknown/null 仍允许已有只读能力", async (kind) => {
    initialLifecycle =
      kind === "hidden"
        ? { visibility: "hidden", online: true }
        : { visibility: "visible", online: false };
    render(<WeeklyProgress />);
    await flush();
    expect(api.getWeeklyProgress).not.toHaveBeenCalled();
    lifecycle("resume", "hidden");
    expect(api.getWeeklyProgress).not.toHaveBeenCalled();
    act(() => {
      const adapter = adapters[0];
      adapter.snapshot = { visibility: "unknown", online: null };
      revision++;
      authListeners.forEach((listener) => listener(snapshot));
    });
    await flush();
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
  });

  it.each([23, 24, 25])("StrictMode 中 %ih 自然日按独立午夜计时而非24h夹值", async (hours) => {
    vi.useFakeTimers();
    const start = new Date("2026-11-03T00:00:00Z");
    const end = new Date(start.getTime() + hours * 3_600_000);
    vi.setSystemTime(start);
    vi.spyOn(calendar, "getLocalDayWindow").mockImplementation(() => ({
      start: start.toISOString(),
      end: end.toISOString(),
      localStartDate: start,
      localEndDate: Date.now() < end.getTime() ? end : new Date(end.getTime() + 24 * 3_600_000),
    }));
    render(
      <StrictMode>
        <WeeklyProgress />
      </StrictMode>,
    );
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(hours * 3_600_000 - 1));
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
    localContext = { endDate: "2026-11-04", timezone: "UTC" };
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(week("2026-11-04"));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.getWeeklyProgress).mock.lastCall?.[0]).toBe("2026-11-04");
  });

  it("卸载后在途 history/more 的迟到成功失败和事件都不能发出新请求", async () => {
    const pending = deferred<api.SessionListResponse>();
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce(page([item(1)], "more"))
      .mockReturnValueOnce(pending.promise);
    const mounted = render(<WeeklyProgress />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
    const signal = vi.mocked(api.listSessions).mock.lastCall?.[1]?.signal;
    mounted.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(page([item(99)])));
    expect(authListeners.size).toBe(0);
    expect(api.listSessions).toHaveBeenCalledTimes(2);
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 重挂载与卸载清理订阅、timer 和旧请求，旧失败不污染新实例", async () => {
    vi.useFakeTimers();
    const old = deferred<api.WeeklyProgressResponse>();
    vi.mocked(api.getWeeklyProgress).mockReturnValueOnce(old.promise);
    const mounted = render(
      <StrictMode>
        <WeeklyProgress />
      </StrictMode>,
    );
    await flush();
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
    expect(adapters[0].dispose).toHaveBeenCalledTimes(1);
    expect(authListeners.size).toBe(1);
    await act(async () => old.reject(new Error("strict-old")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    mounted.unmount();
    expect(authListeners.size).toBe(0);
    expect(adapters[1].dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);
  });
});
