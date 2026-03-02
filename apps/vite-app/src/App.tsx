/**
 * 应用根组件。
 * Phase 4: Dashboard（推荐场景 + 每日进度 + 技能树）与 Session 视图切换。
 */

import React, { useEffect } from "react";
import { useConversationStore } from "@/store/conversation";
import { useAssessmentStore } from "@/store/assessment";
import { VoiceInterface } from "@/components/conversation/VoiceInterface";
import { RecommendedScenarios } from "@/components/learning/RecommendedScenarios";
import { DailyProgress } from "@/components/learning/DailyProgress";
import { SkillTree } from "@/components/learning/SkillTree";
import { zhCN } from "@/i18n/zh-CN";

const tConv = zhCN.conversation;
const tAssess = zhCN.assessment;

/** Dashboard 视图：推荐场景 + 每日进度 + 技能树 */
function Dashboard() {
  const knowledgeStates = useAssessmentStore((s) => s.knowledgeStates);
  const fetchKnowledgeStates = useAssessmentStore((s) => s.fetchKnowledgeStates);
  const error = useConversationStore((s) => s.error);

  useEffect(() => {
    void fetchKnowledgeStates();
  }, [fetchKnowledgeStates]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="mb-1 text-3xl font-bold text-indigo-600">{tConv.title}</h1>
        <p className="text-gray-500">{tConv.subtitle}</p>
      </div>

      {/* Connection error feedback */}
      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-center text-sm text-red-600">
          <p className="font-medium">{tConv.errorTitle}</p>
          <p>{error}</p>
        </div>
      )}

      {/* Recommended Scenarios */}
      <RecommendedScenarios />

      {/* Daily Progress */}
      <DailyProgress />

      {/* Skill Tree */}
      {knowledgeStates.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-bold text-gray-800">{tAssess.skillTreeTitle}</h2>
          <SkillTree states={knowledgeStates} />
        </section>
      )}
    </div>
  );
}

const App = () => {
  const appView = useConversationStore((s) => s.appView);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {appView === "dashboard" ? <Dashboard /> : <VoiceInterface />}
      </div>
    </div>
  );
};

export default App;
