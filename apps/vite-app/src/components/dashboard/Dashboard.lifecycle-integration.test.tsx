import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import * as auth from "@/lib/auth";
import type { SessionListItem } from "@/lib/api";
import { getZonedWeekWindows } from "@/lib/localDayWindow";
import { useAppStore } from "@/store/appStore";
import { zhCN } from "@/i18n/zh-CN";

interface NativeAppListener {
  (state: { isActive: boolean }): void;
}

const nativeAppMock = vi.hoisted(() => ({
  listeners: new Set<NativeAppListener>(),
  addListener: vi.fn(),
  getState: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (...args: unknown[]) => nativeAppMock.addListener(...args),
    getState: (...args: unknown[]) => nativeAppMock.getState(...args),
  },
}));

const PRINCIPAL: auth.AuthPrincipal = {
  issuer: "https://auth.example.test",
  subject: "dashboard-lifecycle-user",
};

const ACTIVE_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DAILY_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NEW_DAILY_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const WEEKLY_SESSION_ID = "44444444-4444-4444-8444-444444444444";
const SELECTED_WEEKLY_SESSION_ID = "55555555-5555-4555-8555-555555555555";
const RECENT_WEEKLY_SESSION_ID = "66666666-6666-4666-8666-666666666666";

const tDashboard = zhCN.dashboard;
const tWeeklyProgress = zhCN.weeklyProgress;

type RouteKind =
  | "knowledge"
  | "recommendation"
  | "active"
  | "dailyProgress"
  | "dailySessions"
  | "weekly"
  | "grammar"
  | "weeklyHistory";

interface FetchRecord {
  kind: RouteKind;
  index: number;
  method: string;
  url: URL;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly settled: () => boolean;
}

type Responder = (index: number, url: URL) => Response | Promise<Response>;
type ResponderMap = Partial<Record<RouteKind, Responder>>;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let isSettled = false;
  const promise = new Promise<T>((res) => {
    resolve = (value) => {
      isSettled = true;
      res(value);
    };
  });
  return {
    promise,
    resolve,
    settled: () => isSettled,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readRequestUrl(input: RequestInfo | URL): URL {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  return new URL(raw, window.location.origin);
}

function findApiPath(url: URL): string {
  const apiIndex = url.pathname.indexOf("/api");
  if (apiIndex < 0) {
    throw new Error(`Unexpected non-API fetch: ${url.href}`);
  }
  return url.pathname.slice(apiIndex);
}

function classifyRoute(url: URL): RouteKind {
  const path = findApiPath(url);
  if (path === "/api/assessments/knowledge/states") return "knowledge";
  if (path === "/api/curriculum/next") return "recommendation";
  if (path === "/api/sessions/active") return "active";
  if (path === "/api/sessions/daily-progress") return "dailyProgress";
  if (path === "/api/sessions/weekly-progress") return "weekly";
  if (path === "/api/assessments/weekly-grammar") return "grammar";
  if (path === "/api/sessions" && url.searchParams.get("status") === "completed") {
    return url.searchParams.get("limit") === "50" ? "weeklyHistory" : "dailySessions";
  }
  throw new Error(`Unexpected fetch route: ${url.href}`);
}

function requiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`Missing ${name} in ${url.href}`);
  return value;
}

function completedSession(id: string, windowStart: string, mode = "free_talk"): SessionListItem {
  const startedAt = new Date(Date.parse(windowStart) + 60 * 60 * 1000).toISOString();
  const endedAt = new Date(Date.parse(startedAt) + 5 * 60 * 1000).toISOString();
  return {
    id,
    mode,
    status: "completed",
    started_at: startedAt,
    ended_at: endedAt,
  };
}

function activeSession(id = ACTIVE_SESSION_ID): SessionListItem {
  return {
    id,
    mode: "scenario",
    status: "active",
    started_at: "2026-11-15T10:00:00Z",
    ended_at: null,
  };
}

function weeklyProgressBody(url: URL) {
  const endDate = requiredSearchParam(url, "end_date");
  const timezone = requiredSearchParam(url, "timezone");
  const days = getZonedWeekWindows(endDate, timezone);
  return {
    days: days.map((day, index) => ({
      ...day,
      completed_sessions: index === days.length - 1 ? 1 : 0,
    })),
  };
}

function weeklyGrammarBody(url: URL) {
  const endDate = requiredSearchParam(url, "end_date");
  const timezone = requiredSearchParam(url, "timezone");
  const days = getZonedWeekWindows(endDate, timezone);
  return {
    start: days[0].start,
    end: days[days.length - 1].end,
    total_errors: 6,
    items: [
      { skill_tag: "article_usage", count: 4 },
      { skill_tag: "preposition", count: 2 },
    ],
  };
}

function defaultResponder(kind: RouteKind, url: URL): Response {
  if (kind === "knowledge") return jsonResponse([]);
  if (kind === "recommendation") {
    return jsonResponse({
      recommendations: [],
      target_level: "B1",
      weakest_skill: "grammar",
      weakest_skill_mastery: 0.4,
    });
  }
  if (kind === "active") {
    return jsonResponse({ items: [activeSession()], next_cursor: null });
  }
  if (kind === "dailyProgress") {
    return jsonResponse({ completed_sessions: 1, total_turns: 8 });
  }
  if (kind === "dailySessions") {
    return jsonResponse({
      items: [completedSession(DAILY_SESSION_ID, requiredSearchParam(url, "start"), "scenario")],
      next_cursor: null,
    });
  }
  if (kind === "weekly") return jsonResponse(weeklyProgressBody(url));
  if (kind === "grammar") return jsonResponse(weeklyGrammarBody(url));
  return jsonResponse({
    items: [completedSession(WEEKLY_SESSION_ID, requiredSearchParam(url, "start"))],
    next_cursor: null,
  });
}

function installFetchRouter(responders: ResponderMap = {}) {
  const records: FetchRecord[] = [];
  const kindIndexes = new Map<RouteKind, number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = readRequestUrl(input);
    const kind = classifyRoute(url);
    const index = kindIndexes.get(kind) ?? 0;
    kindIndexes.set(kind, index + 1);
    records.push({ kind, index, method, url });

    if (method !== "GET") {
      throw new Error(`Unexpected ${method} request: ${url.href}`);
    }

    const responder = responders[kind] ?? ((_index, routeUrl) => defaultResponder(kind, routeUrl));
    return responder(index, url);
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return {
    fetchMock,
    records,
    count(kind: RouteKind): number {
      return records.filter((record) => record.kind === kind).length;
    },
    managedCount(): number {
      return records.filter((record) =>
        ["active", "dailyProgress", "dailySessions", "weekly", "grammar"].includes(record.kind),
      ).length;
    },
    urls(kind: RouteKind): URL[] {
      return records.filter((record) => record.kind === kind).map((record) => record.url);
    },
  };
}

function setDocumentVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
    writable: true,
  });
}

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
    writable: true,
  });
}

function restoreOwnProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

function installIosEnvironment(): void {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  };
}

function releaseAll(pending: readonly Deferred<Response>[], fallback: () => Response): void {
  for (const deferred of pending) {
    if (!deferred.settled()) deferred.resolve(fallback());
  }
}

describe("Dashboard lifecycle integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;
  let originalOnlineDescriptor: PropertyDescriptor | undefined;
  let originalCapacitorDescriptor: PropertyDescriptor | undefined;
  let restoreTokenProvider: () => void;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_BASE_URL", "https://api.echotalk.test/api");
    auth._resetAuthForTesting();
    restoreTokenProvider = auth.setAccessTokenProvider(() => "synthetic-access-token");

    vi.spyOn(auth, "getAuthSnapshot").mockReturnValue({
      state: "authenticated",
      principal: PRINCIPAL,
    });
    vi.spyOn(auth, "getAuthRevision").mockReturnValue(1);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation(() => () => {});
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
    });

    useAppStore.getState().goHome();
    originalFetch = globalThis.fetch;
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    originalCapacitorDescriptor = Object.getOwnPropertyDescriptor(window, "Capacitor");

    nativeAppMock.listeners.clear();
    nativeAppMock.addListener.mockReset();
    nativeAppMock.getState.mockReset();
    nativeAppMock.addListener.mockImplementation(
      (_eventName: string, listener: NativeAppListener) => {
        nativeAppMock.listeners.add(listener);
        return Promise.resolve({
          remove: vi.fn(async () => {
            nativeAppMock.listeners.delete(listener);
          }),
        });
      },
    );
    nativeAppMock.getState.mockResolvedValue({ isActive: true });

    setDocumentVisibility("visible");
    setNavigatorOnline(true);
  });

  afterEach(() => {
    nativeAppMock.listeners.clear();
    globalThis.fetch = originalFetch;
    restoreOwnProperty(document, "visibilityState", originalVisibilityDescriptor);
    restoreOwnProperty(navigator, "onLine", originalOnlineDescriptor);
    restoreOwnProperty(window, "Capacitor", originalCapacitorDescriptor);
    useAppStore.getState().goHome();
    restoreTokenProvider();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    auth._resetAuthForTesting();
  });

  it("iOS pending→active 后由四类真实消费者共同发出初始 5 条 GET，并渲染各自结果", async () => {
    installIosEnvironment();

    const getStateDeferred = createDeferred<{ isActive: boolean }>();
    nativeAppMock.getState.mockImplementation(() => getStateDeferred.promise);

    const activeDeferred = createDeferred<Response>();
    const dailyProgressDeferred = createDeferred<Response>();
    const dailySessionsDeferred = createDeferred<Response>();
    const weeklyDeferred = createDeferred<Response>();
    const grammarDeferred = createDeferred<Response>();
    const weeklyHistoryDeferred = createDeferred<Response>();
    const router = installFetchRouter({
      active: () => activeDeferred.promise,
      dailyProgress: () => dailyProgressDeferred.promise,
      dailySessions: () => dailySessionsDeferred.promise,
      weekly: () => weeklyDeferred.promise,
      grammar: () => grammarDeferred.promise,
      weeklyHistory: () => weeklyHistoryDeferred.promise,
    });
    const pending = [
      activeDeferred,
      dailyProgressDeferred,
      dailySessionsDeferred,
      weeklyDeferred,
      grammarDeferred,
      weeklyHistoryDeferred,
    ];

    let rendered: ReturnType<typeof render> | null = null;
    try {
      rendered = render(<Dashboard onOpenSettings={() => {}} />);

      await waitFor(() => {
        expect(nativeAppMock.addListener).toHaveBeenCalledTimes(4);
        expect(nativeAppMock.getState).toHaveBeenCalledTimes(4);
        expect(router.count("knowledge")).toBe(1);
        expect(router.count("recommendation")).toBe(1);
      });

      expect(nativeAppMock.listeners.size).toBe(4);
      expect(router.managedCount()).toBe(0);

      await act(async () => {
        getStateDeferred.resolve({ isActive: false });
        await Promise.resolve();
      });
      expect(router.managedCount()).toBe(0);

      const listeners = Array.from(nativeAppMock.listeners);
      await act(async () => {
        for (const listener of listeners) listener({ isActive: true });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(router.count("active")).toBe(1);
        expect(router.count("dailyProgress")).toBe(1);
        expect(router.count("dailySessions")).toBe(1);
        expect(router.count("weekly")).toBe(1);
        expect(router.count("grammar")).toBe(1);
      });
      // 首波受管读取共 5 条；周概览 settle 后才另发默认选日 history。
      expect(router.managedCount()).toBe(5);
      expect(router.count("weeklyHistory")).toBe(0);

      const weeklyUrl = router.urls("weekly")[0];
      await act(async () => {
        weeklyDeferred.resolve(jsonResponse(weeklyProgressBody(weeklyUrl)));
        await Promise.resolve();
      });
      await waitFor(() => expect(router.count("weeklyHistory")).toBe(1));

      const dailyStart = requiredSearchParam(router.urls("dailySessions")[0], "start");
      const historyStart = requiredSearchParam(router.urls("weeklyHistory")[0], "start");
      const grammarUrl = router.urls("grammar")[0];
      await act(async () => {
        activeDeferred.resolve(jsonResponse({ items: [activeSession()], next_cursor: null }));
        dailyProgressDeferred.resolve(jsonResponse({ completed_sessions: 2, total_turns: 14 }));
        dailySessionsDeferred.resolve(
          jsonResponse({
            items: [completedSession(DAILY_SESSION_ID, dailyStart, "scenario")],
            next_cursor: null,
          }),
        );
        grammarDeferred.resolve(jsonResponse(weeklyGrammarBody(grammarUrl)));
        weeklyHistoryDeferred.resolve(
          jsonResponse({
            items: [completedSession(WEEKLY_SESSION_ID, historyStart)],
            next_cursor: null,
          }),
        );
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId(`active-session-item-${ACTIVE_SESSION_ID}`)).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: tDashboard.turnsGoal })).toHaveAttribute(
          "aria-valuetext",
          "14 / 20",
        );
        expect(screen.getByTestId(`daily-session-item-${DAILY_SESSION_ID}`)).toBeInTheDocument();
        expect(screen.getByTestId(`weekly-session-${WEEKLY_SESSION_ID}`)).toBeInTheDocument();
        expect(screen.getByTestId("weekly-grammar-article_usage")).toBeInTheDocument();
      });
    } finally {
      rendered?.unmount();
      getStateDeferred.resolve({ isActive: false });
      releaseAll(pending, () =>
        jsonResponse({ items: [], next_cursor: null, days: [], total_errors: 0 }),
      );
    }
  });

  it("Web 连续 online→pageshow 时 ignore 类合并、DP override 保留新结果，并验证 WP 选日 history", async () => {
    setNavigatorOnline(false);

    const activeDeferred = createDeferred<Response>();
    const dailyProgressFirst = createDeferred<Response>();
    const dailyProgressSecond = createDeferred<Response>();
    const dailySessionsFirst = createDeferred<Response>();
    const dailySessionsSecond = createDeferred<Response>();
    const weeklyDeferred = createDeferred<Response>();
    const grammarDeferred = createDeferred<Response>();
    const firstHistoryDeferred = createDeferred<Response>();
    const selectedHistoryDeferred = createDeferred<Response>();

    const router = installFetchRouter({
      active: () => activeDeferred.promise,
      dailyProgress: (index) =>
        index === 0 ? dailyProgressFirst.promise : dailyProgressSecond.promise,
      dailySessions: (index) =>
        index === 0 ? dailySessionsFirst.promise : dailySessionsSecond.promise,
      weekly: () => weeklyDeferred.promise,
      grammar: () => grammarDeferred.promise,
      weeklyHistory: (index) =>
        index === 0 ? firstHistoryDeferred.promise : selectedHistoryDeferred.promise,
    });
    const pending = [
      activeDeferred,
      dailyProgressFirst,
      dailyProgressSecond,
      dailySessionsFirst,
      dailySessionsSecond,
      weeklyDeferred,
      grammarDeferred,
      firstHistoryDeferred,
      selectedHistoryDeferred,
    ];

    let rendered: ReturnType<typeof render> | null = null;
    try {
      rendered = render(<Dashboard onOpenSettings={() => {}} />);
      await waitFor(() => {
        expect(router.count("knowledge")).toBe(1);
        expect(router.count("recommendation")).toBe(1);
      });
      expect(router.managedCount()).toBe(0);

      await act(async () => {
        setNavigatorOnline(true);
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(router.count("active")).toBe(1);
        expect(router.count("dailyProgress")).toBe(1);
        expect(router.count("dailySessions")).toBe(1);
        expect(router.count("weekly")).toBe(1);
        expect(router.count("grammar")).toBe(1);
      });
      expect(router.managedCount()).toBe(5);

      await act(async () => {
        window.dispatchEvent(new Event("pageshow"));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(router.count("dailyProgress")).toBe(2);
        expect(router.count("dailySessions")).toBe(2);
      });
      expect(router.count("active")).toBe(1);
      expect(router.count("weekly")).toBe(1);
      expect(router.count("grammar")).toBe(1);
      expect(router.managedCount()).toBe(7);

      const secondDailyStart = requiredSearchParam(router.urls("dailySessions")[1], "start");
      await act(async () => {
        dailyProgressSecond.resolve(jsonResponse({ completed_sessions: 3, total_turns: 19 }));
        dailySessionsSecond.resolve(
          jsonResponse({
            items: [completedSession(NEW_DAILY_SESSION_ID, secondDailyStart, "pronunciation")],
            next_cursor: null,
          }),
        );
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(screen.getByRole("progressbar", { name: tDashboard.turnsGoal })).toHaveAttribute(
          "aria-valuetext",
          "19 / 20",
        );
        expect(
          screen.getByTestId(`daily-session-item-${NEW_DAILY_SESSION_ID}`),
        ).toBeInTheDocument();
      });

      const firstDailyStart = requiredSearchParam(router.urls("dailySessions")[0], "start");
      await act(async () => {
        dailyProgressFirst.resolve(jsonResponse({ completed_sessions: 1, total_turns: 3 }));
        dailySessionsFirst.resolve(
          jsonResponse({
            items: [completedSession(DAILY_SESSION_ID, firstDailyStart, "scenario")],
            next_cursor: null,
          }),
        );
        await Promise.resolve();
      });
      expect(screen.getByRole("progressbar", { name: tDashboard.turnsGoal })).toHaveAttribute(
        "aria-valuetext",
        "19 / 20",
      );
      expect(screen.getByTestId(`daily-session-item-${NEW_DAILY_SESSION_ID}`)).toBeInTheDocument();
      expect(
        screen.queryByTestId(`daily-session-item-${DAILY_SESSION_ID}`),
      ).not.toBeInTheDocument();

      const weeklyUrl = router.urls("weekly")[0];
      const weekly = weeklyProgressBody(weeklyUrl);
      const grammarUrl = router.urls("grammar")[0];
      await act(async () => {
        activeDeferred.resolve(jsonResponse({ items: [activeSession()], next_cursor: null }));
        grammarDeferred.resolve(jsonResponse(weeklyGrammarBody(grammarUrl)));
        weeklyDeferred.resolve(jsonResponse(weekly));
        await Promise.resolve();
      });
      // 周概览 settle 自动选日产生第 1 条 history；下方手动改日再产生第 2 条。
      await waitFor(() => expect(router.count("weeklyHistory")).toBe(1));

      const firstHistoryUrl = router.urls("weeklyHistory")[0];
      await act(async () => {
        firstHistoryDeferred.resolve(
          jsonResponse({
            items: [
              completedSession(
                RECENT_WEEKLY_SESSION_ID,
                requiredSearchParam(firstHistoryUrl, "start"),
              ),
            ],
            next_cursor: null,
          }),
        );
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(
          screen.getByTestId(`weekly-session-${RECENT_WEEKLY_SESSION_ID}`),
        ).toBeInTheDocument();
      });

      const firstDay = weekly.days[0];
      const dayList = screen.getByRole("list", { name: tWeeklyProgress.dayList });
      const targetDayButton = within(dayList).getByRole("button", {
        name: new RegExp(`^${firstDay.date}，`),
      });
      await act(async () => {
        fireEvent.click(targetDayButton);
        await Promise.resolve();
      });
      await waitFor(() => expect(router.count("weeklyHistory")).toBe(2));

      const selectedHistoryUrl = router.urls("weeklyHistory")[1];
      expect(selectedHistoryUrl.searchParams.get("start")).toBe(firstDay.start);
      expect(selectedHistoryUrl.searchParams.get("end")).toBe(firstDay.end);
      expect(selectedHistoryUrl.searchParams.get("limit")).toBe("50");

      await act(async () => {
        selectedHistoryDeferred.resolve(
          jsonResponse({
            items: [completedSession(SELECTED_WEEKLY_SESSION_ID, firstDay.start)],
            next_cursor: null,
          }),
        );
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId(`active-session-item-${ACTIVE_SESSION_ID}`)).toBeInTheDocument();
        expect(
          screen.getByTestId(`weekly-session-${SELECTED_WEEKLY_SESSION_ID}`),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId(`weekly-session-${RECENT_WEEKLY_SESSION_ID}`),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("weekly-grammar-article_usage")).toBeInTheDocument();
      });
    } finally {
      rendered?.unmount();
      releaseAll(pending, () =>
        jsonResponse({ items: [], next_cursor: null, days: [], total_errors: 0 }),
      );
    }
  });

  it("整页卸载后原生与 Web 迟到事件均零请求、零写与零采音", async () => {
    installIosEnvironment();
    const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const router = installFetchRouter();
    let rendered: ReturnType<typeof render> | null = null;
    try {
      rendered = render(<Dashboard onOpenSettings={() => {}} />);
      await waitFor(() => {
        expect(router.count("active")).toBe(1);
        expect(router.count("dailyProgress")).toBe(1);
        expect(router.count("dailySessions")).toBe(1);
        expect(router.count("weekly")).toBe(1);
        expect(router.count("grammar")).toBe(1);
        expect(router.count("weeklyHistory")).toBe(1);
        expect(screen.getByTestId(`active-session-item-${ACTIVE_SESSION_ID}`)).toBeInTheDocument();
        expect(screen.getByTestId(`weekly-grammar-article_usage`)).toBeInTheDocument();
      });

      const listeners = Array.from(nativeAppMock.listeners);
      expect(listeners).toHaveLength(4);
      const requestCountBeforeUnmount = router.fetchMock.mock.calls.length;
      rendered.unmount();
      rendered = null;

      await waitFor(() => expect(nativeAppMock.listeners.size).toBe(0));
      await act(async () => {
        for (const listener of listeners) listener({ isActive: true });
        setNavigatorOnline(false);
        window.dispatchEvent(new Event("offline"));
        setNavigatorOnline(true);
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("pageshow"));
        await Promise.resolve();
      });

      expect(router.fetchMock).toHaveBeenCalledTimes(requestCountBeforeUnmount);
      expect(router.records.every((record) => record.method === "GET")).toBe(true);
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      rendered?.unmount();
      restoreOwnProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    }
  });
});
