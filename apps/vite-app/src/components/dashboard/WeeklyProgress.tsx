import React from "react";
import { useWeeklyProgressQuery } from "@/data/use-weekly-progress-query";
import { zhCN } from "@/i18n/zh-CN";
import {
  readRecordedDurationBucket,
  summarizeRecordedDurationWeek,
} from "@/lib/weekly-recorded-duration";

const t = zhCN.weeklyProgress;
const buttonClass =
  "border-border-soft focus-visible:ring-accent min-h-[44px] min-w-[44px] rounded-lg border px-3 py-2 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

function formatRecordedDuration(recordedDurationMs: number): string {
  if (recordedDurationMs === 0) {
    return t.recordedDurationSecond.replace("{seconds}", "0");
  }
  if (recordedDurationMs < 1_000) {
    return t.recordedDurationUnderSecond;
  }

  const totalSeconds = Math.floor(recordedDurationMs / 1_000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  if (hours > 0) {
    return t.recordedDurationHourMinuteSecond
      .replace("{hours}", String(hours))
      .replace("{minutes}", String(minutes))
      .replace("{seconds}", String(seconds));
  }
  if (minutes > 0) {
    return t.recordedDurationMinuteSecond
      .replace("{minutes}", String(minutes))
      .replace("{seconds}", String(seconds));
  }
  return t.recordedDurationSecond.replace("{seconds}", String(seconds));
}

function unavailableCountText(count: number): string {
  return t.recordedDurationAdditionalUnavailable.replace("{count}", String(count));
}

/** 只读概览。认证、生命周期、请求归属与分页由 data 查询统一管理。 */
export function WeeklyProgress() {
  const view = useWeeklyProgressQuery();
  const weeklyDuration = summarizeRecordedDurationWeek(view.days);
  const selectedDay = view.days.find((day) => day.date === view.selected);
  const selectedDuration = selectedDay ? readRecordedDurationBucket(selectedDay) : null;

  return (
    <section aria-label={t.title} data-testid="weekly-progress" className="min-w-0 space-y-4">
      <h2 className="text-text-default text-lg font-bold">{t.title}</h2>
      <p className="text-text-muted text-sm">{t.description}</p>
      {view.paused && <p role="status">{t.paused}</p>}
      {view.week === "loading" && <p role="status">{t.loading}</p>}
      {view.week === "error" && (
        <div role="alert">
          <p>{t.loadError}</p>
          <button type="button" className={buttonClass} onClick={view.refresh}>
            {t.retry}
          </button>
        </div>
      )}
      {view.days.length === 7 && (
        <div
          aria-label={t.recordedDurationLabel}
          data-testid="weekly-recorded-duration-total"
          className="border-border-soft bg-surface-raised rounded-lg border p-3"
        >
          <p className="text-text-default font-semibold">
            {weeklyDuration.kind === "available" ? (
              <>
                <span>{t.recordedDurationLabel}</span>{" "}
                <strong>{formatRecordedDuration(weeklyDuration.recordedDurationMs)}</strong>
              </>
            ) : weeklyDuration.kind === "unavailable" ? (
              <>
                <span>{t.recordedDurationLabel}</span>{" "}
                <strong>{t.recordedDurationUnavailable}</strong>
              </>
            ) : (
              t.recordedDurationUnknown
            )}
          </p>
          {weeklyDuration.knownUnavailableCount !== null &&
            weeklyDuration.knownUnavailableCount > 0 &&
            weeklyDuration.unavailableCountComplete && (
              <p className="text-text-muted text-sm">
                {unavailableCountText(weeklyDuration.knownUnavailableCount)}
              </p>
            )}
          {weeklyDuration.kind === "unknown" &&
            weeklyDuration.knownUnavailableCount !== null &&
            !weeklyDuration.unavailableCountComplete && (
              <p className="text-text-muted text-sm">
                {t.recordedDurationKnownIncomplete.replace(
                  "{count}",
                  String(weeklyDuration.knownUnavailableCount),
                )}
              </p>
            )}
          <p className="text-text-muted text-sm">{t.recordedDurationExplanation}</p>
        </div>
      )}
      {view.days.length > 0 && (
        <ul aria-label={t.dayList} className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {view.days.map((day) => (
            <li key={day.date} className="min-w-0">
              <button
                type="button"
                aria-pressed={view.selected === day.date}
                aria-label={t.dayLabel
                  .replace("{date}", day.date)
                  .replace("{count}", String(day.completed_sessions))}
                disabled={view.week === "loading"}
                onClick={() => view.select(day.date)}
                className={`${buttonClass} w-full text-sm ${view.selected === day.date ? "bg-accent-soft-bg text-accent" : "text-text-default"}`}
              >
                <time dateTime={day.date} className="block">
                  {day.date.slice(5)}
                </time>
                <span className="block">
                  {t.count.replace("{count}", String(day.completed_sessions))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.selected && view.days.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-text-default font-semibold">
            {t.historyTitle.replace("{date}", view.selected)}
          </h3>
          {selectedDay && selectedDuration && (
            <div className="space-y-1">
              <p className="text-text-default">
                {selectedDuration.kind === "available" ? (
                  <>
                    <span>{t.recordedDurationLabel}</span>{" "}
                    <strong>{formatRecordedDuration(selectedDuration.recordedDurationMs)}</strong>
                  </>
                ) : selectedDuration.kind === "unavailable" ? (
                  <>
                    <span>{t.recordedDurationLabel}</span>{" "}
                    <strong>{t.recordedDurationUnavailable}</strong>
                  </>
                ) : (
                  t.recordedDurationUnknown
                )}
              </p>
              {selectedDuration.kind !== "unknown" && selectedDuration.unavailableCount > 0 && (
                <p className="text-text-muted text-sm">
                  {unavailableCountText(selectedDuration.unavailableCount)}
                </p>
              )}
            </div>
          )}
          {view.history === "loading" && <p role="status">{t.historyLoading}</p>}
          {view.history === "error" && (
            <div role="alert">
              <p>{t.historyError}</p>
              <button type="button" className={buttonClass} onClick={view.historyRetry}>
                {t.retryHistory}
              </button>
            </div>
          )}
          {view.history === "ready" && view.items.length === 0 && <p>{t.empty}</p>}
          <ul aria-label={t.historyList} className="space-y-2">
            {view.items.map((item) => (
              <li
                key={item.id.toLowerCase()}
                data-testid={`weekly-session-${item.id}`}
                className="border-border-soft min-w-0 rounded-lg border p-3"
              >
                <p>
                  {Object.prototype.hasOwnProperty.call(zhCN.activeSessions.modes, item.mode)
                    ? zhCN.activeSessions.modes[item.mode as keyof typeof zhCN.activeSessions.modes]
                    : zhCN.activeSessions.unknownMode}
                </p>
                <time dateTime={item.started_at} className="text-text-muted text-sm">
                  {new Date(item.started_at).toLocaleString("zh-CN")}
                </time>
              </li>
            ))}
          </ul>
          {view.more === "error" && <p role="alert">{t.moreError}</p>}
          {view.cursor && (
            <button
              type="button"
              className={buttonClass}
              disabled={view.more === "loading" || view.paused}
              onClick={view.moreRetry}
            >
              {view.more === "loading"
                ? t.loadingMore
                : view.more === "error"
                  ? t.retryMore
                  : t.loadMore}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
