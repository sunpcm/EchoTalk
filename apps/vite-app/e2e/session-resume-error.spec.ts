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

test.describe("Session Recovery Error & Cancellation Terminal States (CP-05 / A23)", () => {
  test("real store detail 503 failure shows dedicated safe error, full UUID, >=44px retry, and retries same record on explicit click without implicit token or write", async ({
    page,
    request,
  }, testInfo) => {
    const targetId = await createActiveSession(request);
    let detailCount = 0;
    const rawErrorMessage = "secret_raw_503_upstream_detail_failure";

    await page.route(`**/api/sessions/${targetId}`, async (route) => {
      if (route.request().method() === "GET") {
        detailCount++;
        // 模拟详情 503 服务暂不可用
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: rawErrorMessage }),
        });
        return;
      }
      await route.continue();
    });

    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    // 1. 点击恢复练习，弹出确认面板
    const resumeButton = page.getByTestId(`resume-session-button-${targetId}`);
    await expect(resumeButton).toBeVisible();
    await resumeButton.click();

    const confirmPanel = page.getByTestId(`resume-confirm-panel-${targetId}`);
    await expect(confirmPanel).toBeVisible();
    await expect(page.getByTestId(`confirm-resume-session-id-${targetId}`)).toHaveText(targetId);

    // 2. 点击确认恢复（触发真实 store.resumeSession 与真实的 503 响应）
    const confirmButton = page.getByTestId(`confirm-resume-button-${targetId}`);
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // 3. 验证专用安全错误呈现，不回显原始敏感服务端信息
    const resumeErrorAlert = page.getByTestId(`resume-error-${targetId}`);
    await expect(resumeErrorAlert).toBeVisible();
    await expect(resumeErrorAlert).toHaveText("恢复会话失败");
    await expect(page.locator("body")).not.toContainText(rawErrorMessage);

    // 4. 验证完整可见 UUID 与意图保留
    await expect(page.getByTestId(`confirm-resume-session-id-${targetId}`)).toHaveText(targetId);

    // 5. 验证专用重试按钮与取消按钮均可用，且重试按钮满足 >= 44x44px 无障碍触控
    const retryButton = page.getByTestId(`retry-resume-button-${targetId}`);
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toHaveText("重试恢复");

    const box = await retryButton.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const cancelButton = page.getByTestId(`cancel-resume-button-${targetId}`);
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();

    // 6. 验证请求统计与零隐式 Token 或写请求
    expect(detailCount).toBe(1);
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/call/"))).toBe(false);

    // 截图记录首轮 503 专用错误状态
    await page.screenshot({ path: testInfo.outputPath("resume-detail-503-error-state.png") });

    // 7. 再次明确点击专用重试按钮（触发同一记录的第 2 次 GET，依然安全重试且无任何隐式 Token 或写）
    await retryButton.click();

    // 验证同记录再次发起 GET，且严格去重
    await expect.poll(() => detailCount).toBe(2);

    // 保持在可恢复错误态，专用错误、完整 UUID 及 44px 重试/取消按钮均完好保留
    await expect(resumeErrorAlert).toBeVisible();
    await expect(page.getByTestId(`confirm-resume-session-id-${targetId}`)).toHaveText(targetId);
    await expect(retryButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();

    // 重试后全流程依然零 Token 与写请求
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);

    // 截图记录重试后可恢复状态
    await page.screenshot({ path: testInfo.outputPath("resume-detail-retry-recoverable.png") });
  });

  test("user cancellation after failure dismisses panel with zero side-effects and leaves session active", async ({
    page,
    request,
  }, testInfo) => {
    const targetId = await createActiveSession(request);

    await page.route(`**/api/sessions/${targetId}`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "503 fail" }),
        });
        return;
      }
      await route.continue();
    });

    const pageRequests = trackPageRequests(page);

    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${targetId}`);
    await expect(sessionItem).toBeVisible();

    await page.getByTestId(`resume-session-button-${targetId}`).click();
    await page.getByTestId(`confirm-resume-button-${targetId}`).click();

    // 出现专用错误
    await expect(page.getByTestId(`resume-error-${targetId}`)).toBeVisible();

    // 点击取消
    const cancelButton = page.getByTestId(`cancel-resume-button-${targetId}`);
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // 确认面板关闭
    await expect(page.getByTestId(`resume-confirm-panel-${targetId}`)).toHaveCount(0);

    // 验证整个取消过程零 Token/写操作
    expect(pageRequests.some((r) => r.pathname.includes("/token"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname === "/api/sessions" && r.method === "POST")).toBe(
      false,
    );
    expect(pageRequests.some((r) => r.pathname.includes("/dispatch"))).toBe(false);
    expect(pageRequests.some((r) => r.pathname.includes("/end"))).toBe(false);

    // 列表项完好保留
    await expect(sessionItem).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("resume-error-cancelled.png") });
  });
});
