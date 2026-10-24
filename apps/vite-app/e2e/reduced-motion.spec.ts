import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});

test.describe("prefers-reduced-motion Accessibility & Behavior", () => {
  test("preserves 0.25s body transition, slideInRight drawer animation, and interactive features under no-preference", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // 1. 验证 body 的 0.25s 颜色过渡
    const bodyTransition = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return {
        duration: style.transitionDuration,
        property: style.transitionProperty,
      };
    });
    expect(bodyTransition.duration).toContain("0.25s");

    // 2. 打开设置抽屉并验证 slideInRight 动画
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const drawerAnimation = await dialog.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        name: style.animationName,
        duration: style.animationDuration,
      };
    });
    expect(drawerAnimation.name).toBe("slideInRight");
    expect(drawerAnimation.duration).toContain("0.25s");

    // 3. 验证主题切换与交互正常
    const coolBtn = dialog.getByRole("radio", { name: "冷色外观主题" });
    await coolBtn.click();
    await expect(coolBtn).toHaveAttribute("aria-checked", "true");

    // 4. 关闭、Escape 与焦点恢复
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(settingsBtn).toBeFocused();

    // 再次打开验证仍可用
    await settingsBtn.click();
    await expect(dialog).toBeVisible();
    const closeBtn = dialog.getByRole("button", { name: "关闭设置抽屉" });
    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test("suppresses decorative transitions and drawer slideInRight under reduce without altering layout or final state", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    // 1. 验证 body transition 为 0s 或 none，无持续过渡插值
    const bodyTransition = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return {
        duration: style.transitionDuration,
        property: style.transitionProperty,
      };
    });
    expect(
      bodyTransition.property === "none" ||
        bodyTransition.duration === "0s" ||
        bodyTransition.duration === "0s, 0s",
    ).toBe(true);

    // 2. 验证实际带 transition 的 UI 元素持续时间降为 0s
    const btnDuration = await page
      .locator("button")
      .first()
      .evaluate((el) => window.getComputedStyle(el).transitionDuration);
    expect(
      btnDuration
        .split(",")
        .map((s) => s.trim())
        .every((s) => s === "0s"),
    ).toBe(true);

    // 3. 打开设置抽屉，验证无位移入场动画 (animationName 为 none)
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const drawerAnimationName = await dialog.evaluate(
      (el) => window.getComputedStyle(el).animationName,
    );
    expect(drawerAnimationName).toBe("none");

    // 4. 验证元素未被隐藏，最终尺寸与位置正常
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(280);
    expect(box!.height).toBeGreaterThan(0);

    // 5. 验证主题切换与功能正常执行
    const darkBtn = dialog.getByRole("radio", { name: "黑色外观主题" });
    await darkBtn.click();
    await expect(darkBtn).toHaveAttribute("aria-checked", "true");

    // 6. 验证 Escape 关闭与焦点恢复，再次打开依然可用
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(settingsBtn).toBeFocused();

    await settingsBtn.click();
    await expect(dialog).toBeVisible();
    const closeBtn = dialog.getByRole("button", { name: "关闭设置抽屉" });
    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test("dynamically switches preferences before opening and while drawer remains open", async ({
    page,
  }) => {
    // 初始处于 reduce
    await page.emulateMedia({ reducedMotion: "reduce" });

    // 验证打开前处于 reduce
    let bodyDuration = await page.evaluate(
      () => window.getComputedStyle(document.body).transitionDuration,
    );
    expect(
      bodyDuration
        .split(",")
        .map((s) => s.trim())
        .every((s) => s === "0s"),
    ).toBe(true);

    // 打开前切换为 no-preference
    await page.emulateMedia({ reducedMotion: "no-preference" });
    bodyDuration = await page.evaluate(
      () => window.getComputedStyle(document.body).transitionDuration,
    );
    expect(bodyDuration).toContain("0.25s");

    // 打开抽屉
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();
    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 在 no-preference 下验证 drawer animationName 为 slideInRight
    let animName = await dialog.evaluate((el) => window.getComputedStyle(el).animationName);
    expect(animName).toBe("slideInRight");

    // 保持抽屉打开状态，实时切换为 reduce
    await page.emulateMedia({ reducedMotion: "reduce" });

    // 抽屉保持可见，computed animationName 实时切为 none，body 持续时间切为 0s
    await expect
      .poll(async () => {
        return dialog.evaluate((el) => window.getComputedStyle(el).animationName);
      })
      .toBe("none");

    bodyDuration = await page.evaluate(
      () => window.getComputedStyle(document.body).transitionDuration,
    );
    expect(
      bodyDuration
        .split(",")
        .map((s) => s.trim())
        .every((s) => s === "0s"),
    ).toBe(true);

    // 再次保持打开状态，实时切回 no-preference
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await expect
      .poll(async () => {
        return dialog.evaluate((el) => window.getComputedStyle(el).animationName);
      })
      .toBe("slideInRight");

    bodyDuration = await page.evaluate(
      () => window.getComputedStyle(document.body).transitionDuration,
    );
    expect(bodyDuration).toContain("0.25s");
  });

  test("preserves functional loading spinner animation without suppression under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    let resolveFetch: (() => void) | null = null;
    const fetchHold = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });

    // 拦截 GET /user/settings，保持 loading 态以检验 spinner 真实动画
    await page.route("**/user/settings", async (route) => {
      if (route.request().method() === "GET") {
        await fetchHold;
      }
      await route.continue();
    });

    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();

    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 检查 loading spinner 元素
    const spinner = dialog.locator(".animate-spin");
    await expect(spinner).toBeVisible();

    const spinnerStyle = await spinner.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        animationName: style.animationName,
        animationPlayState: style.animationPlayState,
      };
    });
    // 验证 spinner 动画未被 animation: none 误杀，依然保持 spin 和 running 状态
    expect(spinnerStyle.animationName).toContain("spin");
    expect(spinnerStyle.animationPlayState).toBe("running");

    // 释放拦截并确认最终内容正确加载
    resolveFetch?.();
    const switchBtn = dialog.getByRole("switch");
    await expect(switchBtn).toBeVisible();
  });

  test("zero implicit write requests on preference toggle, drawer open, and close", async ({
    page,
  }) => {
    let settingsPutCount = 0;
    page.on("request", (req) => {
      if (req.url().includes("/user/settings") && req.method() === "PUT") {
        const postData = req.postDataJSON() || {};
        if ("is_custom_mode" in postData || "stt_key" in postData || "llm_key" in postData) {
          settingsPutCount++;
        }
      }
    });

    // 1. 偏好切换
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.emulateMedia({ reducedMotion: "reduce" });

    // 2. 打开抽屉
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();
    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    // 3. 在打开状态再次切换偏好并切换外观主题
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const coolBtn = dialog.getByRole("radio", { name: "冷色外观主题" });
    await coolBtn.click();

    // 4. Escape 取消关闭
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // 验证整个生命周期无隐式业务写操作
    expect(settingsPutCount).toBe(0);
  });
});
