import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SessionListItem } from "@/lib/api";
import { SessionRow } from "./SessionRow";

const FULL_ID = "550e8400-e29b-41d4-a716-446655440000";

const session: SessionListItem = {
  id: FULL_ID,
  mode: "free_talk",
  status: "active",
  started_at: "2026-10-21T10:00:00Z",
  ended_at: null,
};

describe("SessionRow visible ID truncation", () => {
  it("renders only the first 8 characters as the visible ID text", () => {
    render(
      <SessionRow
        session={session}
        showActions
        actionsDisabled={false}
        onResume={() => {}}
        onEnd={() => {}}
      />,
    );

    const idEl = screen.getByTestId(`session-id-${FULL_ID}`);
    expect(idEl.textContent).toBe("550e8400");
  });

  it("keeps the full id in data-testid without exposing it through the title", () => {
    render(
      <SessionRow
        session={session}
        showActions={false}
        actionsDisabled={false}
        onResume={() => {}}
        onEnd={() => {}}
      />,
    );

    const idEl = screen.getByTestId(`session-id-${FULL_ID}`);
    expect(idEl).not.toHaveAttribute("title");
    expect(idEl).not.toHaveTextContent(FULL_ID);
    expect(screen.getByTestId(`active-session-item-${FULL_ID}`)).toBeInTheDocument();
  });

  it("does not expose an identifier of eight characters or fewer", () => {
    const shortSession = { ...session, id: "sess-2" };
    render(
      <SessionRow
        session={shortSession}
        showActions={false}
        actionsDisabled={false}
        onResume={() => {}}
        onEnd={() => {}}
      />,
    );

    const idEl = screen.getByTestId("session-id-sess-2");
    expect(idEl).toBeEmptyDOMElement();
    expect(screen.getByTestId("active-session-item-sess-2")).toBeInTheDocument();
  });

  it("keeps full-id testids on the resume and end action buttons", () => {
    const onResume = vi.fn();
    const onEnd = vi.fn();
    render(
      <SessionRow
        session={session}
        showActions
        actionsDisabled={false}
        onResume={onResume}
        onEnd={onEnd}
      />,
    );

    const resumeBtn = screen.getByTestId(`resume-session-button-${FULL_ID}`);
    const endBtn = screen.getByTestId(`end-session-button-${FULL_ID}`);
    expect(resumeBtn).toBeInTheDocument();
    expect(endBtn).toBeInTheDocument();

    fireEvent.click(resumeBtn);
    expect(onResume).toHaveBeenCalledTimes(1);

    fireEvent.click(endBtn);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
