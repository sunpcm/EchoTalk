/**
 * 自适应课程推荐卡片组件。
 * 挂载时请求 GET /api/curriculum/next，渲染 1-3 个推荐场景卡片。
 */

import React, { useEffect, useState } from "react";
import { getRecommendedCurriculum } from "@/lib/api";
import type { CurriculumRecommendation, CurriculumNextResponse } from "@/lib/api";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";

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
  onEnter,
}: {
  scenario: CurriculumRecommendation;
  onEnter: (scenario: CurriculumRecommendation) => void;
}) {
  const cefrColor = cefrColorMap[scenario.difficulty_cefr] ?? "bg-gray-100 text-gray-700";

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <h3 className="leading-tight font-semibold text-gray-800">{scenario.scenario_name}</h3>
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
              {skill}
            </span>
          ))}
        </div>
      </div>

      {/* Enter button */}
      <button onClick={() => onEnter(scenario)} className="btn-primary w-full text-center">
        {t.enterPractice}
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
          <ScenarioCard key={rec.scenario_name} scenario={rec} onEnter={handleEnter} />
        ))}
      </div>
    </section>
  );
}
