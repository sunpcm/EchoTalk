/**
 * 单条活动记录：模式标签、id、开始时间与“恢复 / 结束”入口。纯展示。
 */

import React, { type ReactNode } from "react";
import type { SessionListItem } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";
import { formatStartedAt, resolveModeLabel } from "./shared";

const t = zhCN.activeSessions;

const ACTION_BASE =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

export interface SessionRowProps {
  session: SessionListItem;
  /** 有确认面板展开时隐藏行内操作按钮。 */
  showActions: boolean;
  actionsDisabled: boolean;
  onResume: () => void;
  onEnd: () => void;
  /** 展开的确认面板（结束或恢复）。 */
  children?: ReactNode;
}

export function SessionRow({
  session,
  showActions,
  actionsDisabled,
  onResume,
  onEnd,
  children,
}: SessionRowProps) {
  return (
    <li
      data-testid={`active-session-item-${session.id}`}
      className="bg-surface-alt flex flex-col gap-2.5 rounded-[12px] p-3 text-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid={`session-mode-${session.id}`}
              className="text-accent bg-accent-soft-bg shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
            >
              {resolveModeLabel(session.mode)}
            </span>
            <span
              data-testid={`session-id-${session.id}`}
              className="text-text-muted font-mono text-xs break-all"
              title={session.id}
            >
              {session.id}
            </span>
          </div>
          <time
            dateTime={session.started_at}
            data-testid={`session-started-at-${session.id}`}
            className="text-text-faint text-xs"
          >
            {formatStartedAt(session.started_at)}
          </time>
        </div>
        {showActions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              tabIndex={0}
              data-testid={`resume-session-button-${session.id}`}
              onClick={onResume}
              disabled={actionsDisabled}
              className={`text-accent hover:text-accent-hover bg-accent-soft-bg hover:bg-accent-soft-bg/80 focus-visible:ring-accent ${ACTION_BASE}`}
            >
              {t.resumeRecord}
            </button>
            <button
              type="button"
              tabIndex={0}
              data-testid={`end-session-button-${session.id}`}
              onClick={onEnd}
              disabled={actionsDisabled}
              className={`text-danger hover:text-danger-hover bg-danger-bg hover:bg-danger-bg/80 focus-visible:ring-danger ${ACTION_BASE}`}
            >
              {t.endRecord}
            </button>
          </div>
        )}
      </div>
      {children}
    </li>
  );
}
