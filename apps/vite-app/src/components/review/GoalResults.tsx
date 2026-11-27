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
      className="practice-journal__section practice-journal__goals"
    >
      <h2 className="practice-journal__section-title">{t.title}</h2>
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
        <p role="alert" className="text-danger text-sm leading-relaxed">
          {t.loadError}
        </p>
        <button type="button" onClick={query.retry} className="practice-journal__retry btn-primary">
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
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-danger text-sm">
          {t.loadError}
        </p>
        <button type="button" onClick={query.retry} className="practice-journal__retry btn-primary">
          {t.retry}
        </button>
      </div>,
    );
  }

  return frame(
    <div className="practice-journal__goal-body">
      <div data-testid="goal-summary" className="practice-journal__goal-summary">
        <p>{`${t.achieved} ${summary.achieved} / ${t.assessed} ${summary.assessed} / ${t.total} ${summary.total}`}</p>
        <p className="text-text-muted">{`${t.unknown} ${summary.unknown}`}</p>
        <p className="text-text-muted">{`${t.notAssessed} ${summary.not_assessed}`}</p>
      </div>
      <ul className="practice-journal__goal-list">
        {response.goals.map((goal) => {
          if (goal.result === null) return null;
          return (
            <li key={goal.goal_id} data-testid="goal-result" className="practice-journal__goal-row">
              <p className="text-text-default min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere] break-words">
                {goal.description_zh}
              </p>
              <span className={`practice-journal__goal-status ${resultClasses[goal.result]}`}>
                {resultLabels[goal.result]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>,
  );
}
