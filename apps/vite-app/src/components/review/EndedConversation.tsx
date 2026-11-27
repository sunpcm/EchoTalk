import { ANALYSIS_UNSUPPORTED } from "@/lib/agentAnalysisContract";
import type { ReactNode } from "react";
import { useCallback, useId } from "react";
import { GoalResults } from "./GoalResults";
import { PronunciationFeedback } from "./PronunciationFeedback";
import { SkillTree } from "@/components/shared/SkillTree";
import { usePollingAssessment } from "@/hooks/usePollingAssessment";
import { zhCN } from "@/i18n/zh-CN";
import { useAssessmentStore } from "@/store/assessment";
import { useConversationStore } from "@/store/conversation";
import { useAppStore } from "@/store/appStore";
import "./PracticeJournal.css";

const tAssess = zhCN.assessment;
const tAgentErr = zhCN.agentError;
const tConv = zhCN.conversation;
const tDash = zhCN.dashboard;
const tGoals = zhCN.sessionGoals;

/** 已结束视图：展示评估结果和技能树，或 Agent 错误卡片。 */
export function EndedConversation() {
  const sessionId = useConversationStore((state) => state.sessionId);
  const goHome = useAppStore((state) => state.goHome);
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
    if (!sessionId) return;

    if (loadState === "failed") {
      void retryFailedAnalysis(sessionId).catch(() => undefined);
      return;
    }

    useAssessmentStore.setState((state) => ({ pollVersion: state.pollVersion + 1 }));
  }, [loadState, retryFailedAnalysis, sessionId]);

  // 无 ID 在途取消：展示本地取消状态，不启动分析
  if (!sessionId) {
    return (
      <JournalShell onGoHome={handleGoHome}>
        <div
          className="practice-journal__state practice-journal__state--muted"
          data-testid="cancelled-local-view"
        >
          <p className="practice-journal__state-title">{tConv.cancelledBeforeStartTitle}</p>
          <p className="practice-journal__state-copy">{tConv.cancelledBeforeStartMessage}</p>
        </div>
      </JournalShell>
    );
  }

  if (agentError) {
    return (
      <JournalShell status={tConv.ended} onGoHome={handleGoHome}>
        <div className="practice-journal__error-card" role="alert">
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
            <div className="min-w-0 flex-1">
              <h3 className="text-danger-text text-sm font-semibold">{tAgentErr.title}</h3>
              <p className="text-danger-text mt-1 text-sm leading-relaxed [overflow-wrap:anywhere]">
                {agentError.message}
              </p>
              <p className="text-danger mt-0.5 font-mono text-xs [overflow-wrap:anywhere]">
                {agentError.code}
              </p>
            </div>
          </div>
        </div>
        <GoalResults sessionId={sessionId} />
      </JournalShell>
    );
  }

  return (
    <JournalShell status={tConv.ended} onGoHome={handleGoHome}>
      {loadState === "loaded" && (
        <PronunciationFeedback assessment={assessment} grammarErrors={grammarErrors} />
      )}
      {(loadState === "idle" || loadState === "pending" || loadState === "running") && (
        <AnalyzingView state={loadState === "running" ? "running" : "pending"} />
      )}
      {(loadState === "failed" || loadState === "error") && (
        <AssessmentErrorView
          failed={loadState === "failed"}
          errorCode={job?.error_code ?? null}
          retryable={job?.retryable ?? false}
          onRetry={handleRetry}
        />
      )}

      <GoalResults sessionId={sessionId} />

      {loadState === "loaded" && knowledgeStates.length > 0 && (
        <section className="practice-journal__section" aria-label={tAssess.skillTreeTitle}>
          <h2 className="practice-journal__section-title">{tAssess.skillTreeTitle}</h2>
          <SkillTree states={knowledgeStates} />
        </section>
      )}
    </JournalShell>
  );
}

function JournalShell({
  status,
  hint,
  onGoHome,
  children,
}: {
  status?: string;
  hint?: string;
  onGoHome: () => void;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <article className="practice-journal" aria-labelledby={titleId}>
      <header className="practice-journal__intro">
        {status ? <p className="practice-journal__eyebrow">{status}</p> : null}
        <h1 id={titleId} className="practice-journal__title">
          {tAssess.journalTitle}
        </h1>
        {hint ? <p className="practice-journal__hint">{hint}</p> : null}
      </header>
      <div className="practice-journal__content">{children}</div>
      <button type="button" onClick={onGoHome} className="practice-journal__return btn-primary">
        {tDash.goHome}
      </button>
    </article>
  );
}

function AnalyzingView({ state }: { state: "pending" | "running" }) {
  return (
    <div className="practice-journal__state" role="status" aria-live="polite" aria-atomic="true">
      <span className="practice-journal__spinner" aria-hidden="true" />
      <p className="practice-journal__state-title">
        {state === "pending" ? tAssess.pending : tAssess.analyzing}
      </p>
      <p className="practice-journal__state-copy">
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
  const showRetry = !failed || (retryable && errorCode !== ANALYSIS_UNSUPPORTED);

  return (
    <div className="practice-journal__error-card" role="alert">
      <p className="practice-journal__error-copy">
        {failed
          ? errorCode === ANALYSIS_UNSUPPORTED
            ? tAssess.unsupported
            : tAssess.failed
          : tAssess.loadError}
      </p>
      {showRetry ? (
        <button type="button" onClick={onRetry} className="practice-journal__retry btn-primary">
          {failed ? tAssess.retry : tGoals.retry}
        </button>
      ) : null}
    </div>
  );
}
