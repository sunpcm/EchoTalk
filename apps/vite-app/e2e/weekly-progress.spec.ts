import { expect, test, type Page } from "@playwright/test";

// 此 spec 由既有配置在 Chromium 与 WebKit 各执行；成功数据来自真实 Fake API HTTP。
test.use({ timezoneId: "Asia/Singapore", viewport: { width: 390, height: 844 } });

async function prepare(page: Page) {
  const writes: string[] = [];
  const unsafeReads: string[] = [];
  const weekly: string[] = [];
  const daily: string[] = [];
  page.on("pageerror", (error) => {
    throw error;
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(url.pathname);
    if (/\/sessions\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname)) unsafeReads.push(url.pathname);
    if (url.pathname === "/api/sessions/weekly-progress") weekly.push(request.url());
    if (url.pathname === "/api/sessions/daily-progress") daily.push(request.url());
  });
  await page.clock.setFixedTime(new Date("2026-11-03T04:00:00Z"));
  await page.route("**/api/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-e2e-weekly-fixture": "weekly" },
    }),
  );
  return { writes, unsafeReads, weekly, daily };
}

test("窄屏七天按钮、键盘选日、真实55条分页/空态与零隐式写", async ({ page }) => {
  const calls = await prepare(page);
  await page.goto("/");
  const section = page.getByTestId("weekly-progress");
  const days = section.getByRole("list", { name: "最近七天的已完成会话" });
  const history = section.getByRole("list", { name: "所选日期的已完成会话" });
  await expect(days.getByRole("button")).toHaveCount(7);
  const today = days.getByRole("button", { name: "2026-11-03，已完成会话 55 次", exact: true });
  await expect(today).toHaveAttribute("aria-pressed", "true");
  await expect(history.getByRole("listitem")).toHaveCount(50);
  expect(calls.weekly).toHaveLength(1);
  const initialDaily = calls.daily.length;
  for (const button of await days.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  const more = section.getByRole("button", { name: "加载更多当日历史", exact: true });
  await more.click();
  await expect(history.getByRole("listitem")).toHaveCount(55);
  await expect(more).toHaveCount(0);
  const ids = await history
    .getByRole("listitem")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
  expect(new Set(ids).size).toBe(55);

  const yesterday = days.getByRole("button", { name: "2026-11-02，已完成会话 1 次", exact: true });
  await yesterday.focus();
  await page.keyboard.press("Enter");
  await expect(yesterday).toHaveAttribute("aria-pressed", "true");
  await expect(today).toHaveAttribute("aria-pressed", "false");
  await expect(history.getByRole("listitem")).toHaveCount(1);
  const empty = days.getByRole("button", { name: "2026-10-28，已完成会话 0 次", exact: true });
  await empty.focus();
  await page.keyboard.press("Space");
  await expect(empty).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByText("这一天还没有已完成会话")).toBeVisible();
  await expect(history.getByRole("listitem")).toHaveCount(0);
  expect(calls.weekly).toHaveLength(1);
  expect(calls.daily).toHaveLength(initialDaily);
  expect(calls.writes).toEqual([]);
  expect(calls.unsafeReads).toEqual([]);
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});

test("概览失败安全提示与显式重试，成功后继续真实 HTTP 查询", async ({ page }) => {
  const calls = await prepare(page);
  await page.addInitScript(() => {
    const initialPageShow = new Promise<void>((resolve) => {
      window.addEventListener("pageshow", () => resolve(), { once: true });
    });
    Object.assign(window, { __waitForInitialWeeklyPageShow: () => initialPageShow });
  });
  let failures = 1;
  await page.route("**/api/sessions/weekly-progress?*", async (route) => {
    if (failures-- > 0) {
      // 初始 pageshow 的刷新须在首个查询仍在途时合并，不能消耗这次失败。
      await page.evaluate(() =>
        (
          window as unknown as { __waitForInitialWeeklyPageShow: () => Promise<void> }
        ).__waitForInitialWeeklyPageShow(),
      );
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "private-weekly-canary" }),
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto("/");
  const section = page.getByTestId("weekly-progress");
  await expect(section.getByRole("alert")).toHaveText(/七天概览加载失败/);
  await expect(section).not.toContainText("private-weekly-canary");
  await section.getByRole("button", { name: "重试七天概览", exact: true }).click();
  await expect(
    section.getByRole("list", { name: "所选日期的已完成会话" }).getByRole("listitem"),
  ).toHaveCount(50);
  expect(calls.weekly).toHaveLength(2);
  expect(calls.writes).toEqual([]);
  expect(calls.unsafeReads).toEqual([]);
});

test("当日历史与 more 失败各自重试，不重取七桶或自动加载下一页", async ({ page }) => {
  const calls = await prepare(page);
  let initialFailure = true;
  let moreFailure = true;
  const cursors: string[] = [];
  await page.route("**/api/sessions?*", async (route) => {
    const url = new URL(route.request().url());
    // WeeklyProgress 的显式 limit，不干扰保留的 DailyProgress。
    if (url.searchParams.get("limit") !== "50") return route.fallback();
    const cursor = url.searchParams.get("cursor");
    if (cursor) cursors.push(cursor);
    if ((!cursor && initialFailure) || (cursor && moreFailure)) {
      if (cursor) moreFailure = false;
      else initialFailure = false;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "private-history-canary" }),
      });
    }
    return route.fallback();
  });
  await page.goto("/");
  const section = page.getByTestId("weekly-progress");
  const history = section.getByRole("list", { name: "所选日期的已完成会话" });
  await expect(section.getByRole("alert")).toHaveText(/当日历史加载失败/);
  await section.getByRole("button", { name: "重试当日历史", exact: true }).click();
  await expect(history.getByRole("listitem")).toHaveCount(50);
  expect(cursors).toEqual([]);
  await section.getByRole("button", { name: "加载更多当日历史", exact: true }).click();
  await expect(section.getByRole("alert")).toHaveText("加载更多当日历史失败");
  await expect(history.getByRole("listitem")).toHaveCount(50);
  await section.getByRole("button", { name: "重试加载更多当日历史", exact: true }).click();
  await expect(history.getByRole("listitem")).toHaveCount(55);
  expect(cursors).toHaveLength(2);
  expect(cursors[0]).toBe(cursors[1]);
  await expect(section).not.toContainText("private-history-canary");
  expect(calls.weekly).toHaveLength(1);
  expect(calls.writes).toEqual([]);
  expect(calls.unsafeReads).toEqual([]);
});

test("在途 more 切日后不混入旧页，离线/恢复只读刷新", async ({ page, context }) => {
  const calls = await prepare(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let moreStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    moreStarted = resolve;
  });
  await page.route("**/api/sessions?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("limit") === "50" && url.searchParams.has("cursor")) {
      moreStarted();
      await held;
    }
    await route.fallback();
  });
  try {
    await page.goto("/");
    const section = page.getByTestId("weekly-progress");
    const history = section.getByRole("list", { name: "所选日期的已完成会话" });
    await expect(history.getByRole("listitem")).toHaveCount(50);
    await section.getByRole("button", { name: "加载更多当日历史", exact: true }).click();
    await started;
    await section.getByRole("button", { name: "2026-11-02，已完成会话 1 次", exact: true }).click();
    await expect(history.getByRole("listitem")).toHaveCount(1);
    release();
    await expect(
      history.getByTestId("weekly-session-77300000-0000-4000-8000-000000000056"),
    ).toBeVisible();
    await context.setOffline(true);
    await expect(section.getByText("回到前台并恢复网络后刷新历史")).toBeVisible();
    await context.setOffline(false);
    await expect(section.getByText("回到前台并恢复网络后刷新历史")).toHaveCount(0);
    await expect(history.getByRole("listitem")).toHaveCount(1);
    await expect(
      section.getByRole("button", { name: "2026-11-02，已完成会话 1 次", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(calls.writes).toEqual([]);
    expect(calls.unsafeReads).toEqual([]);
  } finally {
    release();
  }
});
