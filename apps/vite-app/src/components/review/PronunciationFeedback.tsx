/**
 * 发音反馈组件。
 * 展示 overall_score、音素可视化、语法错误列表；两者皆无时展示中性空态。
 */

import React from "react";
import type { AssessmentResponse, GrammarErrorResponse } from "@/lib/api";
import { PhonemeVisualizer } from "./PhonemeVisualizer";
import { zhCN } from "@/i18n/zh-CN";
import { resolveSkillLabel } from "@/i18n/skillLabels";

const t = zhCN.assessment;

interface PronunciationFeedbackProps {
  assessment: AssessmentResponse | null;
  grammarErrors: GrammarErrorResponse[];
}

/** 根据分数返回颜色类 */
function getScoreColor(score: number): string {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-danger";
}

export function PronunciationFeedback({ assessment, grammarErrors }: PronunciationFeedbackProps) {
  const scoreColor = assessment ? getScoreColor(assessment.overall_score) : "";
  const hasSyntheticFeedback =
    assessment?.is_synthetic === true || grammarErrors.some((error) => error.is_synthetic);

  return (
    <div className="practice-journal__feedback">
      {hasSyntheticFeedback ? (
        <div role="note" className="practice-journal__synthetic">
          <span className="font-semibold">{t.syntheticBadge}</span>
          <span>{t.syntheticHint}</span>
        </div>
      ) : null}

      {grammarErrors.length > 0 && (
        <section className="practice-journal__section" aria-label={t.grammarTitle}>
          <div className="practice-journal__section-heading">
            <h2 className="practice-journal__section-title">
              <span>{t.grammarTitle}</span>{" "}
              <span className="practice-journal__count">({grammarErrors.length})</span>
            </h2>
          </div>

          <ol className="practice-journal__corrections">
            {grammarErrors.map((err) => {
              const hasCorrection = err.corrected.length > 0;

              return (
                <li key={err.id} className="practice-journal__correction">
                  <div className="practice-journal__correction-meta">
                    <span className="practice-journal__tag">
                      {resolveSkillLabel(err.skill_tag, (skillTag) => skillTag)}
                    </span>
                    {err.is_synthetic ? (
                      <span className="practice-journal__tag practice-journal__tag--warning">
                        {t.syntheticBadge}
                      </span>
                    ) : null}
                  </div>

                  <dl className="practice-journal__comparison">
                    <div className="practice-journal__comparison-row">
                      <dt>{t.originalCaption}</dt>
                      <dd
                        lang="en"
                        className="practice-journal__sentence practice-journal__sentence--original"
                      >
                        <del
                          aria-label={t.grammarOriginalLabel.replace("{text}", err.original)}
                          className="practice-journal__original-sentence"
                        >
                          {err.original}
                        </del>
                      </dd>
                    </div>

                    {hasCorrection ? (
                      <div className="practice-journal__comparison-row">
                        <dt>{t.correctedCaption}</dt>
                        <dd
                          lang="en"
                          className="practice-journal__sentence practice-journal__sentence--corrected"
                        >
                          <ins
                            aria-label={t.grammarCorrectedLabel.replace("{text}", err.corrected)}
                            className="practice-journal__corrected-sentence"
                          >
                            {err.corrected}
                          </ins>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {assessment ? (
        <section className="practice-journal__section" aria-label={t.scoreLabel}>
          <h2 className="practice-journal__section-title">{t.scoreLabel}</h2>
          <div
            role="group"
            className="practice-journal__score"
            aria-label={`${t.scoreLabel}: ${Math.round(assessment.overall_score)}/100`}
          >
            <span className={`practice-journal__score-value ${scoreColor}`}>
              {Math.round(assessment.overall_score)}
            </span>
            <span className="practice-journal__score-scale">/100</span>
          </div>

          {assessment.phoneme_alignment.length > 0 ? (
            <div className="practice-journal__subsection">
              <h3 className="practice-journal__subsection-title">{t.phonemeTitle}</h3>
              <PhonemeVisualizer alignment={assessment.phoneme_alignment} />
            </div>
          ) : null}
        </section>
      ) : grammarErrors.length > 0 ? (
        <p className="practice-journal__notice">{t.pronunciationUnavailable}</p>
      ) : (
        // 无发音评估且无语法提示：不暗示“零错误”，语法检测覆盖有限
        <div
          data-testid="assessment-no-feedback"
          className="practice-journal__state practice-journal__state--muted"
        >
          <p className="practice-journal__state-title">{t.noFeedbackTitle}</p>
          <p className="practice-journal__state-copy">{t.noFeedbackBody}</p>
          <p className="practice-journal__fine-print">{t.noFeedbackNote}</p>
        </div>
      )}
    </div>
  );
}
