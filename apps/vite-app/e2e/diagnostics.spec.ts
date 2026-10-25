import { expect, test, type Page } from "@playwright/test";

function trackMutationRequests(page: Page) {
  const mutations: { method: string; pathname: string; url: string; body?: any }[] = [];
  page.on("request", (req) => {
    try {
      const method = req.method();
      if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
        const url = new URL(req.url());
        let body: any = null;
        try {
          body = req.postDataJSON();
        } catch {
          // ignore
        }
        mutations.push({
          method,
          pathname: url.pathname,
          url: req.url(),
          body,
        });
      }
    } catch {
      // ignore
    }
  });
  return mutations;
}

test.describe("Safe Local Diagnostics Instrumentation (CP-06)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Unexpected pageerror encountered: ${err.message}`);
    });
  });

  test("emits safe sanitized diagnostic log on HTTP 503 without leaking canary data, and recovers on retry", async ({
    page,
  }) => {
    const mutations = trackMutationRequests(page);
    const consoleLogs: { type: string; text: string }[] = [];
    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    const CANARY_SECRET_TOKEN = "canary-super-secret-token-xyz-98765";
    const CANARY_DOC_CONTEXT = "confidential-student-transcript-canary-text";

    let shouldFail = true;

    // 拦截 /api/sessions/active，受控注入 HTTP 503 且附带敏感 canary 字段
    await page.route("**/api/sessions/active", async (route) => {
      if (shouldFail) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "Service temporarily unavailable due to upstream maintenance",
            secret_token: CANARY_SECRET_TOKEN,
            document_canary: CANARY_DOC_CONTEXT,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });

    // 访问 Dashboard 页面
    await page.goto("/");

    // 验证页面出现失败状态与重试按钮
    const retryBtn = page.getByRole("button", { name: "重试" });
    await expect(retryBtn).toBeVisible({ timeout: 10_000 });

    // 1. 验证捕获到了结构化安全诊断日志
    const diagnosticMessages = consoleLogs.filter((log) => log.text.includes("[diagnostic]"));
    expect(diagnosticMessages.length).toBeGreaterThanOrEqual(1);

    const diagnosticText = diagnosticMessages[0].text;
    expect(diagnosticText).toContain("api_http_failed");
    expect(diagnosticText).toContain("503");
    expect(diagnosticText).toContain("1.0.1");
    expect(diagnosticText).toContain("web");

    // 2. 核心隐私断言：所有控制台输出中绝对不包含任何敏感 canary 字符串
    for (const log of consoleLogs) {
      expect(log.text).not.toContain(CANARY_SECRET_TOKEN);
      expect(log.text).not.toContain(CANARY_DOC_CONTEXT);
    }

    // 3. 恢复路由，点击重试恢复页面
    shouldFail = false;
    await retryBtn.click();

    // 重试成功后，重试按钮消失，页面恢复正常
    await expect(retryBtn).not.toBeVisible({ timeout: 10_000 });

    // 4. 验证无任何异常 session / lease / token / dispatch 等非预期业务写操作
    const forbiddenMutations = mutations.filter(
      (m) =>
        m.pathname.includes("/call/") ||
        m.pathname.includes("/token") ||
        m.pathname.includes("/dispatch") ||
        (m.pathname === "/api/sessions" && m.method === "POST"),
    );
    expect(forbiddenMutations).toEqual([]);
  });
});
