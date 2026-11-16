/**
 * 应用根组件。
 * Phase 4: Dashboard（推荐场景 + 每日进度 + 技能树）与 Session 视图切换。
 * Phase 5: 设置抽屉 + 设置水合。
 * Phase 7: DocChat 设置视图。
 */

import React, { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useSettingsStore, applyThemeAttr } from "@/store/settings";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { VoiceInterface } from "@/components/session/VoiceInterface";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { DocChatSetup } from "@/components/doc-chat/DocChatSetup";

const App = () => {
  const appView = useAppStore((s) => s.appView);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const theme = useSettingsStore((s) => s.theme);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Phase 5: 应用启动时水合用户设置
  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  // Phase 8: 启动只对齐 store 与 <html data-theme>，不通过 setTheme 触发后台 PUT
  useEffect(() => {
    applyThemeAttr(theme);
  }, [theme]);

  return (
    <div
      className="bg-bg min-h-screen px-4"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <main className="mx-auto max-w-3xl">
        {appView === "dashboard" ? (
          <Dashboard onOpenSettings={() => setDrawerOpen(true)} />
        ) : appView === "doc-chat-setup" ? (
          <DocChatSetup />
        ) : (
          <VoiceInterface />
        )}
      </main>
      <SettingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
};

export default App;
