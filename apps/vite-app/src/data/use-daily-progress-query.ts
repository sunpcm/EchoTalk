import { useEffect, useRef, useState } from "react";
import { getDailyProgress, listSessions, type SessionListItem } from "@/lib/api";
import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
  type AuthPrincipal,
  type AuthSnapshot,
} from "@/lib/auth";
import { getLocalDayWindow } from "@/lib/localDayWindow";
import { createLifecycleAdapter, type WebLifecycleEvent } from "@/platform";
import {
  createEmptyQueryState,
  createReadQuery,
  type Fetcher,
  type QueryProfile,
  type QueryState,
  type ReadQuery,
} from "./readonly-query";

interface DailyProgressWindow {
  start: string;
  end: string;
  localEndDateMs: number;
}

interface DailyProgressStats {
  completedSessions: number;
  totalTurns: number;
}

type DailyProgressQueryItem =
  | ({ kind: "summary" } & DailyProgressStats)
  | { kind: "row"; session: SessionListItem };

interface Actions {
  refresh: () => void;
  loadMore: () => void;
}

export interface DailyProgressQueryView {
  snapshot: AuthSnapshot;
  stats: DailyProgressStats | null;
  sessions: SessionListItem[];
  nextCursor: string | null;
  loading: boolean;
  error: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  refresh: () => void;
  loadMore: () => void;
}

const dailyProfile: QueryProfile<DailyProgressWindow, DailyProgressQueryItem> = {
  resolveContext: () => ({ eligible: false }),
  sameContext: (a, b) => a.start === b.start && a.end === b.end,
  resetOnFirstPage: false,
  preserveOnSuspend: true,
  clearPrimaryErrorOnSuspend: false,
  abortTransport: false,
  concurrent: "override",
  settlementDrift: "discard",
  page: {
    keyOf: (item) => (item.kind === "summary" ? "summary" : `session:${item.session.id}`),
  },
};

function shouldSuspendForLifecycle(event: WebLifecycleEvent): boolean {
  return (
    event.type === "suspend" ||
    event.snapshot.visibility === "hidden" ||
    event.snapshot.online === false
  );
}

function shouldRefreshForLifecycle(event: WebLifecycleEvent): boolean {
  return (
    (event.type === "resume" &&
      event.snapshot.visibility === "visible" &&
      event.snapshot.online !== false) ||
    (event.type === "connectivity" &&
      event.snapshot.online === true &&
      event.snapshot.visibility !== "hidden")
  );
}

export function useDailyProgressQuery(): DailyProgressQueryView {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthSnapshot());
  const [state, setState] = useState<QueryState<DailyProgressQueryItem>>(() => ({
    ...createEmptyQueryState(),
    phase: "loading",
  }));
  const actionsRef = useRef<Actions | null>(null);

  useEffect(() => {
    const adapter = createLifecycleAdapter();
    let disposed = false;
    let windowContext: DailyProgressWindow | null = null;
    let midnight: ReturnType<typeof setTimeout> | undefined;
    let activePrincipal: AuthPrincipal | null = getAuthSnapshot().principal;
    let activeRevision = getAuthRevision();

    const clearMidnight = (): void => {
      if (midnight !== undefined) {
        clearTimeout(midnight);
        midnight = undefined;
      }
    };

    const publish = (next: QueryState<DailyProgressQueryItem>): void => {
      if (!disposed) setState(next);
    };

    const profile: QueryProfile<DailyProgressWindow, DailyProgressQueryItem> = {
      ...dailyProfile,
      resolveContext: () =>
        windowContext === null ? { eligible: false } : { eligible: true, context: windowContext },
    };

    const fetcher: Fetcher<DailyProgressWindow, DailyProgressQueryItem> = async (
      context,
      options,
    ) => {
      if (options.cursor) {
        const page = await listSessions({
          status: "completed",
          start: context.start,
          end: context.end,
          cursor: options.cursor,
        });
        return {
          items: page.items.map((session): DailyProgressQueryItem => ({ kind: "row", session })),
          nextCursor: page.next_cursor,
        };
      }

      const [progress, page] = await Promise.all([
        getDailyProgress(context.start, context.end),
        listSessions({
          status: "completed",
          start: context.start,
          end: context.end,
        }),
      ]);
      return {
        items: [
          {
            kind: "summary",
            completedSessions: progress.completed_sessions,
            totalTurns: progress.total_turns,
          },
          ...page.items.map((session): DailyProgressQueryItem => ({ kind: "row", session })),
        ],
        nextCursor: page.next_cursor,
      };
    };

    // The controller is assigned before callbacks can run; the shared helper closes over it.
    // eslint-disable-next-line prefer-const
    let query: ReadQuery<DailyProgressWindow, DailyProgressQueryItem>;

    const scheduleMidnight = (context: DailyProgressWindow): void => {
      clearMidnight();
      const delay = context.localEndDateMs - Date.now();
      if (delay <= 0) return;
      midnight = setTimeout(() => {
        midnight = undefined;
        if (!disposed) refresh();
      }, delay + 100);
    };

    const refresh = (): void => {
      if (disposed) return;
      const current = getAuthSnapshot();
      if (current.state !== "authenticated" || !current.principal) {
        clearMidnight();
        query.reconcile();
        return;
      }

      const localWindow = getLocalDayWindow();
      windowContext = {
        start: localWindow.start,
        end: localWindow.end,
        localEndDateMs: localWindow.localEndDate.getTime(),
      };
      scheduleMidnight(windowContext);
      query.refresh();
    };

    query = createReadQuery(
      profile,
      fetcher,
      {
        getPrincipal: () => {
          const current = getAuthSnapshot();
          return current.state === "authenticated" ? current.principal : null;
        },
        getRevision: getAuthRevision,
        getLifecycle: () => adapter.getSnapshot(),
      },
      publish,
    );

    actionsRef.current = {
      refresh,
      loadMore: () => query.loadMore(),
    };

    const unsubscribeAuth = subscribeAuthSnapshot((nextSnapshot) => {
      if (disposed) return;
      const nextRevision = getAuthRevision();
      const nextPrincipal = nextSnapshot.principal;
      const principalChanged = !arePrincipalsEqual(activePrincipal, nextPrincipal);
      const revisionChanged = nextRevision !== activeRevision;
      activePrincipal = nextPrincipal;
      activeRevision = nextRevision;
      setSnapshot(nextSnapshot);

      if (nextSnapshot.state !== "authenticated" || !nextPrincipal) {
        clearMidnight();
        query.reconcile();
        return;
      }
      if (principalChanged || revisionChanged) refresh();
    });

    const unsubscribeLifecycle = adapter.subscribe((event) => {
      if (disposed) return;
      if (shouldSuspendForLifecycle(event)) {
        query.suspend();
      } else if (shouldRefreshForLifecycle(event)) {
        refresh();
      }
    });

    const initialSnapshot = getAuthSnapshot();
    activePrincipal = initialSnapshot.principal;
    activeRevision = getAuthRevision();
    setSnapshot(initialSnapshot);
    if (initialSnapshot.state === "authenticated" && initialSnapshot.principal) {
      refresh();
    } else {
      clearMidnight();
      query.reconcile();
    }

    return () => {
      disposed = true;
      actionsRef.current = null;
      clearMidnight();
      unsubscribeAuth();
      unsubscribeLifecycle();
      query.dispose();
      adapter.dispose();
    };
  }, []);

  let stats: DailyProgressStats | null = null;
  const sessions: SessionListItem[] = [];
  for (const item of state.items) {
    if (item.kind === "summary") {
      stats = {
        completedSessions: item.completedSessions,
        totalTurns: item.totalTurns,
      };
    } else {
      sessions.push(item.session);
    }
  }

  return {
    snapshot,
    stats,
    sessions,
    nextCursor: state.cursor,
    loading: state.phase === "loading",
    error: state.phase === "error",
    loadingMore: state.more === "loading",
    loadMoreError: state.more === "error",
    refresh: () => actionsRef.current?.refresh(),
    loadMore: () => actionsRef.current?.loadMore(),
  };
}
