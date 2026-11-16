/** 活动会话只读列表的组件适配层；查询状态由 data 层持有。 */

import { useRef, type RefObject } from "react";
import type { SessionListItem } from "@/lib/api";
import {
  useActiveSessionsQuery,
  type ActiveSessionsIdentity,
} from "@/data/use-active-sessions-query";
import { useConversationStore } from "@/store/conversation";
import { isStartingConversationSession } from "@/store/conversationState";
import type { ActiveSessionsRuntime } from "./shared";

export type { ActiveSessionsIdentity as AuthIdentity };

export interface ActiveSessionList {
  sessions: SessionListItem[];
  loading: boolean;
  error: boolean;
  queriedIdentity: ActiveSessionsIdentity | null;
  nextCursor: string | null;
  loadingMore: boolean;
  loadMoreError: boolean;
  fetchActiveSessions: () => void;
  loadMore: () => void;
  /** 目标是否仍在当前已展示列表中。 */
  hasSession: (sessionId: string) => boolean;
  /** 结束确认成功：从列表移除，并阻止旧列表响应把它带回来。 */
  removeEndedSession: (sessionId: string) => void;
  /** 结束/恢复提交前：作废在途的列表与更多页请求。 */
  cancelInFlightRequests: () => void;
  /** 挂起或离线：作废列表请求并收起分页，保留已展示列表、不新增错误。 */
  suspendRequests: () => void;
  /** 认证失效或代际变化：清空全部列表数据与在途请求。 */
  resetForAuthChange: () => void;
  /** 首次挂载时未认证：不保留任何列表数据。 */
  clearForUnauthenticated: () => void;
  /** 首次挂载时处于后台或离线：不发请求，只退出 loading。 */
  stopLoading: () => void;
  /** 卸载：只作废在途请求，不再写状态。 */
  invalidateOnUnmount: () => void;
}

export function useActiveSessionList(
  runtimeRef: RefObject<ActiveSessionsRuntime>,
): ActiveSessionList {
  const query = useActiveSessionsQuery({
    getLifecycle: () =>
      runtimeRef.current.lifecycleAdapter?.getSnapshot() ?? {
        visibility: "unknown",
        online: null,
      },
    isWriteBlocked: () => {
      const runtime = runtimeRef.current;
      return (
        runtime.endInFlight ||
        runtime.resumeInFlight ||
        isStartingConversationSession(useConversationStore.getState())
      );
    },
  });
  const sessionsRef = useRef<SessionListItem[]>(query.sessions);
  sessionsRef.current = query.sessions;

  return {
    ...query,
    hasSession: (sessionId) => sessionsRef.current.some((session) => session.id === sessionId),
  };
}
