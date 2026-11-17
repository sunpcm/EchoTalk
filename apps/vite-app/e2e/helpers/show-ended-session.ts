import type { Page } from "@playwright/test";

export async function showEndedSession(page: Page, sessionId: string) {
  const serializedSessionId = JSON.stringify(sessionId);
  let firstPageError: Error | undefined;
  const onPageError = (error: Error) => {
    firstPageError ??= error;
  };

  page.on("pageerror", onPageError);
  try {
    await page.addScriptTag({
      type: "module",
      content: `
        import { useAppStore } from "/src/store/appStore.ts";
        useAppStore.setState({
          appView: "session",
          connectionState: "ended",
          sessionId: ${serializedSessionId},
          token: null,
          wsUrl: null,
          error: null,
          agentError: null,
        });
      `,
    });

    if (firstPageError) {
      throw firstPageError;
    }
  } finally {
    page.off("pageerror", onPageError);
  }
}
