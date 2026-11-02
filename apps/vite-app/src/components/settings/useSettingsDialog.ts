import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.settings;

/** 获取当前容器内真正可聚焦且未被禁用的元素列表（排除 disabled fieldset 的后代）。 */
function getTabbableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"),
  );

  return elements.filter((el) => {
    if (el.matches(":disabled") || el.closest("fieldset[disabled]")) {
      return false;
    }
    if ((el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled === true) {
      return false;
    }
    const tabIndex = el.getAttribute("tabindex");
    if (tabIndex !== null && parseInt(tabIndex, 10) < 0) {
      return false;
    }
    if (el.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

interface UseSettingsDialogOptions {
  open: boolean;
  onClose: () => void;
}

/**
 * 绑定原生 dialog 的打开周期资源。
 * effect 只随真实 open 切换，回调引用变化不会关闭并重开 dialog。
 */
export function useSettingsDialog({ open, onClose }: UseSettingsDialogOptions) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      previousActiveElementRef.current = document.activeElement;
    } else {
      previousActiveElementRef.current =
        document.querySelector<HTMLElement>(`button[aria-label="${t.title}"]`) ?? null;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute("open", "");
    }

    // 小视口与移动端也不自动聚焦 API Key，避免拉起键盘。
    const frameId = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) {
        closeButtonRef.current?.focus();
      }
    };

    document.addEventListener("focusin", handleFocusIn);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("focusin", handleFocusIn);
      document.body.style.overflow = originalOverflow;

      if (typeof dialog.close === "function" && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }

      const previousActiveElement = previousActiveElementRef.current;
      previousActiveElementRef.current = null;
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus();
      }
    };
  }, [open]);

  const handleDialogClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== dialogRef.current) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const rect = dialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.bottom &&
      rect.left <= event.clientX &&
      event.clientX <= rect.right;

    if (!isInDialog) {
      onCloseRef.current();
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }

    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusables = getTabbableElements(dialog);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const current = document.activeElement as HTMLElement | null;
    const currentIndex = current ? focusables.indexOf(current) : -1;

    if (event.shiftKey) {
      const previousIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
      focusables[previousIndex].focus();
      return;
    }

    const nextIndex =
      currentIndex === -1 || currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1;
    focusables[nextIndex].focus();
  }, []);

  const handleCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onCloseRef.current();
  }, []);

  return {
    dialogRef,
    closeButtonRef,
    handleDialogClick,
    handleKeyDown,
    handleCancel,
  };
}
