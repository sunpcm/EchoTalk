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
  A1: "bg-green-100 text-green-700",
  A2: "bg-green-100 text-green-700",
  B1: "bg-blue-100 text-blue-700",
  B2: "bg-blue-100 text-blue-700",
  C1: "bg-purple-100 text-purple-700",
  C2: "bg-purple-100 text-purple-700",
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
  const cefrColor = cefrColorMap[scenario.difficulty_cefr] ?? "bg-gray-100 text-gray-700";

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <h3 className="leading-tight font-semibold text-gray-800">
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
        <p className="mb-1.5 text-xs text-gray-500">{t.focusSkills}</p>
        <div className="flex flex-wrap gap-1.5">
          {scenario.focus_skills.map((skill) => (
            <span
              key={skill}
              className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
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
              className="mr-2 h-4 w-4 animate-spin text-white"
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
      <div className="py-8 text-center text-gray-400">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
        {t.loading}
      </div>
    );
  }

  if (error || !data) {
    return <div className="py-8 text-center text-sm text-gray-400">{t.loadError}</div>;
  }

  if (data.recommendations.length === 0) {
    return <div className="py-8 text-center text-sm text-gray-400">{t.noRecommendations}</div>;
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-bold text-gray-800">{t.recommendTitle}</h2>
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
