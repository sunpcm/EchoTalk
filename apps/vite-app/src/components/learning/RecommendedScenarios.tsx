/**
 * 自适应课程推荐卡片组件。
 * 挂载时请求 GET /api/curriculum/next，渲染 1-3 个推荐场景卡片。
 */

import React, { useEffect, useState } from "react";
import { getRecommendedCurriculum } from "@/lib/api";
import type { CurriculumRecommendation, CurriculumNextResponse } from "@/lib/api";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";
import { formatTitle } from "@/utils/format";

const t = zhCN.dashboard;

/** CEFR 等级对应的配色 */
const cefrColorMap: Record<string, string> = {
  A1: "bg-success-bg text-success-text",
  A2: "bg-success-bg text-success-text",
  B1: "bg-warning-bg text-warning",
  B2: "bg-accent-soft-bg text-accent-soft-text",
  C1: "bg-accent-soft-bg text-accent-soft-text",
  C2: "bg-accent-soft-bg text-accent-soft-text",
};

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

  return (
    <div className="border-border-default bg-surface flex flex-col rounded-[20px] border p-5 shadow-[0_6px_22px_-14px_var(--card-shadow)] transition-shadow hover:shadow-[0_10px_26px_-12px_var(--card-shadow)]">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <h3 className="text-text-default leading-tight font-semibold">
          {formatTitle(scenario.scenario_name)}
        </h3>
        <span
          className={`ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${cefrColor}`}
        >
          {scenario.difficulty_cefr}
        </span>
      </div>

      {/* Focus skills */}
      <div className="mb-4 flex-1">
        <p className="text-text-muted mb-1.5 text-xs">{t.focusSkills}</p>
        <div className="flex flex-wrap gap-1.5">
          {scenario.focus_skills.map((skill) => (
            <span
              key={skill}
              className="bg-accent-soft-bg text-accent-soft-text rounded-md px-2 py-0.5 text-xs"
            >
              {formatTitle(skill)}
            </span>
          ))}
        </div>
      </div>

      {/* Enter button */}
      <button
        onClick={() => onEnter(scenario)}
        disabled={isChecking}
        className="btn-primary flex w-full items-center justify-center disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isChecking ? (
          <>
            <svg
              className="text-accent-contrast mr-2 h-4 w-4 animate-spin"
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
            检测服务中...
          </>
        ) : (
          t.enterPractice
        )}
      </button>
    </div>
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

  useEffect(() => {
    let cancelled = false;
    getRecommendedCurriculum()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnter = (scenario: CurriculumRecommendation) => {
    setSelectedScenario(scenario);
    void startSession("scenario");
  };

  if (loading) {
    return (
      <div className="text-text-faint py-8 text-center">
        <div className="border-border-default mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        {t.loading}
      </div>
    );
  }

  if (error || !data) {
    return <div className="text-text-faint py-8 text-center text-sm">{t.loadError}</div>;
  }

  if (data.recommendations.length === 0) {
    return <div className="text-text-faint py-8 text-center text-sm">{t.noRecommendations}</div>;
  }

  return (
    <section>
      <h2 className="text-text-default mb-4 text-lg font-bold">{t.recommendTitle}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.recommendations.slice(0, 3).map((rec) => (
          <ScenarioCard
            key={rec.scenario_name}
            scenario={rec}
            isChecking={isChecking}
            onEnter={handleEnter}
          />
        ))}
      </div>
    </section>
  );
}
