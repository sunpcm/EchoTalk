/**
 * 文档上传/粘贴区域组件。
 * 支持点击选择 .txt/.md/.markdown 文件，在浏览器端读取为文本；
 * 同时提供 textarea 供用户直接粘贴或编辑内容。
 * 实时统计字符数，超过 50,000 字符时显示红色警告。
 */

import React, { useLayoutEffect, useRef, useState } from "react";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;
const MAX_CHARS = 50_000;
const MAX_FILE_BYTES = 200_003;
const ALLOWED_EXTENSIONS = [".txt", ".md", ".markdown"];

function hasValidExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface DocUploadCardProps {
  value: string;
  onChange: (text: string) => void;
}

export function DocUploadCard({ value, onChange }: DocUploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeReaderRef = useRef<FileReader | null>(null);
  const readTokenRef = useRef(0);
  const lastValueRef = useRef(value);

  const [importError, setImportError] = useState<string | null>(null);

  const charCount = value.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isNearLimit = charCount >= 45_000 && !isOverLimit;

  const invalidateCurrentRead = () => {
    readTokenRef.current += 1;
    if (activeReaderRef.current) {
      try {
        const reader = activeReaderRef.current;
        activeReaderRef.current = null;
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        reader.abort();
      } catch {
        // 异常不逃出
      }
    }
  };

  // 父 value 实质变化使旧读取失效；普通未改 value 的父重渲染不误取消
  // 使用 useLayoutEffect 确保在 commit 阶段同步失效，消除提交与 passive effect 之间的间隙
  useLayoutEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      invalidateCurrentRead();
    }
  }, [value]);

  // 组件卸载 / StrictMode 清理及 input cancel 事件监听
  useLayoutEffect(() => {
    const input = fileInputRef.current;
    const onCancel = () => {
      invalidateCurrentRead();
    };
    if (input) {
      input.addEventListener("cancel", onCancel);
    }
    return () => {
      invalidateCurrentRead();
      if (input) {
        input.removeEventListener("cancel", onCancel);
      }
    };
  }, []);

  const openFilePicker = () => {
    invalidateCurrentRead();
    if (fileInputRef.current) {
      try {
        fileInputRef.current.value = "";
      } catch {
        // ignore
      }
      fileInputRef.current.click();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    // 重置 input.value 确保同文件可重选
    try {
      e.target.value = "";
    } catch {
      // ignore
    }

    // 取消选择保留草稿，使旧读取失效，不产生新失败或外部写
    if (!file) {
      invalidateCurrentRead();
      return;
    }

    // 新选择使旧读取失效
    invalidateCurrentRead();
    const token = ++readTokenRef.current;

    // 格式检查：不依赖 accept 或 MIME，只接受 .txt/.md/.markdown
    if (!hasValidExtension(file.name)) {
      setImportError(t.importErrorUnsupportedType);
      return;
    }

    // 保守字节界限：50,000 * 4 + 3 BOM
    if (file.size > MAX_FILE_BYTES) {
      setImportError(t.importErrorOverLimit);
      return;
    }

    let reader: FileReader;
    try {
      reader = new FileReader();
      activeReaderRef.current = reader;
    } catch {
      setImportError(t.importErrorReadFailed);
      return;
    }

    reader.onload = () => {
      if (token !== readTokenRef.current) return;
      activeReaderRef.current = null;

      try {
        const result = reader.result;
        const isArrayBuffer =
          result instanceof ArrayBuffer ||
          Object.prototype.toString.call(result) === "[object ArrayBuffer]";
        if (!isArrayBuffer) {
          setImportError(t.importErrorReadFailed);
          return;
        }
        const buffer = result as ArrayBuffer;

        let decodedText: string;
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          decodedText = decoder.decode(buffer);
        } catch {
          setImportError(t.importErrorInvalidEncoding);
          return;
        }

        // TextDecoder 默认 (ignoreBOM: false) 已自动去除首个 transport BOM；正文中的 FEFF 予以保留
        if (decodedText.length === 0) {
          setImportError(t.importErrorEmpty);
          return;
        }

        if (decodedText.length > MAX_CHARS) {
          setImportError(t.importErrorOverLimit);
          return;
        }

        lastValueRef.current = decodedText;
        setImportError(null);
        onChange(decodedText);
      } catch {
        setImportError(t.importErrorReadFailed);
      }
    };

    reader.onerror = () => {
      if (token !== readTokenRef.current) return;
      activeReaderRef.current = null;
      setImportError(t.importErrorReadFailed);
    };

    reader.onabort = () => {
      if (token !== readTokenRef.current) return;
      activeReaderRef.current = null;
    };

    try {
      reader.readAsArrayBuffer(file);
    } catch {
      if (token === readTokenRef.current) {
        activeReaderRef.current = null;
        setImportError(t.importErrorReadFailed);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    invalidateCurrentRead();
    setImportError(null);
    lastValueRef.current = e.target.value;
    onChange(e.target.value);
  };

  return (
    <div className="space-y-3">
      <label htmlFor="doc-upload-textarea" className="text-text-default block text-sm font-medium">
        {t.uploadHint}
      </label>

      {/* File upload area */}
      <div
        role="button"
        tabIndex={0}
        aria-label="点击选择 .txt 或 .md 文件"
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        className="border-border-default hover:border-accent-soft-border hover:bg-accent-soft-bg focus-visible:ring-accent-soft-border flex cursor-pointer items-center justify-center rounded-[16px] border-2 border-dashed px-4 py-6 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <div className="text-center">
          <svg
            aria-hidden="true"
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
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Import error message */}
      {importError && (
        <p
          role="alert"
          aria-live="polite"
          className="bg-danger-bg text-danger-text rounded-md px-3 py-2 text-sm"
        >
          {importError}
        </p>
      )}

      {/* Editable textarea */}
      <textarea
        id="doc-upload-textarea"
        aria-describedby="doc-upload-char-count"
        value={value}
        onChange={handleTextareaChange}
        placeholder="或在此直接粘贴文档内容..."
        rows={10}
        className={`w-full resize-y rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none ${
          isOverLimit
            ? "border-danger focus:ring-danger-border"
            : isNearLimit
              ? "border-warning focus:ring-warning"
              : "border-border-default focus:ring-accent-soft-bg"
        }`}
      />

      {/* Character count */}
      <div
        id="doc-upload-char-count"
        aria-live="polite"
        className="flex items-center justify-end text-xs"
      >
        <span
          className={
            isOverLimit
              ? "text-danger font-medium"
              : isNearLimit
                ? "text-warning font-medium"
                : "text-text-faint"
          }
        >
          {charCount.toLocaleString()} / {t.charMax} {t.charCount}
        </span>
      </div>

      {/* Over limit warning */}
      {isOverLimit && (
        <p
          role="alert"
          aria-live="polite"
          className="bg-danger-bg text-danger-text rounded-md px-3 py-2 text-sm"
        >
          {t.charOverLimit}
        </p>
      )}
    </div>
  );
}
