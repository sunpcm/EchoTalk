import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.setTimeout(60_000);
test.use({ timezoneId: "Asia/Singapore", viewport: { width: 390, height: 844 } });

const END_DATE = "2026-11-03";
const TIMEZONE = "Asia/Singapore";
const DAY_LIST = "最近七天的已完成会话";
const HISTORY_LIST = "所选日期的已完成会话";

/**
 * These constants are the frozen expected contract. The independent PostgreSQL
 * seed must create fixture inputs that produce exactly these results; assertions
 * must never calculate their expected values from the HTTP response.
 */
const DAY_WINDOWS = [
  ["2026-10-28", "2026-10-27T16:00:00.000Z", "2026-10-28T16:00:00.000Z"],
  ["2026-10-29", "2026-10-28T16:00:00.000Z", "2026-10-29T16:00:00.000Z"],
  ["2026-10-30", "2026-10-29T16:00:00.000Z", "2026-10-30T16:00:00.000Z"],
  ["2026-10-31", "2026-10-30T16:00:00.000Z", "2026-10-31T16:00:00.000Z"],
  ["2026-11-01", "2026-10-31T16:00:00.000Z", "2026-11-01T16:00:00.000Z"],
  ["2026-11-02", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z"],
  ["2026-11-03", "2026-11-02T16:00:00.000Z", "2026-11-03T16:00:00.000Z"],
] as const;

const OPT_IN_DAYS = [
  {
    date: "2026-10-28",
    start: "2026-10-27T16:00:00.000Z",
    end: "2026-10-28T16:00:00.000Z",
    completed_sessions: 3,
    recorded_duration_ms: 999,
    duration_unavailable_count: 0,
  },
  {
    date: "2026-10-29",
    start: "2026-10-28T16:00:00.000Z",
    end: "2026-10-29T16:00:00.000Z",
    completed_sessions: 1,
    recorded_duration_ms: 61_500,
    duration_unavailable_count: 0,
  },
  {
    date: "2026-10-30",
    start: "2026-10-29T16:00:00.000Z",
    end: "2026-10-30T16:00:00.000Z",
    completed_sessions: 1,
    recorded_duration_ms: 0,
    duration_unavailable_count: 0,
  },
  {
    date: "2026-10-31",
    start: "2026-10-30T16:00:00.000Z",
    end: "2026-10-31T16:00:00.000Z",
    completed_sessions: 0,
    recorded_duration_ms: 0,
    duration_unavailable_count: 0,
  },
  {
    date: "2026-11-01",
    start: "2026-10-31T16:00:00.000Z",
    end: "2026-11-01T16:00:00.000Z",
    completed_sessions: 2,
    recorded_duration_ms: 0,
    duration_unavailable_count: 2,
  },
  {
    date: "2026-11-02",
    start: "2026-11-01T16:00:00.000Z",
    end: "2026-11-02T16:00:00.000Z",
    completed_sessions: 1,
    recorded_duration_ms: 3_600_000,
    duration_unavailable_count: 0,
  },
  {
    date: "2026-11-03",
    start: "2026-11-02T16:00:00.000Z",
    end: "2026-11-03T16:00:00.000Z",
    completed_sessions: 0,
    recorded_duration_ms: 0,
    duration_unavailable_count: 0,
  },
] as const;

const LEGACY_DAYS = OPT_IN_DAYS.map(
  ({ date, start, end, completed_sessions }) =>
    ({
      date,
      start,
      end,
      completed_sessions,
    }) as const,
);

function fixtureId(index: number): string {
  return `c0600000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const FIXTURE_IDS = {
  flooredDay: [fixtureId(1), fixtureId(2), fixtureId(3)],
  minuteDay: fixtureId(4),
  legalZero: fixtureId(5),
  unavailableDay: [fixtureId(6), fixtureId(7)],
  hourDay: fixtureId(8),
  excludedActive: fixtureId(9),
  excludedOtherUser: fixtureId(10),
} as const;

type ApiCapture = {
  weekly: string[];
  history: string[];
  writes: string[];
  unsafeReads: string[];
  blocked: string[];
  pageErrors: string[];
};

type SessionItem = {
  id: string;
  status: string;
  started_at: string;
};

type SessionPage = {
  items: SessionItem[];
  next_cursor: string | null;
};

function expectedHistoryWindow(date: string): { start: string; end: string } {
  const window = DAY_WINDOWS.find(([candidate]) => candidate === date);
  if (!window) throw new Error(`Unknown fixture date: ${date}`);
  return { start: window[1], end: window[2] };
}

async function preparePage(page: Page): Promise<ApiCapture> {
  const capture: ApiCapture = {
    weekly: [],
    history: [],
    writes: [],
    unsafeReads: [],
    blocked: [],
    pageErrors: [],
  };

  page.on("pageerror", (error) => capture.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    if (request.method() !== "GET") capture.writes.push(`${request.method()} ${url.pathname}`);
    if (
      /\/sessions\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname) ||
      /\/(token|end|dispatch|claim|heartbeat|release)(?:\/|$)/.test(url.pathname)
    ) {
      capture.unsafeReads.push(url.pathname);
    }
    if (url.pathname === "/api/sessions/weekly-progress") capture.weekly.push(request.url());
    if (
      url.pathname === "/api/sessions" &&
      url.searchParams.get("status") === "completed" &&
      url.searchParams.get("limit") === "50"
    ) {
      capture.history.push(request.url());
    }
  });

  await page.clock.setFixedTime(new Date("2026-11-03T04:00:00.000Z"));
  const appOrigin = "https://127.0.0.1:4175";
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== appOrigin) {
      capture.blocked.push(`EXTERNAL ${request.method()} ${url.href}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      if (url.pathname === "/livekit-ws" || url.pathname.startsWith("/livekit-ws/")) {
        capture.blocked.push(`MEDIA ${request.method()} ${url.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }

    const dashboardReads = new Set([
      "/api/health",
      "/api/health/ready",
      "/api/user/settings",
      "/api/assessments/knowledge/states",
      "/api/assessments/knowledge/skills",
      "/api/assessments/weekly-grammar",
      "/api/curriculum/next",
      "/api/sessions/active",
      "/api/sessions/daily-progress",
      "/api/sessions",
      "/api/sessions/weekly-progress",
    ]);
    const isDashboardRead = request.method() === "GET" && dashboardReads.has(url.pathname);

    if (isDashboardRead) {
      await route.continue();
      return;
    }

    capture.blocked.push(`${request.method()} ${url.pathname}`);
    await route.abort("blockedbyclient");
  });

  return capture;
}

function isWeeklyPath(url: string): boolean {
  return new URL(url).pathname === "/api/sessions/weekly-progress";
}

function isHistoryPath(url: string): boolean {
  return new URL(url).pathname === "/api/sessions";
}

function assertWeeklyQuery(url: string, includeRecordedDuration: boolean): void {
  const parsed = new URL(url);
  expect(parsed.searchParams.get("end_date")).toBe(END_DATE);
  expect(parsed.searchParams.get("timezone")).toBe(TIMEZONE);
  expect(parsed.searchParams.get("include_recorded_duration")).toBe(
    includeRecordedDuration ? "true" : "false",
  );
}

function assertHistoryQueryFor(url: string, date: string): void {
  const parsed = new URL(url);
  const window = expectedHistoryWindow(date);
  const start = parsed.searchParams.get("start");
  const end = parsed.searchParams.get("end");
  const timezoneRfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

  expect(parsed.pathname).toBe("/api/sessions");
  expect(start).toEqual(expect.any(String));
  expect(end).toEqual(expect.any(String));
  if (start === null || end === null) {
    throw new Error(`History query for ${date} is missing start/end`);
  }
  expect(start).toMatch(timezoneRfc3339);
  expect(end).toMatch(timezoneRfc3339);
  expect(new Date(start).toISOString()).toBe(window.start);
  expect(new Date(end).toISOString()).toBe(window.end);
  expect(parsed.searchParams.get("status")).toBe("completed");
  expect(parsed.searchParams.get("limit")).toBe("50");
  expect(parsed.searchParams.has("cursor")).toBe(false);
}

function assertOptInWeeklyPayload(payload: unknown): void {
  expect(payload).toEqual(
    expect.objectContaining({
      days: expect.any(Array),
    }),
  );
  const body = payload as { days: Record<string, unknown>[] };
  expect(Object.keys(body)).toEqual(["days"]);
  expect(body.days).toHaveLength(7);
  for (const day of body.days) {
    expect(Object.keys(day).sort()).toEqual(
      [
        "completed_sessions",
        "date",
        "duration_unavailable_count",
        "end",
        "recorded_duration_ms",
        "start",
      ].sort(),
    );
  }
  expect(
    body.days.map((day) => ({
      date: day.date,
      start: new Date(String(day.start)).toISOString(),
      end: new Date(String(day.end)).toISOString(),
      completed_sessions: day.completed_sessions,
      recorded_duration_ms: day.recorded_duration_ms,
      duration_unavailable_count: day.duration_unavailable_count,
    })),
  ).toEqual(OPT_IN_DAYS);
}

function assertLegacyWeeklyPayload(payload: unknown): void {
  const body = payload as { days: Record<string, unknown>[] };
  expect(Object.keys(body)).toEqual(["days"]);
  expect(body.days).toHaveLength(7);
  for (const day of body.days) {
    expect(Object.keys(day).sort()).toEqual(["completed_sessions", "date", "end", "start"].sort());
  }
  expect(
    body.days.map((day) => ({
      date: day.date,
      start: new Date(String(day.start)).toISOString(),
      end: new Date(String(day.end)).toISOString(),
      completed_sessions: day.completed_sessions,
    })),
  ).toEqual(LEGACY_DAYS);
}

function sessionPage(payload: unknown): SessionPage {
  const body = payload as SessionPage;
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items.every((item) => item.status === "completed")).toBe(true);
  expect(body.next_cursor === null || typeof body.next_cursor === "string").toBe(true);
  return body;
}

async function selectedHistoryIds(section: ReturnType<Page["getByTestId"]>): Promise<string[]> {
  return section
    .getByRole("list", { name: HISTORY_LIST })
    .getByRole("listitem")
    .evaluateAll((items) =>
      items.map((item) => (item.getAttribute("data-testid") ?? "").replace("weekly-session-", "")),
    );
}

async function expectSelectedHistoryIds(
  section: ReturnType<Page["getByTestId"]>,
  expectedIds: readonly string[],
): Promise<void> {
  const history = section.getByRole("list", { name: HISTORY_LIST });
  await expect(history.getByRole("listitem")).toHaveCount(expectedIds.length);
  await expect
    .poll(async () => (await selectedHistoryIds(section)).sort())
    .toEqual([...expectedIds].sort());
}

async function selectDay(
  page: Page,
  section: ReturnType<Page["getByTestId"]>,
  date: string,
  count: number,
): Promise<SessionPage> {
  const requestPromise = page.waitForRequest(
    (request) => request.method() === "GET" && isHistoryPath(request.url()),
  );
  const button = section.getByRole("button", {
    name: `${date}，已完成会话 ${count} 次`,
    exact: true,
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const request = await requestPromise;
  const response = await request.response();
  if (!response) throw new Error(`No response for selected history request: ${date}`);
  assertHistoryQueryFor(request.url(), date);
  expect(response.status()).toBe(200);
  return sessionPage(await response.json());
}

async function expectEmptyHistoryViaHttp(
  apiRequest: APIRequestContext,
  authorization: string,
  origin: string,
  date: string,
): Promise<void> {
  const window = expectedHistoryWindow(date);
  const url = new URL("/api/sessions", origin);
  url.searchParams.set("status", "completed");
  url.searchParams.set("start", window.start);
  url.searchParams.set("end", window.end);
  url.searchParams.set("limit", "50");
  const response = await apiRequest.get(url.toString(), {
    headers: { Authorization: authorization },
  });
  expect(response.status()).toBe(200);
  assertHistoryQueryFor(response.url(), date);
  const page = sessionPage(await response.json());
  expect(page.items).toEqual([]);
  expect(page.next_cursor).toBeNull();
}

async function expectSelectedDuration(
  section: ReturnType<Page["getByTestId"]>,
  date: string,
  duration: RegExp,
): Promise<void> {
  const heading = section.getByRole("heading", { name: `${date} 的会话历史`, exact: true });
  await expect(heading.locator("..")).toContainText(duration);
}

test("真实HTTP与真实PG贯通七日统计、切日状态和用户状态排除", async ({
  page,
  request: apiRequest,
}) => {
  const capture = await preparePage(page);

  const weeklyRequestPromise = page.waitForRequest(
    (request) => request.method() === "GET" && isWeeklyPath(request.url()),
  );
  const weeklyResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "GET" && isWeeklyPath(response.url()),
  );
  await page.goto("/");

  const weeklyRequest = await weeklyRequestPromise;
  const weeklyResponse = await weeklyResponsePromise;
  assertWeeklyQuery(weeklyRequest.url(), true);
  expect(weeklyResponse.status()).toBe(200);
  expect(weeklyRequest.headers().authorization).toMatch(/^Bearer\s+\S+$/);
  assertOptInWeeklyPayload(await weeklyResponse.json());
  const authorization = weeklyRequest.headers().authorization;
  if (!authorization) throw new Error("Missing weekly authorization header");

  const section = page.getByTestId("weekly-progress");
  const days = section.getByRole("list", { name: DAY_LIST });
  await expect(days.getByRole("button")).toHaveCount(7);
  await expect(days.getByRole("button", { name: "2026-11-03，已完成会话 0 次" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const weeklyTotal = section.getByTestId("weekly-recorded-duration-total");
  await expect(weeklyTotal).toContainText(/已记录会话时长\s*1小时1分2秒/);
  await expect(weeklyTotal).toContainText("另有 2 条不可计算");

  await expectSelectedHistoryIds(section, []);
  await expect(section.getByText("这一天还没有已完成会话")).toBeVisible();
  await expect(section.getByRole("button", { name: "加载更多当日历史", exact: true })).toHaveCount(
    0,
  );
  const origin = new URL(page.url()).origin;
  await expectEmptyHistoryViaHttp(apiRequest, authorization, origin, END_DATE);

  const flooredDay = await selectDay(page, section, "2026-10-28", 3);
  expect(flooredDay.items.map((item) => item.id).sort()).toEqual(
    [...FIXTURE_IDS.flooredDay].sort(),
  );
  await expectSelectedHistoryIds(section, FIXTURE_IDS.flooredDay);
  await expectSelectedDuration(section, "2026-10-28", /已记录会话时长\s*不到1秒/);

  const minuteDay = await selectDay(page, section, "2026-10-29", 1);
  expect(minuteDay.items.map((item) => item.id)).toEqual([FIXTURE_IDS.minuteDay]);
  await expectSelectedHistoryIds(section, [FIXTURE_IDS.minuteDay]);
  await expectSelectedDuration(section, "2026-10-29", /已记录会话时长\s*1分1秒/);

  const zeroDay = await selectDay(page, section, "2026-10-30", 1);
  expect(zeroDay.items.map((item) => item.id)).toEqual([FIXTURE_IDS.legalZero]);
  await expectSelectedHistoryIds(section, [FIXTURE_IDS.legalZero]);
  await expectSelectedDuration(section, "2026-10-30", /已记录会话时长\s*0秒/);

  const excludedButton = section.getByRole("button", {
    name: "2026-10-31，已完成会话 0 次",
    exact: true,
  });
  await excludedButton.click();
  await expect(excludedButton).toHaveAttribute("aria-pressed", "true");
  await expectSelectedHistoryIds(section, []);
  await expect(section.getByText("这一天还没有已完成会话")).toBeVisible();
  await expect(section.getByRole("button", { name: "加载更多当日历史", exact: true })).toHaveCount(
    0,
  );
  expect(await selectedHistoryIds(section)).not.toContain(FIXTURE_IDS.excludedActive);
  expect(await selectedHistoryIds(section)).not.toContain(FIXTURE_IDS.excludedOtherUser);
  await expectEmptyHistoryViaHttp(apiRequest, authorization, origin, "2026-10-31");

  const unavailableDay = await selectDay(page, section, "2026-11-01", 2);
  expect(unavailableDay.items.map((item) => item.id).sort()).toEqual(
    [...FIXTURE_IDS.unavailableDay].sort(),
  );
  await expectSelectedHistoryIds(section, FIXTURE_IDS.unavailableDay);
  await expectSelectedDuration(section, "2026-11-01", /已记录会话时长\s*暂无可用时长/);
  await expect(
    section.getByRole("heading", { name: "2026-11-01 的会话历史", exact: true }).locator(".."),
  ).toContainText("另有 2 条不可计算");

  const hourDay = await selectDay(page, section, "2026-11-02", 1);
  expect(hourDay.items.map((item) => item.id)).toEqual([FIXTURE_IDS.hourDay]);
  await expectSelectedHistoryIds(section, [FIXTURE_IDS.hourDay]);
  await expectSelectedDuration(section, "2026-11-02", /已记录会话时长\s*1小时0分0秒/);

  expect(capture.weekly).toHaveLength(1);
  expect(capture.writes).toEqual([]);
  expect(capture.unsafeReads).toEqual([]);
  expect(capture.blocked).toEqual([]);
  expect(capture.pageErrors).toEqual([]);
});

test("真实HTTP默认与false保持四字段，未认证请求返回401", async ({ page, request }) => {
  const capture = await preparePage(page);
  const weeklyRequestPromise = page.waitForRequest(
    (request) => request.method() === "GET" && isWeeklyPath(request.url()),
  );
  const weeklyResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "GET" && isWeeklyPath(response.url()),
  );
  await page.goto("/");
  const weeklyRequest = await weeklyRequestPromise;
  const weeklyResponse = await weeklyResponsePromise;
  assertWeeklyQuery(weeklyRequest.url(), true);
  expect(weeklyResponse.status()).toBe(200);
  assertOptInWeeklyPayload(await weeklyResponse.json());

  const authorization = weeklyRequest.headers().authorization;
  expect(authorization).toMatch(/^Bearer\s+\S+$/);
  const origin = new URL(page.url()).origin;

  for (const includeRecordedDuration of [null, "false"]) {
    const url = new URL("/api/sessions/weekly-progress", origin);
    url.searchParams.set("end_date", END_DATE);
    url.searchParams.set("timezone", TIMEZONE);
    if (includeRecordedDuration !== null) {
      url.searchParams.set("include_recorded_duration", includeRecordedDuration);
    }
    const response = await request.get(url.toString(), {
      headers: { Authorization: authorization },
    });
    expect(response.status()).toBe(200);
    assertLegacyWeeklyPayload(await response.json());
  }

  const unauthorizedUrl = new URL("/api/sessions/weekly-progress", origin);
  unauthorizedUrl.searchParams.set("end_date", END_DATE);
  unauthorizedUrl.searchParams.set("timezone", TIMEZONE);
  unauthorizedUrl.searchParams.set("include_recorded_duration", "true");
  const unauthorized = await request.get(unauthorizedUrl.toString());
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toContain("Bearer");

  expect(capture.weekly).toHaveLength(1);
  expect(capture.writes).toEqual([]);
  expect(capture.unsafeReads).toEqual([]);
  expect(capture.blocked).toEqual([]);
  expect(capture.pageErrors).toEqual([]);
});
