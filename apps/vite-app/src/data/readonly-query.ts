/**
 * 只读查询控制器（框架无关）。
 *
 * 契约与实现边界见 docs/FRONTEND_DATA_LAYER_CONTRACT.md §4。控制器只持有实例内状态、
 * 无共享缓存；认证源、生命周期快照与错误分类由外部注入，因此既可直接单元测试，也可被
 * useReadOnlyQuery 包装后接入 React。clock/scheduler 只属于后者的宿主适配入口。
 */

import type { AuthPrincipal } from "@/lib/auth";
import type { WebLifecycleSnapshot } from "@/platform";

export type ReadErrorKind = "http" | "parse" | "network";
export type SlotPhase = "idle" | "loading" | "ready" | "error";

export interface Page<D> {
  items: D[];
  nextCursor: string | null;
}

export interface QueryOrigin<C> {
  principal: AuthPrincipal;
  revision: number;
  context: C;
}

export type ContextResolution<C> = { eligible: true; context: C } | { eligible: false };

export interface PagePolicy<C, D> {
  keyOf(item: D): string;
  dedupeKey?(item: D): string;
  detectRepeatedCursor?: boolean;
  validatePage?(items: D[], context: C): void;
}

export interface QueryProfile<C, D> {
  resolveContext(): ContextResolution<C>;
  gate?(snapshot: WebLifecycleSnapshot): boolean;
  sameContext?(a: C, b: C): boolean;
  nextContextChange?(now: number): number | null;
  resetOnFirstPage?: boolean;
  preserveOnSuspend?: boolean;
  clearPrimaryErrorOnSuspend?: boolean;
  abortTransport?: boolean;
  concurrent?: "ignore" | "override";
  page?: PagePolicy<C, D>;
}

export interface FetcherOptions {
  signal?: AbortSignal | null;
  cursor?: string | null;
}

export type Fetcher<C, D> = (context: C, options: FetcherOptions) => Promise<Page<D>>;

function invokeFetcher<C, D>(
  fetcher: Fetcher<C, D>,
  context: C,
  options: FetcherOptions,
): Promise<Page<D>> {
  try {
    return fetcher(context, options);
  } catch (error) {
    return Promise.reject(error);
  }
}

export interface QueryState<D> {
  phase: SlotPhase;
  items: D[];
  cursor: string | null;
  errorKind: ReadErrorKind | null;
  paused: boolean;
  more: SlotPhase;
  moreErrorKind: ReadErrorKind | null;
}

export interface QueryHandle {
  refresh(): void;
  loadMore(): void;
  retry(): void;
  removeItem(key: string): void;
  dispose(): void;
}

export interface ReadQuerySource {
  getPrincipal(): AuthPrincipal | null;
  getRevision(): number;
  getLifecycle(): WebLifecycleSnapshot;
  classifyError?(error: unknown): ReadErrorKind | undefined;
}

export interface ReadQuery<C, D> extends QueryHandle {
  updateOptions(profile: QueryProfile<C, D>, fetcher: Fetcher<C, D>): boolean;
  reconcile(): boolean;
  suspend(): void;
  resume(): void;
  getState(): QueryState<D>;
}

export function createEmptyQueryState<D>(): QueryState<D> {
  return {
    phase: "idle",
    items: [],
    cursor: null,
    errorKind: null,
    paused: false,
    more: "idle",
    moreErrorKind: null,
  };
}

function defaultClassifyError(error: unknown): ReadErrorKind {
  if (error instanceof TypeError) return "network";
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return "http";
  }
  return "parse";
}

function defaultSameContext(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => defaultSameContext(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      defaultSameContext(aRecord[key], bRecord[key]),
  );
}

export function createReadQuery<C, D>(
  profile: QueryProfile<C, D>,
  fetcher: Fetcher<C, D>,
  source: ReadQuerySource,
  onChange: (state: QueryState<D>) => void,
): ReadQuery<C, D> {
  let currentProfile = profile;
  let currentFetcher = fetcher;
  const classifyError = (error: unknown): ReadErrorKind =>
    source.classifyError?.(error) ?? defaultClassifyError(error);
  const sameContext = (a: C, b: C): boolean =>
    (currentProfile.sameContext ?? defaultSameContext)(a, b);

  let disposed = false;
  let origin: QueryOrigin<C> | null = null;
  let state: QueryState<D> = createEmptyQueryState();
  let primarySeq = 0;
  let moreSeq = 0;
  let primaryInFlight = false;
  let moreInFlight = false;
  let primaryAbort: AbortController | null = null;
  let moreAbort: AbortController | null = null;
  const consumedCursors = new Set<string>();
  const removedKeys = new Set<string>();

  const publish = (next: QueryState<D>): void => {
    state = next;
    onChange(next);
  };

  const readGate = (): "allowed" | "lifecycle" | "business" => {
    const snap = source.getLifecycle();
    if (snap.visibility === "hidden" || snap.online === false) return "lifecycle";
    if (currentProfile.gate && !currentProfile.gate(snap)) return "business";
    return "allowed";
  };

  const readOrigin = (): QueryOrigin<C> | null => {
    const principal = source.getPrincipal();
    if (!principal) return null;
    const resolved = currentProfile.resolveContext();
    if (!resolved.eligible) return null;
    return { principal, revision: source.getRevision(), context: resolved.context };
  };

  const isSameOrigin = (a: QueryOrigin<C> | null, b: QueryOrigin<C> | null): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.principal.issuer !== b.principal.issuer || a.principal.subject !== b.principal.subject) {
      return false;
    }
    if (a.revision !== b.revision) return false;
    return sameContext(a.context, b.context);
  };

  const abortAll = (): void => {
    primarySeq++;
    moreSeq++;
    primaryInFlight = false;
    moreInFlight = false;
    primaryAbort?.abort();
    moreAbort?.abort();
    primaryAbort = null;
    moreAbort = null;
  };

  const keyOfItem = (item: D): string =>
    currentProfile.page?.keyOf ? currentProfile.page.keyOf(item) : String(item);
  const dedupeKeyOf = (item: D): string =>
    currentProfile.page?.dedupeKey ? currentProfile.page.dedupeKey(item) : keyOfItem(item);

  const dedupe = (items: D[]): D[] => {
    const seen = new Set<string>();
    const out: D[] = [];
    for (const item of items) {
      const id = keyOfItem(item);
      if (removedKeys.has(id)) continue;
      const key = dedupeKeyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  const reconcile = (): boolean => {
    if (disposed) return false;
    const next = readOrigin();
    if (isSameOrigin(origin, next)) return false;
    abortAll();
    consumedCursors.clear();
    removedKeys.clear();
    origin = next;
    publish({ ...createEmptyQueryState(), paused: next !== null && readGate() !== "allowed" });
    return true;
  };

  const updateOptions = (nextProfile: QueryProfile<C, D>, nextFetcher: Fetcher<C, D>): boolean => {
    currentProfile = nextProfile;
    currentFetcher = nextFetcher;
    if (reconcile()) return true;
    const gate = readGate();
    if (origin !== null && gate !== "allowed") pauseForGate(gate === "lifecycle");
    return false;
  };

  const pausedState = (clearCursor: boolean): QueryState<D> => {
    const next: QueryState<D> = {
      ...state,
      paused: origin !== null,
      more: "idle",
      moreErrorKind: null,
    };
    if (clearCursor) next.cursor = null;
    if (!currentProfile.preserveOnSuspend && state.items.length > 0) {
      next.items = [];
    }
    if (currentProfile.clearPrimaryErrorOnSuspend) {
      next.errorKind = null;
    }
    if (!currentProfile.clearPrimaryErrorOnSuspend && next.errorKind !== null) {
      next.phase = "error";
    } else if (currentProfile.preserveOnSuspend && next.items.length > 0) {
      next.phase = "ready";
    } else {
      next.phase = "idle";
    }
    return next;
  };

  const pauseForGate = (clearCursor: boolean): void => {
    const next = pausedState(clearCursor);
    const unchanged =
      state.phase === next.phase &&
      state.items === next.items &&
      state.cursor === next.cursor &&
      state.errorKind === next.errorKind &&
      state.paused === next.paused &&
      state.more === next.more &&
      state.moreErrorKind === next.moreErrorKind;
    const inFlight = primaryInFlight || moreInFlight || primaryAbort !== null || moreAbort !== null;
    if (unchanged && !inFlight) return;
    abortAll();
    publish(next);
  };

  const isPrimaryCurrent = (seq: number): boolean => {
    if (disposed || seq !== primarySeq) return false;
    if (!isSameOrigin(origin, readOrigin())) {
      reconcile();
      refresh();
      return false;
    }
    const gate = readGate();
    if (gate !== "allowed" && origin !== null) pauseForGate(gate === "lifecycle");
    return origin !== null && gate === "allowed";
  };

  const isMoreCurrent = (seq: number): boolean => {
    if (disposed || seq !== moreSeq) return false;
    if (!isSameOrigin(origin, readOrigin())) {
      reconcile();
      refresh();
      return false;
    }
    const gate = readGate();
    if (gate !== "allowed" && origin !== null) pauseForGate(gate === "lifecycle");
    return origin !== null && gate === "allowed";
  };

  const startPrimary = (): void => {
    moreSeq++;
    moreInFlight = false;
    moreAbort?.abort();
    moreAbort = null;
    consumedCursors.clear();
    const seq = ++primarySeq;
    primaryInFlight = true;
    const abort = currentProfile.abortTransport ? new AbortController() : null;
    primaryAbort = abort;
    const patch: Partial<QueryState<D>> = {
      phase: "loading",
      paused: false,
      errorKind: null,
      more: "idle",
      moreErrorKind: null,
    };
    if (currentProfile.resetOnFirstPage) {
      patch.items = [];
      patch.cursor = null;
    }
    publish({ ...state, ...patch });
    const currentOrigin = origin!;
    invokeFetcher(currentFetcher, currentOrigin.context, {
      signal: abort?.signal ?? null,
      cursor: null,
    })
      .then((page) => {
        if (!isPrimaryCurrent(seq)) return;
        if (currentProfile.page?.validatePage)
          currentProfile.page.validatePage(page.items, currentOrigin.context);
        publish({
          ...state,
          items: dedupe(page.items),
          cursor: page.nextCursor,
          phase: "ready",
          errorKind: null,
        });
      })
      .catch((error) => {
        if (!isPrimaryCurrent(seq)) return;
        publish({ ...state, phase: "error", errorKind: classifyError(error) });
      })
      .finally(() => {
        if (seq === primarySeq) {
          primaryInFlight = false;
          primaryAbort = null;
        }
      });
  };

  const refresh = (): void => {
    if (disposed) return;
    reconcile();
    if (!origin) return;
    const gate = readGate();
    if (gate !== "allowed") {
      pauseForGate(gate === "lifecycle");
      return;
    }
    if (primaryInFlight && currentProfile.concurrent !== "override") return;
    startPrimary();
  };

  const loadMore = (): void => {
    if (disposed) return;
    reconcile();
    if (!origin) return;
    const gate = readGate();
    if (gate !== "allowed") {
      pauseForGate(gate === "lifecycle");
      return;
    }
    const cursor = state.cursor;
    if (!cursor) return;
    if (primaryInFlight || moreInFlight) return;

    const seq = ++moreSeq;
    moreInFlight = true;
    const abort = currentProfile.abortTransport ? new AbortController() : null;
    moreAbort = abort;
    publish({ ...state, more: "loading", moreErrorKind: null });
    const currentOrigin = origin;
    invokeFetcher(currentFetcher, currentOrigin.context, {
      signal: abort?.signal ?? null,
      cursor,
    })
      .then((page) => {
        if (!isMoreCurrent(seq)) return;
        if (currentProfile.page?.validatePage)
          currentProfile.page.validatePage(page.items, currentOrigin.context);
        const repeated =
          currentProfile.page?.detectRepeatedCursor === true &&
          (page.nextCursor === cursor ||
            (page.nextCursor !== null && consumedCursors.has(page.nextCursor)));
        if (repeated) {
          publish({
            ...state,
            more: "error",
            moreErrorKind: classifyError(new Error("Repeated pagination cursor")),
          });
          return;
        }
        const merged = dedupe([...state.items, ...page.items]);
        consumedCursors.add(cursor);
        publish({
          ...state,
          items: merged,
          cursor: page.nextCursor,
          more: "ready",
          moreErrorKind: null,
        });
      })
      .catch((error) => {
        if (!isMoreCurrent(seq)) return;
        publish({ ...state, more: "error", moreErrorKind: classifyError(error) });
      })
      .finally(() => {
        if (seq === moreSeq) {
          moreInFlight = false;
          moreAbort = null;
        }
      });
  };

  const removeItem = (key: string): void => {
    if (disposed) return;
    removedKeys.add(key);
    publish({ ...state, items: state.items.filter((item) => keyOfItem(item) !== key) });
  };

  const suspend = (): void => {
    if (disposed) return;
    reconcile();
    abortAll();
    consumedCursors.clear();
    publish(pausedState(true));
  };

  const resume = (): void => {
    if (disposed) return;
    reconcile();
    refresh();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    abortAll();
  };

  return {
    refresh,
    loadMore,
    retry: refresh,
    removeItem,
    updateOptions,
    reconcile,
    suspend,
    resume,
    dispose,
    getState: () => state,
  };
}
