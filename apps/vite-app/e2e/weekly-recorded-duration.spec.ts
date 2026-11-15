import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Singapore", hasTouch: true });

const DAY_LIST = "最近七天的已完成会话";
const HISTORY_LIST = "所选日期的已完成会话";
const EXPLANATION = "包含连接等待、静音和暂停，不等于有效说话";

async function prepare(page: Page) {
  const pageErrors: string[] = [];
  const weekly: string[] = [];
  const daily: string[] = [];
  const history: string[] = [];
  const writes: string[] = [];
  const unsafeReads: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(url.pathname);
    if (/\/sessions\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname)) unsafeReads.push(url.pathname);
    if (url.pathname === "/api/sessions/weekly-progress") weekly.push(request.url());
    if (url.pathname === "/api/sessions/daily-progress") daily.push(request.url());
    if (
      url.pathname === "/api/sessions" &&
      url.searchParams.get("status") === "completed" &&
      url.searchParams.get("limit") === "50"
    ) {
      history.push(request.url());
    }
  });
  await page.clock.setFixedTime(new Date("2026-11-03T04:00:00Z"));
  await page.route("**/api/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-e2e-weekly-fixture": "duration" },
    }),
  );
  return { pageErrors, weekly, daily, history, writes, unsafeReads };
}

async function expectSevenPreservedButtons(section: ReturnType<Page["getByTestId"]>) {
  const days = section.getByRole("list", { name: DAY_LIST });
  await expect(days.getByRole("button")).toHaveCount(7);
  for (const [date, count] of [
    ["2026-10-28", 1],
    ["2026-10-29", 2],
    ["2026-10-30", 1],
    ["2026-10-31", 1],
    ["2026-11-01", 2],
    ["2026-11-02", 1],
    ["2026-11-03", 55],
  ] as const) {
    const button = days.getByRole("button", {
      name: `${date}，已完成会话 ${count} 次`,
      exact: true,
    });
    await expect(button).toHaveCount(1);
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  return days;
}

async function expectSelectedDuration(
  section: ReturnType<Page["getByTestId"]>,
  date: string,
  value: string | RegExp,
) {
  const heading = section.getByRole("heading", { name: `${date} 的会话历史`, exact: true });
  await expect(heading.locator("..")).toContainText(/已记录会话时长/);
  await expect(heading.locator("..")).toContainText(value);
}

test("真实 Fake API 时长主路径在宽窄视口保持选日、键盘、触控、分页与零业务写", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = await prepare(page);
  await page.goto("/");

  const section = page.getByTestId("weekly-progress");
  await expect(section.getByRole("list", { name: DAY_LIST })).toBeVisible();
  expect(calls.weekly).toHaveLength(1);
  expect(new URL(calls.weekly[0]).searchParams.get("include_recorded_duration")).toBe("true");
  const weeklyTotal = section.getByTestId("weekly-recorded-duration-total");
  await expect(weeklyTotal).toContainText(/已记录会话时长\s*34小时59分11秒/);
  await expect(weeklyTotal).toContainText(EXPLANATION);
  await expect(weeklyTotal).toContainText("另有 2 条不可计算");
  await expectSelectedDuration(section, "2026-11-03", /已记录会话时长\s*0秒/);

  const days = await expectSevenPreservedButtons(section);
  const history = section.getByRole("list", { name: HISTORY_LIST });
  await expect(history.getByRole("listitem")).toHaveCount(50);
  await section.getByRole("button", { name: "加载更多当日历史", exact: true }).click();
  await expect(history.getByRole("listitem")).toHaveCount(55);
  await expect(section.getByRole("button", { name: "加载更多当日历史", exact: true })).toHaveCount(
    0,
  );

  const oldest = days.getByRole("button", {
    name: "2026-10-28，已完成会话 1 次",
    exact: true,
  });
  await oldest.tap();
  await expect(oldest).toHaveAttribute("aria-pressed", "true");
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expectSelectedDuration(section, "2026-10-28", /已记录会话时长\s*34小时59分11秒/);

  const missingEnded = days.getByRole("button", {
    name: "2026-10-29，已完成会话 2 次",
    exact: true,
  });
  await missingEnded.focus();
  await page.keyboard.press("Enter");
  await expect(missingEnded).toHaveAttribute("aria-pressed", "true");
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expectSelectedDuration(section, "2026-10-29", /已记录会话时长\s*不到1秒/);
  await expect(
    section.getByRole("heading", { name: "2026-10-29 的会话历史", exact: true }).locator(".."),
  ).toContainText("另有 1 条不可计算");

  expect(calls.weekly).toHaveLength(1);
  expect(calls.history.length).toBeGreaterThanOrEqual(4);
  const dailyCountAfterSelection = calls.daily.length;
  await page.screenshot({
    path: testInfo.outputPath("weekly-recorded-duration-wide-1280.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectSevenPreservedButtons(section);
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  expect(calls.daily).toHaveLength(dailyCountAfterSelection);
  await page.screenshot({
    path: testInfo.outputPath("weekly-recorded-duration-narrow-390.png"),
    fullPage: true,
  });

  expect(calls.pageErrors).toEqual([]);
  expect(calls.writes).toEqual([]);
  expect(calls.unsafeReads).toEqual([]);
});

test("旧服务四字段响应在 opt-in 后降级为时长未知，不以 completed 次数伪造 0", async ({ page }) => {
  const calls = await prepare(page);
  const legacyDays = [
    ["2026-10-28", "2026-10-27T16:00:00.000Z", "2026-10-28T16:00:00.000Z"],
    ["2026-10-29", "2026-10-28T16:00:00.000Z", "2026-10-29T16:00:00.000Z"],
    ["2026-10-30", "2026-10-29T16:00:00.000Z", "2026-10-30T16:00:00.000Z"],
    ["2026-10-31", "2026-10-30T16:00:00.000Z", "2026-10-31T16:00:00.000Z"],
    ["2026-11-01", "2026-10-31T16:00:00.000Z", "2026-11-01T16:00:00.000Z"],
    ["2026-11-02", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z"],
    ["2026-11-03", "2026-11-02T16:00:00.000Z", "2026-11-03T16:00:00.000Z"],
  ].map(([date, start, end], index) => ({
    date,
    start,
    end,
    completed_sessions: index === 6 ? 1 : 0,
  }));

  // Synthetic compatibility boundary: this route tests the browser fallback for an old
  // four-field HTTP response. It is not a PostgreSQL aggregation or real-backend proof.
  await page.route("**/api/sessions/weekly-progress?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ days: legacyDays }),
    }),
  );
  await page.goto("/");

  const section = page.getByTestId("weekly-progress");
  await expect(section.getByRole("list", { name: DAY_LIST })).toBeVisible();
  expect(calls.weekly).toHaveLength(1);
  expect(new URL(calls.weekly[0]).searchParams.get("include_recorded_duration")).toBe("true");
  const weeklyTotal = section.getByTestId("weekly-recorded-duration-total");
  await expect(weeklyTotal).toContainText(/已记录会话时长未知/);
  await expectSelectedDuration(section, "2026-11-03", /已记录会话时长未知/);
  await expect(weeklyTotal).not.toContainText(/已记录会话时长\s*0秒/);
  expect(calls.pageErrors).toEqual([]);
  expect(calls.writes).toEqual([]);
  expect(calls.unsafeReads).toEqual([]);
});

test("部分扩展不能合成周总，但独立已知不可计算计数明确标为不完整", async ({ page }) => {
  const calls = await prepare(page);
  const days = [
    {
      date: "2026-10-28",
      start: "2026-10-27T16:00:00.000Z",
      end: "2026-10-28T16:00:00.000Z",
      completed_sessions: 1,
      recorded_duration_ms: 1_000,
      duration_unavailable_count: 0,
    },
    {
      date: "2026-10-29",
      start: "2026-10-28T16:00:00.000Z",
      end: "2026-10-29T16:00:00.000Z",
      completed_sessions: 2,
      recorded_duration_ms: 0,
      duration_unavailable_count: 2,
    },
    {
      date: "2026-10-30",
      start: "2026-10-29T16:00:00.000Z",
      end: "2026-10-30T16:00:00.000Z",
      completed_sessions: 1,
      recorded_duration_ms: 0,
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
      completed_sessions: 0,
      recorded_duration_ms: 0,
      duration_unavailable_count: 0,
    },
    {
      date: "2026-11-02",
      start: "2026-11-01T16:00:00.000Z",
      end: "2026-11-02T16:00:00.000Z",
      completed_sessions: 0,
      recorded_duration_ms: 0,
      duration_unavailable_count: 0,
    },
    {
      date: "2026-11-03",
      start: "2026-11-02T16:00:00.000Z",
      end: "2026-11-03T16:00:00.000Z",
      completed_sessions: 2,
      recorded_duration_ms: 2_500,
      duration_unavailable_count: 1,
    },
  ];

  // Synthetic partial response only; real PG missing/null/negative coverage belongs to WD-API.
  await page.route("**/api/sessions/weekly-progress?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ days }),
    }),
  );
  await page.goto("/");

  const section = page.getByTestId("weekly-progress");
  await expect(section.getByRole("list", { name: DAY_LIST })).toBeVisible();
  expect(new URL(calls.weekly[0]).searchParams.get("include_recorded_duration")).toBe("true");
  const weeklyTotal = section.getByTestId("weekly-recorded-duration-total");
  await expect(weeklyTotal).toContainText(/已记录会话时长未知/);
  await expect(weeklyTotal).not.toContainText(/已记录会话时长\s*3秒/);
  await expect(weeklyTotal).toContainText("已知 3 条不可计算（明细不完整）");
  await expectSelectedDuration(section, "2026-11-03", /已记录会话时长\s*2秒/);
  await expect(
    section.getByRole("heading", { name: "2026-11-03 的会话历史", exact: true }).locator(".."),
  ).toContainText("另有 1 条不可计算");
  expect(calls.pageErrors).toEqual([]);
  expect(calls.writes).toEqual([]);
  expect(calls.unsafeReads).toEqual([]);
});
