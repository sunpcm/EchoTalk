/**
 * 发音反馈组件。
 * 展示 overall_score、音素可视化、语法错误列表。
 */

import React from "react";
import type { AssessmentResponse, GrammarErrorResponse } from "@/lib/api";
import { PhonemeVisualizer } from "@/components/pronunciation/PhonemeVisualizer";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.assessment;

interface PronunciationFeedbackProps {
  assessment: AssessmentResponse;
  grammarErrors: GrammarErrorResponse[];
}

/** 根据分数返回颜色类 */
function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

export function PronunciationFeedback({ assessment, grammarErrors }: PronunciationFeedbackProps) {
  const scoreColor = getScoreColor(assessment.overall_score);

  return (
    <div className="space-y-6">
      {/* 得分区 */}
      <div className="text-center">
        <p className="text-sm text-gray-500">{t.scoreLabel}</p>
        <p className={`text-4xl font-bold ${scoreColor}`}>
          {Math.round(assessment.overall_score)}
          <span className="text-lg text-gray-400">/100</span>
        </p>
      </div>

      {/* 音素可视化 */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700">{t.phonemeTitle}</h3>
        <PhonemeVisualizer alignment={assessment.phoneme_alignment} />
      </div>

      {/* 语法错误列表 */}
      {grammarErrors.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-700">
            {t.grammarTitle} ({grammarErrors.length})
          </h3>
          <ul className="space-y-2">
            {grammarErrors.map((err) => (
              <li key={err.id} className="rounded-lg border border-gray-200 p-3">
                <span className="mr-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {err.skill_tag}
                </span>
                <span className="text-sm text-red-600 line-through">{err.original}</span>
                {err.corrected && (
                  <span className="ml-2 text-sm text-green-600">{err.corrected}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
