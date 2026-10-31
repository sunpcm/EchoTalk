import { useCallback, useEffect } from "react";
import {
  BarVisualizer,
  useConnectionState,
  useDataChannel,
  useRoomContext,
  useVoiceAssistant,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { AnswerRecommendations } from "@/components/learning/AnswerRecommendations";
import { ChatSubtitles } from "@/components/conversation/ChatSubtitles";
import { zhCN } from "@/i18n/zh-CN";
import { arePrincipalsEqual, getAuthRevision, getAuthSnapshot } from "@/lib/auth";
import type { AuthPrincipal } from "@/lib/auth";
import { logDiagnostic } from "@/lib/diagnostics";
import { useConversationStore } from "@/store/conversation";
import { ConnectingView } from "./ConversationStatusViews";
import { stopRoomLocalTracks } from "./roomAudio";

const tConv = zhCN.conversation;

interface ActiveConversationProps {
  boundPrincipal: AuthPrincipal | null;
  boundRevision: number;
}

/** 对话中视图：LiveKit hooks、数据通道错误与显式结束。 */
export function ActiveConversation({ boundPrincipal, boundRevision }: ActiveConversationProps) {
  const connectionState = useConnectionState();
  const voiceAssistant = useVoiceAssistant();
  const room = useRoomContext();
  const { setActive, endSession, setAgentError, sessionId, sessionGen } = useConversationStore();
  const endError = useConversationStore((state) => state.error);

  // 同步停止当前 Room 拥有的本地音轨，不等待网络 disconnect 延迟
  const handleEnd = useCallback(() => {
    stopRoomLocalTracks(room);
    void endSession();
  }, [room, endSession]);

  // 组件卸载时（如由于代际变化或状态切出），主动同步停止该 Room 拥有的本地音轨
  useEffect(() => {
    return () => {
      stopRoomLocalTracks(room);
    };
  }, [room]);

  useDataChannel("agent_error", (msg) => {
    try {
      const text = new TextDecoder().decode(msg.payload);
      const parsed = JSON.parse(text);
      if (parsed.type === "agent_error" && parsed.code && parsed.message) {
        logDiagnostic("agent_error_received", { agent_code: parsed.code });
        setAgentError({ code: parsed.code, message: parsed.message });
      }
    } catch {
      // 格式异常的消息，忽略
    }
  });

  // LiveKit 连接成功后，核对认证一致性后将 store 状态切换到 active
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      const snap = getAuthSnapshot();
      if (
        snap.state !== "authenticated" ||
        !snap.principal ||
        !arePrincipalsEqual(snap.principal, boundPrincipal) ||
        getAuthRevision() !== boundRevision
      ) {
        return;
      }
      setActive(sessionId ?? undefined, sessionGen);
    }
  }, [connectionState, setActive, sessionId, sessionGen, boundPrincipal, boundRevision]);

  if (connectionState !== ConnectionState.Connected) {
    return <ConnectingView />;
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6 p-4 lg:flex-row">
      <div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
        <div className="border-border-default bg-surface rounded-[20px] border p-4 shadow-[0_6px_22px_-14px_var(--card-shadow)]">
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

          <AgentStatusText state={voiceAssistant.state} />

          <div className="mt-3">
            <VoiceAssistantControlBar controls={{ leave: false }} />
          </div>

          <button
            onClick={handleEnd}
            className="bg-danger hover:bg-danger-hover focus-visible:ring-danger mt-3 w-full rounded-[14px] px-6 py-2 text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {tConv.endButton}
          </button>
          {endError ? <p className="text-danger mt-2 text-sm">{endError}</p> : null}
        </div>

        <AnswerRecommendations />
      </div>

      <div className="min-h-[50vh] flex-1 lg:min-h-0">
        <ChatSubtitles />
      </div>
    </div>
  );
}

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

  return <p className="text-text-muted text-center text-sm font-medium">{text}</p>;
}
