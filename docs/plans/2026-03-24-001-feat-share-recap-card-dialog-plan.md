---
title: "feat: Share GW Recap Card Dialog with Social Targets"
type: feat
status: completed
date: 2026-03-24
---

# feat: Share GW Recap Card Dialog with Social Targets

## Overview

Replace the plain `<a>` "Share recap" link with a **share dialog** that lets users share their generated GW recap PNG via the native OS share sheet (any app), or directly to X/Twitter, WhatsApp, Telegram, and via clipboard. Instagram and Signal are handled through the native share sheet on mobile.

The dialog shows a live image preview of the card, platform-specific buttons, and a copy-link fallback — all built with the existing `Dialog` component and zero new dependencies.

---

## Problem Statement / Motivation

Currently tapping "Share recap" opens the raw PNG in a new browser tab. Users have to manually download the image and open WhatsApp/Instagram/X to share it — a multi-step, friction-heavy flow.

FPL sharing is inherently social (rank changes, big scores, captain picks). A proper share sheet is a standard expectation and will drive organic word-of-mouth reach for the app.

---

## Proposed Solution

### Share Dialog

A new `ShareRecapDialog` component wrapping the existing `Dialog`/`DialogContent` primitives. It:

1. Renders a `<img>` preview of the recap card (fetched from the existing `/api/my-team/:accountId/recap/:gw` endpoint).
2. Shows a **"Share image"** button (Web Share API with image file) when `navigator.canShare({ files })` is supported — on mobile this triggers the native OS share sheet covering Instagram, Signal, iMessage, WhatsApp, etc.
3. Shows platform deep-link buttons for **X/Twitter**, **WhatsApp**, and **Telegram** (all have reliable web intent URLs).
4. Shows a **"Copy link"** button with inline "Copied!" feedback (no toast library needed).
5. Notes that Instagram and Signal require "Share image" on mobile.

Both existing Share buttons (GW header bar + history table row) become `<button>` elements that set `shareGw` state to open the dialog.

### Platform Coverage

| Platform | Method | Notes |
|---|---|---|
| Any app (iOS/Android) | Web Share API `navigator.share({ files })` | Native OS share sheet; covers Instagram, Signal, iMessage, TikTok, etc. |
| X / Twitter | Deep link `twitter.com/intent/tweet` | URL share with pre-filled text + hashtags |
| WhatsApp | Deep link `wa.me/?text=` | URL + caption; WhatsApp renders link preview |
| Telegram | Deep link `t.me/share/url` | URL + text |
| Instagram | Web Share API (mobile only) | No web deep-link exists; native share sheet is the only path |
| Signal | Web Share API (mobile only) | No web deep-link exists; same as Instagram |
| Desktop / clipboard | `navigator.clipboard.writeText` | Fallback for all platforms on desktop |

---

## Technical Approach

### New File: `ShareRecapDialog` Component

```
apps/web/src/components/ui/ShareRecapDialog.tsx
```

**Props interface:**
```ts
interface ShareRecapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number;
  gameweek: number;
  teamName: string;
}
```

**Derived values inside component:**
```ts
const recapUrl = `/api/my-team/${accountId}/recap/${gameweek}`;
const absoluteUrl = `${window.location.origin}${recapUrl}`;
const shareText = `GW${gameweek} Recap 📊 #FPL #GW${gameweek}`;
```

**Web Share API with image file:**
```ts
async function shareImageNative() {
  const res = await fetch(recapUrl);
  const blob = await res.blob();
  const file = new File([blob], `fplytics-gw${gameweek}-recap.png`, { type: "image/png" });
  await navigator.share({ files: [file], title: `GW${gameweek} Recap`, text: shareText });
}
```

Feature-detect before rendering the button:
```ts
const canShareFiles = typeof navigator !== "undefined" && "canShare" in navigator;
```
(Check `canShare` at render time; the actual `canShare({ files })` call is deferred to click since we don't have the `File` yet.)

**Copy link state:**
```ts
const [copied, setCopied] = useState(false);
async function copyLink() {
  await navigator.clipboard.writeText(absoluteUrl);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}
```

**Deep-link URL helpers (construct inline, no library):**
```ts
const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(absoluteUrl)}`;
const waUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${absoluteUrl}`)}`;
const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(shareText)}`;
```

All deep-links open with `window.open(url, "_blank", "noreferrer")`.

### Changes to `MyTeamPage.tsx`

**State addition:**
```ts
const [shareGw, setShareGw] = useState<number | null>(null);
```

**GW header bar** (currently `<a>` at lines 823–834):
- Replace with `<button onClick={() => setShareGw(viewGameweek)}>` styled identically.

**History table row** (currently `<a>` at lines 1032–1043):
- Replace with `<button onClick={() => setShareGw(row.gameweek)}>` per row.

**Dialog instance** (add near the existing player detail Dialog at ~line 1142):
```tsx
{shareGw && (
  <ShareRecapDialog
    open={shareGw !== null}
    onOpenChange={(open) => { if (!open) setShareGw(null); }}
    accountId={selectedAccount.id}
    gameweek={shareGw}
    teamName={payload.teamName}
  />
)}
```

### Dialog UI Layout

```
┌─────────────────────────────────┐
│ Share GW{N} Recap               │  ← DialogTitle
│ Midnight Press FC               │  ← DialogDescription (team name)
├─────────────────────────────────┤
│  [────── 480×160 preview ──────]│  ← <img> max-w-full rounded-lg
├─────────────────────────────────┤
│  [📱 Share image]               │  ← Web Share API (shown if canShare)
│                                 │
│  [𝕏 Post to X]                 │
│  [💬 Send on WhatsApp]          │
│  [✈️ Send on Telegram]          │
│                                 │
│  [🔗 Copy link]  ← "Copied!" ✓ │
│                                 │
│  ⓘ Instagram & Signal: use     │
│    "Share image" on mobile      │  ← only if canShare supported
└─────────────────────────────────┘
```

Buttons use `variant="outline"` from the existing Button component. Icons from `lucide-react` (already installed): `Share2`, `Link`, `Copy`, `Check`.

Custom SVG brand icons for X, WhatsApp, Telegram (inline SVG — avoids external icon dependencies).

---

## System-Wide Impact

- **Interaction graph**: Purely additive UI component. The recap endpoint already exists; no API changes. No new DB queries or SSE connections.
- **Error propagation**: The `fetch(recapUrl)` call inside `shareImageNative` can fail (network error, server error). Wrap in try/catch; show a fallback "Copy link" on error.
- **State lifecycle**: `shareGw` is component-local state; no risk of orphaned state.
- **API surface parity**: No agent/MCP tools access the share dialog — it is purely presentational. No parity concern.
- **Integration test scenarios**: No integration tests needed; the endpoint is already covered. A component test for `ShareRecapDialog` rendering the correct deep-link `href` values is sufficient.

---

## Acceptance Criteria

- [ ] Clicking "Share recap" in the GW header bar opens the share dialog (not a new tab)
- [ ] Clicking "Share" in the history table row opens the share dialog
- [ ] Dialog shows a preview image of the recap card
- [ ] "Share image" button appears when `'canShare' in navigator` and triggers `navigator.share` with a PNG File
- [ ] X, WhatsApp, Telegram buttons open correct deep-link URLs in new tab
- [ ] "Copy link" button copies the absolute recap URL and shows "Copied!" for 2 s
- [ ] Dialog closes cleanly (no lingering `shareGw` state)
- [ ] Instagram/Signal note only shows when `canShare` is supported (mobile context)
- [ ] No new npm dependencies introduced
- [ ] Existing tests continue to pass (mock `navigator.share` in test environment)

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `navigator.share` not supported on desktop Chrome/Firefox | Gate behind `canShare` check; clipboard always shown |
| `fetch(recapUrl)` slow on low-end mobile | Show loading spinner inside "Share image" button during fetch |
| X/Twitter intent URL changes | Pure string constant — easy to update |
| WhatsApp URL scheme blocks deep-link on iOS | `wa.me` format is the canonical modern URL and works on iOS |
| Recap endpoint returns 404 (no history for that GW) | `<img>` `onError` handler shows a placeholder / error state in dialog |

---

## Implementation Units

### Unit 1 — `ShareRecapDialog` component

**Goal:** Build the full share modal as a standalone component.

**Files:**
- Create: `apps/web/src/components/ui/ShareRecapDialog.tsx`

**Patterns to follow:**
- `apps/web/src/components/ui/dialog.tsx` — Dialog primitive usage
- `apps/web/src/components/ui/button.tsx` — Button variants (`outline`, `ghost`)
- Existing Dialog usage in `apps/web/src/pages/MyTeamPage.tsx:1142–1274`

**Approach:**
1. Props: `{ open, onOpenChange, accountId, gameweek, teamName }`
2. Derive `recapUrl`, `absoluteUrl`, `shareText`, deep-link URLs
3. `canShareFiles` constant from `'canShare' in navigator`
4. `copyLink()` with `copied` state
5. `shareImageNative()` async with loading state + try/catch
6. Render dialog with preview img, platform buttons, copy button, Instagram/Signal note

**Execution note:** Implement and visually verify locally before wiring into MyTeamPage.

**Verification:** Component renders without errors; deep-link hrefs contain correctly encoded URL and text; "Share image" button absent in jsdom (no `navigator.canShare`); "Copied!" appears after copy click.

---

### Unit 2 — Wire share dialog into `MyTeamPage`

**Goal:** Replace both `<a>` share tags with buttons that open the new dialog.

**Files:**
- Modify: `apps/web/src/pages/MyTeamPage.tsx`

**Approach:**
1. Add `import { ShareRecapDialog } from "@/components/ui/ShareRecapDialog"`
2. Add `const [shareGw, setShareGw] = useState<number | null>(null)` near other state
3. Replace `<a>` at lines 823–834 with `<button onClick={() => setShareGw(viewGameweek!)}>`
4. Replace `<a>` at lines 1032–1043 with `<button onClick={() => setShareGw(row.gameweek)}>`
5. Add `<ShareRecapDialog>` instance near the player detail Dialog (~line 1142)

**Patterns to follow:** Existing Dialog open/close pattern in MyTeamPage lines 1142–1274.

**Verification:** Share button in GW header bar opens dialog with correct `gameweek`. Share button in history table opens dialog for the correct row GW. Dialog closes when dismissed.

---

### Unit 3 — Tests

**Goal:** Cover the new component and verify MyTeamPage mock is still complete.

**Files:**
- Create: `apps/web/src/components/ui/ShareRecapDialog.test.tsx`
- Verify: `apps/web/src/pages/MyTeamPage.test.tsx` (no new mocks needed — `ShareRecapDialog` is a UI component, not an API call)

**Test scenarios:**

1. Renders preview `<img>` with correct `src` prop
2. Renders X, WhatsApp, Telegram `<a>` tags with correctly encoded URLs
3. "Share image" button absent in jsdom environment (no `navigator.canShare`)
4. "Copy link" click calls `navigator.clipboard.writeText` with the absolute URL
5. Existing MyTeamPage test: "renders the native page sections" still passes with share buttons changed from `<a>` to `<button>`

**Execution note:** Mock `navigator.clipboard.writeText` in test setup.

**Verification:** All 5 test scenarios pass; existing `MyTeamPage.test.tsx` suite still green.

---

## Sources & References

### Internal References

- Recap endpoint: `apps/api/src/routes/createApiRouter.ts:155–180`
- Recap service: `apps/api/src/services/recapCardService.ts:98–182`
- Dialog primitive: `apps/web/src/components/ui/dialog.tsx:1–86`
- Button variants: `apps/web/src/components/ui/button.tsx:1–57`
- Existing Dialog pattern: `apps/web/src/pages/MyTeamPage.tsx:1142–1274`
- Current share buttons (GW bar): `apps/web/src/pages/MyTeamPage.tsx:823–834`
- Current share buttons (history table): `apps/web/src/pages/MyTeamPage.tsx:1032–1043`

### External References

- Web Share API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API
- `navigator.canShare()` (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
- Twitter Web Intent: https://developer.twitter.com/en/docs/twitter-for-websites/tweet-button/guides/web-intent
- WhatsApp Share URL: https://faq.whatsapp.com/5913398998672934
- Telegram Share URL: https://core.telegram.org/widgets/share
