/**
 * 语音对话主选择入口。
 * 根据内部会话 phase 渲染状态视图、结束态或绑定单一资源的 RoomSession。
 */

// 保持拆分前 LiveKit 包与样式副作用的求值顺序。
import "@livekit/components-react";
import "@livekit/components-styles";
import "livekit-client";
import { useConversationStore } from "@/store/conversation";
import {
  ConnectingView,
  ConnectionFailedView,
  DispatchFailedView,
  EndFailedView,
  EndingView,
  IdleView,
} from "./ConversationStatusViews";
import { EndedConversation } from "./EndedConversation";
import { RoomSession } from "./RoomSession";

export { stopRoomLocalTracks } from "./roomAudio";

/** 公共入口；Room key/props 保持与拆分前一致。 */
export function VoiceInterface() {
  const store = useConversationStore();
  const sessionState = store._sessionState;
  const { sessionGen } = store;

  if (sessionState.phase === "idle") {
    return <IdleView />;
  }

  if (
    sessionState.phase === "checking_health" ||
    sessionState.phase === "creating_session" ||
    sessionState.phase === "fetching_token"
  ) {
    return <ConnectingView />;
  }

  if (sessionState.phase === "ending") {
    return <EndingView />;
  }

  if (sessionState.phase === "end_failed") {
    return <EndFailedView />;
  }

  if (sessionState.phase === "ended") {
    return <EndedConversation />;
  }

  if (sessionState.phase === "dispatch_failed") {
    return <DispatchFailedView />;
  }

  if (sessionState.phase === "connection_failed") {
    return <ConnectionFailedView />;
  }

  return (
    <RoomSession
      key={`lk-session-${sessionGen}-${sessionState.sessionId}`}
      sessionId={sessionState.sessionId}
      sessionGen={sessionGen}
      token={sessionState.token}
      wsUrl={sessionState.wsUrl}
    />
  );
}
