/**
 * DocChat 设置页面容器。
 * 组合 DocUploadCard 和 PromptBuilder，管理 raw_text / prompt 局部状态。
 * 底部「开始对话」按钮：字符数为 0 或超过 50,000 时 disabled。
 * 点击后调用 POST /api/sessions 创建 doc_chat 会话，进入 LiveKit 语音房间。
 */

import React, { useState } from "react";
import { useConversationStore } from "@/store/conversation";
import { DocUploadCard } from "./DocUploadCard";
import { PromptBuilder } from "./PromptBuilder";
import { zhCN } from "@/i18n/zh-CN";
import type { DocContext } from "@/lib/api";

const t = zhCN.docChat;
const MAX_CHARS = 50_000;

export function DocChatSetup() {
  const [rawText, setRawText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startSession = useConversationStore((s) => s.startSession);
  const connectionState = useConversationStore((s) => s.connectionState);
  const goHome = useConversationStore((s) => s.goHome);

  const charCount = rawText.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isEmpty = charCount === 0;
  const isDisabled = isEmpty || isOverLimit;
  const isLoading = connectionState === "checking_health" || connectionState === "connecting";

  const handleStart = async () => {
    if (isDisabled || isLoading) return;

    setError(null);

    const docContext: DocContext = {
      content_type: "text/markdown",
      raw_text: rawText,
      prompt: prompt || t.presets.freePrompt,
    };

    try {
      await startSession("doc_chat", docContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建会话失败");
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="relative text-center">
        <button
          onClick={goHome}
          className="absolute top-0 left-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={t.goBack}
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <h1 className="mb-1 text-3xl font-bold text-indigo-600">{t.title}</h1>
        <p className="text-gray-500">{t.subtitle}</p>
      </div>

      {/* Error feedback */}
      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-center text-sm text-red-600">{error}</div>
      )}

      {/* Document upload */}
      <DocUploadCard value={rawText} onChange={setRawText} />

      {/* Prompt builder */}
      <PromptBuilder value={prompt} onChange={setPrompt} />

      {/* Start button */}
      <button
        onClick={handleStart}
        disabled={isDisabled || isLoading}
        className="btn-primary flex w-full items-center justify-center py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <svg
              className="mr-2 h-4 w-4 animate-spin text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {zhCN.conversation.connecting}
          </>
        ) : (
          t.startButton
        )}
      </button>
    </div>
  );
}
