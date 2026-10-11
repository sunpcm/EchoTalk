# Palette's Journal

## 2025-02-28 - ARIA Labels and Focus Rings for Icon Buttons & Custom Controls

**Learning:** Icon-only buttons (like drawer close, go-back, and settings gear) and custom switch controls (`role="switch"`) in React/Tailwind applications lack accessible names for screen readers and visible focus indicators for keyboard navigation unless `aria-label` and `focus-visible:ring-2` are explicitly applied.
**Action:** Always ensure icon-only buttons include `aria-label` matching their title/function and `focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none` for keyboard accessibility.

## 2025-03-01 - Active States for Preset Selection Buttons and Form Label Binding

**Learning:** Preset selection buttons and custom prompts often lack `aria-pressed` states and clear active visual feedback, making it unclear to keyboard and screen reader users which preset prompt is applied. Additionally, unlinked form labels fail to focus textareas on click.
**Action:** Use `aria-pressed={isActive}` on preset toggle buttons, provide distinct active visual styling, and link form labels with `<textarea id="...">` using `htmlFor`.
