import { test, expect } from "@playwright/test";
import { zhCN } from "../src/i18n/zh-CN";

const t = zhCN.docChat;

test.describe("DocTalk local file import reliability", () => {
  test("preserves draft on invalid file, displays safety error, imports valid file on retry with zero implicit API writes", async ({
    page,
  }, testInfo) => {
    // 监听网络请求，确保零隐式 API 写
    const mutatingRequests: string[] = [];
    page.on("request", (req) => {
      const method = req.method();
      if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
        mutatingRequests.push(`${method} ${req.url()}`);
      }
    });

    await page.goto("/");

    // 进入文档对话 (DocTalk) 设置页
    const docTalkEntry = page.getByRole("heading", { name: t.dashboardEntry });
    await expect(docTalkEntry).toBeVisible();
    await docTalkEntry.click();

    const pageHeading = page.getByRole("heading", { name: t.title, exact: true });
    await expect(pageHeading).toBeVisible();

    const textarea = page.locator("#doc-upload-textarea");
    const fileInput = page.locator('input[type="file"]');
    const startButton = page.getByRole("button", { name: t.startButton });

    // 1. 输入初始草稿
    const initialDraft = "Initial draft text before import";
    await textarea.fill(initialDraft);
    await expect(textarea).toHaveValue(initialDraft);
    await expect(startButton).toBeEnabled();

    // 2. 选择不支持的扩展名文件（.pdf）
    await fileInput.setInputFiles({
      name: "document.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 dummy content"),
    });

    // 验证安全错误提示并保留草稿
    const errorAlert = page.getByRole("alert");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveText(t.importErrorUnsupportedType);
    await expect(textarea).toHaveValue(initialDraft);

    // 3. 再次选择合法文件（.md）
    const validContent = "# Heading\nImported markdown content successfully";
    await fileInput.setInputFiles({
      name: "valid-doc.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(validContent, "utf-8"),
    });

    // 验证错误清除且内容更新为合法文件文本
    await expect(textarea).toHaveValue(validContent);
    await expect(errorAlert).not.toBeVisible();
    await expect(startButton).toBeEnabled();

    // 4. 验证零隐式 API 写
    expect(mutatingRequests).toEqual([]);

    // 5. 独立截图输出
    await page.screenshot({ path: testInfo.outputPath("doc-import-verified.png") });
  });
});
