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

## 2025-03-03 - Accessible Text Counters and Early Proactive Warnings

**Learning:** Text input character counters are not automatically associated with textareas for assistive technologies unless explicitly linked via `aria-describedby` and set as a polite live region with `aria-live="polite"`. Furthermore, providing early visual feedback before hitting hard character limits prevents user frustration.
**Action:** Link character counters to textareas with `aria-describedby` and `aria-live="polite"`, and apply warning styling when input length approaches the maximum threshold.

## 2025-03-04 - Semantic Deletions & Insertions for Language Learning Error Feedback

**Learning:** In language correction and grammar feedback lists, relying purely on styled `<span>` elements with CSS `line-through` fails to convey the deletion/insertion semantics to screen reader users, who hear the wrong word and correction in sequence without distinction. In addition, sighted users benefit from an explicit directional transition indicator (`→`) rather than adjacent text blocks.
**Action:** Use semantic `<del>` and `<ins>` tags with descriptive `aria-label` prefixes (e.g. "原句错误：..." and "建议修改：..."), include an `aria-hidden="true"` arrow divider, and preserve clean keyboard tab order without adding unnecessary tabstops to static list items.
