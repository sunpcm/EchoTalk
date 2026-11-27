/**
 * 自适应课程推荐卡片组件。
 * 挂载时请求 GET /api/curriculum/next，渲染 1-3 个推荐场景卡片。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { getRecommendedCurriculum } from "@/lib/api";
import type { CurriculumRecommendation, CurriculumNextResponse } from "@/lib/api";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";
import { resolveSkillLabel } from "@/i18n/skillLabels";
import { SectionState } from "@/components/shared/SectionState";
import { formatTitle } from "@/utils/format";
import bistroImage from "@/assets/bistro.webp";
import practiceNotebookImage from "@/assets/practice-notebook.webp";

const t = zhCN.dashboard;

function getScenarioLabels(scenarioName: string) {
  const englishTitle = formatTitle(scenarioName);
  const hasLocalizedTitle = Object.prototype.hasOwnProperty.call(t.scenarioTitles, scenarioName);

  return {
    englishTitle,
    hasLocalizedTitle,
    displayTitle: hasLocalizedTitle
      ? t.scenarioTitles[scenarioName as keyof typeof t.scenarioTitles]
      : englishTitle,
  };
}

/** CEFR 等级对应的配色 */
const cefrColorMap: Record<string, string> = {
  A1: "bg-success-bg text-success-text",
  A2: "bg-success-bg text-success-text",
  B1: "bg-warning-bg text-warning",
  B2: "bg-accent-soft-bg text-accent-soft-text",
  C1: "bg-accent-soft-bg text-accent-soft-text",
  C2: "bg-accent-soft-bg text-accent-soft-text",
};

function EnterScenarioButton({
  scenario,
  isChecking,
  onEnter,
  className = "",
}: {
  scenario: CurriculumRecommendation;
  isChecking?: boolean;
  onEnter: (scenario: CurriculumRecommendation) => void;
  className?: string;
}) {
  const { englishTitle } = getScenarioLabels(scenario.scenario_name);

  return (
    <button
      type="button"
      onClick={() => onEnter(scenario)}
      disabled={isChecking}
      aria-busy={isChecking ? true : undefined}
      aria-label={`${t.enterPractice}：${englishTitle}`}
      className={`journal-practice-cta btn-primary focus-visible:ring-accent inline-flex min-h-[44px] items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
    >
      {isChecking ? (
        <>
          <svg
            aria-hidden="true"
            className="mr-2 h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {t.checkingService}
        </>
      ) : (
        t.enterPractice
      )}
    </button>
  );
}

function ScenarioCard({
  scenario,
  isChecking,
  onEnter,
}: {
  scenario: CurriculumRecommendation;
  isChecking?: boolean;
  onEnter: (scenario: CurriculumRecommendation) => void;
}) {
  const cefrColor = cefrColorMap[scenario.difficulty_cefr] ?? "bg-surface-alt text-text-muted";
  const goals = scenario.goal_binding?.goals ?? [];
  const { displayTitle, englishTitle, hasLocalizedTitle } = getScenarioLabels(
    scenario.scenario_name,
  );

  return (
    <article className="journal-scenario-card">
      {/* Header */}
      <div className="journal-scenario-card__head">
        <h3
          className="journal-scenario-card__title"
          aria-label={hasLocalizedTitle ? `${displayTitle} ${englishTitle}` : undefined}
        >
          {displayTitle}
        </h3>
        <span
          title={`${t.difficulty}：${scenario.difficulty_cefr}`}
          aria-label={`${t.difficulty}：${scenario.difficulty_cefr}`}
          className={`journal-scenario-card__cefr ${cefrColor}`}
        >
          {scenario.difficulty_cefr}
        </span>
      </div>
      {hasLocalizedTitle && (
        <p className="journal-scenario-card__scene" lang="en" aria-hidden="true">
          {englishTitle}
        </p>
      )}

      {/* Focus skills */}
      <div className="journal-scenario-card__body">
        <p className="journal-eyebrow">{t.focusSkills}</p>
        <div className="journal-scenario-card__skills">
          {scenario.focus_skills.map((skill) => (
            <span key={skill} className="journal-skill-tag">
              {resolveSkillLabel(skill, formatTitle)}
            </span>
          ))}
        </div>
        {goals.length > 0 ? (
          <section aria-label={t.goalPreview} className="journal-scenario-card__goals">
            <p className="journal-eyebrow">{t.goalPreview}</p>
            <ul>
              {goals.map((goal) => (
                <li key={goal.goal_id} data-testid="recommendation-goal">
                  <span>{goal.description_zh}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* Enter button */}
      <EnterScenarioButton
        scenario={scenario}
        isChecking={isChecking}
        onEnter={onEnter}
        className="journal-scenario-card__cta"
      />
    </article>
  );
}

function HeroScenario({
  scenario,
  isChecking,
  onEnter,
}: {
  scenario: CurriculumRecommendation;
  isChecking?: boolean;
  onEnter: (scenario: CurriculumRecommendation) => void;
}) {
  const cefrColor = cefrColorMap[scenario.difficulty_cefr] ?? "bg-surface-alt text-text-muted";
  const goals = scenario.goal_binding?.goals ?? [];
  const isRestaurant = scenario.scenario_name === "restaurant_ordering";
  const heroImage = isRestaurant ? bistroImage : practiceNotebookImage;
  const { displayTitle, englishTitle, hasLocalizedTitle } = getScenarioLabels(
    scenario.scenario_name,
  );

  return (
    <article className="journal-hero">
      <div className="journal-hero__body">
        <h3
          className="journal-hero__title"
          aria-label={hasLocalizedTitle ? `${displayTitle} ${englishTitle}` : undefined}
        >
          {displayTitle}
        </h3>
        <p className="journal-hero__scene">
          {hasLocalizedTitle && (
            <>
              <span lang="en" aria-hidden="true">
                {englishTitle}
              </span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <span
            title={`${t.difficulty}：${scenario.difficulty_cefr}`}
            aria-label={`${t.difficulty}：${scenario.difficulty_cefr}`}
            className={`journal-hero__cefr ${cefrColor}`}
          >
            {scenario.difficulty_cefr}
          </span>
        </p>

        <div className="journal-hero__skills">
          <p className="journal-eyebrow">{t.focusSkills}</p>
          <div className="journal-hero__skill-list">
            {scenario.focus_skills.map((skill) => (
              <span key={skill} className="journal-skill-tag">
                {resolveSkillLabel(skill, formatTitle)}
              </span>
            ))}
          </div>
        </div>

        {goals.length > 0 && (
          <section aria-label={t.goalPreview} className="journal-hero__goals">
            <ul className="journal-hero__goal-list">
              {goals.map((goal) => (
                <li
                  key={goal.goal_id}
                  data-testid="recommendation-goal"
                  className="journal-hero__goal"
                >
                  <span className="journal-hero__goal-zh">{goal.description_zh}</span>
                  <span className="journal-hero__goal-en" lang="en">
                    {goal.description_en}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <EnterScenarioButton
          scenario={scenario}
          isChecking={isChecking}
          onEnter={onEnter}
          className="journal-hero__cta"
        />
      </div>
      <figure className="journal-hero__photo" aria-hidden="true">
        <img src={heroImage} alt="" />
      </figure>
    </article>
  );
}

export function RecommendedScenarios() {
  const [data, setData] = useState<CurriculumNextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const startSession = useConversationStore((s) => s.startSession);
  const setSelectedScenario = useConversationStore((s) => s.setSelectedScenario);
  const connectionState = useConversationStore((s) => s.connectionState);
  const isChecking = connectionState === "checking_health";

  // 请求代际：重试或卸载后，旧响应不得写回
  const requestIdRef = useRef(0);

  const loadRecommendations = useCallback(() => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;
    setLoading(true);
    setError(false);
    getRecommendedCurriculum()
      .then((res) => {
        if (isCurrent()) setData(res);
      })
      .catch(() => {
        if (isCurrent()) setError(true);
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadRecommendations();
    const invalidatePendingRequests = () => {
      requestIdRef.current++;
    };
    return invalidatePendingRequests;
  }, [loadRecommendations]);

  const handleEnter = (scenario: CurriculumRecommendation) => {
    setSelectedScenario(scenario);
    void startSession("scenario");
  };

  if (loading) {
    return <SectionState title={t.recommendTitle} kind="loading" message={t.loading} />;
  }

  if (error || !data) {
    return (
      <SectionState
        title={t.recommendTitle}
        kind="error"
        message={t.loadError}
        onRetry={loadRecommendations}
        retryLabel={t.retry}
      />
    );
  }

  if (data.recommendations.length === 0) {
    return <SectionState title={t.recommendTitle} kind="empty" message={t.noRecommendations} />;
  }

  const hero = data.recommendations[0];
  const remaining = data.recommendations.slice(1, 3);
  const recommendationTitleId = "journal-recommendations-title";

  return (
    <section className="journal-recommendations" aria-labelledby={recommendationTitleId}>
      <h2 id={recommendationTitleId} className="journal-visually-hidden">
        {t.recommendTitle}
      </h2>
      <HeroScenario scenario={hero} isChecking={isChecking} onEnter={handleEnter} />
      {remaining.length > 0 && (
        <div className="journal-recommendations__alternatives">
          {remaining.map((rec) => (
            <ScenarioCard
              key={rec.scenario_name}
              scenario={rec}
              isChecking={isChecking}
              onEnter={handleEnter}
            />
          ))}
        </div>
      )}
    </section>
  );
}
