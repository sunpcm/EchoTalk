# Palette's Journal

## 2025-02-28 - ARIA Labels and Focus Rings for Icon Buttons & Custom Controls

**Learning:** Icon-only buttons (like drawer close, go-back, and settings gear) and custom switch controls (`role="switch"`) in React/Tailwind applications lack accessible names for screen readers and visible focus indicators for keyboard navigation unless `aria-label` and `focus-visible:ring-2` are explicitly applied.
**Action:** Always ensure icon-only buttons include `aria-label` matching their title/function and `focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none` for keyboard accessibility.

## 2025-03-01 - Preset Option Buttons and Form Label Linking

**Learning:** Preset prompt selection buttons and chip filters lack explicit selected state semantics for screen readers and keyboard focus indicators unless `aria-pressed={isSelected}` and `focus-visible:ring-2` are applied. Form labels must also explicitly link via `htmlFor` and matching `id` on target textareas/inputs for screen reader announcement and click-to-focus behavior.
**Action:** Always pair preset selection buttons with `aria-pressed={isSelected}`, distinct active styling, keyboard focus rings, and connect `<label htmlFor="...">` with target input `id`.
