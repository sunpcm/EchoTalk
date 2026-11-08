import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Singapore", viewport: { width: 390, height: 844 } });

async function prepare(page: Page) {
  const writes: string[] = [];
  const grammar: string[] = [];
  page.on("pageerror", (error) => {
    throw error;
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(url.pathname);
    if (url.pathname === "/api/assessments/weekly-grammar") grammar.push(request.url());
  });
  await page.clock.setFixedTime(new Date("2026-11-03T04:00:00Z"));
  await page.route("**/api/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-e2e-weekly-grammar-fixture": "weekly",
      },
    }),
  );
  return { writes, grammar };
}

test("七天语法Top3展示固定名称、记录数与空态，且零业务写入", async ({ page }) => {
  const calls = await prepare(page);
  await page.goto("/");
  const section = page.getByTestId("weekly-grammar");
  await expect(section.getByText("共 15 条记录")).toBeVisible();
  const items = section.getByRole("list", { name: "最近七天语法记录 Top 3" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("冠词使用");
  await expect(items.nth(0)).toContainText("4 条记录");
  await expect(items.nth(1)).toContainText("其他语法");
  await expect(items.nth(1)).toContainText("3 条记录");
  await expect(items.nth(2)).toContainText("过去时态");
  await expect(items.nth(2)).toContainText("3 条记录");
  await expect(section).toContainText("回顾冠词 a/an/the 的基本用法");
  expect(calls.grammar).toHaveLength(1);
  expect(calls.writes).toEqual([]);

  await page.route("**/api/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-e2e-weekly-grammar-fixture": "" },
    }),
  );
  await page.clock.setFixedTime(new Date("2026-11-03T05:00:00Z"));
  await page.reload();
  await expect(section.getByText("这七天暂无可统计的真实语法记录")).toBeVisible();
  expect(calls.writes).toEqual([]);
});

test("七天语法失败显示安全错误，显式重试成功且零业务写入", async ({ page }) => {
  const calls = await prepare(page);
  // Lifecycle/auth refreshes may issue extra reads. Keep every read failing
  // until this test explicitly starts the UI retry, rather than spending a 503.
  let failing = true;
  await page.route("**/api/assessments/weekly-grammar?*", async (route) => {
    if (failing) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "private-grammar-canary" }),
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto("/");
  const section = page.getByTestId("weekly-grammar");
  await expect(section.getByRole("alert")).toHaveText(/七天语法记录加载失败/);
  await expect(section).not.toContainText("private-grammar-canary");
  const beforeRetry = calls.grammar.length;
  expect(beforeRetry).toBeGreaterThanOrEqual(1);
  failing = false;
  await section.getByRole("button", { name: "重试七天语法记录", exact: true }).click();
  await expect(section.getByText("共 15 条记录")).toBeVisible();
  await expect.poll(() => calls.grammar.length).toBeGreaterThan(beforeRetry);
  expect(calls.writes).toEqual([]);
});
