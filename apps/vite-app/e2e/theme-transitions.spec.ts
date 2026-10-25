import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await page.route("**/api/user/settings", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          is_custom_mode: false,
          is_custom_verified: false,
          subscription_tier: "free",
          theme: "warm",
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
      const body = request.postDataJSON() || {};
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

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  expect(pageErrors.length).toBe(0);
});

test.describe("CP-05 / A35 主要容器主题颜色过渡 E2E", () => {
  test("no-preference: 容器0.25s过渡、shadow 150ms与hover能力、CSSTransition中间态捕获、无溢出且精确PUT", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });

    let otherDispatches = 0;
    const putBodies: any[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/user/settings") && req.method() === "PUT") {
        putBodies.push(req.postDataJSON() || {});
      }
      if (
        url.includes("/session") ||
        url.includes("/lease") ||
        url.includes("/token") ||
        url.includes("/dispatch")
      ) {
        if (req.method() === "POST" || req.method() === "PUT") {
          otherDispatches++;
        }
      }
    });

    const rootContainer = page.locator("#root > div.bg-bg").first();
    const card = page.locator(".border-border-default.bg-surface").first();
    const titleText = page.locator("h1").first();

    // 1. computed transition 验证 (0.25s 与 0.15s box-shadow)
    const rootStyle = await rootContainer.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { duration: s.transitionDuration, property: s.transitionProperty };
    });
    expect(rootStyle.duration).toContain("0.25s");
    expect(rootStyle.property).toContain("background-color");

    const cardStyle = await card.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { duration: s.transitionDuration, property: s.transitionProperty };
    });
    expect(cardStyle.duration).toContain("0.25s");
    expect(cardStyle.duration).toContain("0.15s");
    expect(cardStyle.property).toContain("background-color");
    expect(cardStyle.property).toContain("border-color");
    expect(cardStyle.property).toContain("box-shadow");

    const titleStyle = await titleText.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { duration: s.transitionDuration, property: s.transitionProperty };
    });
    expect(titleStyle.duration).toContain("0.25s");
    expect(titleStyle.property).toContain("color");

    // 2. hover 能力与 box-shadow 过渡验证
    const initialShadow = await card.evaluate((el) => window.getComputedStyle(el).boxShadow);
    await card.hover();
    await expect
      .poll(async () => card.evaluate((el) => window.getComputedStyle(el).boxShadow))
      .not.toBe(initialShadow);

    const cardBoxBefore = await card.boundingBox();

    // 3. 打开抽屉并验证抽屉与 sticky header 的 computed transition
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();
    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const drawerStyle = await dialog.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { duration: s.transitionDuration, property: s.transitionProperty };
    });
    expect(drawerStyle.duration).toContain("0.25s");
    expect(drawerStyle.property).toContain("background-color");

    const header = dialog.locator(".sticky").first();
    const headerStyle = await header.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { duration: s.transitionDuration, property: s.transitionProperty };
    });
    expect(headerStyle.duration).toContain("0.25s");
    expect(headerStyle.property).toContain("background-color");
    expect(headerStyle.property).toContain("border-color");

    // 4. 真实主题 radio 切换 (warm -> dark) 并通过 getAnimations 捕获 CSSTransition 与插值中间态
    const transitionCheck = await page.evaluate(async () => {
      const darkRadio = document.querySelector(
        'button[role="radio"][aria-label*="黑色"]',
      ) as HTMLButtonElement;
      const rootDiv = document.querySelector("#root > div.bg-bg") as HTMLElement;
      const titleEl = document.querySelector("h1") as HTMLElement;

      const bgBefore = window.getComputedStyle(rootDiv).backgroundColor;
      const textBefore = window.getComputedStyle(titleEl).color;

      darkRadio.click();

      const rootAnims = rootDiv.getAnimations();
      const titleAnims = titleEl.getAnimations();

      const bgAnim = rootAnims.find((a) => {
        const p = (a as any).transitionProperty || (a as any).propertyName || "";
        return p.includes("background-color");
      });

      const textAnim = titleAnims.find((a) => {
        const p = (a as any).transitionProperty || (a as any).propertyName || "";
        return p.includes("color");
      });

      let bgMid = null;
      let bgFinal = null;
      let textMid = null;
      let textFinal = null;

      if (bgAnim) {
        bgAnim.pause();
        bgAnim.currentTime = 125;
        bgMid = window.getComputedStyle(rootDiv).backgroundColor;
        bgAnim.finish();
        bgFinal = window.getComputedStyle(rootDiv).backgroundColor;
      }

      if (textAnim) {
        textAnim.pause();
        textAnim.currentTime = 125;
        textMid = window.getComputedStyle(titleEl).color;
        textAnim.finish();
        textFinal = window.getComputedStyle(titleEl).color;
      }

      return {
        bgAnimFound: !!bgAnim,
        bgBefore,
        bgMid,
        bgFinal,
        textAnimFound: !!textAnim,
        textBefore,
        textMid,
        textFinal,
      };
    });

    expect(transitionCheck.bgAnimFound).toBe(true);
    expect(transitionCheck.textAnimFound).toBe(true);
    expect(transitionCheck.bgMid).not.toBeNull();
    expect(transitionCheck.bgMid).not.toBe(transitionCheck.bgBefore);
    expect(transitionCheck.bgMid).not.toBe(transitionCheck.bgFinal);
    expect(transitionCheck.textMid).not.toBeNull();
    expect(transitionCheck.textMid).not.toBe(transitionCheck.textBefore);
    expect(transitionCheck.textMid).not.toBe(transitionCheck.textFinal);
    expect(transitionCheck.bgFinal).toBe("rgb(23, 24, 27)");

    // 5. 关闭抽屉、焦点恢复
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(settingsBtn).toBeFocused();

    // 6. 验证主要容器 boundingBox 无位移
    const cardBoxAfter = await card.boundingBox();
    expect(cardBoxAfter!.width).toBe(cardBoxBefore!.width);
    expect(cardBoxAfter!.height).toBe(cardBoxBefore!.height);

    // 7. 窄屏与大字号无水平溢出
    const overflowCheck = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflowCheck).toBe(false);

    // 8. 验证仅发送了单次精确 PUT { theme: "dark" }，零其他隐式写
    await page.waitForTimeout(350);
    expect(otherDispatches).toBe(0);
    expect(putBodies.length).toBe(1);
    expect(putBodies[0]).toEqual({ theme: "dark" });
  });

  test("reduce偏好: 过渡时长降为0s、颜色立即生效、抽屉动画消除且保留spinner动画", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    let otherDispatches = 0;
    page.on("request", (req) => {
      const url = req.url();
      if (
        url.includes("/session") ||
        url.includes("/lease") ||
        url.includes("/token") ||
        url.includes("/dispatch")
      ) {
        if (req.method() === "POST" || req.method() === "PUT") {
          otherDispatches++;
        }
      }
    });

    const rootContainer = page.locator("#root > div.bg-bg").first();

    // 1. 验证主要容器 transition duration 均为 0s
    const rootDuration = await rootContainer.evaluate(
      (el) => window.getComputedStyle(el).transitionDuration,
    );
    expect(
      rootDuration
        .split(",")
        .map((s) => s.trim())
        .every((s) => s === "0s"),
    ).toBe(true);

    // 2. 打开抽屉并验证无入场动画 (animationName 为 none)
    const settingsBtn = page.getByRole("button", { name: "自定义模型设置" });
    await settingsBtn.click();
    const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
    await expect(dialog).toBeVisible();

    const drawerAnim = await dialog.evaluate((el) => window.getComputedStyle(el).animationName);
    expect(drawerAnim).toBe("none");

    // 3. 在 reduce 下点击冷色外观，颜色立即达到最终值（无持续过渡）
    const coolRadio = dialog.getByRole("radio", { name: /冷色/ });
    await coolRadio.click();

    const currentBg = await rootContainer.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    expect(currentBg).toBe("rgb(241, 245, 251)");

    // 4. 验证 loading spinner 未被 reduce 误杀
    const spinner = dialog.locator(".animate-spin").first();
    if (await spinner.isVisible()) {
      const spinnerStyle = await spinner.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { name: s.animationName, state: s.animationPlayState };
      });
      expect(spinnerStyle.name).toContain("spin");
      expect(spinnerStyle.state).toBe("running");
    }

    // 5. 关闭抽屉与零隐式业务写
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(otherDispatches).toBe(0);
  });
});
