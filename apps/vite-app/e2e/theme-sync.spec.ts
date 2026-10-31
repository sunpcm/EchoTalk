import { expect, test } from "@playwright/test";

test.describe("CP-05 / A28 主题持久化可靠性与稳定选择器 E2E", () => {
  test("仅向后端 PUT {theme}、300ms防抖末值合并，且失败时不回滚UI", async ({ page }) => {
    const putRequests: Array<{ url: string; body: any }> = [];

    await page.route("**/api/user/settings", async (route, request) => {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        putRequests.push({ url: request.url(), body });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            is_custom_mode: false,
            is_custom_verified: false,
            subscription_tier: "free",
            theme: body.theme,
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

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const coolBtn = dialog.getByRole("radio", { name: /冷色/ });
    const darkBtn = dialog.getByRole("radio", { name: /黑色/ });

    // 快速连续点击冷色 -> 黑色（模拟 300ms 防抖窗口内的快速操作）
    await coolBtn.click();
    await darkBtn.click();

    // 等待防抖计时器到期并发送 PUT 请求
    await page.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );

    // 验证：300ms 防抖合并为单次 PUT，且只发送最后一次选中的末值 "dark"
    expect(putRequests.length).toBe(1);
    expect(putRequests[0].body).toEqual({ theme: "dark" });

    // 验证本地即时生效
    const themeAttr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );
    expect(themeAttr).toBe("dark");

    const storedTheme = await page.evaluate(() => localStorage.getItem("echotalk-theme"));
    expect(storedTheme).toBe("dark");
  });

  test("共享本地模拟服务端状态下独立浏览器 Context 水合（非真实双设备）与失败恢复", async ({
    browser,
  }) => {
    let sharedServerTheme = "warm";

    const setupMockRoute = async (pageContext: any) => {
      await pageContext.route("**/api/user/settings", async (route: any, request: any) => {
        if (request.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              is_custom_mode: false,
              is_custom_verified: false,
              subscription_tier: "free",
              theme: sharedServerTheme,
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
        if (request.method() === "PUT") {
          const body = request.postDataJSON();
          if (body.failNow) {
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ detail: "Internal Server Error" }),
            });
            return;
          }
          if (body.theme) {
            sharedServerTheme = body.theme;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              is_custom_mode: false,
              is_custom_verified: false,
              subscription_tier: "free",
              theme: sharedServerTheme,
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
    };

    // 客户端 1：进入并设置深色
    const context1 = await browser.newContext({ ignoreHTTPSErrors: true });
    const page1 = await context1.newPage();
    await setupMockRoute(page1);

    await page1.goto("/");
    await expect(page1.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    await page1.getByRole("button", { name: "自定义模型设置" }).click();
    const dialog1 = page1.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog1).toBeVisible();

    // 切换到 dark 并等待 PUT 完成
    const darkBtn = dialog1.getByRole("radio", { name: /黑色/ });
    const putPromise = page1.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );
    await darkBtn.click();
    await putPromise;

    expect(sharedServerTheme).toBe("dark");

    // 客户端 2：独立 BrowserContext 打开（共享本地模拟服务端状态，非真实双设备）
    const context2 = await browser.newContext({ ignoreHTTPSErrors: true });
    const page2 = await context2.newPage();
    await setupMockRoute(page2);

    await page2.goto("/");
    await expect(page2.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 验证新客户端启动后通过 GET /api/user/settings 成功水合为 dark
    await expect(page2.locator("html")).toHaveAttribute("data-theme", "dark");
    const storedThemeInContext2 = await page2.evaluate(() =>
      localStorage.getItem("echotalk-theme"),
    );
    expect(storedThemeInContext2).toBe("dark");

    // 测试后端写失败保持与再次选择恢复
    await page2.getByRole("button", { name: "自定义模型设置" }).click();
    const dialog2 = page2.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog2).toBeVisible();

    // 模拟服务端失败
    await page2.route("**/api/user/settings", async (route, request) => {
      if (request.method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Simulated Backend Failure" }),
        });
        return;
      }
      await route.continue();
    });

    const coolBtn = dialog2.getByRole("radio", { name: /冷色/ });
    const failedPutPromise = page2.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );
    await coolBtn.click();
    await failedPutPromise;

    // 失败时保持本地已选 cool，UI 不回滚，无崩溃
    await expect(page2.locator("html")).toHaveAttribute("data-theme", "cool");

    // 恢复服务端正常
    await setupMockRoute(page2);
    const warmBtn = dialog2.getByRole("radio", { name: /暖色/ });
    const successPutPromise = page2.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );
    await warmBtn.click();
    await successPutPromise;

    // 再次显式选择正常推进并成功持久化
    await expect(page2.locator("html")).toHaveAttribute("data-theme", "warm");
    expect(sharedServerTheme).toBe("warm");

    await context1.close();
    await context2.close();
  });

  test("主题按钮无论选中均固定2px边框，在窄屏、默认与200%字号下选择前后无抖动", async ({
    page,
  }) => {
    // 拦截 PUT 请求，防止 Fake API 404 干扰
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
            theme: body.theme || "warm",
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

    const viewports = [
      { name: "桌面默认字号", width: 1280, height: 800, scale: 1 },
      { name: "窄屏移动端 (390px)", width: 390, height: 844, scale: 1 },
      { name: "200% 大字号布局", width: 1280, height: 800, scale: 2 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

      if (vp.scale !== 1) {
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, vp.scale);
      }

      const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
      await settingsBtn.click();

      const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
      await expect(dialog).toBeVisible();

      // 等待设置加载完成，确保内容几何完全稳定
      await expect(dialog.getByRole("switch")).toBeVisible();

      const radios = dialog.getByRole("radio");
      const radioCount = await radios.count();
      expect(radioCount).toBe(3);

      // 下方参考元素：紧随主题区域下方的分割线 hr，用于精确检测垂直布局抖动
      const belowHr = dialog.locator("hr").first();
      await expect(belowHr).toBeVisible();

      // 验证未切换时三个按钮的 borderWidth 均为 2px
      for (let i = 0; i < radioCount; i++) {
        const btn = radios.nth(i);
        const borderWidth = await btn.evaluate((el) => window.getComputedStyle(el).borderWidth);
        expect(borderWidth).toBe("2px");
      }

      const getBelowTop = async () => belowHr.evaluate((el) => (el as HTMLElement).offsetTop);

      const initialBelowTop = await getBelowTop();

      // 依次点击切换主题：暖色 -> 冷色 -> 黑色 -> 暖色
      for (let i = 0; i < radioCount; i++) {
        const btn = radios.nth(i);
        await btn.click();

        // 验证选中后按钮 borderWidth 仍然严格为 2px
        const currentBorderWidth = await btn.evaluate(
          (el) => window.getComputedStyle(el).borderWidth,
        );
        expect(currentBorderWidth).toBe("2px");

        // 验证未选中按钮的 borderWidth 也全部依然为 2px
        for (let j = 0; j < radioCount; j++) {
          const otherBtn = radios.nth(j);
          const otherBorderWidth = await otherBtn.evaluate(
            (el) => window.getComputedStyle(el).borderWidth,
          );
          expect(otherBorderWidth).toBe("2px");
        }

        // 核心几何断言：下方内容的 offsetTop 坐标绝对不产生 1px 抖动位移（位移差严格为 0）
        const currentBelowTop = await getBelowTop();
        expect(Math.abs(currentBelowTop - initialBelowTop)).toBe(0);
      }

      // 关闭当前抽屉
      await dialog.getByRole("button", { name: "关闭设置抽屉" }).click();
      await expect(dialog).not.toBeVisible();

      // 恢复根字号
      if (vp.scale !== 1) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
      }
    }
  });
});
