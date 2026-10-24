import { test, expect } from "@playwright/test";

test.describe("DocTalk 设置页响应式、触控与几何规范", () => {
  const viewports = [
    { width: 320, height: 568, name: "320x568-mobile" },
    { width: 667, height: 320, name: "667x320-landscape" },
    { width: 640, height: 480, name: "640x480-compact" },
    { width: 960, height: 720, name: "960x720-desktop-small" },
  ];

  const fontScales = [
    { scale: "100%", name: "font-100" },
    { scale: "200%", name: "font-200" },
  ];

  function isOverlapping(
    r1: { left: number; right: number; top: number; bottom: number },
    r2: { left: number; right: number; top: number; bottom: number },
  ) {
    const horizontal = !(r1.right <= r2.left || r1.left >= r2.right);
    const vertical = !(r1.bottom <= r2.top || r1.top >= r2.bottom);
    return horizontal && vertical;
  }

  for (const vp of viewports) {
    for (const fs of fontScales) {
      test(`几何无遮挡、触控>=44px且无横向溢出 (${vp.name}, ${fs.name})`, async ({
        page,
      }, testInfo) => {
        // 监控零隐式写：在设置页浏览和配置期间不得发起会话创建或写请求
        const sessionPostRequests: string[] = [];
        page.on("request", (req) => {
          if (req.method() === "POST" || req.method() === "PUT") {
            const url = req.url();
            if (
              url.includes("/api/sessions") ||
              url.includes("/dispatch") ||
              url.includes("/lease")
            ) {
              sessionPostRequests.push(`${req.method()} ${url}`);
            }
          }
        });

        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto("/");

        // 等待进入主页后，点击 DocTalk 卡片进入设置页
        const docTalkEntry = page.getByText("文档对话 (DocTalk)");
        await expect(docTalkEntry).toBeVisible();
        await docTalkEntry.click();

        // 调整根字体缩放（100% 或 200%）
        if (fs.scale !== "100%") {
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = scale;
          }, fs.scale);
        }

        // 确认关键元素已渲染
        const backBtn = page.getByRole("button", { name: "返回主页" });
        await expect(backBtn).toBeVisible();

        const docTitle = page.getByRole("heading", { name: "文档对话", level: 1 });
        await expect(docTitle).toBeVisible();

        const startBtn = page.getByRole("button", { name: "开始对话" });
        await expect(startBtn).toBeVisible();

        const interviewPreset = page.getByRole("button", { name: "模拟面试" });
        const paperPreset = page.getByRole("button", { name: "论文研讨" });
        const freePreset = page.getByRole("button", { name: "自由讨论" });
        await expect(interviewPreset).toBeVisible();
        await expect(paperPreset).toBeVisible();
        await expect(freePreset).toBeVisible();

        const uploadArea = page.getByRole("button", { name: "点击选择 .txt 或 .md 文件" });
        await expect(uploadArea).toBeVisible();

        // 测算真实文字 Range 与返回按钮的几何关系，避免全宽 h1 块框导致的假阳性
        const metrics = await page.evaluate(() => {
          const btn =
            document.querySelector('[data-testid="doc-chat-back-button"]') ||
            document.querySelector('button[aria-label="返回主页"]');
          const h1 =
            document.querySelector('[data-testid="doc-chat-title"]') ||
            document.querySelector("h1");
          const p =
            document.querySelector('[data-testid="doc-chat-subtitle"]') ||
            (h1 ? h1.parentElement?.querySelector("p") : null);

          const getRangeRect = (el: Element | null) => {
            if (!el) return null;
            const range = document.createRange();
            range.selectNodeContents(el);
            const rect = range.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          };

          const bRect = btn?.getBoundingClientRect();
          return {
            backRect: bRect
              ? {
                  left: bRect.left,
                  right: bRect.right,
                  top: bRect.top,
                  bottom: bRect.bottom,
                  width: bRect.width,
                  height: bRect.height,
                }
              : null,
            titleTextRect: getRangeRect(h1),
            subtitleTextRect: getRangeRect(p),
            titleScrollWidth: h1?.scrollWidth ?? 0,
            titleClientWidth: h1?.clientWidth ?? 0,
            subtitleScrollWidth: p?.scrollWidth ?? 0,
            subtitleClientWidth: p?.clientWidth ?? 0,
            docScrollWidth: document.documentElement.scrollWidth,
            docClientWidth: document.documentElement.clientWidth,
          };
        });

        expect(metrics.backRect).not.toBeNull();
        expect(metrics.titleTextRect).not.toBeNull();

        // 1. 返回控件与标题真实文字 Range 不重叠
        const backOverlapsTitle = isOverlapping(metrics.backRect!, metrics.titleTextRect!);
        expect(backOverlapsTitle).toBe(false);

        // 2. 返回控件与副标题真实文字 Range 不重叠
        if (metrics.subtitleTextRect) {
          const backOverlapsSubtitle = isOverlapping(metrics.backRect!, metrics.subtitleTextRect);
          expect(backOverlapsSubtitle).toBe(false);
        }

        // 3. 触控区域 >= 44x44 CSSpx
        expect(metrics.backRect!.width).toBeGreaterThanOrEqual(44);
        expect(metrics.backRect!.height).toBeGreaterThanOrEqual(44);

        const startRect = await startBtn.boundingBox();
        expect(startRect).not.toBeNull();
        expect(startRect!.width).toBeGreaterThanOrEqual(44);
        expect(startRect!.height).toBeGreaterThanOrEqual(44);

        for (const preset of [interviewPreset, paperPreset, freePreset]) {
          const pRect = await preset.boundingBox();
          expect(pRect).not.toBeNull();
          expect(pRect!.width).toBeGreaterThanOrEqual(44);
          expect(pRect!.height).toBeGreaterThanOrEqual(44);
        }

        const uploadRect = await uploadArea.boundingBox();
        expect(uploadRect).not.toBeNull();
        expect(uploadRect!.width).toBeGreaterThanOrEqual(44);
        expect(uploadRect!.height).toBeGreaterThanOrEqual(44);

        // 4. 内容与控件不发生横向 document 溢出，且标题/副标题自身不横向溢出（DOC25-01）
        expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);
        expect(metrics.titleScrollWidth).toBeLessThanOrEqual(metrics.titleClientWidth + 1);
        if (metrics.subtitleClientWidth > 0) {
          expect(metrics.subtitleScrollWidth).toBeLessThanOrEqual(metrics.subtitleClientWidth + 1);
        }

        // 独立截图证据
        await page.screenshot({
          path: testInfo.outputPath(`layout-${vp.name}-${fs.name}.png`),
          fullPage: true,
        });

        // 5. 零隐式写保持：不发生非预期的会话创建或写请求
        expect(sessionPostRequests).toHaveLength(0);
      });
    }
  }

  test("草稿状态保持、键盘 Tab 导航与预设切换无隐式写", async ({ page }, testInfo) => {
    const postRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" || req.method() === "PUT") {
        postRequests.push(`${req.method()} ${req.url()}`);
      }
    });

    await page.setViewportSize({ width: 960, height: 720 });
    await page.goto("/");

    const docTalkEntry = page.getByText("文档对话 (DocTalk)");
    await docTalkEntry.click();

    const docTextarea = page.getByPlaceholder("或在此直接粘贴文档内容...");
    const promptTextarea = page.getByPlaceholder("输入自定义对话指令，或点击下方预设按钮快速填充");
    const startBtn = page.getByRole("button", { name: "开始对话" });
    const interviewPreset = page.getByRole("button", { name: "模拟面试" });
    const paperPreset = page.getByRole("button", { name: "论文研讨" });

    // 初始状态下「开始对话」为 disabled
    await expect(startBtn).toBeDisabled();

    // 输入文档草稿
    const sampleDoc = "This is a document about machine learning systems.";
    await docTextarea.fill(sampleDoc);
    await expect(docTextarea).toHaveValue(sampleDoc);

    // 填入文档后「开始对话」变为 enabled
    await expect(startBtn).not.toBeDisabled();

    // 点击预设「模拟面试」
    await interviewPreset.click();
    await expect(interviewPreset).toHaveAttribute("aria-pressed", "true");
    await expect(paperPreset).toHaveAttribute("aria-pressed", "false");
    const promptValueAfterPreset = await promptTextarea.inputValue();
    expect(promptValueAfterPreset.length).toBeGreaterThan(0);

    // 二次编辑 Prompt（验证不被快捷键抢占）
    await promptTextarea.focus();
    await page.keyboard.type(" 请格外注意系统架构设计。");
    const customPrompt = await promptTextarea.inputValue();
    expect(customPrompt).toContain("请格外注意系统架构设计。");

    // 动态 resize 视口至极端窄屏（320x568）并缩放到 200% 字号
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    // 验证草稿内容及选定预设状态完好保留
    await expect(docTextarea).toHaveValue(sampleDoc);
    await expect(promptTextarea).toHaveValue(customPrompt);
    await expect(startBtn).not.toBeDisabled();

    // 验证纵向滚动可达：滚动至页面底部开始按钮可点击
    await startBtn.scrollIntoViewIfNeeded();
    await expect(startBtn).toBeInViewport();

    // 键盘 Tab 导航测试
    const backBtn = page.getByRole("button", { name: "返回主页" });
    await backBtn.focus();
    await expect(backBtn).toBeFocused();

    await page.keyboard.press("Tab"); // 聚焦到上传选择区域
    const uploadArea = page.getByRole("button", { name: "点击选择 .txt 或 .md 文件" });
    await expect(uploadArea).toBeFocused();

    // 截图记录极端视口下的草稿保留与焦点
    await page.screenshot({
      path: testInfo.outputPath("draft-preserved-narrow-viewport.png"),
      fullPage: true,
    });

    // 全程零隐式写保持
    expect(postRequests).toHaveLength(0);
  });

  test("DOC25-01 回归：320x568在200%根字号下元素自身与文本可读性验收", async ({
    page,
  }, testInfo) => {
    const postRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" || req.method() === "PUT") {
        const url = req.url();
        if (url.includes("/api/sessions") || url.includes("/dispatch") || url.includes("/lease")) {
          postRequests.push(`${req.method()} ${url}`);
        }
      }
    });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");

    const docTalkEntry = page.getByText("文档对话 (DocTalk)");
    await expect(docTalkEntry).toBeVisible();
    await docTalkEntry.click();

    // 设置 200% 根字号
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const backBtn = page.getByRole("button", { name: "返回主页" });
    const title = page.getByRole("heading", { name: "文档对话", level: 1 });
    const subtitle = page.getByTestId("doc-chat-subtitle");

    await expect(backBtn).toBeVisible();
    await expect(title).toBeVisible();
    await expect(subtitle).toBeVisible();

    const metrics = await page.evaluate(() => {
      const btn =
        document.querySelector('[data-testid="doc-chat-back-button"]') ||
        document.querySelector('button[aria-label="返回主页"]');
      const h1 =
        document.querySelector('[data-testid="doc-chat-title"]') || document.querySelector("h1");
      const p =
        document.querySelector('[data-testid="doc-chat-subtitle"]') ||
        (h1 ? h1.parentElement?.querySelector("p") : null);

      const getRangeRect = (el: Element | null) => {
        if (!el) return null;
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = range.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };

      const bRect = btn?.getBoundingClientRect();
      return {
        backRect: bRect
          ? {
              left: bRect.left,
              right: bRect.right,
              top: bRect.top,
              bottom: bRect.bottom,
              width: bRect.width,
              height: bRect.height,
            }
          : null,
        titleTextRect: getRangeRect(h1),
        subtitleTextRect: getRangeRect(p),
        titleClientWidth: h1?.clientWidth ?? 0,
        titleScrollWidth: h1?.scrollWidth ?? 0,
        subtitleClientWidth: p?.clientWidth ?? 0,
        subtitleScrollWidth: p?.scrollWidth ?? 0,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });

    expect(metrics.backRect).not.toBeNull();
    expect(metrics.titleTextRect).not.toBeNull();
    expect(metrics.subtitleTextRect).not.toBeNull();

    // 1. 返回按钮与标题/副标题真实文字 Range 不重叠
    expect(isOverlapping(metrics.backRect!, metrics.titleTextRect!)).toBe(false);
    expect(isOverlapping(metrics.backRect!, metrics.subtitleTextRect!)).toBe(false);

    // 2. 标题与副标题自身不横向溢出，且充分利用可用宽度（非单字竖排窄列）
    expect(metrics.titleScrollWidth).toBeLessThanOrEqual(metrics.titleClientWidth + 1);
    expect(metrics.titleClientWidth).toBeGreaterThanOrEqual(200);

    expect(metrics.subtitleScrollWidth).toBeLessThanOrEqual(metrics.subtitleClientWidth + 1);
    expect(metrics.subtitleClientWidth).toBeGreaterThanOrEqual(200);

    // 3. 全局 document 无横向溢出
    expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);

    // 4. 触控区域 >= 44x44
    expect(metrics.backRect!.width).toBeGreaterThanOrEqual(44);
    expect(metrics.backRect!.height).toBeGreaterThanOrEqual(44);

    // 5. 截图保留证据
    await page.screenshot({
      path: testInfo.outputPath("regression-doc25-01-320-200.png"),
      fullPage: true,
    });

    // 6. 零隐式写
    expect(postRequests).toHaveLength(0);
  });
});
