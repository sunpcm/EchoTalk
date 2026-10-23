import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function trackPageRequests(page: Page) {
  const requests: { method: string; pathname: string; url: string }[] = [];
  page.on("request", (req) => {
    try {
      const url = new URL(req.url());
      requests.push({
        method: req.method(),
        pathname: url.pathname,
        url: req.url(),
      });
    } catch {
      // ignore unparseable URLs
    }
  });
  return requests;
}

async function createActiveSession(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/sessions", {
    headers: { Authorization: "Bearer e2e-dev-token" },
    data: { mode: "scenario" },
  });
  expect(res.status()).toBe(201);
  const data = (await res.json()) as { id: string; status: string };
  expect(data.id).toBeTruthy();
  expect(data.status).toBe("active");
  return data.id;
}

test.describe("Session Recovery and Auth Boundary Gates", () => {
  test("shows active session and confirms resume prompt; zero side-effect requests before confirm and after cancel", async ({
    page,
    request,
  }) => {
    const targetId = await createActiveSession(request);
    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    // 确认在点击前：列表请求合法发生，零 capabilities/detail/token/create/dispatch/end/lease 请求
    expect(pageRequests.some((r) => r.pathname === "/api/sessions/active")).toBe(true);
    expect(pageRequests.some((r) => r.pathname === "/api/call-capabilities")).toBe(false);
    expect(pageRequests.some((r) => r.pathname === `/api/sessions/${targetId}`)).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);

    // 点击恢复练习
    const resumeButton = page.getByTestId(`resume-session-button-${targetId}`);
    await expect(resumeButton).toBeVisible();
    await resumeButton.click();

    // 弹出确认面板，展示该 ID 及采音说明
    const confirmPanel = page.getByTestId(`resume-confirm-panel-${targetId}`);
    await expect(confirmPanel).toBeVisible();
    await expect(page.getByTestId(`confirm-resume-session-id-${targetId}`)).toHaveText(targetId);
    await expect(confirmPanel).toContainText("恢复后将连接语音服务并请求麦克风权限");

    // 点击取消
    const cancelButton = page.getByTestId(`cancel-resume-button-${targetId}`);
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // 确认面板关闭
    await expect(confirmPanel).toHaveCount(0);

    // 取消后断言：整个流程中零 capabilities/detail/token/create/dispatch/end/lease 请求
    expect(pageRequests.some((r) => r.pathname === "/api/call-capabilities")).toBe(false);
    expect(pageRequests.some((r) => r.pathname === `/api/sessions/${targetId}`)).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);
  });

  test("capabilities failure shows generic error with zero token/create/dispatch/end/lease requests, leaks no raw error, and retries only on explicit action", async ({
    page,
    request,
  }) => {
    const targetId = await createActiveSession(request);
    let capCount = 0;
    const rawErrorMessage = "raw_capabilities_secret_failure_xyz";

    await page.route("**/api/call-capabilities", async (route) => {
      capCount++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: rawErrorMessage }),
      });
    });

    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    await page.getByTestId(`resume-session-button-${targetId}`).click();
    await page.getByTestId(`confirm-resume-button-${targetId}`).click();

    // 出现安全通用错误，不回显原始敏感错误
    await expect(page.getByText("通话能力检查失败，请稍后重试")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(rawErrorMessage);

    // 请求统计：capabilities 请求恰好 1 次
    expect(capCount).toBe(1);

    // 零 Token/创建/dispatch/结束/租约
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);

    // 等待 500ms 验证无自动重试循环
    await page.waitForTimeout(500);
    expect(capCount).toBe(1);

    // 只有再次明确点击重试才增加请求
    const retryBtn = page.getByTestId(`retry-resume-button-${targetId}`);
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toBeEnabled();
    await retryBtn.click();

    await expect.poll(() => capCount).toBe(2);

    // 重试后依然维持零 Token/创建/dispatch/结束/租约
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);
  });

  test("livekit_cloud capability is rejected with zero detail/token/create/dispatch/lease requests", async ({
    page,
    request,
  }) => {
    const targetId = await createActiveSession(request);

    await page.route("**/api/call-capabilities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          protocol_version: 1,
          call_lease_mode: "livekit_cloud",
        }),
      });
    });

    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    await page.getByTestId(`resume-session-button-${targetId}`).click();
    await page.getByTestId(`confirm-resume-button-${targetId}`).click();

    // 恢复失败，提示通用错误
    await expect(page.getByText("当前客户端尚未支持此通话模式")).toBeVisible();

    // 零 detail/token/create/dispatch/租约，原默认门禁不松动
    expect(pageRequests.some((r) => r.pathname === `/api/sessions/${targetId}`)).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);
  });

  test("re-querying detail rejects already ended session with zero token/create/dispatch requests", async ({
    page,
    request,
  }) => {
    const targetId = await createActiveSession(request);
    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    // 此时客户端列表已拉取并缓存；在用户点击恢复确认前，服务端结束该记录
    const endRes = await request.post(`/api/sessions/${targetId}/end`, {
      headers: { Authorization: "Bearer e2e-dev-token" },
    });
    expect(endRes.ok()).toBeTruthy();

    // 客户端使用列表缓存点击恢复
    await page.getByTestId(`resume-session-button-${targetId}`).click();
    await page.getByTestId(`confirm-resume-button-${targetId}`).click();

    // 重新查询详情，已结束记录拒绝恢复
    const errorAlert = page.getByTestId(`resume-error-${targetId}`);
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveText("恢复会话失败");

    // 证明实际重新查询了详情
    expect(
      pageRequests.some((r) => r.pathname === `/api/sessions/${targetId}` && r.method === "GET"),
    ).toBe(true);

    // 证明不能靠列表缓存恢复：零 Token/创建/dispatch
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
  });

  test("pre-recovery 401 unauthenticated boundary fails closed with zero create/token/dispatch requests", async ({
    page,
    request,
  }) => {
    const targetId = await createActiveSession(request);

    await page.route("**/api/call-capabilities", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Authentication required." }),
      });
    });

    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    await page.getByTestId(`resume-session-button-${targetId}`).click();
    await page.getByTestId(`confirm-resume-button-${targetId}`).click();

    // 401 触发未认证边界失效，活动列表清空或卸载，失败关闭
    await expect(page.getByTestId(`active-session-item-${targetId}`)).toHaveCount(0);

    // 零 创建/Token/dispatch 及后续副作用
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);
  });
});
