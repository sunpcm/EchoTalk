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

    // 在导航前安装 Playwright 假时钟：页面加载/抽屉滑入动画期间假时钟仍按真实时间推进，
    // 保证水合与动画自然完成；随后用 pauseAt 冻结，再精确推进 300ms 防抖窗口。
    await page.clock.install({ time: new Date("2026-11-14T08:00:00Z") });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 只读旁路观测：在页面内包装 window.fetch，记录指向 /api/user/settings 的 PUT 调用
    // 次数后委托原 fetch，不改真实 HTTP 行为；记录同步发生在页面内，规避 Node 侧 route
    // 数组读取竞态，使“前299不发 / 300发”边界断言确定性成立。
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      (window as any).__themePutCalls = 0;
      (window as any).fetch = (input: any, init?: any) => {
        const url = typeof input === "string" ? input : (input?.url ?? "");
        const method = ((init?.method as string) || "GET").toUpperCase();
        if (url.includes("/api/user/settings") && method === "PUT") {
          (window as any).__themePutCalls += 1;
        }
        return originalFetch(input, init);
      };
    });

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const coolBtn = dialog.getByRole("radio", { name: /冷色/ });
    const darkBtn = dialog.getByRole("radio", { name: /黑色/ });

    // 冻结时间，使两次主题选择确定性落在 300ms 防抖窗口内（不再依赖两次 awaited click
    // 的真实耗时，避免并行负载下动作性检查/稳定态轮询把间隔自然拉长超过 300ms 而双 PUT）。
    await page.clock.pauseAt(new Date("2026-11-14T08:01:00Z"));

    // 冻结后 requestAnimationFrame 停摆，动作性稳定态检查不可用，故用 force 跳过动作性
    // 但仍派发真实 UI 点击；先滚入视口规避固定抽屉内元素在 force 点击时的视口误差。
    await coolBtn.scrollIntoViewIfNeeded();
    await coolBtn.click({ force: true });
    await darkBtn.scrollIntoViewIfNeeded();
    await darkBtn.click({ force: true });

    // 先注册响应监听（先于推进时钟），防漏收已经完成的响应。
    const putResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );

    // 前299不发：推进到 299ms，300ms 防抖计时器尚未到期，页面内不得有任何 PUT 调用。
    await page.clock.runFor(299);
    const putCallsAt299 = await page.evaluate(() => (window as any).__themePutCalls);
    expect(putCallsAt299).toBe(0);

    // 300发：推进越过 300ms 边界，防抖到期，应发出唯一一次 dark PUT。
    await page.clock.runFor(1);

    // 异步 HTTP 真正跨过观测栅栏，而非读 Node 数组竞态；若防抖被改大到 301ms，
    // 计时器未到期，这里以显式计数断言失败（而非 waitForResponse 全局超时挂起）。
    await expect.poll(() => putRequests.length, { timeout: 2_000 }).toBe(1);

    await putResponsePromise;

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
