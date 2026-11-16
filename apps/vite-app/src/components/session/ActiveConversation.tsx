import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarVisualizer,
  useConnectionState,
  useDataChannel,
  useRoomContext,
  useVoiceAssistant,
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { AnswerRecommendations } from "./AnswerRecommendations";
import { ChatSubtitles } from "./ChatSubtitles";
import { zhCN } from "@/i18n/zh-CN";
import { arePrincipalsEqual, getAuthRevision, getAuthSnapshot } from "@/lib/auth";
import type { AuthPrincipal } from "@/lib/auth";
import { logDiagnostic } from "@/lib/diagnostics";
import { useConversationStore } from "@/store/conversation";
import type { SessionPresentation } from "@/store/conversationSlice";
import { parseAgentErrorMessage } from "./agentErrorMessage";
import { ConnectingView } from "./ConversationStatusViews";
import { stopRoomLocalTracks } from "./roomAudio";

const tConv = zhCN.conversation;

interface ActiveConversationProps {
  sessionId: string;
  sessionGen: number;
  boundPrincipal: AuthPrincipal | null;
  authorizedRevision: number | null;
}

/** 对话中视图：LiveKit hooks、数据通道错误与显式结束。 */
export function ActiveConversation({
  sessionId,
  sessionGen,
  boundPrincipal,
  authorizedRevision,
}: ActiveConversationProps) {
  const connectionState = useConnectionState();
  const voiceAssistant = useVoiceAssistant();
  const room = useRoomContext();
  const { setActive, endSession, setAgentError } = useConversationStore();
  const endError = useConversationStore((state) => state.error);
  const sessionPresentation = useConversationStore((state) => state.sessionPresentation);
  const isMountedRef = useRef(true);
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const handleAgentError = useCallback(
    (msg: { payload: Uint8Array }) => {
      const parsed = parseAgentErrorMessage(msg.payload);
      if (!parsed || !isMountedRef.current || authorizedRevision === null) {
        return;
      }

      const currentAuth = getAuthSnapshot();
      if (
        currentAuth.state !== "authenticated" ||
        !currentAuth.principal ||
        !boundPrincipal ||
        !arePrincipalsEqual(currentAuth.principal, boundPrincipal) ||
        getAuthRevision() !== authorizedRevision
      ) {
        return;
      }

      const accepted = setAgentError(parsed, { sessionId, sessionGen });
      if (accepted) {
        logDiagnostic("agent_error_received", { agent_code: parsed.code });
      }
    },
    [authorizedRevision, boundPrincipal, sessionGen, sessionId, setAgentError],
  );

  useDataChannel("agent_error", handleAgentError);

  // LiveKit 连接成功后，核对认证一致性后将 store 状态切换到 active
  useEffect(() => {
    if (connectionState === ConnectionState.Connected) {
      const snap = getAuthSnapshot();
      if (
        snap.state !== "authenticated" ||
        !snap.principal ||
        !arePrincipalsEqual(snap.principal, boundPrincipal) ||
        getAuthRevision() !== authorizedRevision
      ) {
        return;
      }
      setActive(sessionId, sessionGen);
    }
  }, [connectionState, setActive, sessionId, sessionGen, boundPrincipal, authorizedRevision]);

  if (connectionState !== ConnectionState.Connected) {
    return <ConnectingView />;
  }

  const currentPresentation =
    sessionPresentation?.sessionId === sessionId && sessionPresentation.sessionGen === sessionGen
      ? sessionPresentation
      : null;

  return (
    <div className="session-layout w-full min-w-0 flex-1 p-4">
      <section className="session-layout__status border-border-default bg-surface min-w-0 rounded-[20px] border p-4 shadow-[0_6px_22px_-14px_var(--card-shadow)]">
        <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
          <p
            data-testid="session-scenario"
            className="text-text-default min-w-0 text-sm font-semibold [overflow-wrap:anywhere]"
          >
            {resolveScenarioLabel(currentPresentation)}
          </p>
          <SessionTimer startedAt={currentPresentation?.startedAt ?? null} />
        </div>

        {voiceAssistant.audioTrack ? (
          <div className="mb-4 h-24 w-full">
            <BarVisualizer
              state={voiceAssistant.state}
              trackRef={voiceAssistant.audioTrack}
              barCount={7}
              className="h-full w-full"
            />
          </div>
        ) : null}

        <AgentStatusText state={voiceAssistant.state} />

        <div className="mt-3 min-w-0">
          <VoiceAssistantControlBar controls={{ leave: false }} />
        </div>

        <button
          onClick={handleEnd}
          className="bg-danger hover:bg-danger-hover focus-visible:ring-danger text-danger-contrast mt-3 w-full rounded-[14px] px-6 py-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {tConv.endButton}
        </button>
        {endError ? <p className="text-danger mt-2 text-sm">{endError}</p> : null}
      </section>

      <div className="session-layout__subtitles min-w-0">
        <ChatSubtitles />
      </div>

      <div className="session-layout__recommendations min-w-0">
        <button
          type="button"
          data-testid="answer-recs-toggle"
          aria-expanded={recommendationsOpen}
          aria-controls="answer-recommendations-panel"
          onClick={() => setRecommendationsOpen((open) => !open)}
          className="border-border-default bg-surface text-text-default hover:bg-surface-alt flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-2 text-left text-sm font-semibold transition-colors lg:hidden"
        >
          <span>{zhCN.answerRecommendations.title}</span>
          <span aria-hidden="true" className="text-text-muted text-lg leading-none">
            {recommendationsOpen ? "−" : "+"}
          </span>
        </button>
        <div
          id="answer-recommendations-panel"
          className={`mt-2 min-w-0 lg:mt-0 ${recommendationsOpen ? "block" : "hidden lg:block"}`}
        >
          <AnswerRecommendations />
        </div>
      </div>
    </div>
  );
}

function resolveScenarioLabel(presentation: SessionPresentation | null): string {
  const scenarioName = presentation?.scenarioName?.trim();
  if (scenarioName) return scenarioName;

  const mode = presentation?.mode;
  const modeLabels: Readonly<Record<string, string>> = zhCN.activeSessions.modes;
  if (mode && Object.prototype.hasOwnProperty.call(modeLabels, mode)) {
    return modeLabels[mode] ?? zhCN.activeSessions.unknownMode;
  }
  return zhCN.activeSessions.unknownMode;
}

function SessionTimer({ startedAt }: { startedAt: string | null }) {
  const elapsed = useSessionElapsed(startedAt);
  return (
    <time
      data-testid="session-timer"
      dateTime={startedAt ?? undefined}
      className="text-text-muted shrink-0 text-sm font-medium tabular-nums"
    >
      {elapsed}
    </time>
  );
}

function useSessionElapsed(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return formatElapsed(startedAt, now);
}

function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return tConv.elapsedUnavailable;

  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs) || now < startedAtMs) {
    return tConv.elapsedUnavailable;
  }

  const totalSeconds = Math.floor((now - startedAtMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function AgentStatusText({ state }: { state: string }) {
  const text = (() => {
    switch (state) {
      case "listening":
        return tConv.listening;
      case "thinking":
        return tConv.thinking;
      case "speaking":
        return tConv.speaking;
      default:
        return tConv.idle;
    }
  })();

  return <p className="text-text-muted text-center text-sm font-medium">{text}</p>;
}
