import { expect, test } from "@playwright/test";

async function showEndedSession(page: import("@playwright/test").Page, sessionId: string) {
  await page.evaluate(async (id) => {
    const { useConversationStore } = await import("/src/store/conversation.ts");
    useConversationStore.setState({
      appView: "session",
      connectionState: "ended",
      sessionId: id,
      token: null,
      wsUrl: null,
      error: null,
      agentError: null,
    });
  }, sessionId);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});

test("real web proxies health, create-session, and end-session requests to the fake API", async ({
  request,
}) => {
  const health = await request.get("/api/health/ready");
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toMatchObject({ status: "ok" });

  const created = await request.post("/api/sessions", {
    data: { mode: "scenario" },
  });
  expect(created.status()).toBe(201);
  const session = await created.json();
  expect(session).toMatchObject({ mode: "scenario", status: "active" });

  const ended = await request.post(`/api/sessions/${session.id}/end`);
  expect(ended.ok()).toBeTruthy();
  await expect(ended.json()).resolves.toMatchObject({
    id: session.id,
    status: "completed",
  });

  const analysis = await request.get(`/api/sessions/${session.id}/analysis-status`);
  expect(analysis.ok()).toBeTruthy();
  await expect(analysis.json()).resolves.toMatchObject({
    session_id: session.id,
    status: "pending",
  });
});

test("renders a successful analysis from the fake API", async ({ page }) => {
  await showEndedSession(page, "analysis-success");

  await expect(page.getByText("发音评分")).toBeVisible();
  await expect(page.getByText("88")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回主页" })).toBeEnabled();
});

for (const state of ["pending", "running"] as const) {
  test(`lets the user leave while analysis is ${state}`, async ({ page }) => {
    await showEndedSession(page, `analysis-${state}`);

    const goHome = page.getByRole("button", { name: "返回主页" });
    await expect(goHome).toBeEnabled();
    await goHome.click();
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  });
}

test("shows an analysis failure and lets the user exit to the dashboard", async ({ page }) => {
  await showEndedSession(page, "analysis-failure");

  await expect(page.getByText("分析失败，请重试或返回主页")).toBeVisible();
  await page.getByRole("button", { name: "重新分析" }).click();
  await expect(page.getByText("发音评分")).toBeVisible();
  const goHome = page.getByRole("button", { name: "返回主页" });
  await expect(goHome).toBeEnabled();
  await goHome.click();
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});
