/**
 * 每日练习进度组件。
 * 显示今日已完成会话列表，以及对话轮次 / 20 目标值的进度条。
 * 遵循严格的本地自然日窗口、双并行非 N+1 读请求与认证代际隔离。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getDailyProgress, listSessions } from "@/lib/api";
import type { SessionListItem } from "@/lib/api";
import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
  type AuthPrincipal,
  type AuthSnapshot,
} from "@/lib/auth";
import { getLocalDayWindow } from "@/lib/localDayWindow";
import { createLifecycleAdapter, type LifecycleAdapter, type WebLifecycleEvent } from "@/platform";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.dashboard;

/** 每日目标轮次 */
const DAILY_GOAL = 20;

interface DailyStats {
  completedSessions: number;
  totalTurns: number;
}

export function DailyProgress() {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthSnapshot());
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [loadMoreError, setLoadMoreError] = useState<boolean>(false);

  const isMountedRef = useRef<boolean>(true);
  const activeRequestIdRef = useRef<number>(0);
  const loadMoreRequestIdRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const loadMoreInFlightRef = useRef<boolean>(false);
  const activePrincipalRef = useRef<AuthPrincipal | null>(snapshot.principal);
  const activeRevisionRef = useRef<number>(getAuthRevision());
  const nextCursorRef = useRef<string | null>(null);
  nextCursorRef.current = nextCursor;
  const windowRef = useRef<{ start: string; end: string } | null>(null);
  const midnightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifecycleAdapterRef = useRef<LifecycleAdapter | null>(null);

  const fetchDailyData = useCallback(() => {
    const currentSnap = getAuthSnapshot();
    const currentRev = getAuthRevision();

    // 认证 loading/anonymous/misconfigured 不发请求、清空数据并清理定时器
    if (currentSnap.state !== "authenticated" || !currentSnap.principal) {
      if (midnightTimerRef.current) {
        clearTimeout(midnightTimerRef.current);
        midnightTimerRef.current = null;
      }
      setStats(null);
      setSessions([]);
      setNextCursor(null);
      nextCursorRef.current = null;
      setLoading(false);
      setError(false);
      setLoadingMore(false);
      setLoadMoreError(false);
      return;
    }

    // 重置并计算当前自然日窗口
    const currentWindow = getLocalDayWindow();
    const prevWindow = windowRef.current;
    const isWindowChanged =
      !prevWindow ||
      prevWindow.start !== currentWindow.start ||
      prevWindow.end !== currentWindow.end;

    // 窗口变更（跨午夜或时区变化）时必须立即清空旧日统计与会话，作废旧在途
    if (isWindowChanged) {
      windowRef.current = { start: currentWindow.start, end: currentWindow.end };

      activeRequestIdRef.current++;
      loadMoreRequestIdRef.current++;
      inFlightRef.current = false;
      loadMoreInFlightRef.current = false;

      setStats(null);
      setSessions([]);
      setNextCursor(null);
      nextCursorRef.current = null;
      setError(false);
      setLoadingMore(false);
      setLoadMoreError(false);
    }

    // 重新安排午夜定时器：无论窗口是否变化、无论 StrictMode 重建或提前触发，
    // 始终安排指向当前窗口 localEndDate 的单一定时器，不进行 24 小时硬夹值
    if (midnightTimerRef.current) {
      clearTimeout(midnightTimerRef.current);
      midnightTimerRef.current = null;
    }
    const msUntilMidnight = currentWindow.localEndDate.getTime() - Date.now();
    if (msUntilMidnight > 0) {
      midnightTimerRef.current = setTimeout(() => {
        midnightTimerRef.current = null;
        if (isMountedRef.current) {
          fetchDailyData();
        }
      }, msUntilMidnight + 100);
    }

    // 独立网络与生命周期门禁：离线或隐藏时不发网络请求，但上方已确保跨日旧数据被清空
    const adapter = lifecycleAdapterRef.current;
    if (adapter) {
      const lifeSnap = adapter.getSnapshot();
      if (lifeSnap.visibility === "hidden" || lifeSnap.online === false) {
        setLoading(false);
        return;
      }
    }

    inFlightRef.current = true;
    const reqId = ++activeRequestIdRef.current;
    loadMoreRequestIdRef.current++;
    loadMoreInFlightRef.current = false;
    const reqPrincipal = currentSnap.principal;
    const reqRevision = currentRev;

    setLoading(true);
    setError(false);
    setLoadingMore(false);
    setLoadMoreError(false);

    // 并行启动聚合与今日列表两个独立只读请求
    Promise.all([
      getDailyProgress(currentWindow.start, currentWindow.end),
      listSessions({
        status: "completed",
        start: currentWindow.start,
        end: currentWindow.end,
      }),
    ])
      .then(([progressRes, sessionRes]) => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          !isMountedRef.current ||
          reqId !== activeRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        setStats({
          completedSessions: progressRes.completed_sessions,
          totalTurns: progressRes.total_turns,
        });

        // 单页内严格去重
        const seenIds = new Set<string>();
        const uniqueItems: SessionListItem[] = [];
        for (const item of sessionRes.items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            uniqueItems.push(item);
          }
        }
        setSessions(uniqueItems);
        setNextCursor(sessionRes.next_cursor);
        setError(false);
      })
      .catch(() => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          !isMountedRef.current ||
          reqId !== activeRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        setError(true);
      })
      .finally(() => {
        if (reqId === activeRequestIdRef.current) {
          inFlightRef.current = false;
        }

        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          isMountedRef.current &&
          reqId === activeRequestIdRef.current &&
          latestSnap.state === "authenticated" &&
          arePrincipalsEqual(latestSnap.principal, reqPrincipal) &&
          latestRev === reqRevision
        ) {
          setLoading(false);
        }
      });
  }, []);

  const handleLoadMore = () => {
    if (inFlightRef.current || loadMoreInFlightRef.current || !nextCursorRef.current) {
      return;
    }

    const currentSnap = getAuthSnapshot();
    const currentRev = getAuthRevision();
    if (currentSnap.state !== "authenticated" || !currentSnap.principal) {
      return;
    }

    const adapter = lifecycleAdapterRef.current;
    if (adapter) {
      const lifeSnap = adapter.getSnapshot();
      if (lifeSnap.visibility === "hidden" || lifeSnap.online === false) {
        return;
      }
    }

    loadMoreInFlightRef.current = true;
    const reqId = ++loadMoreRequestIdRef.current;
    const reqPrincipal = currentSnap.principal;
    const reqRevision = currentRev;
    const cursor = nextCursorRef.current;
    const windowBounds = windowRef.current ?? getLocalDayWindow();

    setLoadingMore(true);
    setLoadMoreError(false);

    listSessions({
      status: "completed",
      start: windowBounds.start,
      end: windowBounds.end,
      cursor,
    })
      .then((data) => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          !isMountedRef.current ||
          reqId !== loadMoreRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        setSessions((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          const newItems: SessionListItem[] = [];
          for (const item of data.items) {
            if (!existingIds.has(item.id)) {
              existingIds.add(item.id);
              newItems.push(item);
            }
          }
          return [...prev, ...newItems];
        });
        setNextCursor(data.next_cursor);
        setLoadMoreError(false);
      })
      .catch(() => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          !isMountedRef.current ||
          reqId !== loadMoreRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        setLoadMoreError(true);
      })
      .finally(() => {
        if (reqId === loadMoreRequestIdRef.current) {
          loadMoreInFlightRef.current = false;
        }

        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          isMountedRef.current &&
          reqId === loadMoreRequestIdRef.current &&
          latestSnap.state === "authenticated" &&
          arePrincipalsEqual(latestSnap.principal, reqPrincipal) &&
          latestRev === reqRevision
        ) {
          setLoadingMore(false);
        }
      });
  };

  useEffect(() => {
    isMountedRef.current = true;
    let isEffectActive = true;

    const adapter = createLifecycleAdapter();
    lifecycleAdapterRef.current = adapter;

    const handleLifecycleEvent = (event: WebLifecycleEvent) => {
      if (!isEffectActive || !isMountedRef.current) return;

      // suspend、hidden 或 offline 时作废当前在途的第一页及更多页请求，释放槽位，并彻底清空游标与分页状态
      if (
        event.type === "suspend" ||
        event.snapshot.visibility === "hidden" ||
        event.snapshot.online === false
      ) {
        if (inFlightRef.current) {
          activeRequestIdRef.current++;
          inFlightRef.current = false;
          setLoading(false);
        }
        loadMoreRequestIdRef.current++;
        loadMoreInFlightRef.current = false;
        setLoadingMore(false);
        setLoadMoreError(false);
        setNextCursor(null);
        nextCursorRef.current = null;
      }

      if (
        (event.type === "resume" &&
          event.snapshot.visibility === "visible" &&
          event.snapshot.online !== false) ||
        (event.type === "connectivity" &&
          event.snapshot.online === true &&
          event.snapshot.visibility !== "hidden")
      ) {
        fetchDailyData();
      }
    };

    const unsubscribeLifecycle = adapter.subscribe(handleLifecycleEvent);

    const handleSnapshotChange = (nextSnap: AuthSnapshot) => {
      if (!isEffectActive || !isMountedRef.current) return;

      const nextRev = getAuthRevision();
      const prevPrincipal = activePrincipalRef.current;
      const nextPrincipal = nextSnap.principal;

      const principalChanged = !arePrincipalsEqual(prevPrincipal, nextPrincipal);
      const revisionChanged = nextRev !== activeRevisionRef.current;

      activePrincipalRef.current = nextPrincipal;
      activeRevisionRef.current = nextRev;
      setSnapshot(nextSnap);

      if (nextSnap.state !== "authenticated" || !nextPrincipal) {
        if (midnightTimerRef.current) {
          clearTimeout(midnightTimerRef.current);
          midnightTimerRef.current = null;
        }
        activeRequestIdRef.current++;
        inFlightRef.current = false;
        loadMoreRequestIdRef.current++;
        loadMoreInFlightRef.current = false;
        setStats(null);
        setSessions([]);
        setNextCursor(null);
        nextCursorRef.current = null;
        setLoading(false);
        setError(false);
        setLoadingMore(false);
        setLoadMoreError(false);
        return;
      }

      if (principalChanged || revisionChanged) {
        activeRequestIdRef.current++;
        inFlightRef.current = false;
        loadMoreRequestIdRef.current++;
        loadMoreInFlightRef.current = false;
        setStats(null);
        setSessions([]);
        setNextCursor(null);
        nextCursorRef.current = null;
        setLoading(false);
        setError(false);
        setLoadingMore(false);
        setLoadMoreError(false);
        fetchDailyData();
      }
    };

    const unsubscribeAuth = subscribeAuthSnapshot(handleSnapshotChange);

    const initialSnap = getAuthSnapshot();
    activePrincipalRef.current = initialSnap.principal;
    activeRevisionRef.current = getAuthRevision();
    setSnapshot(initialSnap);

    if (initialSnap.state === "authenticated" && initialSnap.principal) {
      fetchDailyData();
    } else {
      if (midnightTimerRef.current) {
        clearTimeout(midnightTimerRef.current);
        midnightTimerRef.current = null;
      }
      setStats(null);
      setSessions([]);
      setLoading(false);
      setError(false);
    }

    const reqRef = activeRequestIdRef;
    const loadRef = loadMoreRequestIdRef;

    return () => {
      isEffectActive = false;
      isMountedRef.current = false;
      reqRef.current++;
      inFlightRef.current = false;
      loadRef.current++;
      loadMoreInFlightRef.current = false;
      if (midnightTimerRef.current) {
        clearTimeout(midnightTimerRef.current);
        midnightTimerRef.current = null;
      }
      unsubscribeAuth();
      unsubscribeLifecycle();
      adapter.dispose();
      lifecycleAdapterRef.current = null;
    };
  }, [fetchDailyData]);

  if (snapshot.state !== "authenticated" || !snapshot.principal) {
    return null;
  }

  if (loading) {
    return <div className="text-text-faint py-4 text-center text-sm">{t.loading}</div>;
  }

  if (error || (!stats && !loading)) {
    if (error) {
      return (
        <div
          role="alert"
          className="text-text-faint flex items-center justify-center py-4 text-center text-sm"
        >
          <span>{t.loadError}</span>
          <button
            type="button"
            onClick={fetchDailyData}
            className="text-accent ml-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-xs hover:underline focus-visible:outline-none"
          >
            {zhCN.activeSessions.retry}
          </button>
        </div>
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
