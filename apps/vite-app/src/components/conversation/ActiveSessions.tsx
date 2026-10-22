/**
 * 活动会话发现组件（CP-02 本地增量）。
 * 仅消费既有 GET /api/sessions/active 接口，在共享 Dashboard 展示当前已认证账号的活跃会话记录。
 * 遵循严格的认证代际隔离、竞态消除及不回显服务端报错策略。
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { listActiveSessions, endSession, type SessionListItem } from "@/lib/api";
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

interface ConfirmIntent {
  sessionId: string;
  principal: AuthPrincipal;
  revision: number;
}

export function ActiveSessions() {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthSnapshot());
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  // 结束活动记录操作状态
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState<boolean>(false);
  const [endError, setEndError] = useState<boolean>(false);

  // 跟踪在途请求与并发门禁
  const activeRequestIdRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const endRequestIdRef = useRef<number>(0);
  const endInFlightRef = useRef<boolean>(false);
  const activeEndingSessionIdRef = useRef<string | null>(null);
  const endedSessionIdsRef = useRef<Set<string>>(new Set());
  const confirmIntentRef = useRef<ConfirmIntent | null>(null);
  const sessionsRef = useRef<SessionListItem[]>(sessions);
  sessionsRef.current = sessions;

  const isMountedRef = useRef<boolean>(true);
  const activePrincipalRef = useRef<AuthPrincipal | null>(snapshot.principal);
  const activeRevisionRef = useRef<number>(getAuthRevision());
  const lifecycleAdapterRef = useRef<WebLifecycleAdapter | null>(null);

  const fetchActiveSessions = useCallback(() => {
    // 结束在途暂停列表刷新且不排队
    if (endInFlightRef.current) {
      return;
    }

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

        // 后端已按 started_at/id 降序；客户端保留顺序，且防旧列表迟到复活已结束记录
        const filtered = data.filter((s) => !endedSessionIdsRef.current.has(s.id));
        setSessions(filtered);
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

  const handleStartConfirm = (sessionId: string) => {
    // 结束在途时禁重复或替换在途目标
    if (endInFlightRef.current) {
      return;
    }
    const currentSnap = getAuthSnapshot();
    const currentRev = getAuthRevision();
    if (currentSnap.state !== "authenticated" || !currentSnap.principal) {
      return;
    }
    // 绑定选择时的认证 principal 与 revision，防止旧意图被后续新认证代际误用
    confirmIntentRef.current = {
      sessionId,
      principal: currentSnap.principal,
      revision: currentRev,
    };
    setConfirmingSessionId(sessionId);
    setEndError(false);
  };

  const handleCancelConfirm = () => {
    if (endInFlightRef.current) {
      return;
    }
    confirmIntentRef.current = null;
    setConfirmingSessionId(null);
    setEndError(false);
  };

  const handleConfirmEnd = (targetSessionId: string) => {
    // 1. 在途禁重复提交
    if (endInFlightRef.current) {
      return;
    }

    // 2. 校验确认意图是否存在且目标匹配
    const intent = confirmIntentRef.current;
    if (!intent || intent.sessionId !== targetSessionId) {
      return;
    }

    // 3. 重新校验当前认证 principal/revision 必须与确认意图发起时的代际严格一致
    const currentSnap = getAuthSnapshot();
    const currentRev = getAuthRevision();
    if (
      currentSnap.state !== "authenticated" ||
      !currentSnap.principal ||
      !arePrincipalsEqual(currentSnap.principal, intent.principal) ||
      currentRev !== intent.revision
    ) {
      return;
    }

    // 4. 校验目标仍属于当前列表
    const existsInList = sessionsRef.current.some((s) => s.id === targetSessionId);
    if (!existsInList) {
      return;
    }

    // 5. 前台/在线提示门禁：不是 hidden 且不是 offline 才允许发送，unknown/null 沿用未知语义
    const adapter = lifecycleAdapterRef.current;
    if (adapter) {
      const lifeSnap = adapter.getSnapshot();
      if (lifeSnap.visibility === "hidden" || lifeSnap.online === false) {
        return;
      }
    }

    // 6. 结束前作废当前列表请求
    if (inFlightRef.current) {
      activeRequestIdRef.current++;
      inFlightRef.current = false;
      setLoading(false);
    }

    // 7. 标记结束请求在途并推进
    endInFlightRef.current = true;
    const reqId = ++endRequestIdRef.current;
    activeEndingSessionIdRef.current = targetSessionId;
    const reqPrincipal = intent.principal;
    const reqRevision = intent.revision;

    setIsEnding(true);
    setEndError(false);

    endSession(targetSessionId)
      .then((session) => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          !isMountedRef.current ||
          reqId !== endRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        // 仅收到 id 与目标匹配且 status=completed 的 Session 响应才确认成功
        if (session && session.id === targetSessionId && session.status === "completed") {
          endedSessionIdsRef.current.add(targetSessionId);
          setSessions((prev) => prev.filter((s) => s.id !== targetSessionId));
          confirmIntentRef.current = null;
          setConfirmingSessionId(null);
          setEndError(false);
        } else {
          setEndError(true);
        }
      })
      .catch(() => {
        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          !isMountedRef.current ||
          reqId !== endRequestIdRef.current ||
          latestSnap.state !== "authenticated" ||
          !arePrincipalsEqual(latestSnap.principal, reqPrincipal) ||
          latestRev !== reqRevision
        ) {
          return;
        }

        // 失败保留目标和安全本地化错误，不回显服务端异常/正文
        setEndError(true);
      })
      .finally(() => {
        if (reqId === endRequestIdRef.current) {
          endInFlightRef.current = false;
          activeEndingSessionIdRef.current = null;
        }

        const latestSnap = getAuthSnapshot();
        const latestRev = getAuthRevision();

        if (
          isMountedRef.current &&
          reqId === endRequestIdRef.current &&
          latestSnap.state === "authenticated" &&
          arePrincipalsEqual(latestSnap.principal, reqPrincipal) &&
          latestRev === reqRevision
        ) {
          setIsEnding(false);
        }
      });
  };

  useEffect(() => {
    isMountedRef.current = true;

    // 创建独立Web适配器
    const adapter = createWebLifecycleAdapter();
    lifecycleAdapterRef.current = adapter;

    const handleLifecycleEvent = (event: WebLifecycleEvent) => {
      if (!isMountedRef.current) return;

      // suspend或online=false立即作废当前列表请求并释放在途槽位、退出loading，保留同一账号已展示列表、不新增错误提示
      // 契约明确：“结束槽位不能被离线/挂起当列表请求释放；不因suspend/offline释放结束槽位或自动重发已发送POST”
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

      // 结束在途暂停列表刷新且不排队
      if (endInFlightRef.current) {
        return;
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
        // 认证失效/退出：立即清除确认和结束错误、作废旧操作及列表请求
        activeRequestIdRef.current++;
        inFlightRef.current = false;
        endRequestIdRef.current++;
        endInFlightRef.current = false;
        activeEndingSessionIdRef.current = null;
        endedSessionIdsRef.current.clear();
        confirmIntentRef.current = null;
        setConfirmingSessionId(null);
        setIsEnding(false);
        setEndError(false);
        setSessions([]);
        setError(false);
        setLoading(false);
        return;
      }

      // 若 principal 变更或同 principal 下 revision 递增（例如同账号退出重登）
      if (principalChanged || revisionChanged) {
        activeRequestIdRef.current++;
        inFlightRef.current = false;
        endRequestIdRef.current++;
        endInFlightRef.current = false;
        activeEndingSessionIdRef.current = null;
        endedSessionIdsRef.current.clear();
        confirmIntentRef.current = null;
        setConfirmingSessionId(null);
        setIsEnding(false);
        setEndError(false);
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
      // 卸载时作废在途请求与操作，消除 StrictMode 下的残留阻断
      activeRequestIdRef.current++;
      inFlightRef.current = false;
      endRequestIdRef.current++;
      endInFlightRef.current = false;
      activeEndingSessionIdRef.current = null;
      confirmIntentRef.current = null;
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
            const isConfirming = confirmingSessionId === session.id;

            return (
              <li
                key={session.id}
                data-testid={`active-session-item-${session.id}`}
                className="bg-surface-alt flex flex-col gap-2 rounded-[12px] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
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
                  <div className="flex items-center gap-2">
                    <time
                      dateTime={session.started_at}
                      data-testid={`session-started-at-${session.id}`}
                      className="text-text-faint ml-2 shrink-0 text-xs"
                    >
                      {formatStartedAt(session.started_at)}
                    </time>
                    {!isConfirming && (
                      <button
                        type="button"
                        data-testid={`end-session-button-${session.id}`}
                        onClick={() => handleStartConfirm(session.id)}
                        disabled={isEnding}
                        className="text-danger hover:text-danger-hover rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {t.endRecord}
                      </button>
                    )}
                  </div>
                </div>

                {isConfirming && (
                  <div
                    data-testid={`end-confirm-panel-${session.id}`}
                    className="bg-surface-subtle border-border-subtle mt-1 flex flex-col gap-2 rounded-lg border p-2.5 text-xs"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-muted font-medium">{t.targetIdLabel}</span>
                        <span
                          data-testid={`confirm-session-id-${session.id}`}
                          className="text-text-default font-mono font-semibold"
                        >
                          {session.id}
                        </span>
                      </div>
                      <p className="text-text-muted">{t.endConfirmDisclaimer}</p>
                    </div>

                    {endError && (
                      <div
                        role="alert"
                        data-testid={`end-error-${session.id}`}
                        className="text-danger-text bg-danger-bg rounded px-2 py-1 font-medium"
                      >
                        {t.endError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        data-testid={`cancel-end-button-${session.id}`}
                        onClick={handleCancelConfirm}
                        disabled={isEnding}
                        className="text-text-muted hover:text-text-default rounded px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
                      >
                        {t.cancelEnd}
                      </button>
                      {endError ? (
                        <button
                          type="button"
                          data-testid={`retry-end-button-${session.id}`}
                          onClick={() => handleConfirmEnd(session.id)}
                          disabled={isEnding}
                          className="bg-danger hover:bg-danger-hover rounded px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50"
                        >
                          {isEnding ? t.ending : t.retryEnd}
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid={`confirm-end-button-${session.id}`}
                          onClick={() => handleConfirmEnd(session.id)}
                          disabled={isEnding}
                          className="bg-danger hover:bg-danger-hover rounded px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50"
                        >
                          {isEnding ? t.ending : t.confirmEnd}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
