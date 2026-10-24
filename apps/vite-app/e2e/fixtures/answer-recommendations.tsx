import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { AnswerRecommendations } from "../../src/components/learning/AnswerRecommendations";
import "../../src/styles.css";

document.documentElement.setAttribute("data-theme", "warm");

export interface TranscriptionSegment {
  id: string;
  text: string;
  final: boolean;
  firstReceivedTime?: number;
}

export interface FixtureVoiceState {
  agentTranscriptions: TranscriptionSegment[];
  state: "disconnected" | "connecting" | "listening" | "thinking" | "speaking";
}

declare global {
  interface Window {
    __echotalkVoiceAssistantData?: FixtureVoiceState;
    __updateVoiceAssistantData?: (data: Partial<FixtureVoiceState>) => void;
    __clipboardWrites?: string[];
  }
}

if (!window.__clipboardWrites) {
  window.__clipboardWrites = [];
}

const defaultState: FixtureVoiceState = {
  agentTranscriptions: [
    {
      id: "seg-1",
      text: "What is your name?",
      final: true,
      firstReceivedTime: Date.now(),
    },
  ],
  state: "listening",
};

window.__echotalkVoiceAssistantData = defaultState;

function FixtureApp() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    window.__updateVoiceAssistantData = (data: Partial<FixtureVoiceState>) => {
      window.__echotalkVoiceAssistantData = {
        ...(window.__echotalkVoiceAssistantData || defaultState),
        ...data,
      };
      setVersion((v) => v + 1);
    };
  }, []);

  return (
    <div className="space-y-3">
      <div
        data-testid="fixture-disclaimer"
        className="rounded-md bg-amber-50 px-2 py-1 text-[11px] [overflow-wrap:anywhere] break-words text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        [E2E 夹具桩] 挂载真实 AnswerRecommendations 组件，明确标注 useVoiceAssistant 与 clipboard
        桩。
      </div>
      <div data-testid="fixture-component-container">
        <AnswerRecommendations />
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<FixtureApp />);
}
