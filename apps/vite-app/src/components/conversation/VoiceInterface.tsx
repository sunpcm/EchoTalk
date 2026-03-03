/**
 * 语音对话核心组件。
 * 管理 LiveKit 房间连接和语音交互界面。
 * Phase 2: 对话结束后展示发音评估和技能树。
 * Phase 4: 由 Dashboard 驱动进入，结束后可返回主页。
 */

import React, { useCallback, useEffect } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useVoiceAssistant,
  BarVisualizer,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionState } from "livekit-client";
import { useConversationStore } from "@/store/conversation";
import { useAssessmentStore } from "@/store/assessment";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import { dispatchAgent } from "@/lib/api";
import { PronunciationFeedback } from "@/components/pronunciation/PronunciationFeedback";
import { SkillTree } from "@/components/learning/SkillTree";
import { zhCN } from "@/i18n/zh-CN";

const tConv = zhCN.conversation;
const tAssess = zhCN.assessment;
const tDash = zhCN.dashboard;

/** 主入口：根据 connectionState 渲染不同视图 */
export function VoiceInterface() {
  const { connectionState, sessionId, token, error, goHome } = useConversationStore();

  // idle 状态不应在 session 视图出现，作为安全回退
  if (connectionState === "idle") {
    return (
      <div className="flex flex-col items-center gap-6 py-12">
        {error && (
          <div className="w-full max-w-sm rounded-lg bg-red-50 p-4 text-center text-sm text-red-600">
            <p className="font-medium">{tConv.errorTitle}</p>
            <p>{error}</p>
          </div>
        )}
        <button onClick={goHome} className="btn-primary px-8 py-3 text-lg">
          {tDash.goHome}
        </button>
      </div>
    );
  }

  if (connectionState === "connecting" && !token) {
    return <ConnectingView />;
  }

  if (connectionState === "ended") {
    return <EndedView />;
  }

  // connecting（有 token）或 active 状态：渲染 LiveKit 房间
  // dev: Vite proxy → LiveKit Cloud
  // prod: nginx proxy → LiveKit Cloud
  // 浏览器始终只连自己的服务器，由服务器代理到 LiveKit Cloud
  const effectiveWsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/livekit-ws`;

  return (
    <LiveKitRoom
      serverUrl={effectiveWsUrl ?? undefined}
      token={token ?? undefined}
      connect={true}
      audio={true}
      video={false}
      onConnected={() => {
        if (sessionId) {
          dispatchAgent(sessionId).catch((err) => console.error("Agent dispatch failed:", err));
        }
      }}
      onError={(error) => {
        console.error("LiveKit connection error:", error);
      }}
      onDisconnected={(reason) => {
        console.log("LiveKit disconnected:", reason);
      }}
      data-lk-theme="default"
      className="flex min-h-[60vh] flex-col items-center justify-center"
    >
      <ActiveView />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

/** 连接中视图：loading 状态 */
function ConnectingView() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      <p className="text-gray-500">{tConv.connecting}</p>
    </div>
  );
}

/** 对话中视图：LiveKit 房间内 */
function ActiveView() {
  const connectionState = useConnectionState();
  const voiceAssistant = useVoiceAssistant();
  const { setActive, endSession } = useConversationStore();

  // LiveKit 连接成功后，将 store 状态切换到 active
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      setActive();
    }
  }, [connectionState, setActive]);

  // 连接中
  if (connectionState !== ConnectionState.Connected) {
    return <ConnectingView />;
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 py-8">
      {/* 语音可视化 */}
      <div className="h-32 w-full">
        {voiceAssistant.audioTrack && (
          <BarVisualizer
            state={voiceAssistant.state}
            trackRef={voiceAssistant.audioTrack}
            barCount={7}
            className="h-full w-full"
          />
        )}
      </div>

      {/* Agent 状态文案 */}
      <AgentStatusText state={voiceAssistant.state} />

      {/* 控制栏 */}
      <VoiceAssistantControlBar controls={{ leave: false }} />

      {/* 结束对话按钮 */}
      <button
        onClick={endSession}
        className="rounded-lg bg-red-500 px-6 py-2 text-white transition-colors hover:bg-red-600"
      >
        {tConv.endButton}
      </button>
    </div>
  );
}

/** Agent 状态文案 */
function AgentStatusText({ state }: { state: string }) {
  const text = (() => {
    switch (state) {
      case "listening":
        return tConv.listening;
      case "thinking":
        return tConv.connecting;
      case "speaking":
        return tConv.speaking;
      default:
        return tConv.idle;
    }
  })();

  return <p className="text-lg font-medium text-gray-600">{text}</p>;
}

/** 正在分析视图 */
function AnalyzingView() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      <p className="text-gray-500">{tAssess.analyzing}</p>
      <p className="text-sm text-gray-400">{tAssess.analyzingHint}</p>
    </div>
  );
}

/** 加载失败视图 */
function AssessmentErrorView() {
  return (
    <div className="rounded-lg bg-red-50 p-4 text-center">
      <p className="text-sm text-red-600">{tAssess.loadError}</p>
    </div>
  );
}

/** 已结束视图：展示评估结果和技能树，提供"返回主页"按钮 */
function EndedView() {
  const sessionId = useConversationStore((s) => s.sessionId);
  const goHome = useConversationStore((s) => s.goHome);
  const {
    assessment,
    grammarErrors,
    knowledgeStates,
    reset: resetAssessment,
  } = useAssessmentStore();

  // 启动轮询
  const loadState = usePollingAssessment(sessionId);

  const handleGoHome = useCallback(() => {
    resetAssessment();
    goHome();
  }, [resetAssessment, goHome]);

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {/* 标题 */}
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-bold text-gray-700">{tConv.ended}</h2>
      </div>

      {/* 评估内容 */}
      {loadState === "polling" && <AnalyzingView />}
      {loadState === "error" && <AssessmentErrorView />}
      {loadState === "loaded" && assessment && (
        <div className="w-full max-w-md space-y-8">
          <PronunciationFeedback assessment={assessment} grammarErrors={grammarErrors} />
          {knowledgeStates.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-gray-700">{tAssess.skillTreeTitle}</h3>
              <SkillTree states={knowledgeStates} />
            </div>
          )}
        </div>
      )}

      {/* 返回主页按钮 */}
      <button onClick={handleGoHome} className="btn-primary px-8 py-3 text-lg">
        {tDash.goHome}
      </button>
    </div>
  );
}
