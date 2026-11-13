/**
 * 结束/恢复共用的确认面板：目标 id、说明、可选错误与取消/确认按钮。纯展示。
 */

import React from "react";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.activeSessions;

const BUTTON_BASE =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

const TONE_CLASS = {
  danger: "bg-danger hover:bg-danger-hover focus-visible:ring-danger text-danger-contrast",
  accent: "bg-accent hover:bg-accent-hover focus-visible:ring-accent text-accent-contrast",
} as const;

export interface ConfirmPanelProps {
  sessionId: string;
  tone: keyof typeof TONE_CLASS;
  disclaimer: string;
  /** 为 null 时不显示错误；显示错误时确认按钮切换为重试。 */
  errorMessage: string | null;
  /** 仍处于失败态（决定按钮是“确认”还是“重试”），即使错误文案被隐藏。 */
  hasFailed: boolean;
  busy: boolean;
  labels: { cancel: string; confirm: string; retry: string; busy: string };
  testIds: {
    panel: string;
    targetId: string;
    error: string;
    cancel: string;
    confirm: string;
    retry: string;
  };
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmPanel({
  sessionId,
  tone,
  disclaimer,
  errorMessage,
  hasFailed,
  busy,
  labels,
  testIds,
  onCancel,
  onConfirm,
}: ConfirmPanelProps) {
  return (
    <div
      data-testid={testIds.panel}
      className="bg-surface-alt border-border-soft mt-1 flex flex-col gap-2.5 rounded-lg border p-3 text-xs"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-text-muted shrink-0 font-medium">{t.targetIdLabel}</span>
          <span
            data-testid={testIds.targetId}
            className="text-text-default font-mono font-semibold break-all"
          >
            {sessionId}
          </span>
        </div>
        <p className="text-text-muted leading-relaxed break-words">{disclaimer}</p>
      </div>

      {errorMessage !== null && (
        <div
          role="alert"
          data-testid={testIds.error}
          className="text-danger-text bg-danger-bg rounded px-2.5 py-1.5 leading-relaxed font-medium break-words"
        >
          {errorMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-start gap-2 pt-1 sm:justify-end">
        <button
          type="button"
          tabIndex={0}
          data-testid={testIds.cancel}
          onClick={onCancel}
          disabled={busy}
          className={`text-text-muted hover:text-text-default border-border-soft focus-visible:ring-accent border ${BUTTON_BASE}`}
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          tabIndex={0}
          data-testid={hasFailed ? testIds.retry : testIds.confirm}
          onClick={onConfirm}
          disabled={busy}
          className={`${TONE_CLASS[tone]} font-medium ${BUTTON_BASE}`}
        >
          {busy ? labels.busy : hasFailed ? labels.retry : labels.confirm}
        </button>
      </div>
    </div>
  );
}
