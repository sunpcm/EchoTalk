/**
 * 活动会话发现与恢复组件（CP-02 本地增量）。
 * 消费既有 GET /api/sessions/active 接口，在共享 Dashboard 展示当前已认证账号的活跃会话记录。
 * 提供显式结束记录与显式恢复练习能力（接管暂未开放）。
 * 遵循严格的认证代际隔离、竞态消除及不回显服务端报错策略。
 *
 * 本文件只做组装；流程分别位于 activeSessions/ 下的列表、结束、恢复与订阅四个 Hook。
 */

import React, { useRef } from "react";
import { arePrincipalsEqual, getAuthRevision } from "@/lib/auth";
import { useConversationStore } from "@/store/conversation";
import { isStartingConversationSession } from "@/store/conversationState";
import { zhCN } from "@/i18n/zh-CN";
import { ConfirmPanel } from "./activeSessions/ConfirmPanel";
import { SessionRow } from "./activeSessions/SessionRow";
import { createActiveSessionsRuntime, type ActiveSessionsRuntime } from "./activeSessions/shared";
import { useActiveSessionList } from "./activeSessions/useActiveSessionList";
import { useActiveSessionsLifecycle } from "./activeSessions/useActiveSessionsLifecycle";
import { useSessionEndFlow } from "./activeSessions/useSessionEndFlow";
import { useSessionResumeFlow } from "./activeSessions/useSessionResumeFlow";

const t = zhCN.activeSessions;

export function ActiveSessions() {
  const hasReadinessFeedback = useConversationStore(
    (s) => s.readinessIssue !== null || s.recheckingReadiness || s.readinessNotice,
  );
  const isStarting = useConversationStore((s) => isStartingConversationSession(s));

  // 三个流程共用的互斥门禁与生命周期适配器
  const runtimeRef = useRef<ActiveSessionsRuntime>(null as unknown as ActiveSessionsRuntime);
  if (runtimeRef.current === null) {
    runtimeRef.current = createActiveSessionsRuntime();
  }

  const list = useActiveSessionList(runtimeRef);
  const end = useSessionEndFlow(runtimeRef, list, isStarting);
  const resume = useSessionResumeFlow(runtimeRef, list, isStarting);
  const { snapshot, activeRevision } = useActiveSessionsLifecycle(
    runtimeRef,
    { list, end, resume },
    isStarting,
  );

  // 未认证状态（loading/anonymous/misconfigured）不渲染活动记录
  if (snapshot.state !== "authenticated" || !snapshot.principal) {
    return null;
  }

  const { sessions, loading, error, queriedIdentity, nextCursor, loadingMore, loadMoreError } =
    list;
  const { confirmingSessionId, isEnding, endError } = end;
  const { resumingConfirmId, isResuming, resumeError } = resume;

  const currentRevision = getAuthRevision();
  const hasQueried =
    queriedIdentity !== null &&
    arePrincipalsEqual(queriedIdentity.principal, snapshot.principal) &&
    queriedIdentity.revision === currentRevision &&
    queriedIdentity.revision === activeRevision;

  // 结束与恢复确认互斥：打开一个时收起另一个
  const handleStartEndConfirm = (sessionId: string) => {
    if (end.beginConfirm(sessionId)) {
      resume.dismissForEndConfirm();
    }
  };
  const handleStartResumeConfirm = (sessionId: string) => {
    if (resume.beginConfirm(sessionId)) {
      end.hidePanel();
    }
  };

  const isActionInFlight = isEnding || isResuming || isStarting;

  return (
    <section aria-labelledby="active-sessions-title" className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 id="active-sessions-title" className="text-text-default text-lg font-bold">
          {t.title}
        </h2>
        <p className="text-text-muted text-xs leading-relaxed break-words">{t.disclaimer}</p>
      </div>

      {loading && sessions.length === 0 && (
        <div className="text-text-faint py-4 text-center text-sm">{t.loading}</div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-danger-bg text-danger-text flex flex-col items-center justify-center gap-3 rounded-lg p-4 text-center text-sm"
        >
          <p className="leading-relaxed font-medium break-words">{t.loadError}</p>
          <button
            type="button"
            onClick={list.fetchActiveSessions}
            disabled={loading}
            className="bg-accent hover:bg-accent-hover focus-visible:ring-accent text-accent-contrast inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {t.retry}
          </button>
        </div>
      )}

      {!loading &&
        !error &&
        sessions.length === 0 &&
        (hasQueried ? (
          <p className="text-text-faint py-2 text-center text-sm">{t.empty}</p>
        ) : (
          <p role="status" className="text-text-faint py-2 text-center text-sm">
            {t.unqueried}
          </p>
        ))}

      {sessions.length > 0 && (
        <>
          <ul className="space-y-2" data-testid="active-sessions-list">
            {sessions.map((session) => {
              const isConfirmingEnd = confirmingSessionId === session.id;
              const isConfirmingResume = resumingConfirmId === session.id;

              return (
                <SessionRow
                  key={session.id}
                  session={session}
                  showActions={!isConfirmingEnd && !isConfirmingResume}
                  actionsDisabled={isActionInFlight}
                  onResume={() => handleStartResumeConfirm(session.id)}
                  onEnd={() => handleStartEndConfirm(session.id)}
                >
                  {isConfirmingEnd && (
                    <ConfirmPanel
                      sessionId={session.id}
                      tone="danger"
                      disclaimer={t.endConfirmDisclaimer}
                      errorMessage={endError ? t.endError : null}
                      hasFailed={endError}
                      busy={isEnding}
                      labels={{
                        cancel: t.cancelEnd,
                        confirm: t.confirmEnd,
                        retry: t.retryEnd,
                        busy: t.ending,
                      }}
                      testIds={{
                        panel: `end-confirm-panel-${session.id}`,
                        targetId: `confirm-session-id-${session.id}`,
                        error: `end-error-${session.id}`,
                        cancel: `cancel-end-button-${session.id}`,
                        confirm: `confirm-end-button-${session.id}`,
                        retry: `retry-end-button-${session.id}`,
                      }}
                      onCancel={end.cancelConfirm}
                      onConfirm={() => end.confirmEnd(session.id)}
                    />
                  )}

                  {isConfirmingResume && (
                    <ConfirmPanel
                      sessionId={session.id}
                      tone="accent"
                      disclaimer={t.resumeConfirmDisclaimer}
                      errorMessage={resumeError && !hasReadinessFeedback ? t.resumeError : null}
                      hasFailed={resumeError}
                      busy={isResuming}
                      labels={{
                        cancel: t.cancelResume,
                        confirm: t.confirmResume,
                        retry: t.retryResume,
                        busy: t.resuming,
                      }}
                      testIds={{
                        panel: `resume-confirm-panel-${session.id}`,
                        targetId: `confirm-resume-session-id-${session.id}`,
                        error: `resume-error-${session.id}`,
                        cancel: `cancel-resume-button-${session.id}`,
                        confirm: `confirm-resume-button-${session.id}`,
                        retry: `retry-resume-button-${session.id}`,
                      }}
                      onCancel={resume.cancelConfirm}
                      onConfirm={() => void resume.confirmResume(session.id)}
                    />
                  )}
                </SessionRow>
              );
            })}
          </ul>

          {nextCursor !== null && (
            <div className="mt-3 flex flex-col items-center gap-2">
              {loadMoreError && (
                <div
                  role="alert"
                  data-testid="load-more-active-error"
                  className="text-danger-text bg-danger-bg rounded px-2.5 py-1.5 text-xs font-medium"
                >
                  {t.loadMoreError}
                </div>
              )}
              <button
                type="button"
                tabIndex={0}
                data-testid="load-more-active-button"
                onClick={list.loadMore}
                disabled={loadingMore || isEnding || isResuming || isStarting}
                className="text-text-muted hover:text-text-default border-border-soft focus-visible:ring-accent inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-4 py-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
              >
                {loadingMore ? t.loadingMore : loadMoreError ? t.retryLoadMore : t.loadMore}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
