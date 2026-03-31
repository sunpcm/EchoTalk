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
      <label className="block text-sm font-medium text-gray-700">{t.uploadHint}</label>

      {/* File upload area */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 transition-colors hover:border-indigo-400 hover:bg-indigo-50/30"
      >
        <div className="text-center">
          <svg
            className="mx-auto mb-2 h-8 w-8 text-gray-400"
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
          <p className="text-sm text-gray-500">
            点击选择 <span className="font-medium text-indigo-600">.txt</span> /{" "}
            <span className="font-medium text-indigo-600">.md</span> 文件
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
            ? "border-red-400 focus:ring-red-200"
            : "border-gray-300 focus:ring-indigo-200"
        }`}
      />

      {/* Character count */}
      <div className="flex items-center justify-end text-xs">
        <span className={isOverLimit ? "font-medium text-red-600" : "text-gray-400"}>
          {charCount.toLocaleString()} / {t.charMax} {t.charCount}
        </span>
      </div>

      {/* Over limit warning */}
      {isOverLimit && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{t.charOverLimit}</p>
      )}
    </div>
  );
}
