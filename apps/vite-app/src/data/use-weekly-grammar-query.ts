import { getWeeklyGrammar, type WeeklyGrammarSummary } from "@/lib/api";
import { getLocalDayWindow, getLocalWeekContext } from "@/lib/localDayWindow";
import {
  type FetcherOptions,
  type Page,
  type QueryProfile,
  type SlotPhase,
} from "./readonly-query";
import { useReadOnlyQuery } from "./use-readonly-query";

interface WeeklyGrammarContext {
  endDate: string;
  timezone: string;
}

export interface WeeklyGrammarQueryView {
  items: WeeklyGrammarSummary["items"];
  totalErrors: number;
  phase: SlotPhase;
  paused: boolean;
  retry: () => void;
}

const weeklyGrammarProfile: QueryProfile<WeeklyGrammarContext, WeeklyGrammarSummary> = {
  resolveContext: () => ({ eligible: true, context: getLocalWeekContext() }),
  sameContext: (a, b) => a.endDate === b.endDate && a.timezone === b.timezone,
  nextContextChange: (now) => {
    const end = getLocalDayWindow(new Date(now)).localEndDate.getTime();
    return Math.max(1, end - now);
  },
  contextCheckIntervalMs: 60_000,
  resetOnFirstPage: true,
  preserveOnSuspend: false,
  clearPrimaryErrorOnSuspend: true,
  abortTransport: true,
  concurrent: "ignore",
};

async function fetchWeeklyGrammar(
  context: WeeklyGrammarContext,
  options: FetcherOptions,
): Promise<Page<WeeklyGrammarSummary>> {
  const summary = await getWeeklyGrammar(context.endDate, context.timezone, {
    signal: options.signal,
  });
  return { items: [summary], nextCursor: null };
}

export function useWeeklyGrammarQuery(): WeeklyGrammarQueryView {
  const { state, retry } = useReadOnlyQuery({
    profile: weeklyGrammarProfile,
    fetcher: fetchWeeklyGrammar,
  });
  const summary = state.items[0];

  return {
    items: summary?.items ?? [],
    totalErrors: summary?.total_errors ?? 0,
    phase: state.phase,
    paused: state.paused,
    retry,
  };
}
