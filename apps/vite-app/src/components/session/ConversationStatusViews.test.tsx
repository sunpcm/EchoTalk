import { render, screen } from "@testing-library/react";
import { ConnectionState } from "livekit-client";
import { describe, expect, it } from "vitest";
import { ConnectingView } from "./ConversationStatusViews";
import { zhCN } from "@/i18n/zh-CN";

describe("ConversationStatusViews", () => {
  it("shows the disconnected state instead of claiming the room is connecting", () => {
    render(<ConnectingView connectionState={ConnectionState.Disconnected} />);

    const status = screen.getByRole("alert");
    expect(status).toHaveAttribute("data-connection-state", ConnectionState.Disconnected);
    expect(status).toHaveTextContent(zhCN.conversation.connectionFailedTitle);
    expect(status).toHaveTextContent(zhCN.conversation.connectionFailedMessage);
    expect(status).not.toHaveTextContent(zhCN.conversation.connecting);
  });
});
