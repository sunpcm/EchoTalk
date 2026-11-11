/**
 * 发音反馈组件。
 * 展示 overall_score、音素可视化、语法错误列表；两者皆无时展示中性空态。
 */

import React from "react";
import type { AssessmentResponse, GrammarErrorResponse } from "@/lib/api";
import { PhonemeVisualizer } from "@/components/pronunciation/PhonemeVisualizer";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.assessment;

interface PronunciationFeedbackProps {
  assessment: AssessmentResponse | null;
  grammarErrors: GrammarErrorResponse[];
}

const skillLabels: Record<string, string> = zhCN.weeklyGrammar.skills;

/** 语法技能标签的中文名；未知标签原样显示，不猜测。 */
function resolveSkillLabel(tag: string): string {
  return Object.prototype.hasOwnProperty.call(skillLabels, tag) ? skillLabels[tag] : tag;
}

/** 根据分数返回颜色类 */
function getScoreColor(score: number): string {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-danger";
}

export function PronunciationFeedback({ assessment, grammarErrors }: PronunciationFeedbackProps) {
  const scoreColor = assessment ? getScoreColor(assessment.overall_score) : "";

  return (
    <div className="space-y-6">
      {assessment ? (
        <>
          {/* 得分区 */}
          <div
            role="group"
            className="text-center"
            aria-label={`${t.scoreLabel}: ${Math.round(assessment.overall_score)}/100`}
          >
            {assessment.is_synthetic ? (
              <div
                role="note"
                className="bg-warning-bg text-warning mb-3 rounded-lg px-3 py-2 text-sm"
              >
                <span className="font-semibold">{t.syntheticBadge}</span>
                <span className="ml-2">{t.syntheticHint}</span>
              </div>
            ) : null}
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
        </>
      ) : grammarErrors.length > 0 ? (
        <p className="text-text-muted text-center text-sm">{t.pronunciationUnavailable}</p>
      ) : (
        // 无发音评估且无语法提示：不暗示“零错误”，语法检测覆盖有限
        <div data-testid="assessment-no-feedback" className="space-y-2 text-center">
          <p className="text-text-default text-base font-semibold">{t.noFeedbackTitle}</p>
          <p className="text-text-default text-sm">{t.noFeedbackBody}</p>
          <p className="text-text-muted text-xs">{t.noFeedbackNote}</p>
        </div>
      )}

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
                  {resolveSkillLabel(err.skill_tag)}
                </span>
                <del
                  aria-label={t.grammarOriginalLabel.replace("{text}", err.original)}
                  className="text-danger text-sm line-through"
                >
                  {err.original}
                </del>
                {err.corrected && (
                  <>
                    <span
                      aria-hidden="true"
                      className="text-text-faint mx-2 inline-block text-xs select-none"
                    >
                      →
                    </span>
                    <ins
                      aria-label={t.grammarCorrectedLabel.replace("{text}", err.corrected)}
                      className="text-success text-sm font-medium no-underline"
                    >
                      {err.corrected}
                    </ins>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
