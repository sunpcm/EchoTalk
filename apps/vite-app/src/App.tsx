/**
 * 应用根组件。
 * Phase 4: Dashboard（推荐场景 + 每日进度 + 技能树）与 Session 视图切换。
 * Phase 5: 设置抽屉 + 设置水合。
 */

import React, { useEffect, useState } from "react";
import { useConversationStore } from "@/store/conversation";
import { useAssessmentStore } from "@/store/assessment";
import { useSettingsStore } from "@/store/settings";
import { VoiceInterface } from "@/components/conversation/VoiceInterface";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { RecommendedScenarios } from "@/components/learning/RecommendedScenarios";
import { DailyProgress } from "@/components/learning/DailyProgress";
import { SkillTree } from "@/components/learning/SkillTree";
import { zhCN } from "@/i18n/zh-CN";

const tConv = zhCN.conversation;
const tAssess = zhCN.assessment;

/** Dashboard 视图：推荐场景 + 每日进度 + 技能树 */
function Dashboard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const knowledgeStates = useAssessmentStore((s) => s.knowledgeStates);
  const fetchKnowledgeStates = useAssessmentStore((s) => s.fetchKnowledgeStates);
  const error = useConversationStore((s) => s.error);

  useEffect(() => {
    void fetchKnowledgeStates();
  }, [fetchKnowledgeStates]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="relative text-center">
        <h1 className="mb-1 text-3xl font-bold text-indigo-600">{tConv.title}</h1>
        <p className="text-gray-500">{tConv.subtitle}</p>
        {/* 设置按钮 */}
        <button
          onClick={onOpenSettings}
          className="absolute top-0 right-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={zhCN.settings.title}
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.992 6.992 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </button>
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
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Phase 5: 应用启动时水合用户设置
  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {appView === "dashboard" ? (
          <Dashboard onOpenSettings={() => setDrawerOpen(true)} />
        ) : (
          <VoiceInterface />
        )}
      </div>
      <SettingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
};

export default App;
