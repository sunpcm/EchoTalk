import { expect, test, type Page } from "@playwright/test";

// R2-02：三主题下可见文字的 WCAG 2.1 AA 对比度回归。
// 正文 ≥ 4.5，大字（≥24px，或 ≥18.66px 且粗体）≥ 3.0。
// 渐变底、禁用控件与占位符不在断言范围内。

const THEMES = ["warm", "cool", "dark"] as const;

const ACTIVE_SESSION = {
  id: "c0a11a57-0000-4000-8000-000000000001",
  mode: "scenario",
  status: "active",
  started_at: "2026-11-10T08:00:00Z",
  ended_at: null,
};

async function applyTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

/** 返回 scope 内对比度不达标的可见文字（去重后）。 */
function findLowContrast(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const root = document.querySelector(selector);
    if (!root) return ["scope-missing"];
    const failures = new Set<string>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? "";
      const el = node.parentElement;
      if (!text || !el) continue;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || cs.visibility === "hidden") continue;
      if (el.closest(":disabled, [aria-disabled='true'], [aria-hidden='true']")) continue;

      // 向上寻找第一个不透明背景；遇到渐变或半透明祖先则跳过该文字
      let bg: { r: number; g: number; b: number } | null = null;
      let skip = false;
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        const s = getComputedStyle(cur);
        if (parseFloat(s.opacity) < 1 || s.backgroundImage !== "none") {
          skip = true;
          break;
        }
        const c = parse(s.backgroundColor);
        if (c.a >= 0.99) {
          bg = c;
          break;
        }
        if (c.a > 0.01) {
          skip = true;
          break;
        }
      }
      if (skip || !bg) continue;

      const fg = parse(cs.color);
      if (fg.a < 0.99) continue;
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < required) {
        failures.add(
          `${text.slice(0, 18)} ${ratio.toFixed(2)}<${required} ${cs.color} on ${cs.backgroundColor}`,
        );
      }
    }
    return [...failures];
  }, scope);
}

for (const theme of THEMES) {
  test(`dashboard with active sessions and confirm panel meets AA contrast (${theme})`, async ({
    page,
  }) => {
    await page.route("**/api/sessions/active*", (route) =>
      route.fulfill({ json: { items: [ACTIVE_SESSION], next_cursor: null } }),
    );
    await page.goto("/");
    await expect(page.getByRole("button", { name: /进入练习/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "结束记录" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await applyTheme(page, theme);

    expect(await findLowContrast(page, "main")).toEqual([]);

    await page.getByRole("button", { name: "结束记录" }).click();
    expect(await findLowContrast(page, "main")).toEqual([]);
  });

  test(`dashboard error and retry states meet AA contrast (${theme})`, async ({ page }) => {
    await page.route(/\/api\/(sessions|assessments|curriculum)/, (route) =>
      route.fulfill({ status: 503, json: { detail: "synthetic failure" } }),
    );
    await page.goto("/");
    await expect(page.getByText("加载活动会话失败")).toBeVisible();
    await expect(page.getByText("七天概览加载失败，请重试")).toBeVisible();
    await applyTheme(page, theme);

    expect(await findLowContrast(page, "main")).toEqual([]);
  });

  test(`settings drawer meets AA contrast (${theme})`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
    await page.getByRole("button", { name: "自定义模型设置" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("switch").click();
    await applyTheme(page, theme);

    expect(await findLowContrast(page, "dialog.settings-drawer")).toEqual([]);
  });

  for (const sessionId of ["analysis-success", "grammar-only", "grammar-only-empty"]) {
    test(`ended view ${sessionId} meets AA contrast (${theme})`, async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
      await page.evaluate(async (id) => {
        const { useAppStore } = await import("/src/store/appStore.ts");
        useAppStore.setState({
          appView: "session",
          connectionState: "ended",
          sessionId: id,
          token: null,
          wsUrl: null,
          error: null,
          agentError: null,
        });
      }, sessionId);
      await expect(page.getByRole("button", { name: "返回主页" })).toBeVisible();
      await expect(page.locator(".animate-spin")).toHaveCount(0);
      await applyTheme(page, theme);

      expect(await findLowContrast(page, "main")).toEqual([]);
    });
  }
}
