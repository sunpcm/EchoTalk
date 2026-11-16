import React from "react";
import { useWeeklyGrammarQuery } from "@/data/use-weekly-grammar-query";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.weeklyGrammar;
const buttonClass =
  "border-border-soft focus-visible:ring-accent min-h-[44px] min-w-[44px] rounded-lg border px-3 py-2 focus-visible:ring-2 focus-visible:outline-none";

/** 只读七天语法概览。 */
export function WeeklyGrammar() {
  const view = useWeeklyGrammarQuery();

  return (
    <section aria-label={t.title} data-testid="weekly-grammar" className="min-w-0 space-y-4">
      <h2 className="text-text-default text-lg font-bold">{t.title}</h2>
      <p className="text-text-muted text-sm">{t.description}</p>
      {view.paused && <p role="status">{t.paused}</p>}
      {view.phase === "loading" && <p role="status">{t.loading}</p>}
      {view.phase === "error" && (
        <div role="alert">
          <p>{t.loadError}</p>
          <button type="button" className={buttonClass} onClick={view.retry}>
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
