import { expect, test, type Page } from "@playwright/test";
import { zhCN } from "../src/i18n/zh-CN";
import pkg from "../package.json";

const t = zhCN.settings.diagnostics;

interface ClipboardProbe {
  writes: string[];
  mode: "success" | "failure" | "unsupported" | "pending";
  finish: (() => void) | null;
}

async function openDiagnostics(page: Page) {
  const pageErrors: string[] = [];
  const requests: { method: string; url: string }[] = [];
  const mutations: string[] = [];
  let captureRequests = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
    if (captureRequests && ["fetch", "xhr"].includes(request.resourceType())) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });
  await page.addInitScript(() => {
    const probe: ClipboardProbe = { writes: [], mode: "success", finish: null };
    Reflect.set(window, "__diagnosticClipboardProbe", probe);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () =>
        probe.mode === "unsupported"
          ? undefined
          : {
              writeText(text: string) {
                probe.writes.push(text);
                if (probe.mode === "failure") {
                  return Promise.reject(new Error("synthetic-clipboard-error-canary"));
                }
                if (probe.mode === "pending") {
                  return new Promise<void>((resolve) => {
                    probe.finish = resolve;
                  });
                }
                return Promise.resolve();
              },
            },
    });
  });
  let fail = true;
  await page.route("**/api/sessions/active", async (route) => {
    await route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        fail
          ? {
              detail: "Service temporarily unavailable",
              token: "synthetic-response-token-canary",
              body: "synthetic-document-canary",
              user_id: "synthetic-account-canary",
              url: "https://private.invalid/secret-path-canary",
            }
          : { items: [], next_cursor: null },
      ),
    });
  });
  await page.goto("/");
  const retry = page.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(retry).not.toBeVisible();
  await page.getByRole("button", { name: zhCN.settings.title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: zhCN.settings.title });
  await expect(dialog.getByRole("button", { name: zhCN.settings.save, exact: true })).toBeVisible();
  const region = dialog.getByRole("region", { name: t.title, exact: true });
  const preview = region.getByRole("textbox", { name: t.preview });
  await expect(preview).not.toHaveValue("");
  return {
    dialog,
    region,
    preview,
    requests,
    mutations,
    pageErrors,
    startCapture: () => {
      captureRequests = true;
    },
    stopCapture: () => {
      captureRequests = false;
    },
  };
}

test("previews and copies real safe logs, clears locally, and preserves provider drafts", async ({
  page,
}) => {
  const state = await openDiagnostics(page);
  const { dialog, region, preview } = state;
  const records = JSON.parse(await preview.inputValue());
  expect(records).toContainEqual({
    schema_version: 1,
    app_version: pkg.version,
    platform: "web",
    event: "api_http_failed",
    status: 503,
  });
  for (const record of records) {
    expect(Object.keys(record).sort()).toEqual(
      ["schema_version", "app_version", "platform", "event", "status"].sort(),
    );
  }
  expect(await preview.inputValue()).not.toContain("canary");
  expect(await preview.getAttribute("readonly")).not.toBeNull();
  await dialog.getByRole("switch").click();
  const key = dialog.locator("#llm-key-input");
  await key.fill("synthetic-draft-key-canary");
  expect(
    await page.evaluate(
      () => (Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe).writes,
    ),
  ).toEqual([]);

  state.startCapture();
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.copied);
  const writes = await page.evaluate(
    () => (Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe).writes,
  );
  expect(writes).toEqual([await preview.inputValue()]);
  expect(writes[0]).not.toContain("canary");
  await region.getByRole("button", { name: t.clear }).click();
  await expect(preview).toHaveValue("");
  await expect(region.getByRole("status")).toHaveText(t.cleared);
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.empty);
  await expect(key).toHaveValue("synthetic-draft-key-canary");
  // 覆盖现有设置主题同步 300ms 的防抖窗口，防止延迟隐式保存漏过断言。
  await page.waitForTimeout(450);
  expect(state.requests).toEqual([]);
  state.stopCapture();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: zhCN.settings.title, exact: true }).click();
  await expect(dialog.getByRole("button", { name: zhCN.settings.save, exact: true })).toBeVisible();
  await expect(preview).toHaveValue("");
  await expect(region.getByRole("status")).toHaveText("");
  expect(state.mutations).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test("keeps a selectable preview on clipboard failure or missing support", async ({ page }) => {
  const state = await openDiagnostics(page);
  const { region, preview } = state;
  const original = await preview.inputValue();
  state.startCapture();
  await page.evaluate(() => {
    (Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe).mode = "failure";
  });
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.copyFailed);
  await expect(preview).toHaveValue(original);
  await page.evaluate(() => {
    (Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe).mode = "unsupported";
  });
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.unsupported);
  await preview.focus();
  await preview.press("ControlOrMeta+A");
  expect(
    await preview.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe(original.length);
  await page.evaluate(() => {
    (Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe).mode = "success";
  });
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.copied);
  await page.waitForTimeout(450);
  expect(state.requests).toEqual([]);
  expect(state.mutations).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test("discards clipboard completion from an earlier dialog opening", async ({ page }) => {
  const state = await openDiagnostics(page);
  const { dialog, region } = state;
  await page.evaluate(() => {
    (Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe).mode = "pending";
  });
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.copying);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: zhCN.settings.title, exact: true }).click();
  await expect(dialog.getByRole("button", { name: zhCN.settings.save, exact: true })).toBeVisible();
  state.startCapture();
  await page.evaluate(() => {
    const probe = Reflect.get(window, "__diagnosticClipboardProbe") as ClipboardProbe;
    probe.mode = "success";
    probe.finish?.();
  });
  await expect(region.getByRole("status")).toHaveText("");
  await region.getByRole("button", { name: t.copy }).click();
  await expect(region.getByRole("status")).toHaveText(t.copied);
  expect(state.requests).toEqual([]);
  expect(state.mutations).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});
