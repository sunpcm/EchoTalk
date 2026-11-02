# Palette's Journal

## 2025-02-28 - ARIA Labels and Focus Rings for Icon Buttons & Custom Controls

**Learning:** Icon-only buttons (like drawer close, go-back, and settings gear) and custom switch controls (`role="switch"`) in React/Tailwind applications lack accessible names for screen readers and visible focus indicators for keyboard navigation unless `aria-label` and `focus-visible:ring-2` are explicitly applied.
**Action:** Always ensure icon-only buttons include `aria-label` matching their title/function and `focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none` for keyboard accessibility.

## 2025-03-01 - Active States for Preset Selection Buttons and Form Label Binding

**Learning:** Preset selection buttons and custom prompts often lack `aria-pressed` states and clear active visual feedback, making it unclear to keyboard and screen reader users which preset prompt is applied. Additionally, unlinked form labels fail to focus textareas on click.
**Action:** Use `aria-pressed={isActive}` on preset toggle buttons, provide distinct active visual styling, and link form labels with `<textarea id="...">` using `htmlFor`.

## 2025-03-02 - Accessible Progress Bars for Learning Metrics & Progress Indicators

**Learning:** Custom progress bar components (such as daily conversation turn counters and skill mastery levels) rendered as styled `<div>` elements are completely invisible to screen readers without `role="progressbar"` and standard ARIA progress attributes.
**Action:** Always wrap visual progress indicators in `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext`, and `aria-label`.

## 2025-03-03 - Contextual Action Labels and Badge Descriptions for Cards

**Learning:** Repeated generic button text (e.g., "进入练习") across multiple card lists lacks item context when navigated by screen readers via tabbing or rotor, and short acronym badges (e.g. "B2") lack explicit descriptions.
**Action:** Always append the item name to button `aria-label`s (e.g., `${t.enterPractice}：${formatTitle(item.name)}`) and include clear badge `aria-label`s (e.g., `难度等级：B2`).
