import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DailyProgress } from "./DailyProgress";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as localDayWindow from "@/lib/localDayWindow";

vi.mock("@/lib/api", () => ({
  listSessions: vi.fn(),
  getDailyProgress: vi.fn(),
  getSessionDetail: vi.fn(),
}));

describe("DailyProgress component", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(auth, "getAuthSnapshot").mockReturnValue({
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    });
    vi.spyOn(auth, "getAuthRevision").mockReturnValue(1);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation(() => () => {});
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([0, 5, 20, 25])(
    "keeps the accessible value in range for %i turns (zero getSessionDetail calls)",
    async (turns) => {
      vi.mocked(api.getDailyProgress).mockResolvedValue({
        completed_sessions: 1,
        total_turns: turns,
      });

      vi.mocked(api.listSessions).mockResolvedValue({
        items: [
          {
            id: "38752299-15c9-4423-8920-dea740cc4801",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: null,
      });

      render(<DailyProgress />);

      await waitFor(() => {
        const progressbar = screen.getByRole("progressbar");
        expect(progressbar).toBeInTheDocument();
        expect(progressbar).toHaveAttribute("aria-valuenow", String(Math.min(turns, 20)));
        expect(progressbar).toHaveAttribute("aria-valuemin", "0");
        expect(progressbar).toHaveAttribute("aria-valuemax", "20");
        expect(progressbar).toHaveAttribute("aria-valuetext", `${turns} / 20`);
        expect(progressbar).toHaveAttribute("aria-label", "对话轮次目标");
        expect(progressbar.firstElementChild).toHaveStyle({
          width: `${Math.min(turns / 20, 1) * 100}%`,
        });
      });

      // 验证绝无 getSessionDetail N+1 查询
      expect(api.getSessionDetail).not.toHaveBeenCalled();
    },
  );

  it("handles >50 completed sessions accurately without truncating aggregate turns", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 65,
      total_turns: 130,
    });

    vi.mocked(api.listSessions).mockResolvedValue({
      items: Array.from({ length: 50 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        mode: "free_talk",
        status: "completed",
        started_at: "2026-10-25T10:00:00Z",
        ended_at: "2026-10-25T10:05:00Z",
      })),
      next_cursor: "valid-cursor-token-page-2",
    });

    render(<DailyProgress />);

    await waitFor(() => {
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "20");
      expect(progressbar).toHaveAttribute("aria-valuetext", "130 / 20");
      expect(screen.getByText("Goal reached!")).toBeInTheDocument();
      expect(screen.getByTestId("load-more-daily-button")).toBeInTheDocument();
    });

    expect(api.getSessionDetail).not.toHaveBeenCalled();
  });

  it("loads more completed sessions on explicit button click and deduplicates", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 3,
      total_turns: 15,
    });

    vi.mocked(api.listSessions)
      .mockResolvedValueOnce({
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "page-2-cursor",
      })
      .mockResolvedValueOnce({
        items: [
          // 重复项应被自动去重
          {
            id: "11111111-1111-4111-8111-111111111111",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-25T09:00:00Z",
            ended_at: "2026-10-25T09:10:00Z",
          },
        ],
        next_cursor: null,
      });

    render(<DailyProgress />);

    await waitFor(() => {
      expect(
        screen.getByTestId("daily-session-item-11111111-1111-4111-8111-111111111111"),
      ).toBeInTheDocument();
    });

    const loadMoreBtn = screen.getByTestId("load-more-daily-button");
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(
        screen.getByTestId("daily-session-item-22222222-2222-4222-8222-222222222222"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("load-more-daily-button")).not.toBeInTheDocument();
    });
  });

  it("handles load more error gracefully with retry option", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 2,
      total_turns: 10,
    });

    vi.mocked(api.listSessions)
      .mockResolvedValueOnce({
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "page-2-cursor",
      })
      .mockRejectedValueOnce(new Error("Network failed"));

    render(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-daily-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("load-more-daily-button"));

    await waitFor(() => {
      expect(screen.getByTestId("load-more-daily-error")).toBeInTheDocument();
      // 已有条目必须保留
      expect(
        screen.getByTestId("daily-session-item-11111111-1111-4111-8111-111111111111"),
      ).toBeInTheDocument();
    });
  });

  it("clears state immediately when auth is unauthenticated and does not request", () => {
    vi.spyOn(auth, "getAuthSnapshot").mockReturnValue({
      state: "anonymous",
      principal: null,
    });

    render(<DailyProgress />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(api.getDailyProgress).not.toHaveBeenCalled();
    expect(api.listSessions).not.toHaveBeenCalled();
  });

  it("clears old stats and shows error with retry when refresh fails across midnight or window change", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 5,
      total_turns: 10,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T10:00:00Z",
          ended_at: "2026-10-25T10:05:00Z",
        },
      ],
      next_cursor: null,
    });

    render(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
      expect(
        screen.getByTestId("daily-session-item-11111111-1111-4111-8111-111111111111"),
      ).toBeInTheDocument();
    });

    // 准备下一次刷新（如网络断开后重连）失败
    vi.mocked(api.getDailyProgress).mockRejectedValueOnce(new Error("Midnight refresh failed"));
    vi.mocked(api.listSessions).mockRejectedValueOnce(new Error("Midnight refresh failed"));

    // 触发 offline -> online 生命周期事件触发重新加载
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));

    await waitFor(() => {
      // 旧统计与列表已被清空
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("daily-session-item-11111111-1111-4111-8111-111111111111"),
      ).not.toBeInTheDocument();
      // 展示标准 alert 错误与重试按钮
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    });

    // 点击重试恢复
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 1,
      total_turns: 2,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [],
      next_cursor: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("invalidates in-flight loadMore request when lifecycle goes offline and clears pagination button", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 2,
      total_turns: 4,
    });

    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "item-page-1",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T10:00:00Z",
          ended_at: "2026-10-25T10:05:00Z",
        },
      ],
      next_cursor: "cursor-p2",
    });

    let resolveLoadMore!: (val: any) => void;
    const loadMorePromise = new Promise((res) => {
      resolveLoadMore = res;
    });

    render(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-daily-button")).toBeInTheDocument();
    });

    // 此时设置下一次 listSessions 为延迟返回
    vi.mocked(api.listSessions).mockReturnValueOnce(loadMorePromise as any);

    // 发起 loadMore
    fireEvent.click(screen.getByTestId("load-more-daily-button"));
    expect(screen.getByTestId("load-more-daily-button")).toBeDisabled();

    // 触发 offline 挂起生命周期，作废旧 cursor 与在途请求
    window.dispatchEvent(new Event("offline"));

    await waitFor(() => {
      // 契约要求：生命周期失效后清空旧游标，加载更多按钮彻底消失
      expect(screen.queryByTestId("load-more-daily-button")).not.toBeInTheDocument();
    });

    // 旧在途请求迟到返回
    resolveLoadMore({
      items: [
        {
          id: "item-stale-p2",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T09:00:00Z",
          ended_at: "2026-10-25T09:05:00Z",
        },
      ],
      next_cursor: null,
    });

    await act(async () => {
      await Promise.resolve();
    });

    // 验证：作废的请求返回不污染列表
    expect(screen.queryByTestId("daily-session-item-item-stale-p2")).not.toBeInTheDocument();

    // 恢复 online 后重新从第一页只读刷新
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 3,
      total_turns: 6,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "item-page-1",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T10:00:00Z",
          ended_at: "2026-10-25T10:05:00Z",
        },
        {
          id: "item-page-1-recovered",
          mode: "free_talk",
          status: "completed",
          started_at: "2026-10-25T10:10:00Z",
          ended_at: "2026-10-25T10:20:00Z",
        },
      ],
      next_cursor: "cursor-p2-fresh",
    });

    window.dispatchEvent(new Event("online"));

    await waitFor(() => {
      expect(screen.getByTestId("daily-session-item-item-page-1-recovered")).toBeInTheDocument();
      expect(screen.getByTestId("load-more-daily-button")).toBeInTheDocument();
    });
  });

  it("invalidates in-flight loadMore request when visibility becomes hidden and clears pagination button", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 2,
      total_turns: 4,
    });

    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "item-page-1",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T10:00:00Z",
          ended_at: "2026-10-25T10:05:00Z",
        },
      ],
      next_cursor: "cursor-p2",
    });

    let resolveLoadMore!: (val: any) => void;
    const loadMorePromise = new Promise((res) => {
      resolveLoadMore = res;
    });

    render(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByTestId("load-more-daily-button")).toBeInTheDocument();
    });

    vi.mocked(api.listSessions).mockReturnValueOnce(loadMorePromise as any);

    // 发起 loadMore
    fireEvent.click(screen.getByTestId("load-more-daily-button"));
    expect(screen.getByTestId("load-more-daily-button")).toBeDisabled();

    // 触发 hidden 挂起生命周期
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      // 游标已清空，加载更多按钮彻底消失
      expect(screen.queryByTestId("load-more-daily-button")).not.toBeInTheDocument();
    });

    resolveLoadMore({
      items: [
        {
          id: "item-stale-hidden-p2",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T09:00:00Z",
          ended_at: "2026-10-25T09:05:00Z",
        },
      ],
      next_cursor: null,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("daily-session-item-item-stale-hidden-p2")).not.toBeInTheDocument();

    // 回前台恢复
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  it("offline across midnight clears yesterday stats and sessions without sending network requests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 设定时间为当天 23:59:58
    const baseDate = new Date(2026, 9, 25, 23, 59, 58);
    vi.setSystemTime(baseDate);

    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 17,
      total_turns: 20,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "yesterday-session-1",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T23:00:00Z",
          ended_at: "2026-10-25T23:10:00Z",
        },
      ],
      next_cursor: "yesterday-p2",
    });

    render(<DailyProgress />);

    // 运行初始 Promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByTestId("daily-session-item-yesterday-session-1")).toBeInTheDocument();
    expect(screen.getByTestId("load-more-daily-button")).toBeInTheDocument();

    // 模拟离线
    window.dispatchEvent(new Event("offline"));

    // 推进 4 秒跨过午夜到次日 00:00:02
    vi.mocked(api.getDailyProgress).mockClear();
    vi.mocked(api.listSessions).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      await Promise.resolve();
    });

    // 验证：跨午夜后昨日统计与会话已彻底清空，不展示昨日为今日
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("daily-session-item-yesterday-session-1"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("load-more-daily-button")).not.toBeInTheDocument();
    });

    // 验证：离线状态下绝不发送网络请求
    expect(api.getDailyProgress).not.toHaveBeenCalled();
    expect(api.listSessions).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("online across midnight refreshes new day data and delayed old aggregate response is ignored", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const baseDate = new Date(2026, 9, 25, 23, 59, 58);
    vi.setSystemTime(baseDate);

    let resolveOldAggregate!: (val: any) => void;
    const oldAggregatePromise = new Promise((res) => {
      resolveOldAggregate = res;
    });

    vi.mocked(api.getDailyProgress).mockReturnValueOnce(oldAggregatePromise as any);
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "yesterday-session-1",
          mode: "scenario",
          status: "completed",
          started_at: "2026-10-25T23:00:00Z",
          ended_at: "2026-10-25T23:10:00Z",
        },
      ],
      next_cursor: null,
    });

    render(<DailyProgress />);

    // 跨过午夜
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 1,
      total_turns: 2,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "today-session-1",
          mode: "free_talk",
          status: "completed",
          started_at: "2026-10-26T00:01:00Z",
          ended_at: "2026-10-26T00:05:00Z",
        },
      ],
      next_cursor: null,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
      expect(screen.getByTestId("daily-session-item-today-session-1")).toBeInTheDocument();
    });

    // 旧日迟到的聚合响应返回：total_turns 为 100
    resolveOldAggregate({
      completed_sessions: 50,
      total_turns: 100,
    });

    await act(async () => {
      await Promise.resolve();
    });

    // 验证：旧日迟到响应不覆盖新日 progressbar (依然是 2)
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.queryByTestId("daily-session-item-yesterday-session-1")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("deduplicates identical session IDs within the same first page and subsequent page", async () => {
    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 3,
      total_turns: 6,
    });

    // 第一页返回两个相同的 ID
    vi.mocked(api.listSessions)
      .mockResolvedValueOnce({
        items: [
          {
            id: "dup-id-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
          {
            id: "dup-id-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "page-2-cursor",
      })
      // 第二页不仅包含第一页的 dup-id-1，还包含两个自身重复的 dup-id-2
      .mockResolvedValueOnce({
        items: [
          {
            id: "dup-id-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
          {
            id: "dup-id-2",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-25T09:00:00Z",
            ended_at: "2026-10-25T09:05:00Z",
          },
          {
            id: "dup-id-2",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-25T09:00:00Z",
            ended_at: "2026-10-25T09:05:00Z",
          },
        ],
        next_cursor: null,
      });

    render(<DailyProgress />);

    await waitFor(() => {
      const items = screen.getAllByTestId("daily-session-item-dup-id-1");
      expect(items).toHaveLength(1);
    });

    fireEvent.click(screen.getByTestId("load-more-daily-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("daily-session-item-dup-id-1")).toHaveLength(1);
      expect(screen.getAllByTestId("daily-session-item-dup-id-2")).toHaveLength(1);
    });
  });

  it("25h DST day (New York 2026-11-01): advances 24h+1s confirming yesterday remains, then advances +1h+1s to reach actual midnight and refreshes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 纽约 2026-11-01T04:00:00Z 为午夜 00:00:00，次日午夜为 2026-11-02T05:00:00Z（25小时日）
    const dayStart = new Date("2026-11-01T04:00:00.000Z");
    const dayEnd = new Date("2026-11-02T05:00:00.000Z");
    const nextDayEnd = new Date("2026-11-03T05:00:00.000Z");

    vi.setSystemTime(dayStart);

    let currentWindow = {
      start: dayStart.toISOString(),
      end: dayEnd.toISOString(),
      localStartDate: dayStart,
      localEndDate: dayEnd,
    };
    vi.spyOn(localDayWindow, "getLocalDayWindow").mockImplementation(() => currentWindow);

    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 17,
      total_turns: 20,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "yesterday-session-1",
          mode: "scenario",
          status: "completed",
          started_at: "2026-11-01T10:00:00Z",
          ended_at: "2026-11-01T10:05:00Z",
        },
      ],
      next_cursor: null,
    });

    render(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
      expect(screen.getByTestId("daily-session-item-yesterday-session-1")).toBeInTheDocument();
    });

    // 第 1 步推进：推进 24h + 1s (86_400_000 + 1000 ms)
    // 此时纽约时间为 23:00:01，还差 1 小时才到午夜，窗口仍是 2026-11-01
    await act(async () => {
      await vi.advanceTimersByTimeAsync(86_400_000 + 1000);
      await Promise.resolve();
    });

    // 确认：仍显示昨日数据，没有进入新日
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByTestId("daily-session-item-yesterday-session-1")).toBeInTheDocument();

    // 准备新日 mock 数据
    currentWindow = {
      start: dayEnd.toISOString(),
      end: nextDayEnd.toISOString(),
      localStartDate: dayEnd,
      localEndDate: nextDayEnd,
    };
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 3,
      total_turns: 6,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "today-session-1",
          mode: "free_talk",
          status: "completed",
          started_at: "2026-11-02T05:01:00Z",
          ended_at: "2026-11-02T05:05:00Z",
        },
      ],
      next_cursor: null,
    });

    // 第 2 步推进：再推进 1h + 1s (3_600_000 + 1000 ms)，到达真正次日午夜
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000 + 1000);
      await Promise.resolve();
    });

    // 确认：准时触发次日午夜刷新，昨日项目清空，显示新日数据 6
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
      expect(screen.getByTestId("daily-session-item-today-session-1")).toBeInTheDocument();
      expect(
        screen.queryByTestId("daily-session-item-yesterday-session-1"),
      ).not.toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it.each([
    { name: "23h DST day (New York 2026-03-08)", durationMs: 23 * 3600_000 },
    { name: "24h standard day", durationMs: 24 * 3600_000 },
  ])("$name: schedules accurate timer and refreshes at midnight", async ({ durationMs }) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const dayStart = new Date("2026-03-08T05:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + durationMs);
    const nextDayEnd = new Date(dayEnd.getTime() + 24 * 3600_000);

    vi.setSystemTime(dayStart);

    let currentWindow = {
      start: dayStart.toISOString(),
      end: dayEnd.toISOString(),
      localStartDate: dayStart,
      localEndDate: dayEnd,
    };
    vi.spyOn(localDayWindow, "getLocalDayWindow").mockImplementation(() => currentWindow);

    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 1,
      total_turns: 5,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "session-prev",
          mode: "scenario",
          status: "completed",
          started_at: dayStart.toISOString(),
          ended_at: dayStart.toISOString(),
        },
      ],
      next_cursor: null,
    });

    render(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
    });

    // 切换至次日窗口
    currentWindow = {
      start: dayEnd.toISOString(),
      end: nextDayEnd.toISOString(),
      localStartDate: dayEnd,
      localEndDate: nextDayEnd,
    };
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 2,
      total_turns: 10,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "session-new",
          mode: "free_talk",
          status: "completed",
          started_at: dayEnd.toISOString(),
          ended_at: dayEnd.toISOString(),
        },
      ],
      next_cursor: null,
    });

    // 推进全时长 + 1s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(durationMs + 1000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
      expect(screen.getByTestId("daily-session-item-session-new")).toBeInTheDocument();
      expect(screen.queryByTestId("daily-session-item-session-prev")).not.toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it("retains midnight timer across StrictMode effect cleanup & replay and refreshes on midnight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const dayStart = new Date("2026-10-25T00:00:00.000Z");
    const dayEnd = new Date("2026-10-26T00:00:00.000Z");
    const nextDayEnd = new Date("2026-10-27T00:00:00.000Z");

    vi.setSystemTime(dayStart);

    let currentWindow = {
      start: dayStart.toISOString(),
      end: dayEnd.toISOString(),
      localStartDate: dayStart,
      localEndDate: dayEnd,
    };
    vi.spyOn(localDayWindow, "getLocalDayWindow").mockImplementation(() => currentWindow);

    vi.mocked(api.getDailyProgress).mockResolvedValue({
      completed_sessions: 1,
      total_turns: 4,
    });
    vi.mocked(api.listSessions).mockResolvedValue({
      items: [
        {
          id: "strict-session-1",
          mode: "scenario",
          status: "completed",
          started_at: dayStart.toISOString(),
          ended_at: dayStart.toISOString(),
        },
      ],
      next_cursor: null,
    });

    // 使用真实 React.StrictMode 渲染
    render(
      <React.StrictMode>
        <DailyProgress />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    });

    // 切换至次日窗口
    currentWindow = {
      start: dayEnd.toISOString(),
      end: nextDayEnd.toISOString(),
      localStartDate: dayEnd,
      localEndDate: nextDayEnd,
    };
    vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
      completed_sessions: 2,
      total_turns: 8,
    });
    vi.mocked(api.listSessions).mockResolvedValueOnce({
      items: [
        {
          id: "strict-session-2",
          mode: "free_talk",
          status: "completed",
          started_at: dayEnd.toISOString(),
          ended_at: dayEnd.toISOString(),
        },
      ],
      next_cursor: null,
    });

    // 推进 24h + 1s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(86_400_000 + 1000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "8");
      expect(screen.getByTestId("daily-session-item-strict-session-2")).toBeInTheDocument();
      expect(screen.queryByTestId("daily-session-item-strict-session-1")).not.toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  describe("DailyProgress loadMore deferred lifecycle and concurrency", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("invalidates in-flight loadMore when auth principal switches and ignores late response", async () => {
      let authCallback: ((snap: auth.AuthSnapshot) => void) | null = null;
      vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((cb) => {
        authCallback = cb;
        return () => {};
      });

      vi.mocked(api.getDailyProgress).mockResolvedValue({
        completed_sessions: 2,
        total_turns: 5,
      });

      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "user1-session-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "user1-cursor-p2",
      });

      let resolveLoadMore!: (val: any) => void;
      const loadMorePromise = new Promise((res) => {
        resolveLoadMore = res;
      });
      vi.mocked(api.listSessions).mockReturnValueOnce(loadMorePromise as any);

      render(<DailyProgress />);

      await waitFor(() => {
        expect(screen.getByTestId("daily-session-item-user1-session-1")).toBeInTheDocument();
      });

      const moreBtn = screen.getByTestId("load-more-daily-button");
      fireEvent.click(moreBtn);

      // 此时切号给 user-2
      act(() => {
        authCallback?.({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        });
      });

      // user-1 的迟到 loadMore 响应返回
      await act(async () => {
        resolveLoadMore({
          items: [
            {
              id: "user1-session-late",
              mode: "scenario",
              status: "completed",
              started_at: "2026-10-25T09:00:00Z",
              ended_at: "2026-10-25T09:05:00Z",
            },
          ],
          next_cursor: null,
        });
        await Promise.resolve();
      });

      // 验证 user-1 的迟到项目绝不被渲染
      expect(screen.queryByTestId("daily-session-item-user1-session-late")).not.toBeInTheDocument();
    });

    it("invalidates in-flight loadMore when auth revision advances", async () => {
      let authCallback: ((snap: auth.AuthSnapshot) => void) | null = null;
      vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((cb) => {
        authCallback = cb;
        return () => {};
      });

      vi.mocked(api.getDailyProgress).mockResolvedValue({
        completed_sessions: 2,
        total_turns: 5,
      });

      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "rev-session-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "rev-cursor-p2",
      });

      let resolveLoadMore!: (val: any) => void;
      const loadMorePromise = new Promise((res) => {
        resolveLoadMore = res;
      });
      vi.mocked(api.listSessions).mockReturnValueOnce(loadMorePromise as any);

      render(<DailyProgress />);

      await waitFor(() => {
        expect(screen.getByTestId("daily-session-item-rev-session-1")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("load-more-daily-button"));

      // 递增 revision
      vi.spyOn(auth, "getAuthRevision").mockReturnValue(2);
      act(() => {
        authCallback?.({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
        });
      });

      // 旧 revision 的 loadMore 返回
      await act(async () => {
        resolveLoadMore({
          items: [
            {
              id: "rev-session-late",
              mode: "scenario",
              status: "completed",
              started_at: "2026-10-25T09:00:00Z",
              ended_at: "2026-10-25T09:05:00Z",
            },
          ],
          next_cursor: null,
        });
        await Promise.resolve();
      });

      expect(screen.queryByTestId("daily-session-item-rev-session-late")).not.toBeInTheDocument();
    });

    it("prevents late finally of old loadMore from clearing new loadMore loading state", async () => {
      vi.mocked(api.getDailyProgress).mockResolvedValue({
        completed_sessions: 3,
        total_turns: 8,
      });

      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "fin-session-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "fin-cursor-p2",
      });

      let resolveOldMore!: (val: any) => void;
      const oldMorePromise = new Promise((res) => {
        resolveOldMore = res;
      });

      let resolveNewMore!: (val: any) => void;
      const newMorePromise = new Promise((res) => {
        resolveNewMore = res;
      });

      render(<DailyProgress />);

      await waitFor(() => {
        expect(screen.getByTestId("daily-session-item-fin-session-1")).toBeInTheDocument();
      });

      // 发起第 1 次 loadMore
      vi.mocked(api.listSessions).mockReturnValueOnce(oldMorePromise as any);
      fireEvent.click(screen.getByTestId("load-more-daily-button"));

      // 模拟离线后恢复在线（触发生命周期作废旧请求并重新拉取第一页）
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      vi.mocked(api.getDailyProgress).mockResolvedValueOnce({
        completed_sessions: 3,
        total_turns: 8,
      });
      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "fin-session-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "fin-cursor-p2",
      });

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await act(async () => {
        await Promise.resolve();
      });

      // 发起新第 2 次 loadMore
      vi.mocked(api.listSessions).mockReturnValueOnce(newMorePromise as any);
      fireEvent.click(screen.getByTestId("load-more-daily-button"));
      expect(screen.getByTestId("load-more-daily-button")).toBeDisabled();

      // 旧 loadMore finally 结算
      await act(async () => {
        resolveOldMore({
          items: [
            {
              id: "stale-item",
              mode: "scenario",
              status: "completed",
              started_at: "2026-10-25T08:00:00Z",
              ended_at: "2026-10-25T08:05:00Z",
            },
          ],
          next_cursor: null,
        });
        await Promise.resolve();
      });

      // 验证：新在途请求依然保持禁用/loading，没有被旧 finally 误清
      expect(screen.getByTestId("load-more-daily-button")).toBeDisabled();
      expect(screen.queryByTestId("daily-session-item-stale-item")).not.toBeInTheDocument();

      // 新 loadMore 正常返回
      await act(async () => {
        resolveNewMore({
          items: [
            {
              id: "fresh-item",
              mode: "scenario",
              status: "completed",
              started_at: "2026-10-25T09:00:00Z",
              ended_at: "2026-10-25T09:05:00Z",
            },
          ],
          next_cursor: null,
        });
        await Promise.resolve();
      });

      expect(screen.getByTestId("daily-session-item-fresh-item")).toBeInTheDocument();
      expect(screen.queryByTestId("load-more-daily-button")).not.toBeInTheDocument();
    });

    it("supports explicit retry with identical cursor after loadMore error", async () => {
      vi.mocked(api.getDailyProgress).mockResolvedValue({
        completed_sessions: 2,
        total_turns: 4,
      });

      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "retry-session-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "same-cursor-abc",
      });

      render(<DailyProgress />);

      await waitFor(() => {
        expect(screen.getByTestId("daily-session-item-retry-session-1")).toBeInTheDocument();
      });

      // 第一次 loadMore 抛错
      vi.mocked(api.listSessions).mockRejectedValueOnce(new Error("Network failed"));
      fireEvent.click(screen.getByTestId("load-more-daily-button"));

      await waitFor(() => {
        expect(screen.getByTestId("load-more-daily-error")).toBeInTheDocument();
      });

      // 第二次点击重试，恢复成功
      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "retry-session-2",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-25T09:00:00Z",
            ended_at: "2026-10-25T09:05:00Z",
          },
        ],
        next_cursor: null,
      });

      fireEvent.click(screen.getByTestId("load-more-daily-button"));

      await waitFor(() => {
        expect(screen.getByTestId("daily-session-item-retry-session-2")).toBeInTheDocument();
        expect(screen.queryByTestId("load-more-daily-button")).not.toBeInTheDocument();
      });

      // 验证重试时传入的参数仍然是原本的 same-cursor-abc
      expect(vi.mocked(api.listSessions)).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "same-cursor-abc" }),
      );
    });

    it("deduplicates double click on load-more button so only one request is sent", async () => {
      vi.mocked(api.getDailyProgress).mockResolvedValue({
        completed_sessions: 2,
        total_turns: 4,
      });

      vi.mocked(api.listSessions).mockResolvedValueOnce({
        items: [
          {
            id: "click-session-1",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: "2026-10-25T10:05:00Z",
          },
        ],
        next_cursor: "double-click-cursor",
      });

      let resolveSlowMore!: (val: any) => void;
      const slowMorePromise = new Promise((res) => {
        resolveSlowMore = res;
      });
      vi.mocked(api.listSessions).mockReturnValueOnce(slowMorePromise as any);

      render(<DailyProgress />);

      await waitFor(() => {
        expect(screen.getByTestId("daily-session-item-click-session-1")).toBeInTheDocument();
      });

      const btn = screen.getByTestId("load-more-daily-button");
      // 双击
      fireEvent.click(btn);
      fireEvent.click(btn);

      // 验证 listSessions 只被调用了 2 次（1 次首屏，1 次 loadMore，第二次点击被防抖/锁阻断）
      expect(api.listSessions).toHaveBeenCalledTimes(2);

      await act(async () => {
        resolveSlowMore({
          items: [
            {
              id: "click-session-2",
              mode: "scenario",
              status: "completed",
              started_at: "2026-10-25T09:00:00Z",
              ended_at: "2026-10-25T09:05:00Z",
            },
          ],
          next_cursor: null,
        });
        await Promise.resolve();
      });

      expect(screen.getByTestId("daily-session-item-click-session-2")).toBeInTheDocument();
    });
  });
});
