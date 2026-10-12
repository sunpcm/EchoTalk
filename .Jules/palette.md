# Palette's Journal

## 2025-02-28 - ARIA Labels and Focus Rings for Icon Buttons & Custom Controls

**Learning:** Icon-only buttons (like drawer close, go-back, and settings gear) and custom switch controls (`role="switch"`) in React/Tailwind applications lack accessible names for screen readers and visible focus indicators for keyboard navigation unless `aria-label` and `focus-visible:ring-2` are explicitly applied.
**Action:** Always ensure icon-only buttons include `aria-label` matching their title/function and `focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none` for keyboard accessibility.

## 2025-03-01 - Active States for Preset Selection Buttons and Form Label Binding

**Learning:** Preset selection buttons and custom prompts often lack `aria-pressed` states and clear active visual feedback, making it unclear to keyboard and screen reader users which preset prompt is applied. Additionally, unlinked form labels fail to focus textareas on click.
**Action:** Use `aria-pressed={isActive}` on preset toggle buttons, provide distinct active visual styling, and link form labels with `<textarea id="...">` using `htmlFor`.

## 2025-03-02 - Textarea Error Associations and Disabled Action Tooltips

**Learning:** Textareas with character limits leave screen reader users uninformed unless `aria-describedby` links to the character count/warning element and `aria-invalid` is toggled. Additionally, disabled action buttons without explanatory tooltips leave users wondering why submission is blocked.
**Action:** Link textareas to character counts using `aria-describedby`, set `aria-invalid={isOverLimit}`, and add explanatory `title` tooltips and `aria-disabled` on disabled submit buttons.
