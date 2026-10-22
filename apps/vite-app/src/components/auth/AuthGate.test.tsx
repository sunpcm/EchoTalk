import React, { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { AuthGate } from "./AuthGate";
import * as auth from "@/lib/auth";
import * as userState from "@/lib/user-state";

vi.mock("@/lib/user-state", () => ({
  clearUserSessionData: vi.fn(),
}));

function DraftInputComponent({ label }: { label: string }) {
  const [draft, setDraft] = useState("initial-draft-empty");
  return (
    <div>
      <span data-testid="child-label">{label}</span>
      <input data-testid="draft-input" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </div>
  );
}

describe("AuthGate", () => {
  let listeners: Array<(snap: auth.AuthSnapshot) => void> = [];

  beforeEach(() => {
    listeners = [];
    vi.clearAllMocks();

    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    });
  });

  it("renders login UI when anonymous and never mounts children without principal", async () => {
    vi.spyOn(auth, "initializeAuthSnapshot").mockResolvedValue({
      state: "anonymous",
      principal: null,
    });

    render(
      <AuthGate>
        <DraftInputComponent label="private-content" />
      </AuthGate>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("child-label")).toBeNull();
    expect(screen.getByRole("button", { name: /登录/i })).toBeDefined();
  });

  it("mounts children when authenticated with principal", async () => {
    const p1: auth.AuthPrincipal = { issuer: "https://auth", subject: "user-1" };
    vi.spyOn(auth, "initializeAuthSnapshot").mockResolvedValue({
      state: "authenticated",
      principal: p1,
    });

    render(
      <AuthGate>
        <DraftInputComponent label="private-content" />
      </AuthGate>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("child-label").textContent).toBe("private-content");
  });

  it("preserves children state on same principal token renewal (does not drop draft state)", async () => {
    const p1: auth.AuthPrincipal = { issuer: "https://auth", subject: "user-1" };
    vi.spyOn(auth, "initializeAuthSnapshot").mockResolvedValue({
      state: "authenticated",
      principal: p1,
    });

    render(
      <AuthGate>
        <DraftInputComponent label="call-active" />
      </AuthGate>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const input = screen.getByTestId("draft-input");
    // 触发真实 React state 变更
    fireEvent.change(input, { target: { value: "user1-secret-in-progress" } });
    expect(screen.getByTestId("draft-input")).toHaveValue("user1-secret-in-progress");

    // 触发同 principal 的 Token 续期更新
    act(() => {
      listeners.forEach((cb) =>
        cb({
          state: "authenticated",
          principal: { issuer: "https://auth", subject: "user-1" },
        }),
      );
    });

    // 绝不触发集中清理，且子组件 React state 完好保留（不重新挂载）
    expect(userState.clearUserSessionData).not.toHaveBeenCalled();
    expect(screen.getByTestId("draft-input")).toHaveValue("user1-secret-in-progress");
  });

  it("clears user state and completely remounts children resetting React state when switching between different principals (kills mutation if key removed)", async () => {
    const p1: auth.AuthPrincipal = { issuer: "https://auth", subject: "user-1" };
    vi.spyOn(auth, "initializeAuthSnapshot").mockResolvedValue({
      state: "authenticated",
      principal: p1,
    });

    render(
      <AuthGate>
        <DraftInputComponent label="user-session" />
      </AuthGate>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const input = screen.getByTestId("draft-input");
    fireEvent.change(input, { target: { value: "user1-confidential-draft" } });
    expect(screen.getByTestId("draft-input")).toHaveValue("user1-confidential-draft");

    // 切换到另一个账号 user-2
    const p2: auth.AuthPrincipal = { issuer: "https://auth", subject: "user-2" };
    act(() => {
      listeners.forEach((cb) =>
        cb({
          state: "authenticated",
          principal: p2,
        }),
      );
    });

    // 1. 同步清理集中状态
    expect(userState.clearUserSessionData).toHaveBeenCalledTimes(1);
    // 2. 核心门禁断言：由于 key 变化，子组件树被完全销毁重挂载，React 内部草稿 state 必须重置回初始值！
    // 若删去 AuthGate 上的 key={accountGen}，此处必定断言失败（杀死空洞变异）！
    expect(screen.getByTestId("draft-input")).toHaveValue("initial-draft-empty");
  });

  it("clears user session data when logging out or session expires", async () => {
    const p1: auth.AuthPrincipal = { issuer: "https://auth", subject: "user-1" };
    vi.spyOn(auth, "initializeAuthSnapshot").mockResolvedValue({
      state: "authenticated",
      principal: p1,
    });

    render(
      <AuthGate>
        <DraftInputComponent label="user-session" />
      </AuthGate>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      listeners.forEach((cb) =>
        cb({
          state: "anonymous",
          principal: null,
        }),
      );
    });

    expect(userState.clearUserSessionData).toHaveBeenCalled();
    expect(screen.queryByTestId("child-label")).toBeNull();
  });
});
