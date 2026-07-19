/**
 * 文档上传/粘贴区域组件。
 * 支持点击选择 .txt/.md 文件，使用 FileReader 在浏览器端读取为文本；
 * 同时提供 textarea 供用户直接粘贴或编辑内容。
 * 实时统计字符数，超过 50,000 字符时显示红色警告。
 */

import React, { useRef } from "react";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;
const MAX_CHARS = 50_000;

interface DocUploadCardProps {
  value: string;
  onChange: (text: string) => void;
}

export function DocUploadCard({ value, onChange }: DocUploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const charCount = value.length;
  const isOverLimit = charCount > MAX_CHARS;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChange(reader.result);
      }
    };
    reader.readAsText(file);

    // Reset input so selecting the same file again triggers onChange
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <label className="text-text-default block text-sm font-medium">{t.uploadHint}</label>

      {/* File upload area */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-border-default hover:border-accent-soft-border hover:bg-accent-soft-bg flex cursor-pointer items-center justify-center rounded-[16px] border-2 border-dashed px-4 py-6 transition-colors"
      >
        <div className="text-center">
          <svg
            className="text-text-faint mx-auto mb-2 h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
          <p className="text-text-muted text-sm">
            点击选择 <span className="text-accent font-medium">.txt</span> /{" "}
            <span className="text-accent font-medium">.md</span> 文件
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Editable textarea */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="或在此直接粘贴文档内容..."
        rows={10}
        className={`w-full resize-y rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none ${
          isOverLimit
            ? "border-danger focus:ring-danger-border"
            : "border-border-default focus:ring-accent-soft-bg"
        }`}
      />

      {/* Character count */}
      <div className="flex items-center justify-end text-xs">
        <span className={isOverLimit ? "text-danger font-medium" : "text-text-faint"}>
          {charCount.toLocaleString()} / {t.charMax} {t.charCount}
        </span>
      </div>

      {/* Over limit warning */}
      {isOverLimit && (
        <p className="bg-danger-bg text-danger-text rounded-md px-3 py-2 text-sm">
          {t.charOverLimit}
        </p>
      )}
    </div>
  );
}
