import { useCallback } from "react";
import { PronunciationFeedback } from "@/components/pronunciation/PronunciationFeedback";
import { SkillTree } from "@/components/learning/SkillTree";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import { zhCN } from "@/i18n/zh-CN";
import { useAssessmentStore } from "@/store/assessment";
import { useConversationStore } from "@/store/conversation";

const tAssess = zhCN.assessment;
const tAgentErr = zhCN.agentError;
const tConv = zhCN.conversation;
const tDash = zhCN.dashboard;

/** 已结束视图：展示评估结果和技能树，或 Agent 错误卡片。 */
export function EndedConversation() {
  const sessionId = useConversationStore((state) => state.sessionId);
  const goHome = useConversationStore((state) => state.goHome);
  const agentError = useConversationStore((state) => state.agentError);
  const {
    assessment,
    grammarErrors,
    knowledgeStates,
    reset: resetAssessment,
    retryFailedAnalysis,
    job,
  } = useAssessmentStore();

  // 启动轮询（仅在非 Agent 错误且存在 sessionId 时）
  const loadState = usePollingAssessment(agentError || !sessionId ? null : sessionId);

  const handleGoHome = useCallback(() => {
    resetAssessment();
    goHome();
  }, [resetAssessment, goHome]);

  const handleRetry = useCallback(() => {
    if (sessionId) void retryFailedAnalysis(sessionId);
  }, [retryFailedAnalysis, sessionId]);

  // 无 ID 在途取消：展示本地取消状态，不启动分析
  if (!sessionId) {
    return (
      <div className="flex flex-col items-center gap-6 py-8" data-testid="cancelled-local-view">
        <div className="text-center">
          <h2 className="text-text-default mb-2 text-2xl font-bold">
            {tConv.cancelledBeforeStartTitle}
          </h2>
          <p className="text-text-muted text-sm leading-relaxed">
            {tConv.cancelledBeforeStartMessage}
          </p>
        </div>
        <button
          onClick={handleGoHome}
          className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
        >
          {tDash.goHome}
        </button>
      </div>
    );
  }

  if (agentError) {
    return (
      <div className="flex flex-col items-center gap-6 py-8">
        <div className="border-danger-border bg-danger-bg w-full max-w-sm rounded-[20px] border p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <svg className="text-danger h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-danger-text text-sm font-semibold">{tAgentErr.title}</h3>
              <p className="text-danger-text mt-1 text-sm leading-relaxed">{agentError.message}</p>
              <p className="text-danger mt-0.5 font-mono text-xs">{agentError.code}</p>
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
      <div className="text-center">
        <h2 className="text-text-default mb-2 text-2xl font-bold">{tConv.ended}</h2>
      </div>

      {(loadState === "pending" || loadState === "running") && <AnalyzingView state={loadState} />}
      {(loadState === "failed" || loadState === "error") && (
        <AssessmentErrorView
          failed={loadState === "failed"}
          errorCode={job?.error_code ?? null}
          retryable={job?.retryable ?? false}
          onRetry={handleRetry}
        />
      )}
      {loadState === "loaded" && assessment && (
        <div className="w-full max-w-md space-y-8">
          <PronunciationFeedback assessment={assessment} grammarErrors={grammarErrors} />
          {knowledgeStates.length > 0 && (
            <div>
              <h3 className="text-text-default mb-3 text-lg font-semibold">
                {tAssess.skillTreeTitle}
              </h3>
              <SkillTree states={knowledgeStates} />
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleGoHome}
        className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
      >
        {tDash.goHome}
      </button>
    </div>
  );
}

function AnalyzingView({ state }: { state: "pending" | "running" }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      <p className="text-text-muted">{state === "pending" ? tAssess.pending : tAssess.analyzing}</p>
      <p className="text-text-faint text-sm">
        {state === "pending" ? tAssess.pendingHint : tAssess.analyzingHint}
      </p>
    </div>
  );
}

function AssessmentErrorView({
  failed,
  errorCode,
  retryable,
  onRetry,
}: {
  failed: boolean;
  errorCode: string | null;
  retryable: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="bg-danger-bg rounded-lg p-4 text-center">
      <p className="text-danger text-sm">
        {failed
          ? errorCode === "analysis_unsupported"
            ? tAssess.unsupported
            : tAssess.failed
          : tAssess.loadError}
      </p>
      {failed && retryable ? (
        <button onClick={onRetry} className="btn-primary mt-3 px-4 py-2 text-sm">
          {tAssess.retry}
        </button>
      ) : null}
    </div>
  );
}
