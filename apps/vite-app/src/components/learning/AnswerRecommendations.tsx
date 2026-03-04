/**
 * AI 问题回答推荐面板。
 * 当 AI 外教抛出问题时，分析其转录内容，
 * 提供 2-3 条简短英文回答推荐帮助用户回答。
 */

import React, { useMemo } from "react";
import { useVoiceAssistant } from "@livekit/components-react";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.answerRecommendations;

/** 简单的问题检测：判断 Agent 最后一段转录是否包含问句特征 */
function detectQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return true;
  const questionStarters =
    /^(what|where|when|why|who|how|do|does|did|can|could|would|should|is|are|was|were|have|has|had|will|shall|may|might)\b/i;
  return questionStarters.test(trimmed);
}

/** 基于问题内容生成简短回答推荐 */
function generateRecommendations(question: string): string[] {
  const q = question.toLowerCase();

  // 打招呼 / 自我介绍类
  if (q.includes("your name") || q.includes("introduce yourself")) {
    return [
      "My name is ... and I'm learning English.",
      "I'm ... Nice to meet you!",
      "You can call me ... I'm from China.",
    ];
  }
  // 感受 / 状态类
  if (q.includes("how are you") || q.includes("how do you feel") || q.includes("how's it going")) {
    return [
      "I'm doing great, thanks for asking!",
      "Pretty good! How about you?",
      "Not bad. I'm excited to practice English today.",
    ];
  }
  // 原因 / 目的类
  if (q.includes("why") || q.includes("reason")) {
    return [
      "I think it's because ...",
      "The main reason is that ...",
      "Well, in my opinion, it's because ...",
    ];
  }
  // 描述 / 解释类
  if (q.includes("describe") || q.includes("tell me about") || q.includes("explain")) {
    return [
      "Let me think... I would say ...",
      "Well, from my experience, ...",
      "That's a good question. I think ...",
    ];
  }
  // 偏好 / 选择类
  if (
    q.includes("do you like") ||
    q.includes("do you prefer") ||
    q.includes("favorite") ||
    q.includes("favourite")
  ) {
    return [
      "Yes, I really enjoy ... because ...",
      "I prefer ... over ... because ...",
      "My favorite would be ... I think it's great.",
    ];
  }
  // Yes/No 类
  if (
    /^(do|does|did|can|could|would|should|is|are|was|were|have|has|had|will|shall|may|might)\b/i.test(
      q,
    )
  ) {
    return [
      "Yes, I think so. Because ...",
      "No, not really. I believe ...",
      "It depends. In some cases ...",
    ];
  }
  // What 类
  if (q.startsWith("what")) {
    return [
      "I think it's ...",
      "In my opinion, ...",
      "That's an interesting question. I'd say ...",
    ];
  }
  // How 类
  if (q.startsWith("how")) {
    return [
      "I usually ... by doing ...",
      "I think the best way is to ...",
      "From my experience, I would ...",
    ];
  }
  // 通用 fallback
  return [
    "That's a great question. I think ...",
    "Let me think about that. I would say ...",
    "In my opinion, ...",
  ];
}

export function AnswerRecommendations() {
  const { agentTranscriptions, state } = useVoiceAssistant();

  // 从 agent 转录中提取最后一条 final 消息
  const latestQuestion = useMemo(() => {
    const finalSegments = agentTranscriptions.filter((seg) => seg.final && seg.text.trim());
    if (finalSegments.length === 0) return null;
    const last = finalSegments[finalSegments.length - 1];
    return detectQuestion(last.text) ? last.text.trim() : null;
  }, [agentTranscriptions]);

  const recommendations = useMemo(() => {
    if (!latestQuestion) return [];
    return generateRecommendations(latestQuestion);
  }, [latestQuestion]);

  const isWaiting = !latestQuestion || state === "thinking" || state === "speaking";

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-emerald-800">{t.title}</h3>

      {isWaiting ? (
        <p className="text-xs text-emerald-600/70">{t.waiting}</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-emerald-600/80">{t.hint}</p>
          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <div
                key={i}
                className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 transition-colors hover:border-emerald-400 hover:bg-emerald-50"
              >
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                  {i + 1}
                </span>
                {rec}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
