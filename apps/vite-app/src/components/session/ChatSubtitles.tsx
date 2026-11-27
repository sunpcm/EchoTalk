/**
 * 微信风格实时聊天字幕组件。
 * 使用 useVoiceAssistant + useTrackTranscription 分别提取
 * Agent 和 User 的转录流，合并后渲染为聊天气泡。
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  useVoiceAssistant,
  useLocalParticipant,
  useTrackTranscription,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.chat;

interface ChatMessage {
  id: string;
  text: string;
  language?: string;
  sender: "user" | "agent";
  timestamp: number;
  isFinal: boolean;
}

export function ChatSubtitles() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(true);
  const transcriptId = useId();
  const voiceAssistant = useVoiceAssistant();
  const { localParticipant, microphoneTrack } = useLocalParticipant();

  // 将 TrackPublication 转换为 useTrackTranscription 所需的 TrackReferenceOrPlaceholder
  const micTrackRef: TrackReferenceOrPlaceholder | undefined = useMemo(() => {
    if (!microphoneTrack) return undefined;
    return {
      participant: localParticipant,
      publication: microphoneTrack,
      source: Track.Source.Microphone,
    };
  }, [localParticipant, microphoneTrack]);

  // Agent 转录流
  const agentTranscription = useTrackTranscription(voiceAssistant.audioTrack);
  // User 转录流
  const userTranscription = useTrackTranscription(micTrackRef);

  // 合并两条流，按时间排序
  const messages: ChatMessage[] = useMemo(() => {
    const agentMsgs: ChatMessage[] = agentTranscription.segments
      .filter((seg) => seg.text.trim())
      .map((seg) => ({
        id: `agent-${seg.id}`,
        text: seg.text,
        language: seg.language || undefined,
        sender: "agent" as const,
        timestamp: seg.firstReceivedTime,
        isFinal: seg.final,
      }));

    const userMsgs: ChatMessage[] = userTranscription.segments
      .filter((seg) => seg.text.trim())
      .map((seg) => ({
        id: `user-${seg.id}`,
        text: seg.text,
        language: seg.language || undefined,
        sender: "user" as const,
        timestamp: seg.firstReceivedTime,
        isFinal: seg.final,
      }));

    return [...agentMsgs, ...userMsgs].sort((a, b) => a.timestamp - b.timestamp);
  }, [agentTranscription.segments, userTranscription.segments]);

  const latestMessage = messages[messages.length - 1];
  const latestMessageKey = latestMessage
    ? JSON.stringify([latestMessage.id, latestMessage.text, latestMessage.isFinal])
    : "";

  // 新转录到达时仅跟随最新消息；折叠开关不会触发转录订阅或此滚动效应。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && followLatestRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [latestMessageKey]);

  const handleTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    followLatestRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const foldLabel = isTranscriptExpanded ? t.collapseTranscript : t.expandTranscript;

  return (
    <div className="practice-transcript h-full">
      {/* 标题栏 */}
      <div className="practice-transcript__header">
        <h3 className="practice-transcript__title">{t.title}</h3>
        <button
          type="button"
          aria-expanded={isTranscriptExpanded}
          aria-controls={transcriptId}
          onClick={() => setIsTranscriptExpanded((expanded) => !expanded)}
          className="practice-transcript__fold"
        >
          {foldLabel}
        </button>
      </div>

      {/* 消息列表 */}
      <div
        id={transcriptId}
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={t.title}
        onScroll={handleTranscriptScroll}
        className="practice-transcript__log"
        data-expanded={isTranscriptExpanded}
      >
        {messages.length === 0 ? (
          <p className="practice-transcript__empty">{t.empty}</p>
        ) : (
          messages.map((msg, index) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              isLatest={index === messages.length - 1}
              hidden={!isTranscriptExpanded && index < messages.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  isLatest,
  hidden,
}: {
  message: ChatMessage;
  isLatest: boolean;
  hidden: boolean;
}) {
  const isUser = message.sender === "user";
  const senderLabel = isUser ? t.you : t.aiCoach;

  return (
    <article
      hidden={hidden}
      aria-label={`${senderLabel}: ${message.text}`}
      aria-current={isLatest ? "true" : undefined}
      data-latest={isLatest}
      data-final={message.isFinal}
      className={`practice-transcript__turn ${
        isUser ? "practice-transcript__turn--user" : "practice-transcript__turn--agent"
      }`}
    >
      <div className="practice-transcript__role">
        {isLatest ? <span aria-hidden="true" className="practice-transcript__latest-mark" /> : null}
        <span>{senderLabel}</span>
      </div>
      <p className="practice-transcript__text" lang={message.language}>
        {message.text}
      </p>
    </article>
  );
}
