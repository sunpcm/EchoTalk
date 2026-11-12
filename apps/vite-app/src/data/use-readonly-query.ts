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
}

export interface UseReadOnlyQueryResult<D> {
  state: QueryState<D>;
  refresh: () => void;
  loadMore: () => void;
  retry: () => void;
  removeItem: (key: string) => void;
}

export function useReadOnlyQuery<C, D>(
  options: UseReadOnlyQueryOptions<C, D>,
): UseReadOnlyQueryResult<D> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, setState] = useState<QueryState<D>>(createEmptyQueryState);
  const queryRef = useRef<ReadQuery<C, D> | null>(null);
  const optionsInitializedRef = useRef(false);
  const rescheduleContextCheckRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const { profile, fetcher, classifyError } = optionsRef.current;
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
        ...(classifyError ? { classifyError } : {}),
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

    let midnight: ReturnType<typeof setTimeout> | undefined;
    const scheduleContextCheck = (): void => {
      clearTimeout(midnight);
      const next = optionsRef.current.profile.nextContextChange?.(Date.now());
      if (next != null && next > 0) {
        midnight = setTimeout(() => {
          query.reconcile();
          query.refresh();
          scheduleContextCheck();
        }, next);
      }
    };
    rescheduleContextCheckRef.current = scheduleContextCheck;
    const checkContext = (): void => {
      if (query.reconcile()) {
        query.refresh();
        scheduleContextCheck();
      }
    };
    window.addEventListener("focus", checkContext);

    query.refresh();
    scheduleContextCheck();

    return () => {
      clearTimeout(midnight);
      window.removeEventListener("focus", checkContext);
      unsubscribeAuth();
      unsubscribeLifecycle();
      adapter.dispose();
      query.dispose();
      queryRef.current = null;
      rescheduleContextCheckRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!optionsInitializedRef.current) {
      optionsInitializedRef.current = true;
      return;
    }
    const query = queryRef.current;
    if (!query) return;
    query.updateOptions(options.profile, options.fetcher, options.classifyError);
    if (query.reconcile()) query.refresh();
    rescheduleContextCheckRef.current?.();
  }, [options.profile, options.fetcher, options.classifyError]);

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
