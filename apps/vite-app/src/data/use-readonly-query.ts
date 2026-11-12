/**
 * 只读查询 Hook：把框架无关的 ReadOnlyQueryController 接到 React 的认证订阅、
 * 生命周期订阅与 clock/scheduler 上。接口独立于具体组件，不 import 任何业务组件。
 */

import { useEffect, useRef, useState } from "react";
import { getAuthRevision, getAuthSnapshot, subscribeAuthSnapshot } from "@/lib/auth";
import { createLifecycleAdapter } from "@/platform";
import {
  createEmptyQueryState,
  createReadQuery,
  type Fetcher,
  type QueryProfile,
  type QueryState,
  type ReadErrorKind,
  type ReadQuery,
} from "./readonly-query";

export interface UseReadOnlyQueryOptions<C, D> {
  profile: QueryProfile<C, D>;
  fetcher: Fetcher<C, D>;
  classifyError?: (error: unknown) => ReadErrorKind;
  clock?: () => number;
  scheduler?: ReadOnlyQueryScheduler;
}

export interface ReadOnlyQueryScheduler {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

export interface UseReadOnlyQueryResult<D> {
  state: QueryState<D>;
  refresh: () => void;
  loadMore: () => void;
  retry: () => void;
  removeItem: (key: string) => void;
}

const browserScheduler: ReadOnlyQueryScheduler = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export function useReadOnlyQuery<C, D>(
  options: UseReadOnlyQueryOptions<C, D>,
): UseReadOnlyQueryResult<D> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState<QueryState<D>>(createEmptyQueryState);
  const queryRef = useRef<ReadQuery<C, D> | null>(null);
  const scheduleContextCheckRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const { profile, fetcher } = optionsRef.current;
    const adapter = createLifecycleAdapter();
    const query = createReadQuery<C, D>(
      profile,
      fetcher,
      {
        getPrincipal: () => {
          const snap = getAuthSnapshot();
          return snap.state === "authenticated" ? snap.principal : null;
        },
        getRevision: () => getAuthRevision(),
        getLifecycle: () => adapter.getSnapshot(),
        classifyError: (error) => optionsRef.current.classifyError?.(error),
      },
      (next) => setState(next),
    );
    queryRef.current = query;

    const unsubscribeAuth = subscribeAuthSnapshot(() => {
      query.reconcile();
      query.refresh();
    });

    const unsubscribeLifecycle = adapter.subscribe((event) => {
      const { type, snapshot } = event;
      const visibility = snapshot.visibility;
      const online = snapshot.online;

      const suspendNow = type === "suspend" || visibility === "hidden" || online === false;
      const resumeNow =
        (type === "resume" && visibility === "visible" && online !== false) ||
        (type === "connectivity" && online === true && visibility !== "hidden");

      if (suspendNow) {
        query.suspend();
      } else if (resumeNow) {
        query.resume();
      }
    });

    let midnight: number | undefined;
    let timerScheduler: ReadOnlyQueryScheduler | undefined;
    const clearContextTimer = (): void => {
      if (midnight !== undefined) timerScheduler?.clearTimeout(midnight);
      midnight = undefined;
      timerScheduler = undefined;
    };
    const scheduleContextCheck = (): void => {
      clearContextTimer();
      const nextContextChange = optionsRef.current.profile.nextContextChange;
      const next = nextContextChange
        ? nextContextChange((optionsRef.current.clock ?? Date.now)())
        : null;
      if (next != null && next > 0) {
        const scheduler = optionsRef.current.scheduler ?? browserScheduler;
        timerScheduler = scheduler;
        midnight = scheduler.setTimeout(() => {
          midnight = undefined;
          timerScheduler = undefined;
          query.reconcile();
          query.refresh();
          scheduleContextCheck();
        }, next);
      }
    };
    const checkContext = (): void => {
      if (query.reconcile()) {
        query.refresh();
        scheduleContextCheck();
      }
    };
    window.addEventListener("focus", checkContext);

    scheduleContextCheckRef.current = scheduleContextCheck;
    query.refresh();
    scheduleContextCheck();

    return () => {
      clearContextTimer();
      window.removeEventListener("focus", checkContext);
      unsubscribeAuth();
      unsubscribeLifecycle();
      adapter.dispose();
      query.dispose();
      queryRef.current = null;
      scheduleContextCheckRef.current = null;
    };
  }, []);

  useEffect(() => {
    const query = queryRef.current;
    if (!query) return;
    if (query.updateOptions(optionsRef.current.profile, optionsRef.current.fetcher)) {
      query.refresh();
    }
    scheduleContextCheckRef.current?.();
  }, [options]);

  return {
    state,
    refresh: () => {
      queryRef.current?.refresh();
    },
    loadMore: () => {
      queryRef.current?.loadMore();
    },
    retry: () => {
      queryRef.current?.retry();
    },
    removeItem: (key) => {
      queryRef.current?.removeItem(key);
    },
  };
}
