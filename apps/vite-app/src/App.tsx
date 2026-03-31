/**
 * 应用根组件。
 * Phase 4: Dashboard（推荐场景 + 每日进度 + 技能树）与 Session 视图切换。
 * Phase 5: 设置抽屉 + 设置水合。
 * Phase 7: DocChat 设置视图。
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
import { DocChatSetup } from "@/components/doc-chat/DocChatSetup";
import { zhCN } from "@/i18n/zh-CN";

const tConv = zhCN.conversation;
const tAssess = zhCN.assessment;
const tDocChat = zhCN.docChat;

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

      {/* DocTalk Entry Card */}
      <section>
        <button
          onClick={() => useConversationStore.setState({ appView: "doc-chat-setup" })}
          className="flex w-full items-center gap-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-5 text-left shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
            <svg
              className="h-6 w-6 text-indigo-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-indigo-700">{tDocChat.dashboardEntry}</h3>
            <p className="text-sm text-gray-500">{tDocChat.dashboardDesc}</p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </section>

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
        ) : appView === "doc-chat-setup" ? (
          <DocChatSetup />
        ) : (
          <VoiceInterface />
        )}
      </div>
      <SettingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
};

export default App;
