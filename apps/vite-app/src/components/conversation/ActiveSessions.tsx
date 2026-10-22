/**
 * 活动会话发现组件（CP-02 本地增量）。
 * 仅消费既有 GET /api/sessions/active 接口，在共享 Dashboard 展示当前已认证账号的活跃会话记录。
 * 遵循严格的认证代际隔离、竞态消除及不回显服务端报错策略。
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { listActiveSessions, type SessionListItem } from "@/lib/api";
import {
  getAuthSnapshot,
  getAuthRevision,
  subscribeAuthSnapshot,
  arePrincipalsEqual,
  type AuthPrincipal,
  type AuthSnapshot,
} from "@/lib/auth";
import {
  createWebLifecycleAdapter,
  type WebLifecycleAdapter,
  type WebLifecycleEvent,
} from "@/platform";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.activeSessions;

function resolveModeLabel(mode: string): string {
  if (Object.prototype.hasOwnProperty.call(t.modes, mode)) {
    const label = t.modes[mode as keyof typeof t.modes];
    if (typeof label === "string" && label.length > 0) {
      return label;
    }
  }
  return t.unknownMode;
}

function formatStartedAt(startedAt: string): string {
  try {
    const d = new Date(startedAt);
    if (isNaN(d.getTime())) return startedAt;
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return startedAt;
  }
}

export function ActiveSessions() {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthSnapshot());
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  // 跟踪在途请求与并发门禁
  const activeRequestIdRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const activePrincipalRef = useRef<AuthPrincipal | null>(snapshot.principal);
  const activeRevisionRef = useRef<number>(getAuthRevision());
  const lifecycleAdapterRef = useRef<WebLifecycleAdapter | null>(null);

  const fetchActiveSessions = useCallback(() => {
    const currentSnap = getAuthSnapshot();
    const currentRev = getAuthRevision();

    // 认证 loading/anonymous/misconfigured 不发列表请求、不保留上一账号数据
    if (currentSnap.state !== "authenticated" || !currentSnap.principal) {
      setSessions([]);
      setError(false);
      setLoading(false);
      return;
    }

    // 生命周期门禁：仅在 visibility 不是 hidden 且 online 不是 false 时请求
    // unknown/null 代表未知而不是失败，允许原有发现
    const adapter = lifecycleAdapterRef.current;
    if (adapter) {
      const lifeSnap = adapter.getSnapshot();
      if (lifeSnap.visibility === "hidden" || lifeSnap.online === false) {
        return;
      }
    }

    // 一个已挂载实例同时最多一个有效请求；重试期间禁重复提交
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const reqId = ++activeRequestIdRef.current;
    const reqPrincipal = currentSnap.principal;
    const reqRevision = currentRev;

    setLoading(true);
    setError(false);

    listActiveSessions()
      .then((data) => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        // 门禁检查：组件仍挂载、请求未被后续刷新作废、principal精确匹配、revision一致
        if (
          !isMountedRef.current ||
          reqId !== activeRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        // 后端已按 started_at/id 降序；客户端保留顺序
        setSessions(data);
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

        // 不回显任意服务端错误/正文，仅置错误态
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

  useEffect(() => {
    isMountedRef.current = true;

    // 创建独立Web适配器
    const adapter = createWebLifecycleAdapter();
    lifecycleAdapterRef.current = adapter;

    const handleLifecycleEvent = (event: WebLifecycleEvent) => {
      if (!isMountedRef.current) return;

      // suspend或online=false立即作废当前请求并释放在途槽位、退出loading，保留同一账号已展示列表、不新增错误提示
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
      }

      // resume事件仅visibility为visible且online不是false时刷新
      if (event.type === "resume") {
        if (event.snapshot.visibility === "visible" && event.snapshot.online !== false) {
          fetchActiveSessions();
        }
      } else if (event.type === "connectivity") {
        // connectivity事件仅online为true且visibility不是hidden时刷新
        if (event.snapshot.online === true && event.snapshot.visibility !== "hidden") {
          fetchActiveSessions();
        }
      }
    };

    // 先订阅后读取当前快照
    const unsubscribeLifecycle = adapter.subscribe(handleLifecycleEvent);
    const initialLifeSnap = adapter.getSnapshot();

    const handleSnapshotChange = (nextSnap: AuthSnapshot) => {
      if (!isMountedRef.current) return;

      const nextRev = getAuthRevision();
      const prevPrincipal = activePrincipalRef.current;
      const nextPrincipal = nextSnap.principal;

      const principalChanged = !arePrincipalsEqual(prevPrincipal, nextPrincipal);
      const revisionChanged = nextRev !== activeRevisionRef.current;

      activePrincipalRef.current = nextPrincipal;
      activeRevisionRef.current = nextRev;
      setSnapshot(nextSnap);

      if (nextSnap.state !== "authenticated" || !nextPrincipal) {
        // 退出或未认证：立即作废在途请求、清空数据与状态
        activeRequestIdRef.current++;
        inFlightRef.current = false;
        setSessions([]);
        setError(false);
        setLoading(false);
        return;
      }

      // 若 principal 变更或同 principal 下 revision 递增（例如同账号退出重登）
      if (principalChanged || revisionChanged) {
        activeRequestIdRef.current++;
        inFlightRef.current = false;
        setSessions([]);
        setError(false);
        setLoading(false);
        fetchActiveSessions();
      }
    };

    const unsubscribeAuth = subscribeAuthSnapshot(handleSnapshotChange);

    const initialSnap = getAuthSnapshot();
    activePrincipalRef.current = initialSnap.principal;
    activeRevisionRef.current = getAuthRevision();
    setSnapshot(initialSnap);

    if (initialSnap.state === "authenticated" && initialSnap.principal) {
      if (initialLifeSnap.visibility !== "hidden" && initialLifeSnap.online !== false) {
        fetchActiveSessions();
      } else {
        setLoading(false);
      }
    } else {
      setSessions([]);
      setError(false);
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
      // 卸载时作废在途请求，消除 StrictMode 下的残留阻断
      activeRequestIdRef.current++;
      inFlightRef.current = false;
      unsubscribeAuth();
      unsubscribeLifecycle();
      adapter.dispose();
      lifecycleAdapterRef.current = null;
    };
  }, [fetchActiveSessions]);

  // 未认证状态（loading/anonymous/misconfigured）不渲染活动记录
  if (snapshot.state !== "authenticated" || !snapshot.principal) {
    return null;
  }

  return (
    <section aria-labelledby="active-sessions-title" className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 id="active-sessions-title" className="text-text-default text-lg font-bold">
          {t.title}
        </h2>
        <p className="text-text-muted text-xs">{t.disclaimer}</p>
      </div>

      {loading && sessions.length === 0 && (
        <div className="text-text-faint py-4 text-center text-sm">{t.loading}</div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-danger-bg text-danger-text flex flex-col items-center justify-center gap-2 rounded-lg p-4 text-center text-sm"
        >
          <p className="font-medium">{t.loadError}</p>
          <button
            type="button"
            onClick={fetchActiveSessions}
            disabled={loading}
            className="bg-accent hover:bg-accent-hover rounded-md px-3 py-1 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            {t.retry}
          </button>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <p className="text-text-faint py-2 text-center text-sm">{t.empty}</p>
      )}

      {sessions.length > 0 && (
        <ul className="space-y-2" data-testid="active-sessions-list">
          {sessions.map((session) => {
            const modeLabel = resolveModeLabel(session.mode);
            return (
              <li
                key={session.id}
                data-testid={`active-session-item-${session.id}`}
                className="bg-surface-alt flex items-center justify-between rounded-[12px] px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      data-testid={`session-mode-${session.id}`}
                      className="text-accent bg-accent-soft-bg rounded px-1.5 py-0.5 text-xs font-medium"
                    >
                      {modeLabel}
                    </span>
                    <span
                      data-testid={`session-id-${session.id}`}
                      className="text-text-muted truncate font-mono text-xs"
                      title={session.id}
                    >
                      {session.id}
                    </span>
                  </div>
                </div>
                <time
                  dateTime={session.started_at}
                  data-testid={`session-started-at-${session.id}`}
                  className="text-text-faint ml-2 shrink-0 text-xs"
                >
                  {formatStartedAt(session.started_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
