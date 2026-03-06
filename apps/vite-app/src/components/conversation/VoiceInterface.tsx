/**
 * 语音对话核心组件。
 * 管理 LiveKit 房间连接和语音交互界面。
 * Phase 2: 对话结束后展示发音评估和技能树。
 * Phase 4: 左右分栏布局 — 左侧语音状态+回答推荐，右侧微信风格聊天流。
 *          增加防拦截连接异常提示（1Password / 去广告插件 / 代理路由）。
 * Phase 5: DataChannel 错误拦截 — 自定义轨 fail-fast 错误通过 agent_error topic 接收，
 *          显示红色错误卡片并阻止自动重连。
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useVoiceAssistant,
  useDataChannel,
  BarVisualizer,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionState, DisconnectReason } from "livekit-client";
import { useConversationStore } from "@/store/conversation";
import { useAssessmentStore } from "@/store/assessment";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import { dispatchAgent } from "@/lib/api";
import { PronunciationFeedback } from "@/components/pronunciation/PronunciationFeedback";
import { SkillTree } from "@/components/learning/SkillTree";
import { AnswerRecommendations } from "@/components/learning/AnswerRecommendations";
import { ChatSubtitles } from "@/components/conversation/ChatSubtitles";
import { zhCN } from "@/i18n/zh-CN";

const tConv = zhCN.conversation;
const tAssess = zhCN.assessment;
const tDash = zhCN.dashboard;
const tWarn = zhCN.connectionWarning;
const tAgentErr = zhCN.agentError;

/** 主入口：根据 connectionState 渲染不同视图 */
export function VoiceInterface() {
  const { connectionState, sessionId, token, error, goHome } = useConversationStore();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);

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
  const effectiveWsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/livekit-ws`;

  return (
    <>
      {/* 防拦截警告 Toast */}
      {showWarning && (
        <ConnectionWarningToast
          error={connectionError}
          onDismiss={() => setShowWarning(false)}
          onRetry={() => {
            setShowWarning(false);
            setConnectionError(null);
            window.location.reload();
          }}
        />
      )}

      <LiveKitRoom
        serverUrl={effectiveWsUrl ?? undefined}
        token={token ?? undefined}
        connect={true}
        audio={true}
        video={false}
        onConnected={() => {
          setConnectionError(null);
          setShowWarning(false);
          if (sessionId) {
            dispatchAgent(sessionId).catch((err) => console.error("Agent dispatch failed:", err));
          }
        }}
        onError={(error) => {
          console.error("LiveKit connection error:", error);
          setConnectionError(error.message);
          setShowWarning(true);
        }}
        onDisconnected={(reason) => {
          console.log("LiveKit disconnected:", reason);
          // Agent 错误已通过 DataChannel 处理，跳过重复警告
          if (useConversationStore.getState().agentError) return;
          // 非正常断开（如被插件拦截）时显示警告
          if (reason !== undefined && reason !== DisconnectReason.CLIENT_INITIATED) {
            setConnectionError(String(reason));
            setShowWarning(true);
          }
        }}
        data-lk-theme="default"
        className="flex min-h-[60vh] flex-col"
      >
        <ActiveView />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </>
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

/** 对话中视图：左右分栏布局 */
function ActiveView() {
  const connectionState = useConnectionState();
  const voiceAssistant = useVoiceAssistant();
  const { setActive, endSession, setAgentError } = useConversationStore();

  // Phase 5: 监听 agent_error DataChannel 消息（自定义轨 fail-fast）
  useDataChannel("agent_error", (msg) => {
    try {
      const text = new TextDecoder().decode(msg.payload);
      const parsed = JSON.parse(text);
      if (parsed.type === "agent_error" && parsed.code && parsed.message) {
        console.error("Agent error received via DataChannel:", parsed);
        setAgentError({ code: parsed.code, message: parsed.message });
      }
    } catch {
      // 格式异常的消息，忽略
    }
  });

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
    <div className="flex w-full flex-1 flex-col gap-6 p-4 lg:flex-row">
      {/* ===== 左侧：语音状态 + 回答推荐 ===== */}
      <div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
        {/* 语音可视化 + 状态 */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 h-24 w-full">
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
          <div className="mt-3">
            <VoiceAssistantControlBar controls={{ leave: false }} />
          </div>

          {/* 结束对话按钮 */}
          <button
            onClick={endSession}
            className="mt-3 w-full rounded-lg bg-red-500 px-6 py-2 text-white transition-colors hover:bg-red-600"
          >
            {tConv.endButton}
          </button>
        </div>

        {/* 回答推荐面板（固定在左下） */}
        <AnswerRecommendations />
      </div>

      {/* ===== 右侧：微信风格聊天流 ===== */}
      <div className="min-h-[50vh] flex-1 lg:min-h-0">
        <ChatSubtitles />
      </div>
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

  return <p className="text-center text-sm font-medium text-gray-600">{text}</p>;
}

/** 防拦截连接警告 Toast */
function ConnectionWarningToast({
  error,
  onDismiss,
  onRetry,
}: {
  error: string | null;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-x-0 top-4 z-50 mx-auto max-w-lg animate-[slideDown_0.3s_ease-out] px-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-lg">
        <div className="flex items-start gap-3">
          {/* 警告图标 */}
          <div className="mt-0.5 shrink-0">
            <svg className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h4 className="text-sm font-semibold text-amber-800">{tWarn.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-amber-700">{tWarn.message}</p>
            {error && <p className="mt-1 font-mono text-xs text-amber-600/70">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={onRetry}
                className="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-600"
              >
                {tWarn.retry}
              </button>
              <button
                onClick={onDismiss}
                className="rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
              >
                {tWarn.dismiss}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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

/** 已结束视图：展示评估结果和技能树，或 Agent 错误卡片 */
function EndedView() {
  const sessionId = useConversationStore((s) => s.sessionId);
  const goHome = useConversationStore((s) => s.goHome);
  const agentError = useConversationStore((s) => s.agentError);
  const {
    assessment,
    grammarErrors,
    knowledgeStates,
    reset: resetAssessment,
  } = useAssessmentStore();

  // 启动轮询（仅在非 Agent 错误时）
  const loadState = usePollingAssessment(agentError ? null : sessionId);

  const handleGoHome = useCallback(() => {
    resetAssessment();
    goHome();
  }, [resetAssessment, goHome]);

  // Agent 错误：显示红色错误卡片
  if (agentError) {
    return (
      <div className="flex flex-col items-center gap-6 py-8">
        <div className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <svg className="h-6 w-6 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-800">{tAgentErr.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-red-700">{agentError.message}</p>
              <p className="mt-0.5 font-mono text-xs text-red-500/70">{agentError.code}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleGoHome} className="btn-primary px-6 py-2.5">
            {tAgentErr.goHome}
          </button>
        </div>
      </div>
    );
  }

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
      <button
        onClick={handleGoHome}
        disabled={loadState === "polling"}
        className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadState === "polling" && (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        )}
        {loadState === "polling" ? tAssess.analyzing : tDash.goHome}
      </button>
    </div>
  );
}
