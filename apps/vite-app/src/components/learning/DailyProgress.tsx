/**
 * 每日练习进度组件。
 * 显示今日已完成会话列表，以及对话轮次 / 20 目标值的进度条。
 */

import React, { useEffect, useState } from "react";
import { listSessions, getSessionDetail } from "@/lib/api";
import type { SessionListItem } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.dashboard;

/** 每日目标轮次 */
const DAILY_GOAL = 20;

interface DailyStats {
  sessions: SessionListItem[];
  totalTurns: number;
}

export function DailyProgress() {
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const sessions = await listSessions();
        const today = new Date().toISOString().slice(0, 10);
        const todaySessions = sessions.filter(
          (s) => s.status === "completed" && s.started_at.startsWith(today),
        );

        // 获取每个会话的详情以统计对话轮次
        const details = await Promise.all(todaySessions.map((s) => getSessionDetail(s.id)));
        const totalTurns = details.reduce((sum, s) => sum + s.transcripts.length, 0);

        if (!cancelled) {
          setStats({ sessions: todaySessions, totalTurns });
        }
      } catch {
        // 静默失败，不阻塞主流程
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchStats();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="text-text-faint py-4 text-center text-sm">{t.loading}</div>;
  }

  if (!stats) return null;

  const { sessions, totalTurns } = stats;
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
      <div className="bg-surface-alt mb-4 h-3 w-full overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all ${goalReached ? "bg-success" : "bg-[linear-gradient(90deg,var(--accent-grad-1),var(--accent))]"}`}
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
        </div>
      ) : (
        <p className="text-text-faint text-sm">{t.noSessions}</p>
      )}
    </section>
  );
}
