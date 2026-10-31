import { expect, test } from "@playwright/test";

test.describe("CP-05 / A31 主题 Storage 容错与持久化恢复 E2E", () => {
  test("冷启动属性getter抛出SecurityError时安全回退默认warm主题且页面无报错（0 pageerror）", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // 仅拦截 localStorage getter，保持 sessionStorage 不受影响
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

    // 验证页面安全回退为 warm 主题
    await expect(page.locator("html")).toHaveAttribute("data-theme", "warm");
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
    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
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
    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const coolBtn = dialog.getByRole("radio", { name: /冷色/ });
    await expect(coolBtn).toBeChecked();

    // 确认绝无自动多余的 PUT 请求
    expect(putCalled).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
