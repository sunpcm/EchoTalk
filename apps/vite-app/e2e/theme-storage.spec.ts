import { expect, test } from "@playwright/test";

test.describe("CP-05 / A31 主题 Storage 容错与持久化恢复 E2E", () => {
  test("冷启动属性getter抛出SecurityError时安全回退默认warm主题且页面无报错（0 pageerror）", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // 真实 HTTP 观测：在导航前用 page 级 request 事件计数指向 /api/user/settings 的 PUT，
    // 覆盖初始/远端水合与 300ms 防抖窗口，避免导航后包装 window.fetch 漏掉导航期间调用。
    let settingsPutCount = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/api/user/settings")) {
        settingsPutCount += 1;
      }
    });

    // 远端 GET 就绪屏障：先证明远端 GET 未返回前的本地安全回退，再放行确定的 cool 主题完成水合
    let getReleased = false;
    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = () => {
        if (!getReleased) {
          getReleased = true;
          resolve();
        }
      };
    });

    await page.route("**/api/user/settings", async (route, request) => {
      if (request.method() === "GET") {
        await getGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            is_custom_mode: false,
            is_custom_verified: false,
            subscription_tier: "free",
            theme: "cool",
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

    // 仅拦截 localStorage getter，保持 sessionStorage 不受影响
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });

    // 浏览器内旁路计数器（真实 HTTP 事件观察的补充）：导航前安装、完整委托原 fetch，在真实 fetch 调用点
    // 同步计数指向 /api/user/settings 的 PUT。用于收束 Node request 事件经网络拦截异步送达、晚于同步零写
    // 断言的竞态；不取代 page.on("request") 的真实网络观察，也不漏初始阶段。
    await page.addInitScript(() => {
      (window as any).__themePutCount = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        let url = "";
        let method = "GET";
        if (typeof input === "string") {
          url = input;
        } else if (input && typeof input === "object") {
          url = input.url ?? input.href ?? String(input);
          method = input.method ?? "GET";
        }
        if (init && typeof init.method === "string") {
          method = init.method;
        }
        if (String(method).toUpperCase() === "PUT" && url.includes("/api/user/settings")) {
          (window as any).__themePutCount = ((window as any).__themePutCount ?? 0) + 1;
        }
        return originalFetch(input, init);
      };
    });

    // 在导航前安装并冻结 Playwright 假时钟：本地 warm 回退（同步读 localStorage）与远端 cool 水合
    // （网络 promise）都不依赖定时器；把 60s 跳进放在导航前、尚无在途 GET，可避免触发其默认 10s 真实
    // 请求超时。冻结后页面仍正常加载，300ms 防抖窗口由后续 runFor 确定性跨过。
    await page.clock.install({ time: new Date("2026-11-14T08:00:00Z") });
    await page.clock.pauseAt(new Date("2026-11-14T08:01:00Z"));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 阶段一：远端 GET 未返回前，本地读取失败安全回退为 warm 主题且无报错。
    // finally 保证即使 warm 断言失败，GET 门禁也会释放，不遗留挂起 route；原断言失败原样抛出。
    try {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "warm");
      expect(pageErrors).toEqual([]);
    } finally {
      releaseGet();
    }

    // 阶段二：真实 store/DOM 正常水合为 cool，仍无 pageerror
    await expect(page.locator("html")).toHaveAttribute("data-theme", "cool");
    expect(pageErrors).toEqual([]);

    // 两个阶段已真实完成（GET 已释放并水合），假时钟仍冻结，只推进目标 300ms 防抖窗口；
    // 零写由导航前建立的 request 事件真实计数。
    await page.clock.runFor(299);
    expect(settingsPutCount).toBe(0);

    await page.clock.runFor(1);
    expect(settingsPutCount).toBe(0);

    // 确定性浏览器往返：读取导航前安装的浏览器内旁路计数器，收束异步 fetch 微任务后断言真实零写。
    const themePutCount = await page.evaluate(() => (window as any).__themePutCount ?? 0);
    expect(themePutCount).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test("切换主题写Storage故障（QuotaExceededError）时UI即时生效且精确发送PUT，Storage恢复后再次操作可持久化", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

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

    // 拦截 Storage.prototype.setItem，仅针对 window.localStorage 的主题键，模拟配额溢出，绝不破坏 sessionStorage
    await page.addInitScript(() => {
      (window as any).__themeQuotaError = true;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (
          this === window.localStorage &&
          (window as any).__themeQuotaError &&
          key === "echotalk-theme"
        ) {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();
    const dialog = page.getByRole("dialog", { name: "设置" });
    await expect(dialog).toBeVisible();

    // 1. 在写故障下切换到 dark
    const darkBtn = dialog.getByRole("radio", { name: /黑色/ });
    const putPromise1 = page.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );
    await darkBtn.click();

    // UI 即时生效
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await putPromise1;

    // 确认 PUT 正常发送且仅有精确的 dark
    expect(putRequests.length).toBe(1);
    expect(putRequests[0].body).toEqual({ theme: "dark" });

    // 验证 storage 中因配额超限未被持久化
    const storedAfterError = await page.evaluate(() => localStorage.getItem("echotalk-theme"));
    expect(storedAfterError).toBeNull();

    // 2. 模拟 Storage 恢复正常
    await page.evaluate(() => {
      (window as any).__themeQuotaError = false;
    });

    // 再次明确操作：切换到 cool
    const coolBtn = dialog.getByRole("radio", { name: /冷色/ });
    const putPromise2 = page.waitForResponse(
      (res) => res.url().includes("/api/user/settings") && res.request().method() === "PUT",
    );
    await coolBtn.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "cool");
    await putPromise2;

    expect(putRequests.length).toBe(2);
    expect(putRequests[1].body).toEqual({ theme: "cool" });

    // 确认恢复后成功持久化到 localStorage
    const storedAfterRecover = await page.evaluate(() => localStorage.getItem("echotalk-theme"));
    expect(storedAfterRecover).toBe("cool");

    expect(pageErrors).toEqual([]);
  });

  test("后端水合成功但写入Storage失败时，页面正常水合主题且不产生UI报错或误发PUT", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    let putCalled = false;

    await page.route("**/api/user/settings", async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            is_custom_mode: false,
            is_custom_verified: false,
            subscription_tier: "free",
            theme: "cool",
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
        putCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ theme: "cool" }),
        });
        return;
      }
      await route.continue();
    });

    // 拦截 Storage.prototype.setItem，仅针对 window.localStorage 的主题写入抛错，保护 sessionStorage
    await page.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === window.localStorage && key === "echotalk-theme") {
          throw new DOMException("The operation is insecure.", "SecurityError");
        }
        return originalSetItem.call(this, key, value);
      };
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 确认水合为后端指定的 cool 主题
    await expect(page.locator("html")).toHaveAttribute("data-theme", "cool");

    // 打开设置抽屉验证没有错误提示且冷色单选框为选中状态
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();
    const dialog = page.getByRole("dialog", { name: "设置" });
    await expect(dialog).toBeVisible();

    const coolBtn = dialog.getByRole("radio", { name: /冷色/ });
    await expect(coolBtn).toBeChecked();

    // 确认绝无自动多余的 PUT 请求
    expect(putCalled).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
