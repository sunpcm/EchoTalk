/**
 * 每日练习进度组件。
 * 显示今日已完成会话列表，以及对话轮次 / 20 目标值的进度条。
 * 查询状态由 data 层维护，组件只负责渲染和用户事件转发。
 */

import React from "react";
import { useDailyProgressQuery } from "@/data/use-daily-progress-query";
import { zhCN } from "@/i18n/zh-CN";
import { SectionState } from "./SectionState";

const t = zhCN.dashboard;

/** 每日目标轮次 */
const DAILY_GOAL = 20;

export function DailyProgress() {
  const {
    snapshot,
    stats,
    sessions,
    nextCursor,
    loading,
    error,
    loadingMore,
    loadMoreError,
    refresh: fetchDailyData,
    loadMore: handleLoadMore,
  } = useDailyProgressQuery();

  if (snapshot.state !== "authenticated" || !snapshot.principal) {
    return null;
  }

  if (loading) {
    return <SectionState title={t.dailyProgressTitle} kind="loading" message={t.loading} />;
  }

  if (error || (!stats && !loading)) {
    if (error) {
      return (
        <SectionState
          title={t.dailyProgressTitle}
          kind="error"
          message={t.loadError}
          onRetry={fetchDailyData}
          retryLabel={t.retry}
        />
      );
    }
    return null;
  }

  if (!stats) return null;

  const { totalTurns } = stats;
  const progress = Math.min(totalTurns / DAILY_GOAL, 1);
  const pct = Math.round(progress * 100);
  const goalReached = totalTurns >= DAILY_GOAL;

  return (
    <section>
      <h2 className="text-text-default mb-4 text-lg font-bold">{t.dailyProgressTitle}</h2>

      {/* Progress bar */}
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-text-muted">
          {t.turnsGoal}: {totalTurns} / {DAILY_GOAL}
        </span>
        {goalReached && <span className="text-success font-semibold">{t.goalReached}</span>}
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.min(totalTurns, DAILY_GOAL)}
        aria-valuemin={0}
        aria-valuemax={DAILY_GOAL}
        aria-valuetext={`${totalTurns} / ${DAILY_GOAL}`}
        aria-label={t.turnsGoal}
        className="bg-surface-alt mb-4 h-3 w-full overflow-hidden rounded-full"
      >
        <div
          className={`h-full rounded-full transition-all ${
            goalReached
              ? "bg-success"
              : "bg-[linear-gradient(90deg,var(--accent-grad-1),var(--accent))]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Session list */}
      {sessions.length > 0 ? (
        <div>
          <h3 className="text-text-muted mb-2 text-sm font-medium">{t.sessionsTitle}</h3>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                data-testid={`daily-session-item-${s.id}`}
                className="bg-surface-alt flex items-center justify-between rounded-[12px] px-3 py-2 text-sm"
              >
                <span className="text-text-default">{s.mode}</span>
                <span className="text-text-faint">
                  {new Date(s.started_at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>

          {nextCursor !== null && (
            <div className="mt-3 flex flex-col items-center gap-2">
              {loadMoreError && (
                <div
                  role="alert"
                  data-testid="load-more-daily-error"
                  className="text-danger-text bg-danger-bg rounded px-2.5 py-1.5 text-xs font-medium"
                >
                  {t.loadMoreError}
                </div>
              )}
              <button
                type="button"
                tabIndex={0}
                data-testid="load-more-daily-button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-text-muted hover:text-text-default border-border-soft focus-visible:ring-accent inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-4 py-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
              >
                {loadingMore ? t.loadingMore : loadMoreError ? t.retryLoadMore : t.loadMore}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-text-faint text-sm">{t.noSessions}</p>
      )}
    </section>
  );
}
