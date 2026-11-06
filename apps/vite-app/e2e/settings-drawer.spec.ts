import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});

test.describe("SettingsDrawer Cross-Platform Accessibility & Viewport", () => {
  test("opens named modal dialog, sets initial focus safely, and verifies 44x44 touch targets", async ({
    page,
  }) => {
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 初始焦点移到安全控件（关闭按钮），绝不自动聚焦 API Key 等输入框
    const closeBtn = dialog.getByRole("button", { name: "关闭设置抽屉" });
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toBeFocused();

    // 验证 API Key 输入框绝无自动聚焦
    const apiKeyInputs = dialog.locator('input[type="password"]');
    const inputCount = await apiKeyInputs.count();
    for (let i = 0; i < inputCount; i++) {
      await expect(apiKeyInputs.nth(i)).not.toBeFocused();
    }

    // 验证 44x44 CSS 像素最小触控区域
    // 1. 关闭按钮
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);

    // 2. 模式开关
    const switchBtn = dialog.getByRole("switch");
    const switchBox = await switchBtn.boundingBox();
    expect(switchBox).not.toBeNull();
    expect(switchBox!.width).toBeGreaterThanOrEqual(44);
    expect(switchBox!.height).toBeGreaterThanOrEqual(44);

    // 3. 外观主题单选按钮
    const themeRadios = dialog.getByRole("radio");
    const radioCount = await themeRadios.count();
    expect(radioCount).toBe(3);
    for (let i = 0; i < radioCount; i++) {
      const box = await themeRadios.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    // 4. 保存设置按钮
    const saveBtn = dialog.getByRole("button", { name: "保存设置" });
    const saveBox = await saveBtn.boundingBox();
    expect(saveBox).not.toBeNull();
    expect(saveBox!.width).toBeGreaterThanOrEqual(44);
    expect(saveBox!.height).toBeGreaterThanOrEqual(44);
  });

  test("traps focus bidirectionally and reaches Save with custom mode OFF", async ({ page }) => {
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const closeBtn = dialog.getByRole("button", { name: "关闭设置抽屉" });
    const saveBtn = dialog.getByRole("button", { name: "保存设置" });
    await expect(closeBtn).toBeFocused();

    // 自定义模式关闭时，fieldset 被禁用。
    // 有效可聚焦控件序列：Close -> 暖色 -> 冷色 -> 黑色 -> 自定义开关 -> 保存设置 -> Close
    const visitedLabels: string[] = [];

    // 正向 Tab 遍历（5 次从 Close 走到 Save，第 6 次循环回 Close）
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const activeText = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.getAttribute("aria-label") || el?.textContent || "";
      });
      visitedLabels.push(activeText);
    }

    // 显式断言第 5 步精确聚焦于“保存设置”按钮，绝不能跳过
    await expect(saveBtn).toBeFocused();

    // 再次按 Tab 回到关闭按钮
    await page.keyboard.press("Tab");
    await expect(closeBtn).toBeFocused();

    // 反向 Shift+Tab：从关闭按钮反向，第一步必须直接聚焦到“保存设置”
    await page.keyboard.press("Shift+Tab");
    await expect(saveBtn).toBeFocused();

    // 再次反向遍历循环回到关闭按钮
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
    }
    await expect(closeBtn).toBeFocused();

    // 按 Escape 键关闭抽屉并恢复原触发控件焦点
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(settingsBtn).toBeFocused();
  });

  test("traps focus bidirectionally and reaches Save with custom mode ON", async ({ page }) => {
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const closeBtn = dialog.getByRole("button", { name: "关闭设置抽屉" });
    const switchBtn = dialog.getByRole("switch");
    const saveBtn = dialog.getByRole("button", { name: "保存设置" });

    // 开启自定义模式，使 fieldset 内所有输入控件启用
    await switchBtn.click();
    await closeBtn.focus();
    await expect(closeBtn).toBeFocused();

    let saveReached = false;
    // 在 custom=true 时，控件数量较多，完整按 Tab 遍历一个周期直至回到 Close
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      const isSave = await saveBtn.evaluate((el) => document.activeElement === el);
      if (isSave) {
        saveReached = true;
        break;
      }
    }
    // 显式断言遍历过程中必须能够到达 Save 按钮
    expect(saveReached).toBe(true);

    // 从 Save 按 Tab 循环回到 Close
    await page.keyboard.press("Tab");
    await expect(closeBtn).toBeFocused();

    // 反向 Shift+Tab，第一步必须直接聚焦到 Save 按钮
    await page.keyboard.press("Shift+Tab");
    await expect(saveBtn).toBeFocused();
  });

  test("closes when clicking backdrop, but does not close when clicking inside dialog", async ({
    page,
  }) => {
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 点击抽屉内部标题或内容区域，对话框保持开启
    const heading = dialog.getByRole("heading", { name: "自定义模型设置" });
    await heading.click();
    await expect(dialog).toBeVisible();

    // 启动自定义模式，在内部输入框点击和输入，对话框绝不误关
    const switchBtn = dialog.getByRole("switch");
    await switchBtn.click();
    const sttKeyInput = dialog.locator("#stt-key-input");
    await sttKeyInput.click();
    await sttKeyInput.fill("test-key-typing");
    await expect(dialog).toBeVisible();

    // 点击左侧遮罩区域（backdrop），触发关闭
    await page.mouse.click(20, 20);
    await expect(dialog).not.toBeVisible();
  });

  test("preserves draft inputs and focus across store updates without reset or close", async ({
    page,
  }) => {
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 开启自定义模式并在 API Key 中输入草稿
    const switchBtn = dialog.getByRole("switch");
    await switchBtn.click();
    const llmKeyInput = dialog.locator("#llm-key-input");
    await llmKeyInput.fill("draft-api-key-test");

    // 切换外观主题（触发 store 更新）
    const coolThemeBtn = dialog.getByRole("radio", { name: "冷色外观主题" });
    await coolThemeBtn.click();

    // 验证草稿内容保持不变且 dialog 未被重置或关闭
    await expect(dialog).toBeVisible();
    await expect(llmKeyInput).toHaveValue("draft-api-key-test");
  });

  test("zero implicit write requests on drawer open, toggle switch, resize, or escape cancel", async ({
    page,
  }) => {
    let settingsPutCount = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/settings") && req.method() === "PUT") {
        const postData = req.postDataJSON() || {};
        // 排除外观主题切换的前端同步，仅统计自定义模式业务保存
        if ("is_custom_mode" in postData || "stt_key" in postData || "llm_key" in postData) {
          settingsPutCount++;
        }
      }
    });

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 开关自定义模式
    const switchBtn = dialog.getByRole("switch");
    await switchBtn.click();
    await switchBtn.click();

    // 调整视口大小模拟 resize
    await page.setViewportSize({ width: 500, height: 600 });
    await page.waitForTimeout(100);

    // Escape 取消关闭
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // 验证整个交互过程没有触发业务写操作
    expect(settingsPutCount).toBe(0);
  });

  test("renders safely on 320px narrow portrait viewport without horizontal overflow and can scroll to save", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 验证抽屉无横向溢出截断
    const isOverflowing = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(isOverflowing).toBe(false);

    // 滚动到底部，保存按钮完全可见可点击
    const saveBtn = dialog.getByRole("button", { name: "保存设置" });
    await saveBtn.scrollIntoViewIfNeeded();
    await expect(saveBtn).toBeVisible();
  });

  test("renders safely on 667x320 landscape viewport with accessible close and scrollable save", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 667, height: 320 });

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 顶部关闭按钮持续处于可见区域
    const closeBtn = dialog.getByRole("button", { name: "关闭设置抽屉" });
    await expect(closeBtn).toBeVisible();

    // 底部保存按钮可通过滚动到达并点击
    const saveBtn = dialog.getByRole("button", { name: "保存设置" });
    await saveBtn.scrollIntoViewIfNeeded();
    await expect(saveBtn).toBeVisible();

    // 重新滚动回顶部验证关闭按钮仍然立即可用
    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
  });
});
