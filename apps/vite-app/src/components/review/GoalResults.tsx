import type { ReactNode } from "react";
import { useSessionGoalsQuery } from "@/data/use-session-goals-query";
import { zhCN } from "@/i18n/zh-CN";
import type { SessionGoalResultStatus } from "@/lib/api";

const t = zhCN.sessionGoals;

const resultLabels: Record<SessionGoalResultStatus, string> = {
  achieved: t.achieved,
  not_achieved: t.notAchieved,
  unknown: t.unknown,
  not_assessed: t.notAssessed,
};

const resultClasses: Record<SessionGoalResultStatus, string> = {
  achieved: "bg-success-bg text-success-text",
  not_achieved: "bg-danger-bg text-danger-text",
  unknown: "bg-warning-bg text-warning",
  not_assessed: "bg-surface-alt text-text-muted",
};

export interface GoalResultsProps {
  readonly sessionId: string | null;
}

export function GoalResults({ sessionId }: GoalResultsProps) {
  const query = useSessionGoalsQuery(sessionId);

  if (!sessionId) return null;

  const frame = (children: ReactNode) => (
    <section
      data-testid="goal-results"
      aria-label={t.title}
      className="border-border-default bg-surface w-full max-w-md rounded-[20px] border p-5 shadow-sm"
    >
      <h2 className="text-text-default mb-4 text-lg font-semibold">{t.title}</h2>
      {children}
    </section>
  );

  if (query.errorKind) {
    if (query.errorStatus === 404) {
      return frame(
        <p role="status" className="text-text-muted text-sm leading-relaxed">
          {t.unavailable}
        </p>,
      );
    }
    return frame(
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-danger text-sm leading-relaxed">
          {t.loadError}
        </p>
        <button
          type="button"
          onClick={query.retry}
          className="btn-primary focus-visible:outline-accent inline-flex min-h-11 min-w-11 items-center justify-center px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t.retry}
        </button>
      </div>,
    );
  }

  if (!query.data) {
    return frame(
      <p role="status" className="text-text-muted text-sm">
        {t.loading}
      </p>,
    );
  }

  const response = query.data;

  if (!response.configured) {
    return frame(
      <p role="status" className="text-text-muted text-sm leading-relaxed">
        {t.notConfigured}
      </p>,
    );
  }

  const executionStatus = response.execution?.status;
  if (executionStatus === "pending" || executionStatus === "running") {
    return frame(
      <p role="status" className="text-text-muted text-sm">
        {t.evaluating}
      </p>,
    );
  }

  const summary = response.summary;
  if (!summary) {
    return frame(
      <p role="status" className="text-danger text-sm">
        {t.loadError}
      </p>,
    );
  }

  return frame(
    <div className="space-y-4">
      <div
        data-testid="goal-summary"
        className="bg-surface-alt text-text-default space-y-1 rounded-lg px-3 py-2 text-sm"
      >
        <p>{`${t.achieved} ${summary.achieved} / ${t.assessed} ${summary.assessed} / ${t.total} ${summary.total}`}</p>
        <p className="text-text-muted">{`${t.unknown} ${summary.unknown}`}</p>
        <p className="text-text-muted">{`${t.notAssessed} ${summary.not_assessed}`}</p>
      </div>
      <ul className="space-y-2">
        {response.goals.map((goal) => {
          if (goal.result === null) return null;
          return (
            <li
              key={goal.goal_id}
              data-testid="goal-result"
              className="border-border-default flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <p className="text-text-default min-w-0 text-sm leading-relaxed break-words">
                {goal.description_zh}
              </p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${resultClasses[goal.result]}`}
              >
                {resultLabels[goal.result]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>,
  );
}
