/**
 * 活动会话列表：首屏查询、分页、单页去重，以及与认证代际绑定的迟到响应丢弃。
 */

import { useCallback, useRef, useState, type RefObject } from "react";
import { listActiveSessions, type SessionListItem } from "@/lib/api";
import { useConversationStore } from "@/store/conversation";
import { isStartingConversationSession } from "@/store/conversationState";
import {
  captureAuthIdentity,
  isLifecycleBlocked,
  isRequestCurrent,
  type ActiveSessionsRuntime,
  type AuthIdentity,
} from "./shared";

export interface ActiveSessionList {
  sessions: SessionListItem[];
  loading: boolean;
  error: boolean;
  queriedIdentity: AuthIdentity | null;
  nextCursor: string | null;
  loadingMore: boolean;
  loadMoreError: boolean;
  fetchActiveSessions: () => void;
  loadMore: () => void;
  /** 目标是否仍在当前已展示列表中。 */
  hasSession: (sessionId: string) => boolean;
  /** 结束确认成功：从列表移除，并阻止旧列表响应把它带回来。 */
  removeEndedSession: (sessionId: string) => void;
  /** 结束/恢复提交前：作废在途的列表与更多页请求。 */
  cancelInFlightRequests: () => void;
  /** 挂起或离线：作废列表请求并收起分页，保留已展示列表、不新增错误。 */
  suspendRequests: () => void;
  /** 认证失效或代际变化：清空全部列表数据与在途请求。 */
  resetForAuthChange: () => void;
  /** 首次挂载时未认证：不保留任何列表数据。 */
  clearForUnauthenticated: () => void;
  /** 首次挂载时处于后台或离线：不发请求，只退出 loading。 */
  stopLoading: () => void;
  /** 卸载：只作废在途请求，不再写状态。 */
  invalidateOnUnmount: () => void;
}

export function useActiveSessionList(
  runtimeRef: RefObject<ActiveSessionsRuntime>,
): ActiveSessionList {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [queriedIdentity, setQueriedIdentity] = useState<AuthIdentity | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [loadMoreError, setLoadMoreError] = useState<boolean>(false);

  const requestIdRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const loadMoreRequestIdRef = useRef<number>(0);
  const loadMoreInFlightRef = useRef<boolean>(false);
  const nextCursorRef = useRef<string | null>(null);
  nextCursorRef.current = nextCursor;
  const endedSessionIdsRef = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<SessionListItem[]>(sessions);
  sessionsRef.current = sessions;

  const fetchActiveSessions = useCallback(() => {
    const runtime = runtimeRef.current;
    // 结束在途或启动/恢复在途暂停列表刷新且不排队
    const isStartingNow = isStartingConversationSession(useConversationStore.getState());
    if (runtime.endInFlight || runtime.resumeInFlight || isStartingNow) {
      return;
    }

    // 认证 loading/anonymous/misconfigured 不发列表请求、不保留上一账号数据
    const identity = captureAuthIdentity();
    if (!identity) {
      setSessions([]);
      setError(false);
      setLoading(false);
      setQueriedIdentity(null);
      return;
    }

    if (isLifecycleBlocked(runtime)) {
      return;
    }

    // 一个已挂载实例同时最多一个有效请求；重试期间禁重复提交
    if (inFlightRef.current) {
      return;
    }

    loadMoreRequestIdRef.current++;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(false);
    setNextCursor(null);

    inFlightRef.current = true;
    const reqId = ++requestIdRef.current;
    const isCurrent = () => isRequestCurrent(runtime, reqId, requestIdRef.current, identity);

    setLoading(true);
    setError(false);

    listActiveSessions()
      .then((data) => {
        if (!isCurrent()) return;

        // 后端已按 started_at/id 降序；客户端保留顺序，单页去重且防旧列表迟到复活已结束记录
        const seenIds = new Set<string>();
        const uniqueItems: SessionListItem[] = [];
        for (const s of data.items) {
          if (!endedSessionIdsRef.current.has(s.id) && !seenIds.has(s.id)) {
            seenIds.add(s.id);
            uniqueItems.push(s);
          }
        }
        setSessions(uniqueItems);
        setNextCursor(data.next_cursor);
        setError(false);
        setQueriedIdentity(identity);
      })
      .catch(() => {
        if (!isCurrent()) return;
        // 不回显任意服务端错误/正文，仅置错误态
        setError(true);
      })
      .finally(() => {
        if (reqId === requestIdRef.current) {
          inFlightRef.current = false;
        }
        if (isCurrent()) {
          setLoading(false);
        }
      });
  }, [runtimeRef]);

  const loadMore = () => {
    const runtime = runtimeRef.current;
    const isStartingNow = isStartingConversationSession(useConversationStore.getState());
    if (
      runtime.endInFlight ||
      runtime.resumeInFlight ||
      isStartingNow ||
      inFlightRef.current ||
      loadMoreInFlightRef.current ||
      !nextCursorRef.current
    ) {
      return;
    }

    const identity = captureAuthIdentity();
    if (!identity) {
      return;
    }
    if (isLifecycleBlocked(runtime)) {
      return;
    }

    loadMoreInFlightRef.current = true;
    const reqId = ++loadMoreRequestIdRef.current;
    const cursor = nextCursorRef.current;
    const isCurrent = () =>
      isRequestCurrent(runtime, reqId, loadMoreRequestIdRef.current, identity);

    setLoadingMore(true);
    setLoadMoreError(false);

    listActiveSessions({ cursor })
      .then((data) => {
        if (!isCurrent()) return;

        setSessions((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          const newUnique: SessionListItem[] = [];
          for (const s of data.items) {
            if (!existingIds.has(s.id) && !endedSessionIdsRef.current.has(s.id)) {
              existingIds.add(s.id);
              newUnique.push(s);
            }
          }
          return [...prev, ...newUnique];
        });
        setNextCursor(data.next_cursor);
        setLoadMoreError(false);
      })
      .catch(() => {
        if (!isCurrent()) return;
        setLoadMoreError(true);
      })
      .finally(() => {
        if (reqId === loadMoreRequestIdRef.current) {
          loadMoreInFlightRef.current = false;
        }
        if (isCurrent()) {
          setLoadingMore(false);
        }
      });
  };

  const hasSession = (sessionId: string) => sessionsRef.current.some((s) => s.id === sessionId);

  const removeEndedSession = (sessionId: string) => {
    endedSessionIdsRef.current.add(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  const cancelInFlightRequests = () => {
    if (inFlightRef.current) {
      requestIdRef.current++;
      inFlightRef.current = false;
      setLoading(false);
    }
    if (loadMoreInFlightRef.current) {
      loadMoreRequestIdRef.current++;
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  };

  const suspendRequests = () => {
    if (inFlightRef.current) {
      requestIdRef.current++;
      inFlightRef.current = false;
      setLoading(false);
    }
    loadMoreRequestIdRef.current++;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(false);
    setNextCursor(null);
    nextCursorRef.current = null;
  };

  const invalidateOnUnmount = () => {
    requestIdRef.current++;
    inFlightRef.current = false;
    loadMoreRequestIdRef.current++;
    loadMoreInFlightRef.current = false;
  };

  const clearForUnauthenticated = () => {
    setSessions([]);
    setError(false);
    setLoading(false);
    setQueriedIdentity(null);
  };

  const resetForAuthChange = () => {
    invalidateOnUnmount();
    endedSessionIdsRef.current.clear();
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(false);
    clearForUnauthenticated();
  };

  const stopLoading = () => setLoading(false);

  return {
    sessions,
    loading,
    error,
    queriedIdentity,
    nextCursor,
    loadingMore,
    loadMoreError,
    fetchActiveSessions,
    loadMore,
    hasSession,
    removeEndedSession,
    cancelInFlightRequests,
    suspendRequests,
    resetForAuthChange,
    clearForUnauthenticated,
    stopLoading,
    invalidateOnUnmount,
  };
}
