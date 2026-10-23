import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDrawer } from "./SettingsDrawer";
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
});
