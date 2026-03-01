/**
 * 语音对话核心组件。
 * 管理 LiveKit 房间连接和语音交互界面。
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
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.conversation;

/** 主入口：根据 connectionState 渲染不同视图 */
export function VoiceInterface() {
  const { connectionState, token, wsUrl, error, startSession, reset } = useConversationStore();

  const handleStart = useCallback(() => {
    startSession("conversation");
  }, [startSession]);

  if (connectionState === "idle") {
    return <IdleView onStart={handleStart} error={error} />;
  }

  if (connectionState === "connecting" && !token) {
    return <ConnectingView />;
  }

  if (connectionState === "ended") {
    return <EndedView onReset={reset} />;
  }

  // connecting（有 token）或 active 状态：渲染 LiveKit 房间
  return (
    <LiveKitRoom
      serverUrl={wsUrl ?? undefined}
      token={token ?? undefined}
      connect={true}
      audio={true}
      video={false}
      data-lk-theme="default"
      className="flex min-h-[60vh] flex-col items-center justify-center"
    >
      <ActiveView />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

/** 空闲视图："开始练习"按钮 */
function IdleView({ onStart, error }: { onStart: () => void; error: string | null }) {
  return (
    <div className="flex flex-col items-center gap-6 py-12">
      <div className="text-center">
        <h2 className="text-brand-600 mb-2 text-2xl font-bold">{t.title}</h2>
        <p className="text-gray-500">{t.subtitle}</p>
      </div>

      {error && (
        <div className="w-full max-w-sm rounded-lg bg-red-50 p-4 text-center text-sm text-red-600">
          <p className="font-medium">{t.errorTitle}</p>
          <p>{error}</p>
        </div>
      )}

      <button onClick={onStart} className="btn-primary px-8 py-3 text-lg">
        {t.startButton}
      </button>
    </div>
  );
}

/** 连接中视图：loading 状态 */
function ConnectingView() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="border-brand-500 h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" />
      <p className="text-gray-500">{t.connecting}</p>
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
        {t.endButton}
      </button>
    </div>
  );
}

/** Agent 状态文案 */
function AgentStatusText({ state }: { state: string }) {
  const text = (() => {
    switch (state) {
      case "listening":
        return t.listening;
      case "thinking":
        return t.connecting;
      case "speaking":
        return t.speaking;
      default:
        return t.idle;
    }
  })();

  return <p className="text-lg font-medium text-gray-600">{text}</p>;
}

/** 已结束视图 */
function EndedView({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-12">
      <div className="text-center">
        <h2 className="mb-2 text-2xl font-bold text-gray-700">{t.ended}</h2>
        <p className="text-gray-500">{t.endedHint}</p>
      </div>

      <button onClick={onReset} className="btn-primary px-8 py-3 text-lg">
        {t.retryButton}
      </button>
    </div>
  );
}
