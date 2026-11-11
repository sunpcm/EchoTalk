import { expect, test, type Page } from "@playwright/test";

// 主路径：进入练习 → 就绪检查 → 创建会话 → 取 Token → 挂载 Room。
// 信令 WebSocket 由 Playwright 接管，不连接任何真实 LiveKit；只验证客户端视图与请求顺序。

function trackSessionRequests(page: Page) {
  const calls: string[] = [];
  let sessionId: string | null = null;
  page.on("response", async (res) => {
    const req = res.request();
    const pathname = new URL(req.url()).pathname;
    if (!pathname.startsWith("/api/sessions") && pathname !== "/api/health/ready") return;
    if (req.method() === "GET" && !pathname.endsWith("/token")) {
      if (pathname !== "/api/health/ready") return;
    }
    calls.push(`${req.method()} ${pathname.replace(/[0-9a-f-]{36}/, ":id")}`);
    if (req.method() === "POST" && pathname === "/api/sessions" && res.status() === 201) {
      sessionId = ((await res.json()) as { id: string }).id;
    }
  });
  return { calls, getSessionId: () => sessionId };
}

async function endSessionForCleanup(page: Page, sessionId: string | null) {
  if (!sessionId) return;
  await page.request.post(`/api/sessions/${sessionId}/end`, {
    headers: { Authorization: "Bearer e2e-dev-token" },
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});

test("starting practice creates one session, fetches a token and shows the connecting view", async ({
  page,
}) => {
  // 信令保持挂起：Room 停留在连接中，不会进入失败态
  await page.routeWebSocket(/.*/, () => {});
  const tracker = trackSessionRequests(page);

  try {
    await page
      .getByRole("button", { name: /进入练习/ })
      .first()
      .click();

    await expect(page.getByText("正在连接...")).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toHaveCount(0);

    await expect
      .poll(() => tracker.calls.filter((c) => c === "GET /api/sessions/:id/token").length)
      .toBe(1);
    expect(tracker.calls.filter((c) => c === "POST /api/sessions")).toHaveLength(1);
    // 未连接成功前不得调度 Agent 或结束会话
    expect(tracker.calls.some((c) => c.endsWith("/dispatch"))).toBe(false);
    expect(tracker.calls.some((c) => c.endsWith("/end"))).toBe(false);
    // 顺序：就绪检查先于创建，创建先于取 Token
    const order = [
      "GET /api/health/ready",
      "POST /api/sessions",
      "GET /api/sessions/:id/token",
    ].map((c) => tracker.calls.indexOf(c));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  } finally {
    await endSessionForCleanup(page, tracker.getSessionId());
  }
});

test("a refused signaling connection stops at the connection-failed view and returns home without retrying", async ({
  page,
}) => {
  await page.routeWebSocket(/.*/, (ws) => {
    void ws.close({ code: 1011, reason: "e2e refused" });
  });
  const tracker = trackSessionRequests(page);

  try {
    await page
      .getByRole("button", { name: /进入练习/ })
      .first()
      .click();

    await expect(page.getByRole("heading", { name: "语音连接已中断，音频已停止" })).toBeVisible({
      timeout: 30_000,
    });
    // 失败后不自动重建会话、不重取 Token、不调度、不结束
    expect(tracker.calls.filter((c) => c === "POST /api/sessions")).toHaveLength(1);
    expect(tracker.calls.filter((c) => c === "GET /api/sessions/:id/token")).toHaveLength(1);
    expect(tracker.calls.some((c) => c.endsWith("/dispatch"))).toBe(false);
    expect(tracker.calls.some((c) => c.endsWith("/end"))).toBe(false);

    await page.getByRole("button", { name: "返回主页" }).click();
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
    // 既有契约：记录保留在活动会话中，由用户显式恢复或结束
    await expect(page.getByText(tracker.getSessionId() ?? "missing-session-id")).toBeVisible();
    expect(tracker.calls.filter((c) => c === "POST /api/sessions")).toHaveLength(1);
  } finally {
    await endSessionForCleanup(page, tracker.getSessionId());
  }
});

test("a failed token request ends the just-created session and shows a generic message", async ({
  page,
}) => {
  await page.route("**/api/sessions/*/token", (route) =>
    route.fulfill({ status: 502, json: { detail: "upstream-detail-canary" } }),
  );
  const tracker = trackSessionRequests(page);

  try {
    await page
      .getByRole("button", { name: /进入练习/ })
      .first()
      .click();

    await expect(page.getByText("暂时无法开始练习，请稍后重试。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
    // 后端原始 detail 不展示给用户
    await expect(page.getByText("upstream-detail-canary")).toHaveCount(0);

    expect(tracker.calls.filter((c) => c === "POST /api/sessions")).toHaveLength(1);
    expect(tracker.calls.filter((c) => c === "GET /api/sessions/:id/token")).toHaveLength(1);
    expect(tracker.calls.filter((c) => c === "POST /api/sessions/:id/end")).toHaveLength(1);
    expect(tracker.calls.some((c) => c.endsWith("/dispatch"))).toBe(false);

    // 服务端记录已结束，活动会话中不再出现这条记录
    const sessionId = tracker.getSessionId();
    expect(sessionId).not.toBeNull();
    const detail = await page.request.get(`/api/sessions/${sessionId}`, {
      headers: { Authorization: "Bearer e2e-dev-token" },
    });
    expect(await detail.json()).toMatchObject({ id: sessionId, status: "completed" });
    await expect(page.getByText(sessionId ?? "missing-session-id")).toHaveCount(0);
  } finally {
    await endSessionForCleanup(page, tracker.getSessionId());
  }
});
