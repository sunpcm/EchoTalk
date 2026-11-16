import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * READ：设置可读性（仅产品/回归阶段）。
 * 覆盖三主题 × 390/1280 CSS 宽 × 正常/根字号 200% × 禁用/启用，Chromium/WebKit 由
 * Playwright 项目矩阵独立执行。
 *
 * 断言口径（不镜像实现，以真实合成后计算样式为准）：
 * - 功能输入/select 可识别边界 3:1，不四舍五入（仅启用态；禁用控件按 WCAG 豁免）。
 * - 禁用 Provider 文字以「合成祖先 opacity 后的真实前景/背景」按原 AA 字号规则判定
 *   （14px 正文 4.5:1，>=24px 大字 3:1），能杀掉恢复 fieldset opacity-50 的变异。
 * - focus 态存在且可识别：聚焦后 ring 颜色对比 >=3:1，且默认控件边界不因聚焦被降低。
 * - 说明文字/开关不相交，开关 44px 不退化，抽屉无新增水平溢出。
 * - 真实 root/控件字号断言（200% 必须是 28px 而非 14px），全程零 pageerror。
 *
 * 确定场景：GET 返回固定 theme + 本地 localStorage 主题，真实水合就绪，不依赖共享 Fake
 * 主题/mock store；不新增 sleep/retry/skip，两阶段（禁用/启用）各自截图 + metrics，截图
 * 写 Playwright artifacts 不纳 Git。
 */

const THEMES = ["warm", "cool", "dark"] as const;
type Theme = (typeof THEMES)[number];

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 900 },
] as const;

const ROOT_FONT_SIZES = [
  { name: "normal", value: "100%", rootPx: 16 },
  { name: "200", value: "200%", rootPx: 32 },
] as const;

const CONTROL_SELECTORS = [
  "#stt-provider-select",
  "#stt-key-input",
  "#llm-provider-select",
  "#llm-model-input",
  "#llm-key-input",
  "#tts-provider-select",
  "#tts-key-input",
] as const;

const SETTINGS_JSON = (theme: Theme) => ({
  is_custom_mode: false,
  is_custom_verified: false,
  subscription_tier: "free",
  theme,
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
});

async function openDrawerWithTheme(page: Page, theme: Theme, rootFontSizeValue: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // 本地主题意图与确定 GET 保持一致，不读取共享 Fake default。
  await page.addInitScript((t) => localStorage.setItem("echotalk-theme", t), theme);
  await page.route("**/api/user/settings", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: SETTINGS_JSON(theme) });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  // 在真实 DOM 可写后设置根字号（此前 addInitScript 中 document.documentElement 为 null）。
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, rootFontSizeValue);
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  // 真实水合就绪：等待后端主题回写与 html data-theme 终值。
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  return dialog;
}

/** 读取并断言真实 root / 控件字号，避免仅凭 case label 称 200%。 */
function measureRealFont(page: Page) {
  return page.evaluate(() => {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const el = document.querySelector<HTMLElement>("#stt-provider-select");
    const sel = el ? parseFloat(getComputedStyle(el).fontSize) : -1;
    return { root, sel };
  });
}

/**
 * 合成祖先 opacity 后，读取指定元素文字的真实前景/背景对比度。
 * 关键：不只看 CSS color/background，而是把每个 <1 的 ancestor opacity 按 source-over
 * 合成到最近的 opaque 背景上，从而能识别整组 opacity-50 的变异。
 */
function measureProviderTextEffective(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return { r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m[3] ?? 1 };
    };
    const over = (
      fg: { r: number; g: number; b: number; a: number },
      bg: { r: number; g: number; b: number },
    ) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
    });
    const lum = (p: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
    };
    const ratio = (
      a: { r: number; g: number; b: number },
      b: { r: number; g: number; b: number },
    ) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const el = document.querySelector(sel);
    if (!el) return { ratio: -1, fontSize: 0, required: 0, groupOpacity: 1 };

    const cs = getComputedStyle(el);
    const textColor = parse(cs.color);

    // 最近一层 opaque 背景（文字直接所在填充色）。
    const chain: Element[] = [];
    let n: Element | null = el;
    while (n && n !== document.documentElement) {
      chain.push(n);
      n = n.parentElement;
    }
    let immediateBg: { r: number; g: number; b: number } | null = null;
    let immediateBgNode: Element | null = null;
    for (const node of chain) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a >= 0.99) {
        immediateBg = { r: c.r, g: c.g, b: c.b };
        immediateBgNode = node;
        break;
      }
    }
    if (!immediateBg) immediateBg = { r: 255, g: 255, b: 255 };

    // 位于 immediateBg 之上的祖先（承载 opacity group）。
    const above: Element[] = [];
    let m: Element | null = immediateBgNode ? immediateBgNode.parentElement : el.parentElement;
    while (m && m !== document.documentElement) {
      above.push(m);
      m = m.parentElement;
    }

    let effText = { r: textColor.r, g: textColor.g, b: textColor.b };
    let effBg = { ...immediateBg };
    let behind: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 };
    let groupOpacity = 1;
    for (const node of [...above].reverse()) {
      const ncs = getComputedStyle(node);
      const nodeBg = parse(ncs.backgroundColor);
      const o = Math.min(Math.max(parseFloat(ncs.opacity), 0), 1);
      if (o < 1) groupOpacity *= o;
      if (nodeBg.a >= 0.99) {
        behind = { r: nodeBg.r, g: nodeBg.g, b: nodeBg.b };
      } else if (nodeBg.a > 0) {
        behind = over(nodeBg, behind);
      }
      if (o < 1) {
        effText = over({ ...effText, a: o }, behind);
        effBg = over({ ...effBg, a: o }, behind);
      }
    }

    const r = ratio(effText, effBg);
    const fontSize = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const required = fontSize >= 24 || (fontSize >= 18.66 && bold) ? 3 : 4.5;
    return { ratio: r, fontSize, required, groupOpacity, effText, effBg };
  }, selector);
}

/** 读取全部七控件的边界对比度，逐一证明存在且有非零边框，不因缺失/零边框而少测。 */
function measureControlBoundary(page: Page, selectors: readonly string[]) {
  return page.evaluate(
    (sels) => {
      const parse = (c: string) => {
        const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
        return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
      };
      const lum = (p: { r: number; g: number; b: number }) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
      };
      const ratio = (
        a: { r: number; g: number; b: number },
        b: { r: number; g: number; b: number },
      ) => {
        const la = lum(a);
        const lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      // 最近一层 opaque 祖先背景（控件外邻表面，边界外缘相邻色）。
      const nearestOpaqueAncestorBg = (el: Element) => {
        let a: Element | null = el.parentElement;
        while (a && a !== document.documentElement) {
          const c = parse(getComputedStyle(a).backgroundColor);
          if (c.a >= 0.99) return { r: c.r, g: c.g, b: c.b };
          a = a.parentElement;
        }
        return { r: 255, g: 255, b: 255 };
      };
      let min = Number.POSITIVE_INFINITY;
      const details = sels.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) {
          return {
            sel,
            found: false,
            borderWidth: 0,
            ratio: -1,
            innerRatio: -1,
            outerRatio: -1,
            border: "",
            bg: "",
          };
        }
        const cs = getComputedStyle(el);
        const borderWidth = parseFloat(cs.borderTopWidth);
        const borderColor = parse(cs.borderTopColor);
        const bgColor = parse(cs.backgroundColor);
        const adjacent = nearestOpaqueAncestorBg(el);
        const innerRatio =
          Number.isFinite(borderWidth) && borderWidth > 0 ? ratio(borderColor, bgColor) : -1;
        const outerRatio =
          Number.isFinite(borderWidth) && borderWidth > 0 ? ratio(borderColor, adjacent) : -1;
        const r = innerRatio >= 0 && outerRatio >= 0 ? Math.min(innerRatio, outerRatio) : -1;
        if (r >= 0 && r < min) min = r;
        return {
          sel,
          found: true,
          borderWidth,
          ratio: r,
          innerRatio,
          outerRatio,
          border: cs.borderTopColor,
          bg: cs.backgroundColor,
        };
      });
      return { min: Number.isFinite(min) ? min : -1, count: details.length, details };
    },
    selectors as readonly string[],
  );
}

/** 聚焦后解析 box-shadow 各层，找可见、非透明、几何非零的 ring 层并计算其与相邻背景对比度。 */
function measureFocusRing(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return { r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m[3] ?? 1 };
    };
    const lum = (p: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
    };
    const ratio = (
      a: { r: number; g: number; b: number },
      b: { r: number; g: number; b: number },
    ) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    // 按顶层逗号切分 shadow 层，避免把 rgb()/rgba() 颜色函数内部的逗号拆碎。
    const splitTopLevel = (str: string) => {
      const parts: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of str) {
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        if (ch === "," && depth === 0) {
          parts.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur.trim() !== "") parts.push(cur);
      return parts.map((s) => s.trim());
    };
    // 每层：抽取完整颜色函数（rgb/rgba/hsl/hsla/hex）与四个 px 长度（x/y/blur/spread）。
    const parseLayer = (layer: string) => {
      const colorMatch = layer.match(/(?:rgba?|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8}/);
      const color = colorMatch ? colorMatch[0] : null;
      const rest = colorMatch ? layer.replace(colorMatch[0], " ") : layer;
      const lengths = (rest.match(/-?\d+(?:\.\d+)?px/g) || []).map((s) => parseFloat(s));
      return { color, lengths };
    };

    const el = document.querySelector(sel);
    if (!el) {
      return { boxShadow: "", ringColor: null, ringSpread: 0, ratio: -1, bg: "", adjacentBg: "" };
    }
    const cs = getComputedStyle(el);
    const boxShadow = cs.boxShadow;
    const bg = parse(cs.backgroundColor);

    // 最近一层 opaque 祖先背景（控件外邻表面，ring 外缘相邻色）。
    let adjacentBg = { r: 255, g: 255, b: 255 };
    let adjacentStr = "";
    let a: Element | null = el.parentElement;
    while (a && a !== document.documentElement) {
      const ac = getComputedStyle(a);
      const c = parse(ac.backgroundColor);
      if (c.a >= 0.99) {
        adjacentBg = { r: c.r, g: c.g, b: c.b };
        adjacentStr = ac.backgroundColor;
        break;
      }
      a = a.parentElement;
    }

    if (boxShadow === "none") {
      return {
        boxShadow,
        ringColor: null,
        ringSpread: 0,
        ratio: -1,
        bg: cs.backgroundColor,
        adjacentBg: adjacentStr,
      };
    }

    // 找可见 ring 层：颜色非透明（alpha>=0.99）且几何非零（spread>0，次选 blur>0）。
    const layers = splitTopLevel(boxShadow).map(parseLayer);
    let ringColor: string | null = null;
    let ringSpread = 0;
    for (const layer of layers) {
      const c = layer.color ? parse(layer.color) : null;
      const spread = layer.lengths[3] ?? 0;
      if (c && c.a >= 0.99 && spread > 0) {
        ringColor = layer.color;
        ringSpread = spread;
        break;
      }
    }
    if (!ringColor) {
      for (const layer of layers) {
        const c = layer.color ? parse(layer.color) : null;
        const blur = layer.lengths[2] ?? 0;
        if (c && c.a >= 0.99 && blur > 0) {
          ringColor = layer.color;
          ringSpread = blur;
          break;
        }
      }
    }

    let r = -1;
    if (ringColor) {
      const rc = parse(ringColor);
      const inner = ratio(rc, bg);
      const outer = ratio(rc, adjacentBg);
      r = Math.min(inner, outer);
    }
    return {
      boxShadow,
      ringColor,
      ringSpread,
      ratio: r,
      bg: cs.backgroundColor,
      adjacentBg: adjacentStr,
    };
  }, selector);
}

/** 读取每个主题 radio 的色点（外圈/内点）与文字真实矩形，证明均在按钮边界内（不只看 class）。 */
function measureSwatchGeometry(page: Page) {
  return page.evaluate(() => {
    type Rect = {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
    const elRect = (el: Element | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const rangeRect = (range: Range): Rect => {
      const r = range.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const contains = (child: Rect | null, parent: Rect): boolean => {
      if (!child) return false;
      const e = 0.5; // 亚像素/取整容差
      return (
        child.left >= parent.left - e &&
        child.right <= parent.right + e &&
        child.top >= parent.top - e &&
        child.bottom <= parent.bottom + e
      );
    };
    const group = document.querySelector('[role="radiogroup"]');
    const buttons = group ? Array.from(group.querySelectorAll('[role="radio"]')) : [];
    return buttons.map((btn) => {
      const btnBox = elRect(btn)!;
      const swatch = btn.children[0] ?? null;
      const dot = swatch?.children[0] ?? null;
      const label = btn.children[1] ?? null;
      const swatchBox = elRect(swatch);
      const dotBox = elRect(dot);
      let textBox: Rect | null = null;
      if (label && label.textContent && label.textContent.trim() !== "") {
        const range = document.createRange();
        range.selectNodeContents(label);
        textBox = rangeRect(range);
      }
      return {
        label: btn.getAttribute("aria-label"),
        btn: btnBox,
        swatch: swatchBox,
        dot: dotBox,
        text: textBox,
        swatchWithin: contains(swatchBox, btnBox),
        dotWithin: contains(dotBox, btnBox),
        textWithin: contains(textBox, btnBox),
      };
    });
  });
}

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const rootFontSize of ROOT_FONT_SIZES) {
      test(`settings readability (${theme} / ${viewport.name} / ${rootFontSize.name})`, async ({
        page,
      }, testInfo: TestInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const dialog = await openDrawerWithTheme(page, theme, rootFontSize.value);
        const switchBtn = dialog.getByRole("switch");
        const description = dialog.getByText("开启后使用你自己的 API Key 连接 AI 服务");

        // P1-1：真实 root/控件字号已生效，200% 必须是 28px 而非 14px。
        const font = await measureRealFont(page);
        expect(font.root).toBeCloseTo(rootFontSize.rootPx, 0);
        expect(font.sel).toBeCloseTo(rootFontSize.rootPx * 0.875, 0);

        // ---- 禁用态（自定义模式关闭）：布局、合成文字对比、截图 ----
        await expect(dialog.locator("fieldset")).toHaveAttribute("disabled", "");

        const descBox = await description.boundingBox();
        const switchBox = await switchBtn.boundingBox();
        expect(descBox).not.toBeNull();
        expect(switchBox).not.toBeNull();
        expect(descBox!.x + descBox!.width).toBeLessThanOrEqual(switchBox!.x + 1);
        expect(switchBox!.width).toBeGreaterThanOrEqual(44);
        expect(switchBox!.height).toBeGreaterThanOrEqual(44);

        const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(overflow).toBe(false);

        // 主题按钮大字号重排：每个 radio 的色点/内点/文字真实矩形均落在按钮边界内。
        const swatchGeometry = await measureSwatchGeometry(page);
        expect(swatchGeometry).toHaveLength(THEMES.length);
        for (const g of swatchGeometry) {
          expect(g.swatchWithin).toBe(true);
          expect(g.dotWithin).toBe(true);
          expect(g.textWithin).toBe(true);
        }

        // P1-2：合成祖先 opacity 后的真实文字对比，能杀 opacity-50 变异。
        const disabledText = await measureProviderTextEffective(page, "#stt-provider-select");
        expect(disabledText.ratio).toBeGreaterThanOrEqual(disabledText.required);

        // 目标取景：在不改变布局的前提下滚动到 Provider 目标，保证大字号时控件在屏内。
        await page.locator("#stt-provider-select").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(
            `settings-readability-${theme}-${viewport.name}-${rootFontSize.name}-disabled.png`,
          ),
          fullPage: false,
        });
        await testInfo.attach("metrics-disabled", {
          body: JSON.stringify(
            {
              phase: "disabled",
              theme,
              viewport: viewport.name,
              rootFontSize: rootFontSize.name,
              font,
              disabledText,
              descBox,
              switchBox,
              overflow,
              swatchGeometry,
            },
            null,
            2,
          ),
          contentType: "application/json",
        });

        // ---- 启用态（自定义模式开启）：边界 3:1、focus 3:1、截图 ----
        await switchBtn.click();
        await expect(dialog.locator("fieldset")).not.toHaveAttribute("disabled", "");

        const boundary = await measureControlBoundary(page, CONTROL_SELECTORS);
        expect(boundary.count).toBe(CONTROL_SELECTORS.length);
        expect(boundary.details.every((d) => d.found)).toBe(true);
        expect(boundary.details.every((d) => d.borderWidth > 0)).toBe(true);
        expect(boundary.min).toBeGreaterThanOrEqual(3);

        // P1-3：focus ring 存在且可识别 >=3:1；默认控件边界不因聚焦被降低。
        await page.locator("#llm-model-input").focus();
        const focus = await measureFocusRing(page, "#llm-model-input");
        expect(focus.boxShadow).not.toBe("none");
        expect(focus.ringColor).not.toBeNull();
        expect(focus.ringSpread).toBeGreaterThan(0);
        expect(focus.ratio).toBeGreaterThanOrEqual(3);

        // 聚焦后默认控件边界仍需可识别（外邻表面纳入度量），不低于 3:1。
        const focusedBoundary = await measureControlBoundary(page, CONTROL_SELECTORS);
        expect(focusedBoundary.count).toBe(CONTROL_SELECTORS.length);
        expect(focusedBoundary.details.every((d) => d.found)).toBe(true);
        expect(focusedBoundary.details.every((d) => d.borderWidth > 0)).toBe(true);
        expect(focusedBoundary.min).toBeGreaterThanOrEqual(3);

        // 目标取景：滚动到聚焦控件，保证截图实拍 Provider 目标。
        await page.locator("#llm-model-input").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(
            `settings-readability-${theme}-${viewport.name}-${rootFontSize.name}-enabled.png`,
          ),
          fullPage: false,
        });
        await testInfo.attach("metrics-enabled", {
          body: JSON.stringify(
            {
              phase: "enabled",
              theme,
              viewport: viewport.name,
              rootFontSize: rootFontSize.name,
              boundary,
              focus,
              focusedBoundary,
            },
            null,
            2,
          ),
          contentType: "application/json",
        });

        // 全程零 pageerror（覆盖 P1-1 被吞掉的 null 写入错误）。
        expect(pageErrors).toEqual([]);
      });
    }
  }
}
