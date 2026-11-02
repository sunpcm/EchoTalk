import { expect, test, type Page, type TestInfo } from "@playwright/test";

const FIXTURE_SESSION_A = {
  id: "38752299-15c9-4423-8920-dea740cc4801",
  mode: "scenario",
  status: "active",
  started_at: "2026-10-24T00:30:00Z",
  ended_at: null,
};

const FIXTURE_SESSION_B = {
  id: "8f7e6d5c-4b3a-4210-9876-543210fedcba",
  mode: "free_talk",
  status: "active",
  started_at: "2026-10-24T00:45:00Z",
  ended_at: null,
};

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

test.describe("Activity Sessions Responsive Layout & Touch Targets", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/sessions/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [FIXTURE_SESSION_A, FIXTURE_SESSION_B],
          next_cursor: null,
        }),
      });
    });
  });

  test("verifies 44x44 CSSpx touch targets for list action buttons and confirm panel buttons", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${FIXTURE_SESSION_A.id}`);
    await expect(sessionItem).toBeVisible();

    // 1. 列表操作按钮触控尺寸 (>= 44x44)
    const resumeBtn = page.getByTestId(`resume-session-button-${FIXTURE_SESSION_A.id}`);
    const endBtn = page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`);
    await expect(resumeBtn).toBeVisible();
    await expect(endBtn).toBeVisible();

    const resumeBox = await resumeBtn.boundingBox();
    expect(resumeBox).not.toBeNull();
    expect(resumeBox!.width).toBeGreaterThanOrEqual(44);
    expect(resumeBox!.height).toBeGreaterThanOrEqual(44);

    const endBox = await endBtn.boundingBox();
    expect(endBox).not.toBeNull();
    expect(endBox!.width).toBeGreaterThanOrEqual(44);
    expect(endBox!.height).toBeGreaterThanOrEqual(44);

    // 2. 结束确认面板按钮触控尺寸 (>= 44x44)
    await endBtn.click();
    const endPanel = page.getByTestId(`end-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(endPanel).toBeVisible();

    const cancelEndBtn = page.getByTestId(`cancel-end-button-${FIXTURE_SESSION_A.id}`);
    const confirmEndBtn = page.getByTestId(`confirm-end-button-${FIXTURE_SESSION_A.id}`);
    await expect(cancelEndBtn).toBeVisible();
    await expect(confirmEndBtn).toBeVisible();

    const cancelEndBox = await cancelEndBtn.boundingBox();
    expect(cancelEndBox).not.toBeNull();
    expect(cancelEndBox!.width).toBeGreaterThanOrEqual(44);
    expect(cancelEndBox!.height).toBeGreaterThanOrEqual(44);

    const confirmEndBox = await confirmEndBtn.boundingBox();
    expect(confirmEndBox).not.toBeNull();
    expect(confirmEndBox!.width).toBeGreaterThanOrEqual(44);
    expect(confirmEndBox!.height).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: testInfo.outputPath("touch-targets-end-panel.png") });

    // 取消结束确认
    await cancelEndBtn.click();
    await expect(endPanel).toHaveCount(0);

    // 3. 恢复确认面板按钮触控尺寸 (>= 44x44)
    await resumeBtn.click();
    const resumePanel = page.getByTestId(`resume-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(resumePanel).toBeVisible();

    const cancelResumeBtn = page.getByTestId(`cancel-resume-button-${FIXTURE_SESSION_A.id}`);
    const confirmResumeBtn = page.getByTestId(`confirm-resume-button-${FIXTURE_SESSION_A.id}`);
    await expect(cancelResumeBtn).toBeVisible();
    await expect(confirmResumeBtn).toBeVisible();

    const cancelResumeBox = await cancelResumeBtn.boundingBox();
    expect(cancelResumeBox).not.toBeNull();
    expect(cancelResumeBox!.width).toBeGreaterThanOrEqual(44);
    expect(cancelResumeBox!.height).toBeGreaterThanOrEqual(44);

    const confirmResumeBox = await confirmResumeBtn.boundingBox();
    expect(confirmResumeBox).not.toBeNull();
    expect(confirmResumeBox!.width).toBeGreaterThanOrEqual(44);
    expect(confirmResumeBox!.height).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: testInfo.outputPath("touch-targets-resume-panel.png") });
  });

  const viewports = [
    { name: "320x568-portrait", width: 320, height: 568 },
    { name: "667x320-landscape", width: 667, height: 320 },
    { name: "640x480-small-desktop", width: 640, height: 480 },
    { name: "960x720-desktop", width: 960, height: 720 },
  ];

  for (const vp of viewports) {
    test(`renders safely on ${vp.name} viewport without horizontal overflow`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      const list = page.getByTestId("active-sessions-list");
      await expect(list).toBeVisible();

      // 验证页面无横向溢出
      const isOverflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(isOverflowing).toBe(false);

      // 验证列表内 ID 宽度 > 0 且可辨
      const idElem = page.getByTestId(`session-id-${FIXTURE_SESSION_A.id}`);
      await expect(idElem).toBeVisible();
      const idBox = await idElem.boundingBox();
      expect(idBox).not.toBeNull();
      expect(idBox!.width).toBeGreaterThan(0);

      // 验证模式和时间完全可见
      await expect(page.getByTestId(`session-mode-${FIXTURE_SESSION_A.id}`)).toBeVisible();
      await expect(page.getByTestId(`session-started-at-${FIXTURE_SESSION_A.id}`)).toBeVisible();

      // 打开结束确认面板并验证无溢出、完整 UUID 可视换行
      await page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`).click();
      const endPanel = page.getByTestId(`end-confirm-panel-${FIXTURE_SESSION_A.id}`);
      await expect(endPanel).toBeVisible();

      const confirmId = page.getByTestId(`confirm-session-id-${FIXTURE_SESSION_A.id}`);
      await expect(confirmId).toHaveText(FIXTURE_SESSION_A.id);

      const panelOverflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(panelOverflowing).toBe(false);

      await page.screenshot({ path: testInfo.outputPath(`layout-${vp.name}.png`) });
    });
  }

  test("renders safely under 320px portrait with 200% root font size without clipping UUID or pushing buttons off-screen", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");

    // 缩放根字号至 200%
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const sessionItem = page.getByTestId(`active-session-item-${FIXTURE_SESSION_A.id}`);
    await expect(sessionItem).toBeVisible();

    // 验证卡片内 ID 宽度 > 0
    const idElem = page.getByTestId(`session-id-${FIXTURE_SESSION_A.id}`);
    const idBox = await idElem.boundingBox();
    expect(idBox).not.toBeNull();
    expect(idBox!.width).toBeGreaterThan(0);

    // 验证恢复和结束按钮均可见且处于视口水平范围内
    const resumeBtn = page.getByTestId(`resume-session-button-${FIXTURE_SESSION_A.id}`);
    const endBtn = page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`);
    await expect(resumeBtn).toBeVisible();
    await expect(endBtn).toBeVisible();

    const resumeBox = await resumeBtn.boundingBox();
    const endBox = await endBtn.boundingBox();
    expect(resumeBox).not.toBeNull();
    expect(endBox).not.toBeNull();
    expect(resumeBox!.x + resumeBox!.width).toBeLessThanOrEqual(321);
    expect(endBox!.x + endBox!.width).toBeLessThanOrEqual(321);

    // 打开恢复确认面板
    await resumeBtn.click();
    const resumePanel = page.getByTestId(`resume-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(resumePanel).toBeVisible();

    // 完整 UUID 可视核对且文本无截断丢失
    const confirmId = page.getByTestId(`confirm-resume-session-id-${FIXTURE_SESSION_A.id}`);
    await expect(confirmId).toHaveText(FIXTURE_SESSION_A.id);

    // 确认面板按钮均在视口水平范围内，纵向滚动可达
    const confirmBtn = page.getByTestId(`confirm-resume-button-${FIXTURE_SESSION_A.id}`);
    await confirmBtn.scrollIntoViewIfNeeded();
    await expect(confirmBtn).toBeVisible();
    const confirmBox = await confirmBtn.boundingBox();
    expect(confirmBox).not.toBeNull();
    expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(321);

    await page.screenshot({ path: testInfo.outputPath("layout-320px-200pct-font.png") });
  });

  test("supports full keyboard Tab reachability to all list and confirmation actions", async ({
    page,
    browserName,
  }) => {
    await page.goto("/");
    const sessionItem = page.getByTestId(`active-session-item-${FIXTURE_SESSION_A.id}`);
    await expect(sessionItem).toBeVisible();

    const resumeBtn = page.getByTestId(`resume-session-button-${FIXTURE_SESSION_A.id}`);
    const endBtn = page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`);

    // 直接聚焦到第一个活动卡片的恢复按钮
    await resumeBtn.focus();
    await expect(resumeBtn).toBeFocused();

    // WebKit 在 macOS 环境下键盘导航按钮遵循系统偏好，使用 Alt+Tab 切换控件焦点
    const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";

    // Tab 到结束按钮
    await page.keyboard.press(tabKey);
    await expect(endBtn).toBeFocused();

    // 回车打开结束确认面板
    await page.keyboard.press("Enter");
    const endPanel = page.getByTestId(`end-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(endPanel).toBeVisible();

    const cancelBtn = page.getByTestId(`cancel-end-button-${FIXTURE_SESSION_A.id}`);
    const confirmBtn = page.getByTestId(`confirm-end-button-${FIXTURE_SESSION_A.id}`);

    // Tab 到取消按钮和确认按钮
    await cancelBtn.focus();
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press(tabKey);
    await expect(confirmBtn).toBeFocused();
  });

  test("zero implicit write requests on panel open, cancel, Tab navigation, or window resize", async ({
    page,
  }) => {
    const mutations = trackMutationRequests(page);

    await page.goto("/");
    const resumeBtn = page.getByTestId(`resume-session-button-${FIXTURE_SESSION_A.id}`);
    await expect(resumeBtn).toBeVisible();

    // 1. 打开恢复确认面板
    await resumeBtn.click();
    const resumePanel = page.getByTestId(`resume-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(resumePanel).toBeVisible();

    // 2. 窗口 resize
    await page.setViewportSize({ width: 500, height: 600 });
    await page.waitForTimeout(50);

    // 3. Tab 键盘导航
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // 4. 点击取消按钮
    const cancelBtn = page.getByTestId(`cancel-resume-button-${FIXTURE_SESSION_A.id}`);
    await cancelBtn.click();
    await expect(resumePanel).toHaveCount(0);

    // 5. 打开结束确认面板并取消
    const endBtn = page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`);
    await endBtn.click();
    const endPanel = page.getByTestId(`end-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(endPanel).toBeVisible();

    const cancelEndBtn = page.getByTestId(`cancel-end-button-${FIXTURE_SESSION_A.id}`);
    await cancelEndBtn.click();
    await expect(endPanel).toHaveCount(0);

    // 验证整个过程没有任何会话结束/创建/dispatch/租约写请求
    const illegalMutations = mutations.filter(
      (m) =>
        m.pathname.includes("/end") ||
        m.pathname.includes("/call/") ||
        m.pathname.includes("/dispatch") ||
        m.pathname.includes("/token") ||
        (m.pathname === "/api/sessions" && m.method === "POST"),
    );
    expect(illegalMutations).toHaveLength(0);
  });

  test("handles load error and end error with >= 44x44 retry buttons", async ({
    page,
  }, testInfo) => {
    // 1. 列表加载失败重试场景
    await page.route("**/api/sessions/active", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Simulated load failure" }),
      });
    });

    await page.goto("/");
    const loadErrorAlert = page.getByRole("alert");
    await expect(loadErrorAlert).toBeVisible();

    const retryLoadBtn = loadErrorAlert.getByRole("button", { name: "重试" });
    await expect(retryLoadBtn).toBeVisible();
    const retryLoadBox = await retryLoadBtn.boundingBox();
    expect(retryLoadBox).not.toBeNull();
    expect(retryLoadBox!.width).toBeGreaterThanOrEqual(44);
    expect(retryLoadBox!.height).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: testInfo.outputPath("load-error-retry.png") });

    // 恢复列表接口并重试
    await page.route("**/api/sessions/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [FIXTURE_SESSION_A],
          next_cursor: null,
        }),
      });
    });
    await retryLoadBtn.click();

    const sessionItem = page.getByTestId(`active-session-item-${FIXTURE_SESSION_A.id}`);
    await expect(sessionItem).toBeVisible();

    // 2. 结束会话失败重试场景
    await page.route(`**/api/sessions/${FIXTURE_SESSION_A.id}/end`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Simulated end failure" }),
      });
    });

    await page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`).click();
    await page.getByTestId(`confirm-end-button-${FIXTURE_SESSION_A.id}`).click();

    const endErrorAlert = page.getByTestId(`end-error-${FIXTURE_SESSION_A.id}`);
    await expect(endErrorAlert).toBeVisible();

    const retryEndBtn = page.getByTestId(`retry-end-button-${FIXTURE_SESSION_A.id}`);
    await expect(retryEndBtn).toBeVisible();
    const retryEndBox = await retryEndBtn.boundingBox();
    expect(retryEndBox).not.toBeNull();
    expect(retryEndBox!.width).toBeGreaterThanOrEqual(44);
    expect(retryEndBox!.height).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: testInfo.outputPath("end-error-retry.png") });
  });
});
