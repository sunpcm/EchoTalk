import { describe, expect, it } from "vitest";

// AGENTS.md：前端文案必须走 src/i18n/。本测试扫描源码，禁止在语言包之外出现中文字面量。
// 注释不算文案；platform/url.ts 的配置错误文案同样必须经过语言包。

const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const CJK = /[一-鿿]/;

function isScanned(path: string): boolean {
  return (
    !path.startsWith("./") &&
    !path.startsWith("../i18n/") &&
    !/\.test\.tsx?$/.test(path) &&
    !path.endsWith(".d.ts")
  );
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

describe("no hardcoded user-facing copy outside src/i18n", () => {
  const scanned = Object.keys(sources).filter(isScanned);

  it("finds source files to scan", () => {
    expect(scanned.length).toBeGreaterThan(40);
    expect(scanned).toContain("../store/conversation.ts");
    expect(scanned).toContain("../components/doc-chat/DocUploadCard.tsx");
    expect(scanned).toContain("../platform/url.ts");
  });

  it("has no CJK literals outside the language pack", () => {
    const offenders: string[] = [];
    for (const path of scanned) {
      stripComments(sources[path])
        .split("\n")
        .forEach((line, index) => {
          if (CJK.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("detects a CJK literal but ignores comments", () => {
    expect(CJK.test(stripComments('const a = "中文"; // 注释'))).toBe(true);
    expect(CJK.test(stripComments("const a = 1; // 仅注释\n/* 块注释 */"))).toBe(false);
  });
});
