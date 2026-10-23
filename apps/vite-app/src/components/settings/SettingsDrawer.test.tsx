import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsDrawer } from "./SettingsDrawer";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/lib/api", () => ({
  getUserSettings: vi.fn().mockResolvedValue({
    is_custom_mode: false,
    theme: "warm",
    stt_provider: null,
    llm_provider: null,
    llm_model: null,
    tts_provider: null,
    has_stt_key: false,
    has_llm_key: false,
    has_tts_key: false,
    stt_status: "unconfigured",
    llm_status: "unconfigured",
    tts_status: "unconfigured",
  }),
  updateUserSettings: vi.fn(),
}));

describe("SettingsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().reset();
  });

  it("renders with proper dialog ARIA attributes when open", async () => {
    await act(async () => {
      render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("settings-drawer-title");

    const heading = screen.getByRole("heading", { name: /设置/i });
    expect(heading.getAttribute("id")).toBe("settings-drawer-title");
  });

  it("closes when Escape key is pressed", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      render(<SettingsDrawer open={true} onClose={handleClose} />);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onClose on Escape key if drawer is closed", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      render(<SettingsDrawer open={false} onClose={handleClose} />);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(handleClose).not.toHaveBeenCalled();
  });
});
