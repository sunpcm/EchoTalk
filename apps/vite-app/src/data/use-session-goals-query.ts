import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as apiModule from "@/lib/api";
import type { SessionGoalsResponse } from "@/lib/api";
import { getAuthRevision, getAuthSnapshot, type AuthPrincipal } from "@/lib/auth";
import type { Fetcher, QueryProfile, ReadErrorKind, SlotPhase } from "./readonly-query";
import { useReadOnlyQuery } from "./use-readonly-query";

const POLL_DELAYS_MS = [1_000, 2_000, 5_000] as const;

interface GoalsRequestOrigin {
  readonly sessionId: string;
  readonly principal: AuthPrincipal;
  readonly revision: number;
}

type GoalsPageItem =
  | {
      readonly kind: "loaded";
      readonly origin: GoalsRequestOrigin;
      readonly data: SessionGoalsResponse;
    }
  | {
      readonly kind: "error";
      readonly origin: GoalsRequestOrigin;
      readonly errorKind: ReadErrorKind;
      readonly status: number | null;
    };

export interface SessionGoalsQueryView {
  readonly phase: SlotPhase;
  readonly data: SessionGoalsResponse | null;
  readonly errorKind: ReadErrorKind | null;
  readonly errorStatus: number | null;
  readonly paused: boolean;
  readonly retry: () => void;
}

function readAuthOrigin(): Pick<GoalsRequestOrigin, "principal" | "revision"> | null {
  const snapshot = getAuthSnapshot();
  if (snapshot.state !== "authenticated" || !snapshot.principal) return null;
  return { principal: snapshot.principal, revision: getAuthRevision() };
}

function samePrincipal(a: AuthPrincipal, b: AuthPrincipal): boolean {
  return a.issuer === b.issuer && a.subject === b.subject;
}

function sameOrigin(a: GoalsRequestOrigin, b: GoalsRequestOrigin): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.revision === b.revision &&
    samePrincipal(a.principal, b.principal)
  );
}

function classifyGoalsError(error: unknown): ReadErrorKind {
  if (typeof apiModule.ApiError === "function" && error instanceof apiModule.ApiError) {
    return "http";
  }
  if (error instanceof TypeError) return "network";
  return "parse";
}

function errorStatus(error: unknown): number | null {
  if (typeof apiModule.ApiError === "function" && error instanceof apiModule.ApiError) {
    return error.status;
  }
  return null;
}

const fetchGoalsPage: Fetcher<GoalsRequestOrigin, GoalsPageItem> = async (context, options) => {
  try {
    if (typeof apiModule.getSessionGoals !== "function") {
      throw new Error("Session goals API is unavailable");
    }
    const data = await apiModule.getSessionGoals(context.sessionId, { signal: options.signal });
    return {
      items: [{ kind: "loaded", origin: context, data }],
      nextCursor: null,
    };
  } catch (error) {
    return {
      items: [
        {
          kind: "error",
          origin: context,
          errorKind: classifyGoalsError(error),
          status: errorStatus(error),
        },
      ],
      nextCursor: null,
    };
  }
};

export function useSessionGoalsQuery(sessionId: string | null): SessionGoalsQueryView {
  const [committedSessionId, setCommittedSessionId] = useState<string | null>(sessionId);
  const committedSessionIdRef = useRef<string | null>(sessionId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextPollDelayIndexRef = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);

  const profile = useMemo<QueryProfile<GoalsRequestOrigin, GoalsPageItem>>(
    () => ({
      resolveContext: () => {
        const currentSessionId = committedSessionIdRef.current;
        if (currentSessionId === null) return { eligible: false };
        const auth = readAuthOrigin();
        if (!auth) return { eligible: false };
        return {
          eligible: true,
          context: {
            sessionId: currentSessionId,
            principal: auth.principal,
            revision: auth.revision,
          },
        };
      },
      sameContext: sameOrigin,
      resetOnFirstPage: false,
      clearCursorOnFirstPage: true,
      preserveOnSuspend: true,
      clearPrimaryErrorOnSuspend: true,
      abortTransport: true,
      concurrent: "ignore",
      settlementDrift: "discard",
      page: {
        keyOf: (item) =>
          `${item.origin.sessionId}:${item.origin.principal.issuer}:${item.origin.principal.subject}:${item.origin.revision}`,
        dedupeKey: (item) =>
          `${item.origin.sessionId}:${item.origin.principal.issuer}:${item.origin.principal.subject}:${item.origin.revision}`,
      },
    }),
    [],
  );

  const queryOptions = useMemo(() => ({ profile, fetcher: fetchGoalsPage }), [profile]);
  const query = useReadOnlyQuery<GoalsRequestOrigin, GoalsPageItem>(queryOptions);
  useLayoutEffect(() => {
    refreshRef.current = query.retry;
  }, [query.retry]);
  // React 提交本 effect 后才发布 query context；未提交的 render 只读取旧 ref。
  useLayoutEffect(() => {
    if (committedSessionIdRef.current === sessionId) return;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    committedSessionIdRef.current = sessionId;
    nextPollDelayIndexRef.current = 0;
    setCommittedSessionId(sessionId);
    refreshRef.current();
  }, [sessionId]);

  const auth = readAuthOrigin();
  const rawItem = query.state.items[0];
  const liveOrigin: GoalsRequestOrigin | null =
    auth && committedSessionId
      ? {
          sessionId: committedSessionId,
          principal: auth.principal,
          revision: auth.revision,
        }
      : null;
  const isPropCommitted = sessionId !== null && sessionId === committedSessionId;
  const isLiveItem = Boolean(rawItem && liveOrigin && sameOrigin(rawItem.origin, liveOrigin));
  const currentItem = isPropCommitted && isLiveItem ? rawItem : undefined;

  const data = currentItem?.kind === "loaded" ? currentItem.data : null;
  const errorKind = currentItem?.kind === "error" ? currentItem.errorKind : null;
  const errorStatus = currentItem?.kind === "error" ? currentItem.status : null;
  const phase: SlotPhase = isPropCommitted ? query.state.phase : "idle";

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isPropCommitted || !isLiveItem) {
      nextPollDelayIndexRef.current = 0;
      return;
    }
    if (query.state.paused || query.state.phase !== "ready" || currentItem?.kind !== "loaded") {
      if (currentItem?.kind === "error") nextPollDelayIndexRef.current = 0;
      return;
    }

    const status = currentItem.data.execution?.status;
    if (status !== "pending" && status !== "running") {
      nextPollDelayIndexRef.current = 0;
      return;
    }

    const delayIndex = Math.min(nextPollDelayIndexRef.current, POLL_DELAYS_MS.length - 1);
    const delayMs = POLL_DELAYS_MS[delayIndex];
    const expectedOrigin = currentItem.origin;
    nextPollDelayIndexRef.current += 1;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const currentAuth = readAuthOrigin();
      const currentSessionId = committedSessionIdRef.current;
      if (
        !currentAuth ||
        currentSessionId !== expectedOrigin.sessionId ||
        !sameOrigin(expectedOrigin, {
          sessionId: currentSessionId,
          principal: currentAuth.principal,
          revision: currentAuth.revision,
        })
      ) {
        return;
      }
      refreshRef.current();
    }, delayMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentItem, isLiveItem, isPropCommitted, query.state]);

  return {
    phase,
    data,
    errorKind,
    errorStatus,
    paused: isPropCommitted && query.state.paused,
    retry: query.retry,
  };
}
