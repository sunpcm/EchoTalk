/**
 * 微信风格实时聊天字幕组件。
 * 使用 useVoiceAssistant + useTrackTranscription 分别提取
 * Agent 和 User 的转录流，合并后渲染为聊天气泡。
 */

import React, { useEffect, useMemo, useRef } from "react";
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
  sender: "user" | "agent";
  timestamp: number;
  isFinal: boolean;
}

export function ChatSubtitles() {
  const scrollRef = useRef<HTMLDivElement>(null);
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
        sender: "agent" as const,
        timestamp: seg.firstReceivedTime,
        isFinal: seg.final,
      }));

    const userMsgs: ChatMessage[] = userTranscription.segments
      .filter((seg) => seg.text.trim())
      .map((seg) => ({
        id: `user-${seg.id}`,
        text: seg.text,
        sender: "user" as const,
        timestamp: seg.firstReceivedTime,
        isFinal: seg.final,
      }));

    return [...agentMsgs, ...userMsgs].sort((a, b) => a.timestamp - b.timestamp);
  }, [agentTranscription.segments, userTranscription.segments]);

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* 标题栏 */}
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{t.title}</h3>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">{t.empty}</p>
        ) : (
          messages.map((msg) => <ChatBubble key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser ? "bg-green-500 text-white" : "bg-gray-100 text-gray-800"
        } ${!message.isFinal ? "opacity-70" : ""}`}
      >
        {/* 发送者标签 */}
        <p className={`mb-1 text-xs font-medium ${isUser ? "text-green-100" : "text-gray-400"}`}>
          {isUser ? t.you : t.aiCoach}
        </p>
        {/* 消息文本 */}
        <p className="text-sm leading-relaxed">{message.text}</p>
      </div>
    </div>
  );
}
