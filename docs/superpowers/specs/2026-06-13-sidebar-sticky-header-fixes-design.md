# Sidebar Sticky Header UI Fixes

Date: 2026-06-13

## 1. Goal

Fix three visual issues in the Sidebar header without increasing its height or changing the sidebar's overall layout:

1. Header blends with scrollable conversation list beneath it (same white bg, thin 0.5px border is insufficient).
2. Content scrolls under the header with no visual occlusion effect (no shadow, no gradient).
3. Collapse button (`‹`) sits on the same row as "会话" label and "+" button, making three peer-level elements look like equal-function buttons. Collapsing the sidebar is a global layout action and should not share the same hierarchy as content operations.

## 2. Current Layout

```text
┌───────────────────────┐
│ 会话    ‹     +       │  ← thin 0.5px bottom border
├───────────────────────┤
│ 项目A                 │
│ 项目B                 │  ← scrollable list, no occlusion
│ 项目C                 │
│ ...                   │
```

Problems:
- `‹` (collapse) is visually a third button between "会话" and "+"
- No visual hint that content scrolls under the header
- 0.5px border alone doesn't create a perceived "sticky" separation

## 3. Proposed Changes

### 3.1 Sticky Header with Scroll Shadow

Make the header `position: sticky; top: 0; z-index: 10` so it stays fixed at the top when the conversation list scrolls.

Add a `box-shadow` to the header that appears **only when the list is scrolled** (`scrollTop > 0`):

```css
/* Not scrolled — no shadow, clean flat header */
box-shadow: none;

/* Scrolled — soft shadow suggesting content is underneath */
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
```

This single change solves both problems:
- **Visual distinction**: shadow creates a clear horizontal break between header and list
- **Occlusion hint**: shadow implies content continues beneath the header

Implementation note: use a scroll handler on the conversation list container (`div.flex-1.overflow-y-auto`), set a local state flag `scrolled`, and toggle the shadow via inline style.

### 3.2 Collapse Button as Right-Side Handle

Move `‹` from the header's button row to the **right edge** of the sidebar, positioned as a narrow vertical strip attached to the border.

```text
┌────────────────────────┬──┐
│ 会话             +     │‹ │
├────────────────────────┴──┤
│ 项目A                    │
│ 项目B                    │
│ 项目C                    │
```

Design details:
- Rendered as a thin rectangle (e.g. 24px wide) spanning the full header height
- Positioned at the right edge, visually part of the sidebar border system
- The `‹` character is centered vertically inside the strip
- Border-left (0.5px) separates it from the header content, making it look like a "handle" attached to the frame, not a content button
- Hover state: slightly different background to signal interactivity
- No added height: the header's existing `pt-5 pb-4 py-3` (collapsed/expanded) padding accommodates this

Benefits:
- Global layout action is physically separated from content actions
- The handle position on the right edge is intuitive: pull/push to close/open
- The `‹` character orientation (right-pointing when collapsed) maps correctly — collapsed sidebar pins to left, handle moves to the new right edge

## 4. Visual States

### Normal (not scrolled, sidebar expanded)

```text
┌────────────────────────┬──┐
│ 会话             +     │‹ │  ← flat header, no shadow
├────────────────────────┴──┤
│ Normal item               │
│ Normal item               │
```

### Scrolled (sidebar expanded)

```text
┌────────────────────────┬──┐
│ 会话             +     │‹ │  ← bottom shadow visible
│═══════════════════════════│
├────────────────────────┴──┤
│ Item under header         │
│ Scrolled item             │
```

### Collapsed sidebar (w-12)

```text
┌────┐
│  + │
│  › │  ← `›` centered in the narrow panel, handle concept visually
├────┤     transitions back to inline button position
│ A  │
│ B  │
```

Note: In collapsed mode the handle doesn't exist as a separate right-edge element (no room at 48px). The expand button (`›`) stays in its current inline position within the flex column layout. The implementation can use a single button element that changes positioning via absolute ↔ relative depending on collapsed state, or use two elements (one visible per state).

## 5. Component Changes

### Sidebar (`frontend/src/components/Sidebar/index.tsx`)

- Add a `scrolled` state variable (or ref-based check)
- Make the header element `sticky` via className `sticky top-0 z-10`
- Add scroll listener on the conversation list container (the `div.flex-1.overflow-y-auto`) to set `scrolled`
- Apply `box-shadow` conditionally on the header
- Extract the collapse button from the header's flex row
- Render collapse handle as a separate element positioned at the right edge of the sidebar's top section

No changes to:
- `ConversationItem` / `DeleteConversationDialog` — these are layout-neutral
- Sidebar width or padding values
- The collapse/open animation

## 6. Acceptance Criteria

- When conversation list is **not scrolled**, header has no shadow
- When conversation list **is scrolled**, header shows a soft bottom shadow
- Collapse button (`‹`) is visually distinct from "会话" and "+", positioned at the right edge
- Collapsed sidebar still works identically (shows abbreviated list, `›` to expand)
- No extra height added to the sidebar header
- Existing sidebar functionality (new conversation, delete, selection) unchanged
