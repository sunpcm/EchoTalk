/**
 * 技能树组件。
 * 将 BKT 知识状态按 grammar / pronunciation 分组，展示进度条和掌握度。
 */

import React from "react";
import type { KnowledgeStateResponse } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.assessment;

interface SkillTreeProps {
  states: KnowledgeStateResponse[];
}

/** 按 skill_category 分组 */
function groupByCategory(
  states: KnowledgeStateResponse[],
): Record<string, KnowledgeStateResponse[]> {
  const result: Record<string, KnowledgeStateResponse[]> = {};
  for (const s of states) {
    (result[s.skill_category] ??= []).push(s);
  }
  return result;
}

function SkillRow({ state }: { state: KnowledgeStateResponse }) {
  const pct = Math.round(state.p_mastery * 100);
  const mastered = state.p_mastery >= 0.95;
  const barColor = mastered
    ? "bg-success"
    : state.p_mastery >= 0.6
      ? "bg-mid-green"
      : state.p_mastery >= 0.3
        ? "bg-warning-bar"
        : "bg-danger";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-text-default text-sm">{state.skill_name}</span>
        {mastered ? (
          <span className="bg-success-bg text-success-text rounded-full px-2 py-0.5 text-xs font-medium">
            {t.mastered}
          </span>
        ) : (
          <span className="text-text-muted text-xs">{pct}%</span>
        )}
      </div>
      <div className="bg-surface-alt h-2 w-full overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SkillTree({ states }: SkillTreeProps) {
  if (states.length === 0) return null;

  const grouped = groupByCategory(states);

  return (
    <div className="space-y-6">
      {(["pronunciation", "grammar"] as const).map((category) => {
        const skills = grouped[category];
        if (!skills || skills.length === 0) return null;

        return (
          <div key={category}>
            <h3 className="text-text-faint mb-3 text-sm font-semibold tracking-wide uppercase">
              {category === "pronunciation" ? t.pronunciation : t.grammar}
            </h3>
            <div className="space-y-3">
              {skills.map((state) => (
                <SkillRow key={state.skill_id} state={state} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
