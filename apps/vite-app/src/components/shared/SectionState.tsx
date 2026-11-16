/**
 * Dashboard 区块的加载 / 空 / 错误占位。
 * 区块标题始终保留；加载与空态用 role="status"，错误用 role="alert" 并带 ≥44px 的重试按钮。
 * 纯展示，不发请求。
 */

import React from "react";

const RETRY_BUTTON_CLASS =
  "border-border-default text-text-default hover:bg-surface-alt focus-visible:ring-accent inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none";

export interface SectionStateProps {
  title: string;
  kind: "loading" | "empty" | "error";
  message: string;
  /** 仅 error：提供后渲染重试按钮。 */
  onRetry?: () => void;
  retryLabel?: string;
}

export function SectionState({ title, kind, message, onRetry, retryLabel }: SectionStateProps) {
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-text-default text-lg font-bold">{title}</h2>
      {kind === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-text-default text-sm">{message}</p>
          {onRetry && retryLabel ? (
            <button type="button" onClick={onRetry} className={RETRY_BUTTON_CLASS}>
              {retryLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <p role="status" className="text-text-muted flex items-center gap-2 text-sm">
          {kind === "loading" ? (
            <span
              aria-hidden="true"
              className="border-border-default h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent"
            />
          ) : null}
          {message}
        </p>
      )}
    </section>
  );
}
