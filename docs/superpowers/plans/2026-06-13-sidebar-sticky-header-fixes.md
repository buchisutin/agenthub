# Sidebar Sticky Header UI Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three visual issues in the Sidebar header: header blends with scrollable list, no occlusion shadow when content scrolls under, and collapse button wrongly positioned among content actions.

**Architecture:** Two independent changes to `Sidebar/index.tsx`: (1) add scroll-state tracking to toggle a shadow on the header, (2) restructure the header layout to move the collapse toggle to the right edge as a "handle" in expanded mode. The existing test file covers collapse behavior and must continue passing.

**Tech Stack:** React + Tailwind CSS (`frontend/src/components/Sidebar/index.tsx`)

---

### Task 1: Add scroll shadow to sidebar header

**Files:**
- Modify: `frontend/src/components/Sidebar/index.tsx:69-96`

**Goal:** When the conversation list is scrolled, the header gets a bottom shadow to visually separate it from the list and imply content is underneath.

**Approach:**
- Add a `scrolled` state variable
- Add an `onScroll` handler on the scroll container (`div.flex-1.overflow-y-auto`, the sibling of the header)
- Toggle a `box-shadow` on the header div based on `scrolled`

- [ ] **Step 1: Add `scrolled` state**

Add this as a new `useState` after `collapsed` (line 21):

```tsx
const [collapsed, setCollapsed] = useState(false);
const [scrolled, setScrolled] = useState(false);
```

- [ ] **Step 2: Add scroll handler and conditionally apply shadow**

Find the header div (currently line 74):

```tsx
<div className={collapsed ? 'px-2 py-3' : 'px-5 pt-5 pb-4'} style={{ borderBottom: '0.5px solid var(--app-border)' }}>
```

Replace it with:

```tsx
<div
  className={collapsed ? 'px-2 py-3 relative' : 'px-5 pt-5 pb-4 relative'}
  style={{
    borderBottom: '0.5px solid var(--app-border)',
    boxShadow: scrolled && !collapsed ? '0 2px 8px rgba(0,0,0,0.06)' : undefined,
  }}
>
```

Note: `relative` is needed for the absolute-positioned collapse handle in Task 2. Adding it now avoids a second edit to this div.

- [ ] **Step 3: Add onScroll to the conversation list container**

Find the scroll container (currently line 118):

```tsx
<div className="flex-1 overflow-y-auto px-2 py-3">
```

Replace with:

```tsx
<div className="flex-1 overflow-y-auto px-2 py-3" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
```

The scroll handler fires on every scroll event and sets `scrolled` to `true` as soon as any scroll happens, and back to `false` when scrolled back to the top.

- [ ] **Step 4: Run existing tests**

```bash
cd frontend && npx vitest run src/components/Sidebar/index.test.tsx
```

Expected: all tests pass (the collapse test uses aria-labels which haven't changed yet).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar/index.tsx
git commit -m "feat: add scroll shadow to sidebar header"
```

---

### Task 2: Move collapse button to right-edge handle

**Files:**
- Modify: `frontend/src/components/Sidebar/index.tsx:69-96`
- Test: `frontend/src/components/Sidebar/index.test.tsx` (the collapse test must keep passing — confirm aria-labels are unchanged)

**Goal:** In expanded mode, the collapse button (`‹`) becomes a full-height handle strip at the right edge of the header, visually separate from "会话" label and "+" button. In collapsed mode, the expand button (`›`) stays inline in the flex column layout.

**Approach:**
- The collapse button is conditionally rendered in two positions:
  - **Expanded**: absolutely positioned at `right-0`, spanning `inset-y-0`, `w-6`, styled as a handle strip with a left border separator
  - **Collapsed**: inline in the flex column (as it is currently)
- The inner flex row gets `pr-6` (or equivalent margin) to keep "会话" and "+" from overlapping the handle

- [ ] **Step 1: Restructure the header JSX**

Replace the entire header section (lines 74-96) with:

```tsx
<div
  className={collapsed ? 'px-2 py-3 relative' : 'px-5 pt-5 pb-4 relative'}
  style={{
    borderBottom: '0.5px solid var(--app-border)',
    boxShadow: scrolled && !collapsed ? '0 2px 8px rgba(0,0,0,0.06)' : undefined,
  }}
>
  <div className={collapsed ? 'flex flex-col items-center gap-2' : 'flex items-center justify-between gap-2'}>
    {!collapsed && <span className="text-[13px] font-medium" style={{ color: 'var(--app-text)' }}>会话</span>}

    {collapsed && (
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? '展开会话列表' : '收起会话列表'}
        className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors hover:opacity-90"
        style={{ color: 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)', backgroundColor: 'var(--card-bg)' }}
      >
        ›
      </button>
    )}

    <button
      onClick={handleNewConversation}
      className="w-6 h-6 flex items-center justify-center rounded text-base leading-none transition-colors hover:opacity-90"
      style={{ color: 'var(--app-text-hint)' }}
      title="新建会话"
      aria-label="新建会话"
    >
      +
    </button>
  </div>

  {!collapsed && (
    <button
      type="button"
      onClick={() => setCollapsed((value) => !value)}
      aria-label="收起会话列表"
      className="absolute right-0 inset-y-0 w-6 flex items-center justify-center text-sm transition-colors hover:opacity-90 rounded-r-xl"
      style={{ color: 'var(--app-text-secondary)', borderLeft: '0.5px solid var(--app-border)' }}
    >
      ‹
    </button>
  )}
</div>
```

Key changes from original:
- Collapse button removed from the inner flex row in expanded mode
- Collapse button rendered as `absolute right-0 inset-y-0 w-6` handle when expanded
- Collapse button stays inline when collapsed
- Handle has `borderLeft` to visually separate it from the header content
- `rounded-r-xl` on the handle to match the sidebar's rounded corners
- The aria-label `收起会话列表` / `展开会话列表` is preserved on both render paths

- [ ] **Step 2: Run tests**

```bash
cd frontend && npx vitest run src/components/Sidebar/index.test.tsx
```

Expected: all tests pass. The collapse test finds the button via `getByLabelText('收起会话列表')` which is still present.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar/index.tsx
git commit -m "feat: move sidebar collapse button to right-edge handle"
```
