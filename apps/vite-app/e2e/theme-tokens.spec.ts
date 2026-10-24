import { expect, test, type Page } from "@playwright/test";

const FIXTURE_SESSION_A = {
  id: "38752299-15c9-4423-8920-dea740cc4801",
  mode: "scenario",
  status: "active",
  started_at: "2026-10-24T00:30:00Z",
  ended_at: null,
};

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

test.describe("Theme Tokens Audit & Confirmation Panels Visual Regression (CP-05 / A32)", () => {
  test.beforeEach(async ({ page }) => {
    // 监听 pageerror，保证 0 pageerror
    page.on("pageerror", (err) => {
      throw new Error(`Unexpected pageerror encountered: ${err.message}`);
    });

    // 拦截活动会话只读发现
    await page.route("**/api/sessions/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([FIXTURE_SESSION_A]),
      });
    });

    // 拦截设置 PUT，确保只允许合法 theme 保存且返回 200
    await page.route("**/api/user/settings", async (route, request) => {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            is_custom_mode: false,
            is_custom_verified: false,
            subscription_tier: "free",
            theme: body?.theme || "warm",
            stt_provider: null,
            llm_provider: null,
            llm_model: null,
            tts_provider: null,
            has_stt_key: false,
            has_llm_key: false,
            has_tts_key: false,
            stt_status: "unconfigured",
            llm_status: "unconfigured",
            tts_status: "unconfigured",
          }),
        });
        return;
      }
      await route.continue();
    });
  });

  const THEMES: Array<{ key: "warm" | "cool" | "dark"; labelRegex: RegExp }> = [
    { key: "warm", labelRegex: /暖色/ },
    { key: "cool", labelRegex: /冷色/ },
    { key: "dark", labelRegex: /黑色/ },
  ];

  for (const themeConfig of THEMES) {
    test(`verifies end and resume confirm panels background and borders resolve to valid non-transparent CSS variables under ${themeConfig.key} theme`, async ({
      page,
    }) => {
      const mutations = trackMutationRequests(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

      // 切换到目标主题
      const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
      await settingsBtn.click();
      const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
      await expect(dialog).toBeVisible();

      const themeRadio = dialog.getByRole("radio", { name: themeConfig.labelRegex });
      await themeRadio.click();

      // 验证 html 标签 theme 属性
      if (themeConfig.key === "warm") {
        const htmlTheme = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        expect(htmlTheme === "warm" || htmlTheme === null).toBe(true);
      } else {
        await expect(page.locator("html")).toHaveAttribute("data-theme", themeConfig.key);
      }

      // 关闭设置抽屉
      await dialog.getByRole("button", { name: "关闭设置抽屉" }).click();
      await expect(dialog).not.toBeVisible();

      const sessionItem = page.getByTestId(`active-session-item-${FIXTURE_SESSION_A.id}`);
      await expect(sessionItem).toBeVisible();

      // 1. 验证结束确认面板
      const endBtn = page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`);
      await endBtn.click();
      const endPanel = page.getByTestId(`end-confirm-panel-${FIXTURE_SESSION_A.id}`);
      await expect(endPanel).toBeVisible();

      // 断言结束确认面板 computed 背景与边框
      const endPanelStyles = await page.evaluate(
        ({ panelSelector, cancelSelector }) => {
          const panel = document.querySelector(panelSelector) as HTMLElement | null;
          const cancelBtn = document.querySelector(cancelSelector) as HTMLElement | null;
          if (!panel || !cancelBtn) return null;

          const panelComp = window.getComputedStyle(panel);
          const cancelComp = window.getComputedStyle(cancelBtn);

          // probe 元素测试变量解析
          const probeBg = document.createElement("div");
          probeBg.style.backgroundColor = "var(--surface-alt)";
          document.body.appendChild(probeBg);
          const expectedBg = window.getComputedStyle(probeBg).backgroundColor;
          probeBg.remove();

          const probeBorder = document.createElement("div");
          probeBorder.style.borderColor = "var(--border-soft)";
          probeBorder.style.borderStyle = "solid";
          document.body.appendChild(probeBorder);
          const expectedBorder = window.getComputedStyle(probeBorder).borderTopColor;
          probeBorder.remove();

          return {
            panelBg: panelComp.backgroundColor,
            panelBorderTop: panelComp.borderTopColor,
            cancelBorderTop: cancelComp.borderTopColor,
            expectedBg,
            expectedBorder,
          };
        },
        {
          panelSelector: `[data-testid="end-confirm-panel-${FIXTURE_SESSION_A.id}"]`,
          cancelSelector: `[data-testid="cancel-end-button-${FIXTURE_SESSION_A.id}"]`,
        },
      );

      expect(endPanelStyles).not.toBeNull();
      // 非透明断言
      expect(endPanelStyles!.panelBg).not.toBe("rgba(0, 0, 0, 0)");
      expect(endPanelStyles!.panelBg).not.toBe("transparent");
      // 严格匹配 --surface-alt 与 --border-soft
      expect(endPanelStyles!.panelBg).toBe(endPanelStyles!.expectedBg);
      expect(endPanelStyles!.panelBorderTop).toBe(endPanelStyles!.expectedBorder);
      expect(endPanelStyles!.cancelBorderTop).toBe(endPanelStyles!.expectedBorder);

      // 取消结束确认
      const cancelEndBtn = page.getByTestId(`cancel-end-button-${FIXTURE_SESSION_A.id}`);
      await cancelEndBtn.click();
      await expect(endPanel).toHaveCount(0);

      // 验证取消后原列表按钮可再次操作
      await expect(endBtn).toBeVisible();
      await expect(endBtn).toBeEnabled();

      // 2. 验证恢复确认面板
      const resumeBtn = page.getByTestId(`resume-session-button-${FIXTURE_SESSION_A.id}`);
      await resumeBtn.click();
      const resumePanel = page.getByTestId(`resume-confirm-panel-${FIXTURE_SESSION_A.id}`);
      await expect(resumePanel).toBeVisible();

      const resumePanelStyles = await page.evaluate(
        ({ panelSelector, cancelSelector }) => {
          const panel = document.querySelector(panelSelector) as HTMLElement | null;
          const cancelBtn = document.querySelector(cancelSelector) as HTMLElement | null;
          if (!panel || !cancelBtn) return null;

          const panelComp = window.getComputedStyle(panel);
          const cancelComp = window.getComputedStyle(cancelBtn);

          const probeBg = document.createElement("div");
          probeBg.style.backgroundColor = "var(--surface-alt)";
          document.body.appendChild(probeBg);
          const expectedBg = window.getComputedStyle(probeBg).backgroundColor;
          probeBg.remove();

          const probeBorder = document.createElement("div");
          probeBorder.style.borderColor = "var(--border-soft)";
          probeBorder.style.borderStyle = "solid";
          document.body.appendChild(probeBorder);
          const expectedBorder = window.getComputedStyle(probeBorder).borderTopColor;
          probeBorder.remove();

          return {
            panelBg: panelComp.backgroundColor,
            panelBorderTop: panelComp.borderTopColor,
            cancelBorderTop: cancelComp.borderTopColor,
            expectedBg,
            expectedBorder,
          };
        },
        {
          panelSelector: `[data-testid="resume-confirm-panel-${FIXTURE_SESSION_A.id}"]`,
          cancelSelector: `[data-testid="cancel-resume-button-${FIXTURE_SESSION_A.id}"]`,
        },
      );

      expect(resumePanelStyles).not.toBeNull();
      expect(resumePanelStyles!.panelBg).not.toBe("rgba(0, 0, 0, 0)");
      expect(resumePanelStyles!.panelBg).not.toBe("transparent");
      expect(resumePanelStyles!.panelBg).toBe(resumePanelStyles!.expectedBg);
      expect(resumePanelStyles!.panelBorderTop).toBe(resumePanelStyles!.expectedBorder);
      expect(resumePanelStyles!.cancelBorderTop).toBe(resumePanelStyles!.expectedBorder);

      // 取消恢复确认
      const cancelResumeBtn = page.getByTestId(`cancel-resume-button-${FIXTURE_SESSION_A.id}`);
      await cancelResumeBtn.click();
      await expect(resumePanel).toHaveCount(0);

      // 再次验证取消后原列表可再次操作
      await expect(resumeBtn).toBeVisible();
      await expect(resumeBtn).toBeEnabled();

      // 验证业务写门禁：确认前与取消不能触发 end/resume/token/dispatch 等业务写
      const illegalMutations = mutations.filter(
        (m) =>
          m.pathname.includes("/end") ||
          m.pathname.includes("/call/") ||
          m.pathname.includes("/dispatch") ||
          m.pathname.includes("/token") ||
          (m.pathname === "/api/sessions" && m.method === "POST"),
      );
      expect(illegalMutations).toHaveLength(0);

      // 允许主题显式 PUT，若发生则必须精确包含 theme
      const settingPuts = mutations.filter(
        (m) => m.pathname === "/api/user/settings" && m.method === "PUT",
      );
      for (const putReq of settingPuts) {
        expect(putReq.body).toHaveProperty("theme");
      }
    });
  }

  test("verifies responsive layout under 390px viewport and 200% root font size without horizontal overflow and full cancel recovery", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 放大根字号至 200%
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const sessionItem = page.getByTestId(`active-session-item-${FIXTURE_SESSION_A.id}`);
    await expect(sessionItem).toBeVisible();

    // 1. 打开结束确认面板并验证无溢出
    const endBtn = page.getByTestId(`end-session-button-${FIXTURE_SESSION_A.id}`);
    await endBtn.click();
    const endPanel = page.getByTestId(`end-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(endPanel).toBeVisible();

    const isEndOverflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(isEndOverflowing).toBe(false);

    // 取消结束确认
    const cancelEndBtn = page.getByTestId(`cancel-end-button-${FIXTURE_SESSION_A.id}`);
    await cancelEndBtn.click();
    await expect(endPanel).toHaveCount(0);

    // 2. 打开恢复确认面板并验证无溢出
    const resumeBtn = page.getByTestId(`resume-session-button-${FIXTURE_SESSION_A.id}`);
    await resumeBtn.click();
    const resumePanel = page.getByTestId(`resume-confirm-panel-${FIXTURE_SESSION_A.id}`);
    await expect(resumePanel).toBeVisible();

    const isResumeOverflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(isResumeOverflowing).toBe(false);

    // 取消恢复确认
    const cancelResumeBtn = page.getByTestId(`cancel-resume-button-${FIXTURE_SESSION_A.id}`);
    await cancelResumeBtn.click();
    await expect(resumePanel).toHaveCount(0);

    // 原列表按钮正常可点
    await expect(resumeBtn).toBeVisible();
    await expect(resumeBtn).toBeEnabled();
  });
});
