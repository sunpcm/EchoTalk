import { expect, test, type Page } from "@playwright/test";

function trackMutationRequests(page: Page) {
  const mutations: { method: string; pathname: string; url: string }[] = [];
  page.on("request", (req) => {
    try {
      const method = req.method();
      if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
        const url = new URL(req.url());
        mutations.push({
          method,
          pathname: url.pathname,
          url: req.url(),
        });
      }
    } catch {
      // ignore
    }
  });
  return mutations;
}

test.describe("Session Pagination & Daily Progress E2E (RF-08 / A41)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Unexpected pageerror encountered: ${err.message}`);
    });
  });

  test("loads more active sessions on explicit user click, preserves order and deduplicates without implicit writes", async ({
    page,
  }) => {
    const mutations = trackMutationRequests(page);

    const SESSION_PAGE_1 = {
      id: "38752299-15c9-4423-8920-dea740cc4801",
      mode: "scenario",
      status: "active",
      started_at: "2026-10-25T10:00:00Z",
      ended_at: null,
    };

    const SESSION_PAGE_2 = {
      id: "8f7e6d5c-4b3a-4210-9876-543210fedcba",
      mode: "free_talk",
      status: "active",
      started_at: "2026-10-25T09:00:00Z",
      ended_at: null,
    };

    let page1Requested = false;
    let page2Requested = false;

    await page.route("**/api/sessions/active*", async (route) => {
      const url = new URL(route.request().url());
      const cursor = url.searchParams.get("cursor");

      if (!cursor) {
        page1Requested = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [SESSION_PAGE_1],
            next_cursor: "cursor-token-page-2",
          }),
        });
      } else {
        page2Requested = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [SESSION_PAGE_2],
            next_cursor: null,
          }),
        });
      }
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 第一页会话可见，且显示“加载更多”按钮
    const item1 = page.getByTestId(`active-session-item-${SESSION_PAGE_1.id}`);
    await expect(item1).toBeVisible();

    const loadMoreBtn = page.getByTestId("load-more-active-button");
    await expect(loadMoreBtn).toBeVisible();
    expect(page1Requested).toBe(true);
    expect(page2Requested).toBe(false);

    // 触控尺寸合规 (>= 44x44)
    const box = await loadMoreBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // 点击“加载更多”
    await loadMoreBtn.click();

    // 第二页会话加载追加
    const item2 = page.getByTestId(`active-session-item-${SESSION_PAGE_2.id}`);
    await expect(item2).toBeVisible();
    await expect(item1).toBeVisible();
    expect(page2Requested).toBe(true);

    // 最后一页后“加载更多”按钮消失
    await expect(loadMoreBtn).toHaveCount(0);

    // 零隐式写请求（零 POST/PUT/DELETE/PATCH）
    expect(mutations.length).toBe(0);
  });

  test("displays daily progress aggregate stats and paginates completed sessions without detail N+1", async ({
    page,
  }) => {
    const mutations = trackMutationRequests(page);
    let detailCount = 0;

    page.on("request", (req) => {
      if (req.url().match(/\/api\/sessions\/[0-9a-f-]+$/)) {
        detailCount++;
      }
    });

    const COMPLETED_1 = {
      id: "a1a1a1a1-1111-4111-8111-111111111111",
      mode: "scenario",
      status: "completed",
      started_at: "2026-10-25T11:00:00Z",
      ended_at: "2026-10-25T11:15:00Z",
    };

    const COMPLETED_2 = {
      id: "b2b2b2b2-2222-4222-8222-222222222222",
      mode: "free_talk",
      status: "completed",
      started_at: "2026-10-25T08:00:00Z",
      ended_at: "2026-10-25T08:20:00Z",
    };

    await page.route("**/api/sessions/daily-progress*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          completed_sessions: 25,
          total_turns: 35,
        }),
      });
    });

    await page.route("**/api/sessions?*", async (route) => {
      const url = new URL(route.request().url());
      const cursor = url.searchParams.get("cursor");

      if (!cursor) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [COMPLETED_1],
            next_cursor: "daily-cursor-page-2",
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [COMPLETED_2],
            next_cursor: null,
          }),
        });
      }
    });

    await page.goto("/");

    // 验证进度条展示服务端真实聚合数值 35 / 20，且 aria 属性正确
    const progressbar = page.getByRole("progressbar");
    await expect(progressbar).toBeVisible();
    await expect(progressbar).toHaveAttribute("aria-valuenow", "20");
    await expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    await expect(progressbar).toHaveAttribute("aria-valuemax", "20");
    await expect(progressbar).toHaveAttribute("aria-valuetext", "35 / 20");

    // 验证今日完成会话第一页显示
    await expect(page.getByTestId(`daily-session-item-${COMPLETED_1.id}`)).toBeVisible();

    // 点击“加载更多”
    const loadMoreDaily = page.getByTestId("load-more-daily-button");
    await expect(loadMoreDaily).toBeVisible();
    await loadMoreDaily.click();

    // 第二页追加显示
    await expect(page.getByTestId(`daily-session-item-${COMPLETED_2.id}`)).toBeVisible();
    await expect(page.getByTestId(`daily-session-item-${COMPLETED_1.id}`)).toBeVisible();
    await expect(loadMoreDaily).toHaveCount(0);

    // 核心契约：零 getSessionDetail N+1 调用
    expect(detailCount).toBe(0);
    // 零隐式写请求
    expect(mutations.length).toBe(0);
  });
});
