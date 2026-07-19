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
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-danger";
}

export function PronunciationFeedback({ assessment, grammarErrors }: PronunciationFeedbackProps) {
  const scoreColor = getScoreColor(assessment.overall_score);

  return (
    <div className="space-y-6">
      {/* 得分区 */}
      <div className="text-center">
        <p className="text-text-muted text-sm">{t.scoreLabel}</p>
        <p className={`text-4xl font-bold ${scoreColor}`}>
          {Math.round(assessment.overall_score)}
          <span className="text-text-faint text-lg">/100</span>
        </p>
      </div>

      {/* 音素可视化 */}
      <div>
        <h3 className="text-text-default mb-2 text-sm font-medium">{t.phonemeTitle}</h3>
        <PhonemeVisualizer alignment={assessment.phoneme_alignment} />
      </div>

      {/* 语法错误列表 */}
      {grammarErrors.length > 0 && (
        <div>
          <h3 className="text-text-default mb-2 text-sm font-medium">
            {t.grammarTitle} ({grammarErrors.length})
          </h3>
          <ul className="space-y-2">
            {grammarErrors.map((err) => (
              <li key={err.id} className="border-border-default rounded-[14px] border p-3">
                <span className="bg-surface-alt text-text-muted mr-2 inline-block rounded px-2 py-0.5 text-xs font-medium">
                  {err.skill_tag}
                </span>
                <span className="text-danger text-sm line-through">{err.original}</span>
                {err.corrected && (
                  <span className="text-success ml-2 text-sm">{err.corrected}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
