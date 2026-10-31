import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDrawer } from "./SettingsDrawer";
import * as settingsPayloadModule from "./settingsPayload";
import { useSettingsStore } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.settings;

describe("SettingsDrawer Component", () => {
  let originalShowModal: typeof HTMLDialogElement.prototype.showModal;
  let originalClose: typeof HTMLDialogElement.prototype.close;

  beforeEach(() => {
    originalShowModal = HTMLDialogElement.prototype.showModal;
    originalClose = HTMLDialogElement.prototype.close;

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    useSettingsStore.getState().reset();
  });

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal;
    HTMLDialogElement.prototype.close = originalClose;
  });

  it("does not render when open is false", () => {
    render(<SettingsDrawer open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders accessible modal dialog and locks body scroll when open is true", () => {
    const originalBodyOverflow = document.body.style.overflow;
    const { unmount } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-labelledby", "settings-drawer-title");
    expect(screen.getByText(t.title)).toBeInTheDocument();

    // 验证 showModal 调用
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);

    // 验证锁定 body 滚动
    expect(document.body.style.overflow).toBe("hidden");

    // 卸载后恢复 body 滚动
    unmount();
    expect(document.body.style.overflow).toBe(originalBodyOverflow);
  });

  it("calls onClose when close button is clicked", () => {
    const handleClose = vi.fn();
    render(<SettingsDrawer open={true} onClose={handleClose} />);

    const closeBtn = screen.getByRole("button", { name: t.closeAriaLabel || t.close });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("retains local draft state and does not re-invoke dialog lifecycle on theme store change", () => {
    const { rerender } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);

    // 触发外部主题 store 更新
    useSettingsStore.getState().setTheme("dark");
    rerender(<SettingsDrawer open={true} onClose={vi.fn()} />);

    // 重新渲染不应再次重复调用 showModal
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("consumes buildSettingsUpdate and passes full payload to updateSettings on save", async () => {
    const originalFetchSettings = useSettingsStore.getState().fetchSettings;
    const originalUpdateSettings = useSettingsStore.getState().updateSettings;
    const mockUpdateSettings = vi.fn().mockResolvedValue({ success: true });
    const spyBuildPayload = vi.spyOn(settingsPayloadModule, "buildSettingsUpdate");

    useSettingsStore.setState({
      settings: {
        is_custom_mode: true,
        stt_provider: "deepgram",
        llm_provider: "siliconflow",
        llm_model: "test-model-1",
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "verified",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
        theme: "warm",
      },
      loading: false,
      saving: false,
      fetchSettings: vi.fn().mockResolvedValue(undefined),
      updateSettings: mockUpdateSettings,
    });

    try {
      render(<SettingsDrawer open={true} onClose={vi.fn()} />);

      const llmKeyInput = screen.getByLabelText(t.apiKey, { selector: "#llm-key-input" });
      fireEvent.change(llmKeyInput, { target: { value: "  sk-new-llm-key  " } });

      const saveBtn = screen.getByRole("button", { name: t.save });
      fireEvent.click(saveBtn);

      expect(spyBuildPayload).toHaveBeenCalledTimes(1);
      expect(spyBuildPayload).toHaveBeenCalledWith({
        isCustomMode: true,
        sttProvider: "deepgram",
        llmProvider: "siliconflow",
        llmModel: "test-model-1",
        ttsProvider: "cartesia",
        sttKey: "",
        llmKey: "  sk-new-llm-key  ",
        ttsKey: "",
      });

      expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        is_custom_mode: true,
        stt_provider: "deepgram",
        llm_provider: "siliconflow",
        llm_model: "test-model-1",
        tts_provider: "cartesia",
        llm_key: "sk-new-llm-key",
      });
    } finally {
      spyBuildPayload.mockRestore();
      useSettingsStore.setState({
        fetchSettings: originalFetchSettings,
        updateSettings: originalUpdateSettings,
      });
      useSettingsStore.getState().reset();
    }
  });

  it("consumes buildSettingsUpdate when custom mode is disabled", async () => {
    const originalFetchSettings = useSettingsStore.getState().fetchSettings;
    const originalUpdateSettings = useSettingsStore.getState().updateSettings;
    const mockUpdateSettings = vi.fn().mockResolvedValue({ success: true });
    const spyBuildPayload = vi.spyOn(settingsPayloadModule, "buildSettingsUpdate");

    useSettingsStore.setState({
      settings: {
        is_custom_mode: false,
        stt_provider: "deepgram",
        llm_provider: "siliconflow",
        llm_model: "",
        tts_provider: "cartesia",
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
        theme: "warm",
      },
      loading: false,
      saving: false,
      fetchSettings: vi.fn().mockResolvedValue(undefined),
      updateSettings: mockUpdateSettings,
    });

    try {
      render(<SettingsDrawer open={true} onClose={vi.fn()} />);

      const saveBtn = screen.getByRole("button", { name: t.save });
      fireEvent.click(saveBtn);

      expect(spyBuildPayload).toHaveBeenCalledTimes(1);
      expect(spyBuildPayload).toHaveBeenCalledWith({
        isCustomMode: false,
        sttProvider: "deepgram",
        llmProvider: "siliconflow",
        llmModel: "",
        ttsProvider: "cartesia",
        sttKey: "",
        llmKey: "",
        ttsKey: "",
      });

      expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        is_custom_mode: false,
      });
    } finally {
      spyBuildPayload.mockRestore();
      useSettingsStore.setState({
        fetchSettings: originalFetchSettings,
        updateSettings: originalUpdateSettings,
      });
      useSettingsStore.getState().reset();
    }
  });
});
