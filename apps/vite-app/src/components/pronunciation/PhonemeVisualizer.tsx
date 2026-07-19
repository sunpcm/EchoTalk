/**
 * 音素可视化组件。
 * 根据 phoneme_alignment 数组渲染带颜色编码的音素序列，支持 Hover 显示错误详情。
 */

import React from "react";
import type { PhonemeAlignmentItem } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.assessment;

interface PhonemeVisualizerProps {
  alignment: PhonemeAlignmentItem[];
}

/** 获取音素类型对应的 Tailwind 样式 */
function getColorClasses(type: PhonemeAlignmentItem["type"]): string {
  switch (type) {
    case "correct":
      return "bg-success-bg text-success-text border-success-border";
    case "substitution":
      return "bg-danger-bg text-danger-text border-danger-border";
    case "deletion":
      return "bg-danger-bg text-danger-text border-dashed border-danger-border";
    case "insertion":
      return "bg-warning-bg text-warning border-warning-border";
  }
}

/** 获取 Hover 提示文本 */
function getTooltipText(item: PhonemeAlignmentItem): string {
  switch (item.type) {
    case "correct":
      return t.tooltipCorrect;
    case "substitution":
      return t.tooltipSubstitution
        .replace("{expected}", item.expected ?? "")
        .replace("{actual}", item.actual ?? "");
    case "deletion":
      return t.tooltipDeletion.replace("{expected}", item.expected ?? "");
    case "insertion":
      return t.tooltipInsertion.replace("{actual}", item.actual ?? "");
  }
}

function PhonemeBlock({ item }: { item: PhonemeAlignmentItem }) {
  const colorClasses = getColorClasses(item.type);
  const tooltipText = getTooltipText(item);

  return (
    <div className="group relative inline-block">
      <span
        className={`inline-block rounded border px-2 py-1 font-mono text-xs font-medium ${colorClasses}`}
      >
        {item.phoneme}
      </span>
      <span className="bg-text-default text-bg pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">
        {tooltipText}
      </span>
    </div>
  );
}

export function PhonemeVisualizer({ alignment }: PhonemeVisualizerProps) {
  if (alignment.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {alignment.map((item, idx) => (
        <PhonemeBlock key={idx} item={item} />
      ))}
    </div>
  );
}
