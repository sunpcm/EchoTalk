/**
 * R2-UI 显示合同回归：
 * 活动行与结束/恢复确认面板只用现有模式标签和开始时间标识记录。
 * 完整 UUID 仅供内部定位与请求归属。
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { formatStartedAt, resolveModeLabel } from "./activeSessions/shared";
import { ActiveSessions } from "./ActiveSessions";
import { useAppStore } from "@/store/appStore";

const PRINCIPAL: auth.AuthPrincipal = {
  issuer: "https://auth.example.com",
  subject: "user-1",
};

const FIRST_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const SECOND_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";
const STARTED_AT = "2026-11-15T02:03:04Z";
const EXPECTED_MODE = resolveModeLabel("free_talk");
const EXPECTED_STARTED_AT = formatStartedAt(STARTED_AT);

const ACTIVE_SESSIONS: api.SessionListResponse = {
  items: [
    {
      id: FIRST_ID,
      mode: "free_talk",
      status: "active",
      started_at: STARTED_AT,
      ended_at: null,
    },
    {
      id: SECOND_ID,
      mode: "free_talk",
      status: "active",
      started_at: STARTED_AT,
      ended_at: null,
    },
  ],
  next_cursor: null,
};

let originalVisibilityState: PropertyDescriptor | undefined;
let originalOnlineState: PropertyDescriptor | undefined;

function setDocumentVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    value,
    configurable: true,
  });
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  });
}

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

function expectNoFullIdExposure(scope: HTMLElement, sessionId: string) {
  expect(scope).not.toHaveTextContent(sessionId);
  expect(scope).not.toHaveAccessibleName(new RegExp(sessionId));
  expect(scope.getAttribute("title") ?? "").not.toContain(sessionId);

  for (const titledElement of Array.from(scope.querySelectorAll<HTMLElement>("[title]"))) {
    const title = titledElement.getAttribute("title") ?? "";
    expect(title).not.toContain(sessionId);
  }

  for (const control of within(scope).getAllByRole("button")) {
    expect(control).not.toHaveAccessibleName(new RegExp(sessionId));
  }
}

function completedSessionFor(sessionId: string): api.Session {
  return {
    id: sessionId,
    user_id: PRINCIPAL.subject,
    mode: "free_talk",
    status: "completed",
    started_at: STARTED_AT,
    ended_at: "2026-11-15T02:08:04Z",
    transcripts: [],
  };
}

describe("ActiveSessions R2-UI display labels", () => {
  beforeEach(() => {
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
    originalOnlineState = Object.getOwnPropertyDescriptor(navigator, "onLine");

    cleanup();
    useAppStore.getState().goHome();

    vi.spyOn(auth, "getAuthSnapshot").mockReturnValue({
      state: "authenticated",
      principal: PRINCIPAL,
    });
    vi.spyOn(auth, "getAuthRevision").mockReturnValue(1);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockReturnValue(() => {});
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation(
      (left, right) => left?.issuer === right?.issuer && left?.subject === right?.subject,
    );

    vi.spyOn(api, "listActiveSessions").mockResolvedValue(ACTIVE_SESSIONS);
    setDocumentVisibility("visible");
    setNavigatorOnline(true);
  });

  afterEach(() => {
    cleanup();
    useAppStore.getState().goHome();
    vi.restoreAllMocks();
    restoreProperty(document, "visibilityState", originalVisibilityState);
    restoreProperty(navigator, "onLine", originalOnlineState);
  });

  it("renders rows with mode and start time without UUID leakage", async () => {
    render(<ActiveSessions />);

    const rows = [
      { id: FIRST_ID, element: await screen.findByTestId(`active-session-item-${FIRST_ID}`) },
      { id: SECOND_ID, element: await screen.findByTestId(`active-session-item-${SECOND_ID}`) },
    ];

    for (const { id, element } of rows) {
      expect(element).toHaveTextContent(EXPECTED_MODE);
      expect(element).toHaveTextContent(EXPECTED_STARTED_AT);
      expectNoFullIdExposure(element, id);
    }

    expect(screen.getByTestId(`resume-session-button-${FIRST_ID}`)).toHaveAccessibleName(
      "恢复练习",
    );
    expect(screen.getByTestId(`end-session-button-${FIRST_ID}`)).toHaveAccessibleName("结束记录");
    expect(screen.getByTestId(`resume-session-button-${SECOND_ID}`)).toHaveAccessibleName(
      "恢复练习",
    );
    expect(screen.getByTestId(`end-session-button-${SECOND_ID}`)).toHaveAccessibleName("结束记录");
  });

  it("renders the end panel with mode and start time without UUID leakage", async () => {
    render(<ActiveSessions />);
    await screen.findByTestId(`active-session-item-${FIRST_ID}`);

    fireEvent.click(screen.getByTestId(`end-session-button-${FIRST_ID}`));

    const panel = screen.getByTestId(`end-confirm-panel-${FIRST_ID}`);
    expect(panel).toHaveTextContent(EXPECTED_MODE);
    expect(panel).toHaveTextContent(EXPECTED_STARTED_AT);
    expect(panel).not.toHaveTextContent("目标ID:");
    expectNoFullIdExposure(panel, FIRST_ID);
    expect(screen.getByTestId(`confirm-end-button-${FIRST_ID}`)).toHaveAccessibleName("确认结束");
    expect(screen.getByTestId(`cancel-end-button-${FIRST_ID}`)).toHaveAccessibleName("取消");
  });

  it("renders the resume panel with mode and start time without UUID leakage", async () => {
    render(<ActiveSessions />);
    await screen.findByTestId(`active-session-item-${SECOND_ID}`);

    fireEvent.click(screen.getByTestId(`resume-session-button-${SECOND_ID}`));

    const panel = screen.getByTestId(`resume-confirm-panel-${SECOND_ID}`);
    expect(panel).toHaveTextContent(EXPECTED_MODE);
    expect(panel).toHaveTextContent(EXPECTED_STARTED_AT);
    expect(panel).not.toHaveTextContent("目标ID:");
    expectNoFullIdExposure(panel, SECOND_ID);
    expect(screen.getByTestId(`confirm-resume-button-${SECOND_ID}`)).toHaveAccessibleName(
      "确认恢复",
    );
    expect(screen.getByTestId(`cancel-resume-button-${SECOND_ID}`)).toHaveAccessibleName("取消");
  });

  it("targets the second row's exact ID for end while both same-label rows remain present", async () => {
    const endSpy = vi.spyOn(api, "endSession").mockResolvedValue(completedSessionFor(SECOND_ID));

    render(<ActiveSessions />);
    const firstRow = await screen.findByTestId(`active-session-item-${FIRST_ID}`);
    const secondRow = await screen.findByTestId(`active-session-item-${SECOND_ID}`);

    fireEvent.click(screen.getByTestId(`end-session-button-${SECOND_ID}`));

    expect(firstRow).toBeInTheDocument();
    expect(secondRow).toBeInTheDocument();
    expect(screen.getByTestId(`end-confirm-panel-${SECOND_ID}`)).toBeInTheDocument();
    expect(endSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`confirm-end-button-${SECOND_ID}`));

    await waitFor(() => {
      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(endSpy).toHaveBeenCalledWith(SECOND_ID);
    });
  });

  it("targets the second row's exact ID and origin for resume while both same-label rows remain present", async () => {
    const resumeSpy = vi.spyOn(useAppStore.getState(), "resumeSession").mockResolvedValue(true);

    render(<ActiveSessions />);
    const firstRow = await screen.findByTestId(`active-session-item-${FIRST_ID}`);
    const secondRow = await screen.findByTestId(`active-session-item-${SECOND_ID}`);

    fireEvent.click(screen.getByTestId(`resume-session-button-${SECOND_ID}`));

    expect(firstRow).toBeInTheDocument();
    expect(secondRow).toBeInTheDocument();
    expect(screen.getByTestId(`resume-confirm-panel-${SECOND_ID}`)).toBeInTheDocument();
    expect(resumeSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId(`confirm-resume-button-${SECOND_ID}`));
      await Promise.resolve();
    });

    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).toHaveBeenCalledWith(SECOND_ID, {
      principal: PRINCIPAL,
      revision: 1,
    });
  });
});
