import React from "react";
import ReactDOM from "react-dom/client";
import "@livekit/components-styles";
import { ActiveConversation } from "../../src/components/session/ActiveConversation";
import { useAppStore } from "../../src/store/appStore";
import "../../src/styles.css";

document.documentElement.setAttribute("data-theme", "warm");

interface SessionPresentation {
  readonly sessionId: string;
  readonly sessionGen: number;
  readonly startedAt: string;
  readonly mode: string;
  readonly scenarioName: string;
}

type AppStoreWithSessionPresentation = ReturnType<typeof useAppStore.getState> & {
  sessionPresentation: SessionPresentation | null;
};

const sessionId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const principal = {
  issuer: "https://auth.example.com",
  subject: "stub-user",
};

useAppStore.setState(
  (state) =>
    ({
      ...state,
      sessionPresentation: {
        sessionId,
        sessionGen: 1,
        startedAt: new Date(Date.now() - 65_000).toISOString(),
        mode: "scenario",
        scenarioName: "Travel Planning",
      },
    }) as AppStoreWithSessionPresentation,
);

function FixtureApp() {
  return (
    <main data-testid="fixture-surface" className="bg-bg min-h-screen p-3 sm:p-4">
      <p
        data-testid="fixture-disclaimer"
        className="rounded-md bg-amber-50 px-2 py-1 text-[11px] [overflow-wrap:anywhere] break-words text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        [E2E 夹具桩] 挂载真实 ActiveConversation 与产品 CSS；仅本地替换 LiveKit 组件模块，不连接真实
        Media、Provider 或 SDK 信令。
      </p>
      <div
        data-testid="livekit-room-container"
        data-lk-theme="default"
        className="lk-room-container mt-3 flex min-h-[60vh] flex-col"
      >
        <ActiveConversation
          sessionId={sessionId}
          sessionGen={1}
          boundPrincipal={principal}
          authorizedRevision={1}
        />
      </div>
    </main>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<FixtureApp />);
}
