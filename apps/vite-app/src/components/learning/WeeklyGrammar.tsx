import React, { useEffect, useRef, useState } from "react";
import { getWeeklyGrammar, type WeeklyGrammarItem } from "@/lib/api";
import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
  type AuthPrincipal,
} from "@/lib/auth";
import { getLocalDayWindow, getLocalWeekContext } from "@/lib/localDayWindow";
import { createLifecycleAdapter } from "@/platform";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.weeklyGrammar;
type Phase = "idle" | "loading" | "ready" | "error";
interface View {
  items: WeeklyGrammarItem[];
  totalErrors: number;
  phase: Phase;
  paused: boolean;
}
interface Origin {
  principal: AuthPrincipal;
  revision: number;
  endDate: string;
  timezone: string;
}
interface Operation {
  origin: Origin;
  controller: AbortController;
}

const emptyView = (): View => ({
  items: [],
  totalErrors: 0,
  phase: "idle",
  paused: false,
});
const buttonClass =
  "border-border-soft focus-visible:ring-accent min-h-[44px] min-w-[44px] rounded-lg border px-3 py-2 focus-visible:ring-2 focus-visible:outline-none";

/** 只读七天语法概览。请求槽位与视图引用同步更新，避免 React 批处理延迟作废旧请求。 */
export function WeeklyGrammar() {
  const [view, setView] = useState<View>(emptyView);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const adapter = createLifecycleAdapter();
    let disposed = false;
    let origin: Origin | null = null;
    let state = emptyView();
    let operation: Operation | null = null;
    let midnight: ReturnType<typeof setTimeout> | undefined;
    const publish = (patch: Partial<View>) => {
      if (disposed) return;
      state = { ...state, ...patch };
      setView(state);
    };
    const invalidate = () => {
      const previous = operation;
      operation = null;
      previous?.controller.abort();
    };
    const canRead = () => {
      const lifecycle = adapter.getSnapshot();
      return lifecycle.visibility !== "hidden" && lifecycle.online !== false;
    };
    const readOrigin = (): Origin | null => {
      const auth = getAuthSnapshot();
      if (auth.state !== "authenticated" || !auth.principal) return null;
      return {
        ...getLocalWeekContext(),
        principal: auth.principal,
        revision: getAuthRevision(),
      };
    };
    const sameOrigin = (a: Origin | null, b: Origin | null) =>
      a === b ||
      (!!a &&
        !!b &&
        arePrincipalsEqual(a.principal, b.principal) &&
        a.revision === b.revision &&
        a.endDate === b.endDate &&
        a.timezone === b.timezone);
    const reconcile = () => {
      const next = readOrigin();
      if (sameOrigin(origin, next)) return false;
      invalidate();
      origin = next;
      publish({ ...emptyView(), paused: !!next && !canRead() });
      return true;
    };
    const valid = (request: Operation) => {
      if (disposed || request !== operation) return false;
      if (!sameOrigin(origin, readOrigin())) {
        refresh();
        return false;
      }
      return request.origin === origin && canRead();
    };

    function refresh() {
      if (disposed) return;
      reconcile();
      if (!origin || !canRead() || operation) return;
      const request: Operation = { origin, controller: new AbortController() };
      publish({ items: [], totalErrors: 0, phase: "loading", paused: false });
      operation = request;
      void getWeeklyGrammar(request.origin.endDate, request.origin.timezone, {
        signal: request.controller.signal,
      })
        .then((result) => {
          if (!valid(request)) return;
          publish({
            items: result.items,
            totalErrors: result.total_errors,
            phase: "ready",
          });
        })
        .catch(() => {
          if (valid(request)) publish({ phase: "error" });
        })
        .finally(() => {
          if (valid(request)) operation = null;
        });
    }

    refreshRef.current = refresh;
    const unsubscribeAuth = subscribeAuthSnapshot(() => {
      reconcile();
      refresh();
    });
    const unsubscribeLifecycle = adapter.subscribe((event) => {
      if (event.type === "suspend" || event.snapshot.online === false) {
        reconcile();
        invalidate();
        publish({ phase: "idle", paused: !!origin });
      } else if (
        (event.type === "resume" && event.snapshot.visibility === "visible") ||
        (event.type === "connectivity" &&
          event.snapshot.online === true &&
          event.snapshot.visibility !== "hidden")
      ) {
        refresh();
      }
    });
    const scheduleMidnight = () => {
      clearTimeout(midnight);
      const end = getLocalDayWindow().localEndDate.getTime();
      midnight = setTimeout(
        () => {
          reconcile();
          refresh();
          scheduleMidnight();
        },
        Math.max(1, end - Date.now()),
      );
    };
    const checkCalendar = () => {
      if (reconcile()) {
        refresh();
        scheduleMidnight();
      }
    };
    const calendarTimer = setInterval(checkCalendar, 60_000);
    window.addEventListener("focus", checkCalendar);
    refresh();
    scheduleMidnight();
    return () => {
      disposed = true;
      refreshRef.current = null;
      invalidate();
      clearTimeout(midnight);
      clearInterval(calendarTimer);
      window.removeEventListener("focus", checkCalendar);
      unsubscribeAuth();
      unsubscribeLifecycle();
      adapter.dispose();
    };
  }, []);

  return (
    <section aria-label={t.title} data-testid="weekly-grammar" className="min-w-0 space-y-4">
      <h2 className="text-text-default text-lg font-bold">{t.title}</h2>
      <p className="text-text-muted text-sm">{t.description}</p>
      {view.paused && <p role="status">{t.paused}</p>}
      {view.phase === "loading" && <p role="status">{t.loading}</p>}
      {view.phase === "error" && (
        <div role="alert">
          <p>{t.loadError}</p>
          <button type="button" className={buttonClass} onClick={() => refreshRef.current?.()}>
            {t.retry}
          </button>
        </div>
      )}
      {view.phase === "ready" && (
        <>
          <p className="text-text-muted text-sm">
            {t.total.replace("{count}", String(view.totalErrors))}
          </p>
          {view.items.length === 0 ? (
            <p>{t.empty}</p>
          ) : (
            <ol aria-label={t.list} className="space-y-2">
              {view.items.map((item, index) => (
                <li
                  key={item.skill_tag}
                  className="border-border-soft min-w-0 rounded-lg border p-3"
                  data-testid={`weekly-grammar-${item.skill_tag}`}
                >
                  <p className="font-semibold">
                    <span className="sr-only">{t.rank.replace("{rank}", String(index + 1))}</span>
                    {t.skills[item.skill_tag]}
                  </p>
                  <p className="text-text-muted text-sm">
                    {t.count.replace("{count}", String(item.count))}
                  </p>
                  <p className="text-text-muted text-sm">{t.tips[item.skill_tag]}</p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
