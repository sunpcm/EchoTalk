import { catalogSkillLabels, zhCN } from "./zh-CN";

const weeklyGrammarSkillLabels: Readonly<Record<string, string>> = zhCN.weeklyGrammar.skills;

/**
 * 解析已知技能标签；未命中时必须由消费端提供原有回退。
 */
export function resolveSkillLabel(
  skillTag: string,
  fallback: (skillTag: string) => string,
): string {
  if (Object.prototype.hasOwnProperty.call(catalogSkillLabels, skillTag)) {
    return catalogSkillLabels[skillTag as keyof typeof catalogSkillLabels];
  }
  if (Object.prototype.hasOwnProperty.call(weeklyGrammarSkillLabels, skillTag)) {
    return weeklyGrammarSkillLabels[skillTag];
  }
  return fallback(skillTag);
}
