import { useEffect, useRef, useState } from "react";
import { listActiveSessions, type SessionListItem } from "@/lib/api";
import { getAuthRevision, getAuthSnapshot, type AuthPrincipal } from "@/lib/auth";
import type { WebLifecycleSnapshot } from "@/platform";
import {
  createEmptyQueryState,
  createReadQuery,
  type Fetcher,
  type QueryProfile,
  type QueryState,
  type ReadQuery,
} from "./readonly-query";

export interface ActiveSessionsIdentity {
  principal: AuthPrincipal;
  revision: number;
}

export interface UseActiveSessionsQueryOptions {
  getLifecycle: () => WebLifecycleSnapshot;
  isWriteBlocked: () => boolean;
}

export interface ActiveSessionsQueryView {
  sessions: SessionListItem[];
  loading: boolean;
  error: boolean;
  queriedIdentity: ActiveSessionsIdentity | null;
  nextCursor: string | null;
  loadingMore: boolean;
  loadMoreError: boolean;
  fetchActiveSessions: () => void;
  loadMore: () => void;
  removeEndedSession: (sessionId: string) => void;
  cancelInFlightRequests: () => void;
  suspendRequests: () => void;
  resetForAuthChange: () => void;
  clearForUnauthenticated: () => void;
  stopLoading: () => void;
  invalidateOnUnmount: () => void;
}

const activeSessionsProfile: QueryProfile<null, SessionListItem> = {
  resolveContext: () => ({ eligible: true, context: null }),
  resetOnFirstPage: false,
  clearCursorOnFirstPage: true,
  preserveOnSuspend: true,
  clearPrimaryErrorOnSuspend: false,
  abortTransport: false,
  concurrent: "ignore",
  settlementDrift: "discard",
  page: {
    keyOf: (item) => item.id,
    dedupeKey: (item) => item.id,
  },
};

function readIdentity(): ActiveSessionsIdentity | null {
  const snapshot = getAuthSnapshot();
  if (snapshot.state !== "authenticated" || !snapshot.principal) return null;
  return { principal: snapshot.principal, revision: getAuthRevision() };
}

export function useActiveSessionsQuery(
  options: UseActiveSessionsQueryOptions,
): ActiveSessionsQueryView {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState<QueryState<SessionListItem>>(createEmptyQueryState);
  const [queriedIdentity, setQueriedIdentity] = useState<ActiveSessionsIdentity | null>(null);
  const queryRef = useRef<ReadQuery<null, SessionListItem> | null>(null);
  const pendingPrimaryIdentityRef = useRef<ActiveSessionsIdentity | null>(null);

  useEffect(() => {
    let previousState = createEmptyQueryState<SessionListItem>();
    const profile: QueryProfile<null, SessionListItem> = {
      ...activeSessionsProfile,
      gate: () => !optionsRef.current.isWriteBlocked(),
    };
    const fetcher: Fetcher<null, SessionListItem> = async (_context, requestOptions) => {
      if (requestOptions.cursor) {
        const page = await listActiveSessions({ cursor: requestOptions.cursor });
        return { items: page.items, nextCursor: page.next_cursor };
      }

      const identity = readIdentity();
      if (!identity) throw new Error("Active sessions requires an authenticated principal");
      pendingPrimaryIdentityRef.current = identity;
      const page = await listActiveSessions();
      return { items: page.items, nextCursor: page.next_cursor };
    };

    const query = createReadQuery<null, SessionListItem>(
      profile,
      fetcher,
      {
        getPrincipal: () => readIdentity()?.principal ?? null,
        getRevision: getAuthRevision,
        getLifecycle: () => optionsRef.current.getLifecycle(),
      },
      (next) => {
        const primarySettled = previousState.phase === "loading" && next.phase === "ready";

        if (primarySettled && pendingPrimaryIdentityRef.current) {
          setQueriedIdentity(pendingPrimaryIdentityRef.current);
          pendingPrimaryIdentityRef.current = null;
        }

        previousState = next;
        setState(next);
      },
    );
    queryRef.current = query;

    return () => {
      query.dispose();
      queryRef.current = null;
      pendingPrimaryIdentityRef.current = null;
    };
  }, []);

  const isReadBlocked = (): boolean => {
    const lifecycle = optionsRef.current.getLifecycle();
    return (
      lifecycle.visibility === "hidden" ||
      lifecycle.online === false ||
      optionsRef.current.isWriteBlocked()
    );
  };

  const fetchActiveSessions = (): void => {
    if (isReadBlocked()) return;
    queryRef.current?.refresh();
  };

  const loadMore = (): void => {
    if (isReadBlocked()) return;
    queryRef.current?.loadMore();
  };

  const removeEndedSession = (sessionId: string): void => {
    queryRef.current?.removeItem(sessionId);
  };

  const cancelInFlightRequests = (): void => {
    pendingPrimaryIdentityRef.current = null;
    queryRef.current?.cancel();
  };

  const suspendRequests = (): void => {
    pendingPrimaryIdentityRef.current = null;
    queryRef.current?.suspend();
  };

  const resetForAuthChange = (): void => {
    pendingPrimaryIdentityRef.current = null;
    setQueriedIdentity(null);
    queryRef.current?.reconcile();
  };

  const clearForUnauthenticated = (): void => {
    pendingPrimaryIdentityRef.current = null;
    setQueriedIdentity(null);
    queryRef.current?.reconcile();
  };

  const stopLoading = (): void => {
    queryRef.current?.cancel();
  };

  const invalidateOnUnmount = (): void => {
    pendingPrimaryIdentityRef.current = null;
    queryRef.current?.dispose();
  };

  return {
    sessions: state.items,
    loading: state.phase === "loading",
    error: state.phase === "error",
    queriedIdentity,
    nextCursor: state.cursor,
    loadingMore: state.more === "loading",
    loadMoreError: state.more === "error",
    fetchActiveSessions,
    loadMore,
    removeEndedSession,
    cancelInFlightRequests,
    suspendRequests,
    resetForAuthChange,
    clearForUnauthenticated,
    stopLoading,
    invalidateOnUnmount,
  };
}
