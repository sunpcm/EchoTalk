/**
 * Prompt 预设选择 + 自定义编辑组件。
 * 提供三个场景快捷按钮（模拟面试、论文研讨、自由讨论），
 * 点击后将对应 i18n 文本填入 Prompt 输入框，用户可二次编辑。
 */

import React from "react";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.docChat;

const PRESETS = [
  { label: t.presets.interview, prompt: t.presets.interviewPrompt },
  { label: t.presets.paper, prompt: t.presets.paperPrompt },
  { label: t.presets.free, prompt: t.presets.freePrompt },
] as const;

interface PromptBuilderProps {
  value: string;
  onChange: (prompt: string) => void;
}

export function PromptBuilder({ value, onChange }: PromptBuilderProps) {
  return (
    <div className="space-y-3">
      <label className="text-text-default block text-sm font-medium">{t.promptLabel}</label>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.prompt)}
            className="border-accent-soft-border bg-accent-soft-bg text-accent-soft-text hover:bg-accent-soft-bg-strong rounded-full border px-3 py-1 text-xs font-medium transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Prompt textarea */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.promptPlaceholder}
        rows={3}
        className="border-border-default focus:ring-accent-soft-bg w-full resize-y rounded-[14px] border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
      />
    </div>
  );
}
