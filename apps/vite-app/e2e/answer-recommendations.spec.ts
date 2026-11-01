import { test, expect } from "@playwright/test";

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

test.beforeEach(async ({ page }) => {
  // 注入剪贴板桩，精确捕获写入文本，避免无头浏览器系统权限弹窗干扰
  await page.addInitScript(() => {
    window.__clipboardWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          window.__clipboardWrites = window.__clipboardWrites || [];
          window.__clipboardWrites.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  });

  // 仅在 e2e 隔离测试中拦截 @livekit/components-react，明确桩化 useVoiceAssistant，
  // 不连接真实媒体通道，不创建生产测试注入入口
  await page.route("**/@livekit_components-react.js*", async (route) => {
    const response = await route.fetch();
    let text = await response.text();

    const reactIdent = text.match(/\b(\w+)\.useState\b/)?.[1] || "React";
    const stubCode = `
function __stub_useVoiceAssistant() {
  const [data, setData] = ${reactIdent}.useState(() => window.__echotalkVoiceAssistantData || {
    agentTranscriptions: [],
    state: "listening",
  });
  ${reactIdent}.useEffect(() => {
    const onUpdate = (e) => setData(e.detail);
    window.addEventListener("voice-assistant-update", onUpdate);
    return () => window.removeEventListener("voice-assistant-update", onUpdate);
  }, []);
  return data;
}
`;
    text =
      text.replace(
        /\b(\w+)\s+as\s+useVoiceAssistant\b/,
        "__stub_useVoiceAssistant as useVoiceAssistant",
      ) + stubCode;

    await route.fulfill({ response, body: text });
  });
});

test.describe("回答推荐响应式、四视口、字号缩放与触控几何规范 (A26 / CP-05)", () => {
  for (const vp of viewports) {
    for (const fs of fontScales) {
      test(`四视口几何无横向溢出、文字完整换行、真实可读宽度且触控>=44px (${vp.name}, ${fs.name})`, async ({
        page,
      }, testInfo) => {
        // 监控零隐式写：夹具渲染与交互期间不得发起任何后端会话与能力写请求
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
        await page.goto("/e2e/fixtures/answer-recommendations.html");

        if (fs.scale !== "100%") {
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = scale;
          }, fs.scale);
        }

        // 验证面板区域
        const section = page.getByRole("region", { name: "回答推荐" });
        await expect(section).toBeVisible();

        // 验证标题与提示语
        const heading = section.getByRole("heading", { name: "回答推荐", level: 3 });
        await expect(heading).toBeVisible();
        await expect(section.getByText("不知道怎么回答？试试以下表达：")).toBeVisible();

        // 验证推荐按钮
        const buttons = section.getByRole("button");
        const count = await buttons.count();
        expect(count).toBe(3);

        // 逐一测量按钮尺寸与正文内容框真实几何（触控规范、真实可读宽度与无横向溢出）
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          await expect(btn).toBeVisible();

          const box = await btn.boundingBox();
          expect(box).not.toBeNull();
          // 触控尺寸不低于 44x44 CSSpx
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);

          // 测量真实正文内容框 clientWidth 与文字 Range 矩形
          const geom = await btn.evaluate((el) => {
            const textSpan =
              el.querySelector("span.break-words") || el.querySelector("div > span:nth-child(2)");
            let textRangeRect: { width: number; height: number } | null = null;
            let spanRect: { width: number; height: number } | null = null;

            if (textSpan) {
              const rect = textSpan.getBoundingClientRect();
              spanRect = { width: rect.width, height: rect.height };

              const range = document.createRange();
              range.selectNodeContents(textSpan);
              const rRect = range.getBoundingClientRect();
              textRangeRect = { width: rRect.width, height: rRect.height };
            }

            const textComputed = textSpan ? window.getComputedStyle(textSpan) : null;

            return {
              btnClientWidth: el.clientWidth,
              btnScrollWidth: el.scrollWidth,
              textSpanWidth: spanRect ? spanRect.width : 0,
              textRangeWidth: textRangeRect ? textRangeRect.width : 0,
              textRangeHeight: textRangeRect ? textRangeRect.height : 0,
              textOverflow: textComputed ? textComputed.textOverflow : "",
              whiteSpace: textComputed ? textComputed.whiteSpace : "",
            };
          });

          // 严禁 ellipsis / truncate 伪装换行
          expect(geom.textOverflow).not.toBe("ellipsis");
          // 内容框无内部横向溢出
          expect(geom.btnScrollWidth).toBeLessThanOrEqual(geom.btnClientWidth + 1);

          // R1 关键回归 (P1 小屏真实文字宽度)：断言正文文本框与真实文字范围具备充裕可读宽度，
          // 彻底杜绝 16px 挤压导致的单字母竖列缺陷
          expect(geom.textSpanWidth).toBeGreaterThanOrEqual(140);
          expect(geom.textRangeWidth).toBeGreaterThanOrEqual(100);
          // 验证文字不是单字母垂直串：文字宽度不得过窄导致高度畸高
          expect(geom.textRangeWidth).toBeGreaterThan(geom.textRangeHeight * 0.3);
        }

        // 全页及容器水平无溢出
        const pageOverflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            docScrollWidth: doc.scrollWidth,
            docClientWidth: doc.clientWidth,
          };
        });
        expect(pageOverflow.docScrollWidth).toBeLessThanOrEqual(pageOverflow.docClientWidth + 1);

        // 拍摄真正的按钮和推荐面板特写截图，确保证据清晰完整
        const btn0Path = testInfo.outputPath(`button-0-${vp.name}-${fs.name}.png`);
        await buttons.first().screenshot({ path: btn0Path });

        const sectionPath = testInfo.outputPath(`section-${vp.name}-${fs.name}.png`);
        await section.screenshot({ path: sectionPath });

        const pagePath = testInfo.outputPath(`page-${vp.name}-${fs.name}.png`);
        await page.screenshot({ path: pagePath });

        // 确认全过程零隐式写请求
        expect(sessionPostRequests).toHaveLength(0);
      });
    }
  }
});

test.describe("回答推荐键盘交互、完整复制与时序隔离 (A26 / CP-05)", () => {
  test("支持键盘 Tab 导航、可见焦点与 Enter/Space 复制完整原始字符串", async ({
    page,
    browserName,
  }) => {
    await page.goto("/e2e/fixtures/answer-recommendations.html");

    const section = page.getByRole("region", { name: "回答推荐" });
    const buttons = section.getByRole("button");
    await expect(buttons.first()).toBeVisible();

    // 聚焦到第一个推荐按钮
    const firstBtn = buttons.nth(0);
    await firstBtn.focus();
    await expect(firstBtn).toBeFocused();

    // 焦点可见环样式
    const isFocusVisible = await firstBtn.evaluate((el) => {
      return el.classList.contains("focus-visible:ring-accent") || el.matches(":focus-visible");
    });
    expect(isFocusVisible).toBeTruthy();

    // 使用 Enter 键激活第一个按钮
    await page.keyboard.press("Enter");
    await expect(firstBtn.getByText("已复制")).toBeVisible();

    // 验证剪贴板写入内容为完整原始英文字符串，不包含序号或提示文案
    const writes1 = await page.evaluate(() => window.__clipboardWrites || []);
    expect(writes1.length).toBeGreaterThan(0);
    expect(writes1[writes1.length - 1]).toBe("My name is ... and I'm learning English.");

    // WebKit 在 macOS 环境下键盘导航按钮遵循系统偏好，使用 Alt+Tab 切换控件焦点
    const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await page.keyboard.press(tabKey);
    const secondBtn = buttons.nth(1);
    await expect(secondBtn).toBeFocused();
    await page.keyboard.press("Space");
    await expect(secondBtn.getByText("已复制")).toBeVisible();

    const writes2 = await page.evaluate(() => window.__clipboardWrites || []);
    expect(writes2[writes2.length - 1]).toBe("I'm ... Nice to meet you!");
  });

  test("换题时即时清理旧反馈，旧回调不污染新问题", async ({ page }) => {
    await page.goto("/e2e/fixtures/answer-recommendations.html");

    const section = page.getByRole("region", { name: "回答推荐" });
    const buttons = section.getByRole("button");

    // 点击复制第一个推荐
    await buttons.nth(0).click();
    await expect(buttons.nth(0).getByText("已复制")).toBeVisible();

    // 切换到新问题
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg-2",
                text: "Why do you learn English?",
                final: true,
                firstReceivedTime: Date.now(),
              },
            ],
            state: "listening",
          },
        }),
      );
    });

    // 换题后立即清除旧问题的复制反馈，推荐内容已切换
    await expect(section.getByText("已复制")).not.toBeVisible();
    await expect(section.getByText("I think it's because ...")).toBeVisible();

    // 再次显式复制新问题回答
    const newButtons = section.getByRole("button");
    await newButtons.nth(0).click();
    await expect(newButtons.nth(0).getByText("已复制")).toBeVisible();

    const writes = await page.evaluate(() => window.__clipboardWrites || []);
    expect(writes[writes.length - 1]).toBe("I think it's because ...");
  });

  test("等待状态（thinking / speaking）清空反馈并在恢复后保持干净", async ({ page }) => {
    await page.goto("/e2e/fixtures/answer-recommendations.html");

    const section = page.getByRole("region", { name: "回答推荐" });
    const buttons = section.getByRole("button");

    await buttons.nth(0).click();
    await expect(buttons.nth(0).getByText("已复制")).toBeVisible();

    // 切换至 thinking 状态
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg-1",
                text: "What is your name?",
                final: true,
              },
            ],
            state: "thinking",
          },
        }),
      );
    });

    // 处于等待状态中
    await expect(section.getByText("等待 AI 提问中...")).toBeVisible();
    await expect(section.getByRole("button")).toHaveCount(0);

    // 恢复为 listening
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg-1",
                text: "What is your name?",
                final: true,
              },
            ],
            state: "listening",
          },
        }),
      );
    });

    // 恢复后不残留旧的“已复制”指示
    await expect(section.getByRole("button")).toHaveCount(3);
    await expect(section.getByText("已复制")).not.toBeVisible();
  });

  test("冒号边界碰撞切题即时清除提示，且新题可再次复制成功 (A33 / CP-05)", async ({ page }) => {
    // 监控页面异常：0 pageerror
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // 监控零隐式写：夹具渲染与交互期间不得发起任何后端会话/令牌/租约/调度写请求
    const sessionPostRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" || req.method() === "PUT") {
        const url = req.url();
        if (
          url.includes("/api/sessions") ||
          url.includes("/dispatch") ||
          url.includes("/lease") ||
          url.includes("/token")
        ) {
          sessionPostRequests.push(`${req.method()} ${url}`);
        }
      }
    });

    await page.goto("/e2e/fixtures/answer-recommendations.html");

    const section = page.getByRole("region", { name: "回答推荐" });
    await expect(section).toBeVisible();

    // 1. 设置题目 A: id="seg", text="What:is your hobby?"
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg",
                text: "What:is your hobby?",
                final: true,
                firstReceivedTime: Date.now(),
              },
            ],
            state: "listening",
          },
        }),
      );
    });

    const buttons = section.getByRole("button");
    await expect(buttons.first()).toBeVisible();
    await buttons.nth(0).click();
    await expect(buttons.nth(0).getByText("已复制")).toBeVisible();

    const writes1 = await page.evaluate(() => window.__clipboardWrites || []);
    expect(writes1.length).toBeGreaterThan(0);
    const textA = writes1[writes1.length - 1];

    // 2. 切换至存在冒号拼接碰撞风险的题目 B: id="seg:What", text="is your hobby?"
    // 旧冒号直接拼接会生成相同 scopeKey ("seg:What:is your hobby?") 导致反馈残留；
    // 无歧义元组编码下两者严格隔离，切题后旧提示立即清除
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg:What",
                text: "is your hobby?",
                final: true,
                firstReceivedTime: Date.now(),
              },
            ],
            state: "listening",
          },
        }),
      );
    });

    // 立即断言已复制提示消失
    await expect(section.getByText("已复制")).not.toBeVisible();

    // 3. 在新题目上再次点击复制，断言复制成功显示并写入新剪贴板内容
    const newButtons = section.getByRole("button");
    await newButtons.nth(0).click();
    await expect(newButtons.nth(0).getByText("已复制")).toBeVisible();

    const writes2 = await page.evaluate(() => window.__clipboardWrites || []);
    expect(writes2.length).toBe(writes1.length + 1);
    expect(writes2[writes2.length - 1]).not.toBe(textA);

    // 4. 断言 0 pageerror 与零隐式写
    expect(pageErrors).toHaveLength(0);
    expect(sessionPostRequests).toHaveLength(0);
  });

  test("冒号碰撞题目间迟到 clipboard 完成不污染新题目，且新题目复制成功 (A33 / CP-05)", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const sessionPostRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" || req.method() === "PUT") {
        const url = req.url();
        if (
          url.includes("/api/sessions") ||
          url.includes("/dispatch") ||
          url.includes("/lease") ||
          url.includes("/token")
        ) {
          sessionPostRequests.push(`${req.method()} ${url}`);
        }
      }
    });

    await page.goto("/e2e/fixtures/answer-recommendations.html");

    const section = page.getByRole("region", { name: "回答推荐" });
    await expect(section).toBeVisible();

    // 注入受控 clipboard 延迟桩
    await page.evaluate(() => {
      window.__delayedResolvers = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: (text: string) => {
            window.__clipboardWrites = window.__clipboardWrites || [];
            window.__clipboardWrites.push(text);
            return new Promise<void>((resolve) => {
              window.__delayedResolvers.push(resolve);
            });
          },
        },
        configurable: true,
      });
    });

    // 1. 设置题目 A: id="seg", text="What:is your hobby?"
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg",
                text: "What:is your hobby?",
                final: true,
                firstReceivedTime: Date.now(),
              },
            ],
            state: "listening",
          },
        }),
      );
    });

    const buttons = section.getByRole("button");
    await expect(buttons.first()).toBeVisible();

    // 点击题目 A 按钮，处于 pending 状态
    await buttons.nth(0).click();
    await expect(section.getByText("已复制")).not.toBeVisible();

    // 2. 在 pending 期间切换至冒号碰撞题目 B: id="seg:What", text="is your hobby?"
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("voice-assistant-update", {
          detail: {
            agentTranscriptions: [
              {
                id: "seg:What",
                text: "is your hobby?",
                final: true,
                firstReceivedTime: Date.now(),
              },
            ],
            state: "listening",
          },
        }),
      );
    });

    // 3. 释放题目 A 的剪贴板 Promise
    await page.evaluate(() => {
      if (window.__delayedResolvers.length > 0) {
        const resolve = window.__delayedResolvers.shift();
        resolve();
      }
    });

    // 关键断言：题目 A 的迟到写入完成绝不能污染题目 B，面板上不得出现“已复制”
    await expect(section.getByText("已复制")).not.toBeVisible();

    // 4. 在题目 B 上发起复制并完成
    const newButtons = section.getByRole("button");
    await newButtons.nth(0).click();

    await page.evaluate(() => {
      if (window.__delayedResolvers.length > 0) {
        const resolve = window.__delayedResolvers.shift();
        resolve();
      }
    });

    // 题目 B 正常显示已复制
    await expect(newButtons.nth(0).getByText("已复制")).toBeVisible();

    const writes = await page.evaluate(() => window.__clipboardWrites || []);
    expect(writes.length).toBeGreaterThanOrEqual(2);

    expect(pageErrors).toHaveLength(0);
    expect(sessionPostRequests).toHaveLength(0);
  });
});
