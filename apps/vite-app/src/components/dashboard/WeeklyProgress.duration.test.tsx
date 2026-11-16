import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyProgress } from "./WeeklyProgress";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as calendar from "@/lib/localDayWindow";
import * as platform from "@/platform";

vi.mock("@/lib/api", () => ({ getWeeklyProgress: vi.fn(), listSessions: vi.fn() }));

const context = { endDate: "2026-11-03", timezone: "UTC" };
const dayListName = "最近七天的已完成会话";
const explanation = "包含连接等待、静音和暂停，不等于有效说话";

type ExtensionMap = Partial<Record<"recorded_duration_ms" | "duration_unavailable_count", unknown>>;
type DayFixture = { completed_sessions: number } & ExtensionMap;
type MutableWeek = { days: Array<Record<string, unknown>> };

function durationWeek(days: DayFixture[]): api.WeeklyProgressResponse {
  return {
    days: calendar.getZonedWeekWindows(context.endDate, context.timezone).map((day, index) => ({
      ...day,
      ...days[index],
    })),
  } as api.WeeklyProgressResponse;
}

function mutableWeek(): MutableWeek {
  return {
    days: calendar.getZonedWeekWindows(context.endDate, context.timezone).map((day) => ({
      ...day,
      completed_sessions: 0,
      recorded_duration_ms: 0,
      duration_unavailable_count: 0,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

function selectedDurationBlock(date = context.endDate): HTMLElement {
  const heading = screen.getByRole("heading", { name: `${date} 的会话历史` });
  expect(heading.parentElement).not.toBeNull();
  return heading.parentElement!;
}

describe("WeeklyProgress 已记录会话时长", () => {
  let snapshot: auth.AuthSnapshot;
  let revision: number;
  let authListeners: Set<(snapshot: auth.AuthSnapshot) => void>;
  let lifecycleListeners: Set<(event: platform.WebLifecycleEvent) => void>;
  let lifecycleSnapshot: platform.WebLifecycleSnapshot;

  beforeEach(() => {
    vi.resetAllMocks();
    revision = 1;
    snapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example", subject: "duration-review" },
    };
    authListeners = new Set();
    lifecycleListeners = new Set();
    lifecycleSnapshot = { visibility: "visible", online: true };
    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => snapshot);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => revision);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((listener) => {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    });
    vi.spyOn(calendar, "getLocalWeekContext").mockImplementation(() => ({ ...context }));
    vi.spyOn(platform, "createLifecycleAdapter").mockImplementation(() => ({
      capabilities: { webEvents: true, nativeAppState: false },
      getSnapshot: () => lifecycleSnapshot,
      subscribe: (listener) => {
        lifecycleListeners.add(listener);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      dispose: vi.fn(() => lifecycleListeners.clear()),
      whenReady: () => Promise.resolve(),
    }));
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(
      durationWeek(
        Array.from({ length: 7 }, () => ({
          completed_sessions: 0,
          recorded_duration_ms: 0,
          duration_unavailable_count: 0,
        })),
      ),
    );
    vi.mocked(api.listSessions).mockResolvedValue({ items: [], next_cursor: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("七桶精确总和、选中日切日、0/不到1秒/超过24小时与请求次数保持", async () => {
    const days: DayFixture[] = [
      { completed_sessions: 1, recorded_duration_ms: 125_951_992, duration_unavailable_count: 0 },
      { completed_sessions: 2, recorded_duration_ms: 4, duration_unavailable_count: 1 },
      { completed_sessions: 1, recorded_duration_ms: 1, duration_unavailable_count: 0 },
      { completed_sessions: 1, recorded_duration_ms: 1, duration_unavailable_count: 0 },
      { completed_sessions: 1, recorded_duration_ms: 1, duration_unavailable_count: 0 },
      { completed_sessions: 1, recorded_duration_ms: 0, duration_unavailable_count: 0 },
      { completed_sessions: 55, recorded_duration_ms: 0, duration_unavailable_count: 0 },
    ];
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(durationWeek(days));

    render(<WeeklyProgress />);
    const list = await screen.findByRole("list", { name: dayListName });
    const section = screen.getByTestId("weekly-progress");

    expect(section).toHaveTextContent(/已记录会话时长\s*34小时59分11秒/);
    expect(section).toHaveTextContent(explanation);
    expect(section).toHaveTextContent("另有 1 条不可计算");
    expect(selectedDurationBlock()).toHaveTextContent(/已记录会话时长\s*0秒/);
    expect(within(list).getAllByRole("button")).toHaveLength(7);
    expect(
      within(list).getByRole("button", {
        name: "2026-11-03，已完成会话 55 次",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(list).getByRole("button", {
        name: "2026-10-28，已完成会话 1 次",
      }),
    );
    await flush();
    expect(selectedDurationBlock("2026-10-28")).toHaveTextContent(
      /已记录会话时长\s*34小时59分11秒/,
    );

    fireEvent.click(
      within(list).getByRole("button", {
        name: "2026-10-29，已完成会话 2 次",
      }),
    );
    await flush();
    const selected = selectedDurationBlock("2026-10-29");
    expect(selected).toHaveTextContent(/已记录会话时长\s*不到1秒/);
    expect(selected).toHaveTextContent("另有 1 条不可计算");
    expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["无会话", 0, 0, 0, "0秒", false],
    ["可计算会话的合法零时长", 1, 0, 0, "0秒", false],
    ["有会话但全部不可计算", 2, 0, 2, "暂无可用时长", true],
    ["部分会话可计算", 2, 2_500, 1, "2秒", true],
  ] as const)(
    "%s 明确区分 0、暂无可用时长与部分缺失",
    async (_label, completed, duration, unavailable, expected, hasMissing) => {
      const days: DayFixture[] = Array.from({ length: 7 }, () => ({
        completed_sessions: 0,
        recorded_duration_ms: 0,
        duration_unavailable_count: 0,
      }));
      days[6] = {
        completed_sessions: completed,
        recorded_duration_ms: duration,
        duration_unavailable_count: unavailable,
      };
      vi.mocked(api.getWeeklyProgress).mockResolvedValue(durationWeek(days));

      render(<WeeklyProgress />);
      await screen.findByRole("list", { name: dayListName });
      const weeklyTotal = screen.getByTestId("weekly-recorded-duration-total");
      const selected = selectedDurationBlock();

      expect(selected).toHaveTextContent("已记录会话时长");
      expect(selected).toHaveTextContent(expected);
      expect(weeklyTotal).toHaveTextContent(expected);
      if (hasMissing) {
        expect(selected).toHaveTextContent(`另有 ${unavailable} 条不可计算`);
      } else {
        expect(selected).not.toHaveTextContent("另有");
      }
      if (expected === "暂无可用时长") {
        expect(selected).not.toHaveTextContent("已记录会话时长 0秒");
      }
    },
  );

  it.each([
    [
      "缺少时长字段",
      (week: MutableWeek) => {
        delete week.days[6].recorded_duration_ms;
      },
      true,
    ],
    [
      "时长为 null",
      (week: MutableWeek) => {
        week.days[6].recorded_duration_ms = null;
      },
      true,
    ],
    [
      "时长非法字符串",
      (week: MutableWeek) => {
        week.days[6].recorded_duration_ms = "1";
      },
      true,
    ],
    [
      "缺少不可计算计数",
      (week: MutableWeek) => {
        delete week.days[6].duration_unavailable_count;
      },
      true,
    ],
    [
      "不可计算计数为 null",
      (week: MutableWeek) => {
        week.days[6].duration_unavailable_count = null;
      },
      true,
    ],
    [
      "单个扩展超出安全整数",
      (week: MutableWeek) => {
        week.days[6].recorded_duration_ms = Number.MAX_SAFE_INTEGER + 1;
      },
      true,
    ],
    [
      "不可计算计数超过 completed",
      (week: MutableWeek) => {
        week.days[6].completed_sessions = 1;
        week.days[6].recorded_duration_ms = 0;
        week.days[6].duration_unavailable_count = 2;
      },
      true,
    ],
    [
      "无可计算会话却出现正时长",
      (week: MutableWeek) => {
        week.days[6].completed_sessions = 1;
        week.days[6].recorded_duration_ms = 1;
        week.days[6].duration_unavailable_count = 1;
      },
      true,
    ],
    [
      "七个安全整数求和溢出",
      (week: MutableWeek) => {
        week.days[0].completed_sessions = 1;
        week.days[0].recorded_duration_ms = Number.MAX_SAFE_INTEGER - 1;
        week.days[1].completed_sessions = 1;
        week.days[1].recorded_duration_ms = 2;
      },
      false,
    ],
  ] as const)("%s 时周总精确降为未知，不夹断为数字", async (_label, mutate, selectedUnknown) => {
    const week = mutableWeek();
    mutate(week);
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(
      week as unknown as api.WeeklyProgressResponse,
    );

    render(<WeeklyProgress />);
    await screen.findByRole("list", { name: dayListName });

    const weeklyTotal = screen.getByTestId("weekly-recorded-duration-total");
    expect(weeklyTotal).toHaveTextContent(/已记录会话时长未知/);
    if (selectedUnknown) {
      expect(selectedDurationBlock()).toHaveTextContent(/已记录会话时长未知/);
    } else {
      expect(selectedDurationBlock()).toHaveTextContent(/已记录会话时长\s*0秒/);
    }
  });

  it("七桶全部缺少两个扩展时周总未知且不伪造已知 0", async () => {
    const week = mutableWeek();
    for (const day of week.days) {
      delete day.recorded_duration_ms;
      delete day.duration_unavailable_count;
    }
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(
      week as unknown as api.WeeklyProgressResponse,
    );

    render(<WeeklyProgress />);
    await screen.findByRole("list", { name: dayListName });

    const weeklyTotal = screen.getByTestId("weekly-recorded-duration-total");
    expect(weeklyTotal).toHaveTextContent(/已记录会话时长未知/);
    expect(weeklyTotal).not.toHaveTextContent("已知 0 条不可计算");
  });

  it("部分数据仍可验证缺失计数时只提示已知且明确明细不完整", async () => {
    const week = mutableWeek();
    week.days[0].completed_sessions = 3;
    week.days[0].recorded_duration_ms = 5_000;
    week.days[0].duration_unavailable_count = 2;
    week.days[1].completed_sessions = 1;
    delete week.days[1].duration_unavailable_count;
    vi.mocked(api.getWeeklyProgress).mockResolvedValue(
      week as unknown as api.WeeklyProgressResponse,
    );

    render(<WeeklyProgress />);
    await screen.findByRole("list", { name: dayListName });

    const weeklyTotal = screen.getByTestId("weekly-recorded-duration-total");
    expect(weeklyTotal).toHaveTextContent(/已记录会话时长未知/);
    expect(weeklyTotal).toHaveTextContent("已知 2 条不可计算（明细不完整）");
  });

  it("认证 revision 使旧响应隔离，新响应才更新时长与请求次数", async () => {
    const old = deferred<api.WeeklyProgressResponse>();
    const oldResponse = durationWeek(
      Array.from({ length: 7 }, () => ({
        completed_sessions: 1,
        recorded_duration_ms: 6_000,
        duration_unavailable_count: 0,
      })),
    );
    const next = durationWeek(
      Array.from({ length: 7 }, () => ({
        completed_sessions: 1,
        recorded_duration_ms: 7_000,
        duration_unavailable_count: 0,
      })),
    );
    vi.mocked(api.getWeeklyProgress).mockReturnValueOnce(old.promise).mockResolvedValueOnce(next);

    render(<WeeklyProgress />);
    try {
      expect(api.getWeeklyProgress).toHaveBeenCalledTimes(1);

      revision += 1;
      act(() => {
        authListeners.forEach((listener) => listener(snapshot));
      });
      act(() => {
        lifecycleListeners.forEach((listener) =>
          listener({ type: "resume", snapshot: lifecycleSnapshot }),
        );
      });
      expect(api.getWeeklyProgress).toHaveBeenCalledTimes(2);

      await act(async () => old.resolve(oldResponse));
      await flush();
      expect(screen.queryByText(/已记录会话时长 6秒/)).not.toBeInTheDocument();

      await screen.findByRole("list", { name: dayListName });
      const section = screen.getByTestId("weekly-progress");
      expect(section).toHaveTextContent(/已记录会话时长\s*7秒/);
      expect(section).not.toHaveTextContent(/已记录会话时长\s*6秒/);
      expect(api.listSessions).toHaveBeenCalledTimes(1);
    } finally {
      old.resolve(oldResponse);
    }
  });
});
