/**
 * 应用根组件。
 * Phase 1: 渲染语音对话练习界面。
 */

import React from "react";
import { VoiceInterface } from "@/components/conversation/VoiceInterface";

const App = () => {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <VoiceInterface />
      </div>
    </div>
  );
};

export default App;
