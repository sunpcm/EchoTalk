import { useEffect, useRef, useState } from "react";
import {
  getWeeklyProgress,
  listSessions,
  type SessionListItem,
  type WeeklyProgressDay,
  type WeeklyProgressResponse,
} from "@/lib/api";
import {
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
  type AuthPrincipal,
} from "@/lib/auth";
import { getLocalDayWindow, getLocalWeekContext } from "@/lib/localDayWindow";
import { createLifecycleAdapter } from "@/platform";
import {
  createEmptyQueryState,
  createReadQuery,
  type Fetcher,
  type QueryProfile,
  type QueryState,
  type ReadQuery,
  type SlotPhase,
} from "./readonly-query";

interface WeekContext {
  endDate: string;
  timezone: string;
}

interface HistoryContext extends WeekContext {
  selected: string;
  start: string;
  end: string;
  generation: number;
}

interface CommittedWeek extends WeekContext {
  principal: AuthPrincipal;
  revision: number;
  days: WeeklyProgressDay[];
}

interface WeeklyRequestOrigin extends WeekContext {
  principal: AuthPrincipal;
  revision: number;
}

interface Actions {
  refresh: () => void;
  select: (date: string) => void;
  history: () => void;
  more: () => void;
}

export interface WeeklyProgressQueryView {
  days: WeeklyProgressDay[];
  selected: string;
  items: SessionListItem[];
  cursor: string | null;
  week: SlotPhase;
  history: SlotPhase;
  more: SlotPhase;
  paused: boolean;
  refresh: () => void;
  select: (date: string) => void;
  historyRetry: () => void;
  moreRetry: () => void;
}

const weekProfile: QueryProfile<WeekContext, WeeklyProgressResponse> = {
  resolveContext: () => ({ eligible: true, context: getLocalWeekContext() }),
  sameContext: (a, b) => a.endDate === b.endDate && a.timezone === b.timezone,
  nextContextChange: (now) => {
    const end = getLocalDayWindow(new Date(now)).localEndDate.getTime();
    return Math.max(1, end - now);
  },
  contextCheckIntervalMs: 60_000,
  resetOnFirstPage: false,
  preserveOnSuspend: true,
  clearPrimaryErrorOnSuspend: true,
  abortTransport: true,
  concurrent: "ignore",
};

const samePrincipal = (a: AuthPrincipal, b: AuthPrincipal): boolean =>
  a.issuer === b.issuer && a.subject === b.subject;

const leftLoading = (before: SlotPhase, after: SlotPhase): boolean =>
  before === "loading" && after !== "loading";

export function useWeeklyProgressQuery(): WeeklyProgressQueryView {
  const [weeklyState, setWeeklyState] = useState<QueryState<WeeklyProgressResponse>>(() =>
    createEmptyQueryState(),
  );
  const [historyState, setHistoryState] = useState<QueryState<SessionListItem>>(() =>
    createEmptyQueryState(),
  );
  const [selected, setSelected] = useState("");
  const [zeroWindowReady, setZeroWindowReady] = useState(false);
  const actionsRef = useRef<Actions | null>(null);

  useEffect(() => {
    const adapter = createLifecycleAdapter();
    let disposed = false;
    let weeklyValue = createEmptyQueryState<WeeklyProgressResponse>();
    let historyValue = createEmptyQueryState<SessionListItem>();
    let selectedValue = "";
    let committed: CommittedWeek | null = null;
    let pendingWeeklyOrigin: WeeklyRequestOrigin | null = null;
    let historyGeneration = 0;
    let settlingHistory = false;
    let midnight: ReturnType<typeof setTimeout> | undefined;

    const readAuthOrigin = (): Pick<WeeklyRequestOrigin, "principal" | "revision"> | null => {
      const snapshot = getAuthSnapshot();
      if (snapshot.state !== "authenticated" || !snapshot.principal) return null;
      return { principal: snapshot.principal, revision: getAuthRevision() };
    };
    const canRead = (): boolean => {
      const lifecycle = adapter.getSnapshot();
      return lifecycle.visibility !== "hidden" && lifecycle.online !== false;
    };
    const currentWeek = (): CommittedWeek | null => {
      if (!committed) return null;
      const auth = readAuthOrigin();
      const context = getLocalWeekContext();
      if (
        !auth ||
        !samePrincipal(auth.principal, committed.principal) ||
        auth.revision !== committed.revision ||
        context.endDate !== committed.endDate ||
        context.timezone !== committed.timezone
      ) {
        return null;
      }
      return committed;
    };
    const historyDay = (): WeeklyProgressDay | null =>
      currentWeek()?.days.find((day) => day.date === selectedValue) ?? null;

    const weeklyFetcher: Fetcher<WeekContext, WeeklyProgressResponse> = async (
      context,
      options,
    ) => {
      const auth = readAuthOrigin();
      if (!auth) throw new Error("Weekly progress requires an authenticated principal");
      pendingWeeklyOrigin = { ...auth, ...context };
      const result = await getWeeklyProgress(context.endDate, context.timezone, {
        signal: options.signal,
      });
      return { items: [result], nextCursor: null };
    };

    const historyProfile: QueryProfile<HistoryContext, SessionListItem> = {
      resolveContext: () => {
        const week = currentWeek();
        const day = historyDay();
        if (!week || !day) return { eligible: false };
        return {
          eligible: true,
          context: {
            endDate: week.endDate,
            timezone: week.timezone,
            selected: selectedValue,
            start: day.start,
            end: day.end,
            generation: historyGeneration,
          },
        };
      },
      sameContext: (a, b) =>
        a.endDate === b.endDate &&
        a.timezone === b.timezone &&
        a.selected === b.selected &&
        a.start === b.start &&
        a.end === b.end &&
        a.generation === b.generation,
      resetOnFirstPage: true,
      preserveOnSuspend: true,
      clearPrimaryErrorOnSuspend: true,
      abortTransport: true,
      concurrent: "ignore",
      page: {
        keyOf: (item) => item.id,
        dedupeKey: (item) => item.id.toLowerCase(),
        detectRepeatedCursor: true,
        validatePage: (items, context) => {
          if (
            items.some(
              (item) =>
                item.status !== "completed" ||
                Date.parse(item.started_at) < Date.parse(context.start) ||
                Date.parse(item.started_at) >= Date.parse(context.end),
            )
          ) {
            throw new Error("Invalid history window");
          }
        },
      },
    };
    const historyFetcher: Fetcher<HistoryContext, SessionListItem> = async (context, options) => {
      if (Date.parse(context.start) === Date.parse(context.end)) {
        return { items: [], nextCursor: null };
      }
      const page = await listSessions(
        {
          status: "completed",
          start: context.start,
          end: context.end,
          limit: 50,
          ...(options.cursor ? { cursor: options.cursor } : {}),
        },
        { signal: options.signal },
      );
      return { items: page.items, nextCursor: page.next_cursor };
    };

    const publishHistory = (next: QueryState<SessionListItem>): void => {
      historyValue = next;
      if (!disposed) setHistoryState(next);
    };
    const publishWeekly = (next: QueryState<WeeklyProgressResponse>): void => {
      weeklyValue = next;
      if (!disposed) setWeeklyState(next);
    };

    // 两个 controller 互相结算，需在共享 helper 定义后按依赖顺序各初始化一次。
    // eslint-disable-next-line prefer-const
    let weekly: ReadQuery<WeekContext, WeeklyProgressResponse>;
    // eslint-disable-next-line prefer-const
    let history: ReadQuery<HistoryContext, SessionListItem>;

    const resetSelectionToToday = (): void => {
      selectedValue = getLocalWeekContext().endDate;
      if (!disposed) setSelected(selectedValue);
    };
    const invalidateHistory = (): void => {
      if (disposed) return;
      setZeroWindowReady(false);
      historyGeneration += 1;
      history.reconcile();
    };
    const clearWeekDependencies = (): void => {
      committed = null;
      resetSelectionToToday();
      invalidateHistory();
    };
    const settleHistory = (): void => {
      if (settlingHistory || disposed) return;
      settlingHistory = true;
      try {
        if (weekly.reconcile()) {
          clearWeekDependencies();
          weekly.refresh();
          return;
        }
        if (
          history.reconcile() &&
          weekly.getState().phase !== "loading" &&
          historyDay() &&
          canRead()
        ) {
          history.refresh();
        }
      } finally {
        settlingHistory = false;
      }
    };

    history = createReadQuery(
      historyProfile,
      historyFetcher,
      {
        getPrincipal: () => readAuthOrigin()?.principal ?? null,
        getRevision: getAuthRevision,
        getLifecycle: () => adapter.getSnapshot(),
      },
      (next) => {
        const previous = historyValue;
        publishHistory(next);
        if (leftLoading(previous.phase, next.phase) || leftLoading(previous.more, next.more)) {
          settleHistory();
        }
      },
    );

    weekly = createReadQuery(
      weekProfile,
      weeklyFetcher,
      {
        getPrincipal: () => readAuthOrigin()?.principal ?? null,
        getRevision: getAuthRevision,
        getLifecycle: () => adapter.getSnapshot(),
      },
      (next) => {
        const previous = weeklyValue;
        publishWeekly(next);
        if (previous.phase === "loading" && next.phase === "error") {
          pendingWeeklyOrigin = null;
        }
        if (previous.items.length > 0 && next.items.length === 0 && next.phase === "idle") {
          clearWeekDependencies();
        }
        if (
          previous.phase !== "loading" ||
          next.phase !== "ready" ||
          next.paused ||
          !next.items[0] ||
          !pendingWeeklyOrigin
        ) {
          return;
        }

        const origin = pendingWeeklyOrigin;
        pendingWeeklyOrigin = null;
        committed = { ...origin, days: next.items[0].days };
        selectedValue = committed.days.some((day) => day.date === selectedValue)
          ? selectedValue
          : origin.endDate;
        setSelected(selectedValue);
        loadHistory();
      },
    );

    const refresh = (): void => {
      if (disposed) return;
      const changed = weekly.reconcile();
      if (changed) clearWeekDependencies();
      if (!canRead() || (!changed && weekly.getState().phase === "loading")) {
        weekly.refresh();
        return;
      }
      invalidateHistory();
      weekly.refresh();
    };

    function loadHistory(): void {
      if (disposed) return;
      if (weekly.reconcile()) {
        clearWeekDependencies();
        weekly.refresh();
        return;
      }
      if (
        !readAuthOrigin() ||
        !canRead() ||
        weekly.getState().phase === "loading" ||
        history.getState().phase === "loading" ||
        !historyDay()
      ) {
        return;
      }
      const day = historyDay();
      if (!day) return;
      invalidateHistory();
      if (Date.parse(day.start) === Date.parse(day.end)) {
        setZeroWindowReady(true);
        return;
      }
      history.refresh();
    }

    const select = (date: string): void => {
      if (disposed) return;
      if (weekly.reconcile()) {
        clearWeekDependencies();
        weekly.refresh();
        return;
      }
      if (
        !readAuthOrigin() ||
        weekly.getState().phase === "loading" ||
        !currentWeek()?.days.some((day) => day.date === date) ||
        date === selectedValue
      ) {
        return;
      }
      invalidateHistory();
      selectedValue = date;
      setSelected(date);
      loadHistory();
    };

    const loadMore = (): void => {
      if (disposed) return;
      if (weekly.reconcile()) {
        clearWeekDependencies();
        weekly.refresh();
        return;
      }
      if (
        !readAuthOrigin() ||
        !canRead() ||
        !historyValue.cursor ||
        !historyDay() ||
        weekly.getState().phase === "loading" ||
        history.getState().phase === "loading" ||
        history.getState().more === "loading"
      ) {
        return;
      }
      history.loadMore();
    };

    actionsRef.current = { refresh, select, history: loadHistory, more: loadMore };
    const unsubscribeAuth = subscribeAuthSnapshot(() => {
      refresh();
    });
    const unsubscribeLifecycle = adapter.subscribe((event) => {
      if (event.type === "suspend" || event.snapshot.online === false) {
        weekly.suspend();
        history.suspend();
      } else if (
        (event.type === "resume" && event.snapshot.visibility === "visible") ||
        (event.type === "connectivity" &&
          event.snapshot.online === true &&
          event.snapshot.visibility !== "hidden")
      ) {
        refresh();
      }
    });

    const scheduleMidnight = (): void => {
      clearTimeout(midnight);
      const next = weekProfile.nextContextChange?.(Date.now());
      if (next == null || next <= 0) return;
      midnight = setTimeout(() => {
        if (disposed) return;
        if (weekly.reconcile()) clearWeekDependencies();
        weekly.refresh();
        scheduleMidnight();
      }, next);
    };
    const checkContext = (): void => {
      if (weekly.reconcile()) {
        clearWeekDependencies();
        weekly.refresh();
        scheduleMidnight();
      }
    };

    window.addEventListener("focus", checkContext);
    const contextCheck = setInterval(checkContext, weekProfile.contextCheckIntervalMs);
    refresh();
    scheduleMidnight();

    return () => {
      disposed = true;
      actionsRef.current = null;
      clearTimeout(midnight);
      clearInterval(contextCheck);
      window.removeEventListener("focus", checkContext);
      unsubscribeAuth();
      unsubscribeLifecycle();
      history.dispose();
      weekly.dispose();
      adapter.dispose();
    };
  }, []);

  const days = weeklyState.items[0]?.days ?? [];
  const paused = weeklyState.paused;
  const selectedZeroWindow =
    zeroWindowReady &&
    days.some((day) => day.date === selected && Date.parse(day.start) === Date.parse(day.end));

  return {
    days,
    selected,
    items: historyState.items,
    cursor: historyState.cursor,
    week: paused ? "idle" : weeklyState.phase,
    history: historyState.paused ? "idle" : selectedZeroWindow ? "ready" : historyState.phase,
    more: historyState.paused ? "idle" : historyState.more,
    paused,
    refresh: () => actionsRef.current?.refresh(),
    select: (date) => actionsRef.current?.select(date),
    historyRetry: () => actionsRef.current?.history(),
    moreRetry: () => actionsRef.current?.more(),
  };
}
