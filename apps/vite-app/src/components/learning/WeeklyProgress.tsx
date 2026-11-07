import React, { useEffect, useRef, useState } from "react";
import {
  getWeeklyProgress,
  listSessions,
  type SessionListItem,
  type SessionListResponse,
  type WeeklyProgressDay,
} from "@/lib/api";
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

const t = zhCN.weeklyProgress;
type Phase = "idle" | "loading" | "ready" | "error";
interface View {
  days: WeeklyProgressDay[];
  selected: string;
  items: SessionListItem[];
  cursor: string | null;
  week: Phase;
  history: Phase;
  more: Phase;
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
interface Actions {
  refresh: () => void;
  select: (date: string) => void;
  history: () => void;
  more: () => void;
}

const emptyView = (): View => ({
  days: [],
  selected: "",
  items: [],
  cursor: null,
  week: "idle",
  history: "idle",
  more: "idle",
  paused: false,
});
const buttonClass =
  "border-border-soft focus-visible:ring-accent min-h-[44px] min-w-[44px] rounded-lg border px-3 py-2 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

/** 只读概览。请求槽位和视图引用同步更新，不能让 React 批处理延迟作废旧操作。 */
export function WeeklyProgress() {
  const [view, setView] = useState<View>(emptyView);
  const actions = useRef<Actions | null>(null);

  useEffect(() => {
    const adapter = createLifecycleAdapter();
    let disposed = false;
    let origin: Origin | null = null;
    let state = emptyView();
    let weekly: Operation | null = null;
    let history: Operation | null = null;
    let more: Operation | null = null;
    let midnight: ReturnType<typeof setTimeout> | undefined;
    const consumedCursors = new Set<string>();
    const publish = (patch: Partial<View>) => {
      if (disposed) return;
      state = { ...state, ...patch };
      setView(state);
    };
    const invalidateHistory = () => {
      const previous = [history, more];
      history = null;
      more = null;
      consumedCursors.clear();
      previous.forEach((operation) => operation?.controller.abort());
    };
    const invalidate = () => {
      const previous = weekly;
      weekly = null;
      invalidateHistory();
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
      publish({ ...emptyView(), selected: next?.endDate ?? "", paused: !!next && !canRead() });
      return true;
    };
    const valid = (operation: Operation, slot: Operation | null) => {
      if (disposed || operation !== slot) return false;
      // 时区/午夜可先于定时器改变；结算时也核对真实归属。
      if (!sameOrigin(origin, readOrigin())) {
        refresh();
        return false;
      }
      return operation.origin === origin && canRead();
    };
    const operation = (): Operation => ({ origin: origin!, controller: new AbortController() });
    const checkedItems = (page: SessionListResponse, day: WeeklyProgressDay) => {
      if (
        page.items.some(
          (item) =>
            item.status !== "completed" ||
            Date.parse(item.started_at) < Date.parse(day.start) ||
            Date.parse(item.started_at) >= Date.parse(day.end),
        )
      ) {
        throw new Error("Invalid history window");
      }
      return page.items;
    };
    const unique = (items: SessionListItem[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = item.id.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    function loadHistory() {
      if (disposed) return;
      if (reconcile()) {
        refresh();
        return;
      }
      if (!origin || !canRead() || weekly || history) return;
      const day = state.days.find((entry) => entry.date === state.selected);
      if (!day) return;
      invalidateHistory();
      publish({ items: [], cursor: null, history: "loading", more: "idle" });
      if (Date.parse(day.start) === Date.parse(day.end)) {
        publish({ history: "ready" });
        return;
      }
      const request = operation();
      history = request;
      void listSessions(
        { status: "completed", start: day.start, end: day.end, limit: 50 },
        { signal: request.controller.signal },
      )
        .then((page) => {
          if (!valid(request, history)) return;
          publish({
            items: unique(checkedItems(page, day)),
            cursor: page.next_cursor,
            history: "ready",
          });
        })
        .catch(() => {
          if (valid(request, history)) publish({ history: "error" });
        })
        .finally(() => {
          if (valid(request, history)) history = null;
        });
    }

    function refresh() {
      if (disposed) return;
      reconcile();
      if (!origin || !canRead() || weekly) return;
      invalidateHistory();
      publish({
        week: "loading",
        history: "idle",
        more: "idle",
        cursor: null,
        items: [],
        paused: false,
      });
      const request = operation();
      weekly = request;
      void getWeeklyProgress(request.origin.endDate, request.origin.timezone, {
        signal: request.controller.signal,
      })
        .then((result) => {
          if (!valid(request, weekly)) return;
          const selected = result.days.some((day) => day.date === state.selected)
            ? state.selected
            : request.origin.endDate;
          publish({ days: result.days, selected, week: "ready" });
          // 只释放自己占用的槽位，随后启动属于本批桶的单日历史。
          weekly = null;
          loadHistory();
        })
        .catch(() => {
          if (valid(request, weekly)) publish({ week: "error" });
        })
        .finally(() => {
          if (valid(request, weekly)) weekly = null;
        });
    }

    const select = (date: string) => {
      if (disposed) return;
      if (reconcile()) {
        refresh();
        return;
      }
      if (
        !origin ||
        weekly ||
        !state.days.some((day) => day.date === date) ||
        date === state.selected
      )
        return;
      invalidateHistory();
      publish({ selected: date, items: [], cursor: null, history: "idle", more: "idle" });
      loadHistory();
    };
    const loadMore = () => {
      if (disposed) return;
      if (reconcile()) {
        refresh();
        return;
      }
      const cursor = state.cursor;
      const day = state.days.find((entry) => entry.date === state.selected);
      if (!origin || !canRead() || !cursor || !day || weekly || history || more) return;
      const request = operation();
      more = request;
      publish({ more: "loading" });
      void listSessions(
        { status: "completed", start: day.start, end: day.end, limit: 50, cursor },
        { signal: request.controller.signal },
      )
        .then((page) => {
          if (!valid(request, more)) return;
          const items = checkedItems(page, day);
          if (
            page.next_cursor === cursor ||
            (page.next_cursor && consumedCursors.has(page.next_cursor))
          ) {
            throw new Error("Repeated pagination cursor");
          }
          consumedCursors.add(cursor);
          publish({
            items: unique([...state.items, ...items]),
            cursor: page.next_cursor,
            more: "ready",
          });
        })
        .catch(() => {
          if (valid(request, more)) publish({ more: "error" });
        })
        .finally(() => {
          if (valid(request, more)) more = null;
        });
    };

    actions.current = { refresh, select, history: loadHistory, more: loadMore };
    const unsubscribeAuth = subscribeAuthSnapshot(() => {
      reconcile();
      refresh();
    });
    const unsubscribeLifecycle = adapter.subscribe((event) => {
      if (event.type === "suspend" || event.snapshot.online === false) {
        reconcile();
        invalidate();
        publish({ cursor: null, week: "idle", history: "idle", more: "idle", paused: !!origin });
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
    // 只核日历和时区，不轮询 API；系统时区变化没有标准 DOM 事件。
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
      actions.current = null;
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
    <section aria-label={t.title} data-testid="weekly-progress" className="min-w-0 space-y-4">
      <h2 className="text-text-default text-lg font-bold">{t.title}</h2>
      <p className="text-text-muted text-sm">{t.description}</p>
      {view.paused && <p role="status">{t.paused}</p>}
      {view.week === "loading" && <p role="status">{t.loading}</p>}
      {view.week === "error" && (
        <div role="alert">
          <p>{t.loadError}</p>
          <button type="button" className={buttonClass} onClick={() => actions.current?.refresh()}>
            {t.retry}
          </button>
        </div>
      )}
      {view.days.length > 0 && (
        <ul aria-label={t.dayList} className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {view.days.map((day) => (
            <li key={day.date} className="min-w-0">
              <button
                type="button"
                aria-pressed={view.selected === day.date}
                aria-label={t.dayLabel
                  .replace("{date}", day.date)
                  .replace("{count}", String(day.completed_sessions))}
                disabled={view.week === "loading"}
                onClick={() => actions.current?.select(day.date)}
                className={`${buttonClass} w-full text-sm ${view.selected === day.date ? "bg-accent-soft-bg text-accent" : "text-text-default"}`}
              >
                <time dateTime={day.date} className="block">
                  {day.date.slice(5)}
                </time>
                <span className="block">
                  {t.count.replace("{count}", String(day.completed_sessions))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.selected && view.days.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-text-default font-semibold">
            {t.historyTitle.replace("{date}", view.selected)}
          </h3>
          {view.history === "loading" && <p role="status">{t.historyLoading}</p>}
          {view.history === "error" && (
            <div role="alert">
              <p>{t.historyError}</p>
              <button
                type="button"
                className={buttonClass}
                onClick={() => actions.current?.history()}
              >
                {t.retryHistory}
              </button>
            </div>
          )}
          {view.history === "ready" && view.items.length === 0 && <p>{t.empty}</p>}
          <ul aria-label={t.historyList} className="space-y-2">
            {view.items.map((item) => (
              <li
                key={item.id.toLowerCase()}
                data-testid={`weekly-session-${item.id}`}
                className="border-border-soft min-w-0 rounded-lg border p-3"
              >
                <p>
                  {Object.prototype.hasOwnProperty.call(zhCN.activeSessions.modes, item.mode)
                    ? zhCN.activeSessions.modes[item.mode as keyof typeof zhCN.activeSessions.modes]
                    : zhCN.activeSessions.unknownMode}
                </p>
                <time dateTime={item.started_at} className="text-text-muted text-sm">
                  {new Date(item.started_at).toLocaleString("zh-CN")}
                </time>
              </li>
            ))}
          </ul>
          {view.more === "error" && <p role="alert">{t.moreError}</p>}
          {view.cursor && (
            <button
              type="button"
              className={buttonClass}
              disabled={view.more === "loading" || view.paused}
              onClick={() => actions.current?.more()}
            >
              {view.more === "loading"
                ? t.loadingMore
                : view.more === "error"
                  ? t.retryMore
                  : t.loadMore}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
