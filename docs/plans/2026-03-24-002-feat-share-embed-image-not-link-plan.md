---
title: "feat: Share recap card as embedded image, not a link"
type: feat
status: completed
date: 2026-03-24
origin: docs/plans/2026-03-24-001-feat-share-recap-card-dialog-plan.md
---

# feat: Share recap card as embedded image, not a link

## Overview

The current share dialog passes a URL to the recap PNG for X/WhatsApp/Telegram deep-links, and "Copy link" copies that URL. When users paste this into a message or post, the image appears only as an unfurled link preview at best — it is not directly embedded as an image.

This plan upgrades the sharing so the image itself travels to the recipient/platform:

1. **"Copy image" button** — uses the `ClipboardItem` API to copy the PNG binary to the clipboard. The user then pastes it directly into X's compose box, WhatsApp desktop, Telegram desktop, etc., and it lands as an embedded image (not a URL).
2. **OG meta preview page** (server) — a lightweight HTML page at `/api/my-team/:accountId/recap/:gw/preview` with `og:image` / `twitter:card` meta tags so that when a URL is shared, X/WhatsApp/Telegram scrapers render the image inline rather than a plain link.
3. **"Download" link** — simple `<a download>` fallback for browsers where ClipboardItem is unavailable.

The Web Share API with file objects (mobile, already implemented) continues to handle the true native embed path on iOS/Android.

---

## Problem Statement / Motivation

"Sharing a link to an image" and "sharing an image" are meaningfully different UX outcomes:

- Sharing a link: recipient sees a URL, possibly an unfurled card — but it looks like a link post, not an image post.
- Sharing an image: recipient sees the actual PNG in their feed/chat, no URL clutter.

For FPL recap cards the image IS the content. The goal is to let the image land as a first-class visual in the destination, not as a hyperlink.

---

## Proposed Solution

### 1. "Copy image" button (ClipboardItem API)

Replace the existing "Copy link" button with a two-mode button:
- **If `ClipboardItem` is supported**: copies the PNG blob — labeled "Copy image"
- **Fallback**: copies the URL — labeled "Copy link" (existing behaviour)

```ts
// apps/web/src/components/ui/ShareRecapDialog.tsx
const canCopyImage = typeof ClipboardItem !== "undefined";

async function copyImage() {
  const res = await fetch(recapUrl);
  const blob = await res.blob();
  if (canCopyImage) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } else {
    await navigator.clipboard.writeText(absoluteUrl);
  }
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}
```

After copying, the user can paste the image directly into X compose (web), WhatsApp desktop, Telegram desktop, Discord, Slack, iMessage for Mac, etc.

**Browser support for `ClipboardItem`:** Chrome 97+, Safari 13.1+, Edge 97+. Firefox requires `dom.events.asyncClipboard.clipboardItem` (not default). Graceful fallback covers Firefox.

### 2. "Download" link

Add a simple `<a>` tag with `download` attribute as an explicit tertiary option:

```tsx
<a
  href={recapUrl}
  download={`fplytics-gw${gameweek}-recap.png`}
  className="..."
>
  <Download className="h-4 w-4" />
  Save image
</a>
```

Downloading and then manually uploading covers any gap for platforms/browsers where neither Web Share API nor ClipboardItem works.

### 3. OG meta preview endpoint (server)

Add a new Express route that returns a minimal HTML page with Open Graph and Twitter Card meta tags. Update the deep-link URLs for X/WhatsApp/Telegram to point to this preview page rather than the raw PNG, so scrapers see the image.

**New route:** `GET /api/my-team/:accountId/recap/:gw/preview`

```ts
// apps/api/src/routes/createApiRouter.ts
router.get("/my-team/:accountId/recap/:gw/preview", (req, res) => {
  const accountId = Number(req.params.accountId);
  const gw = Number(req.params.gw);
  const data = recapCardService.getRecapData(accountId, gw);
  if (!data) { res.status(404).send("Not found"); return; }

  const origin = `${req.protocol}://${req.get("host")}`;
  const imageUrl = `${origin}/api/my-team/${accountId}/recap/${gw}`;
  const title = `${data.managerName} — GW${gw} Recap`;
  const description = `${data.gwPoints} pts · Rank #${data.overallRank.toLocaleString()} · ${data.teamName}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="480">
  <meta property="og:image:height" content="320">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta http-equiv="refresh" content="0;url=${imageUrl}">
</head>
<body></body>
</html>`);
});
```

The `meta http-equiv="refresh"` redirects real browser visitors to the PNG immediately. Scrapers follow the OG/Twitter meta tags instead.

**Update deep-link URLs in the component:**

```ts
// Use /preview URL for social link sharing (OG tags make image appear inline)
const previewUrl = `${window.location.origin}/api/my-team/${accountId}/recap/${gameweek}/preview`;

const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(previewUrl)}`;
const waUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${previewUrl}`)}`;
const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(previewUrl)}&text=${encodeURIComponent(shareText)}`;
```

---

## Updated Dialog UI

```
┌─────────────────────────────────┐
│ Share GW{N} Recap               │
│ Midnight Press FC               │
├─────────────────────────────────┤
│  [──────── preview image ──────]│
├─────────────────────────────────┤
│  [📱 Share image]               │  ← Web Share API (mobile, canShare)
│                                 │
│  [𝕏 Post to X]  [💬 WhatsApp]  │  ← deep-links to /preview page
│  [✈️ Telegram]                  │
│                                 │
│  [🖼 Copy image]  ← "Copied!" ✓│  ← ClipboardItem (or copy URL fallback)
│  [⬇ Save image]                │  ← <a download>
│                                 │
│  ⓘ Instagram & Signal: use     │
│    "Share image" on mobile      │  ← shown only when canShare
└─────────────────────────────────┘
```

---

## System-Wide Impact

- **Interaction graph**: Purely additive. New server route adds no DB writes. `ClipboardItem` is client-only. No existing routes change.
- **Error propagation**: `fetch(recapUrl)` inside `copyImage()` can fail — wrap in try/catch, fall back to URL copy + show an error hint. OG endpoint's only dependency is `recapCardService.getRecapData()` (synchronous, SQLite read — already used by the PNG endpoint).
- **State lifecycle**: No persistent state changes. `copied` is ephemeral component state.
- **XSS in OG HTML**: All interpolated values (`title`, `description`, `imageUrl`) must have HTML special characters escaped before insertion into the inline HTML string.
- **API surface parity**: No agent/MCP tools need updating — purely presentational.

---

## Acceptance Criteria

- [ ] "Copy image" button copies the PNG blob to clipboard on Chrome/Safari/Edge (ClipboardItem supported)
- [ ] "Copy image" falls back to copying the URL on Firefox / unsupported browsers, with label "Copy link"
- [ ] "Save image" link downloads the PNG file directly
- [ ] `GET /api/my-team/:accountId/recap/:gw/preview` returns HTML with correct `og:image`, `og:title`, `og:description`, `twitter:card: summary_large_image`, and `twitter:image` meta tags
- [ ] Browser visiting `/preview` URL is immediately redirected to the PNG via `meta refresh`
- [ ] X/WhatsApp/Telegram deep-link buttons use the `/preview` URL (not the raw PNG URL)
- [ ] OG HTML has all user-supplied values HTML-escaped (no XSS)
- [ ] "Share image" (Web Share API) continues to work on mobile unchanged
- [ ] Existing tests pass; new tests added for OG endpoint and `copyImage()` logic

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| ClipboardItem requires user gesture and secure context (HTTPS/localhost) | Always available in production; dev server is localhost (secure context) |
| Firefox does not support ClipboardItem | Graceful fallback to URL copy; label switches to "Copy link" |
| OG scrapers (X/WhatsApp/Telegram) may not follow `meta refresh` | They don't need to; they read OG meta tags before redirect |
| `req.get("host")` returns wrong value behind a reverse proxy | Production deployments should set `app.set("trust proxy", 1)` and forward `X-Forwarded-Proto` / `X-Forwarded-Host` |
| HTML injection in OG page from malicious manager/team names | HTML-escape `title`, `description`, `imageUrl` before interpolation |

---

## Implementation Units

### Unit 1 — "Copy image" + "Save image" in ShareRecapDialog

**Goal:** Replace "Copy link" with a smarter button that copies the image blob (or falls back to URL), and add a download link.

**Files:**
- Modify: `apps/web/src/components/ui/ShareRecapDialog.tsx`

**Approach:**
1. Add `canCopyImage = typeof ClipboardItem !== "undefined"` constant
2. Replace `copyLink()` with `copyImage()` — fetches blob, writes `ClipboardItem({ 'image/png': blob })` if supported, else `clipboard.writeText(url)`
3. Update button label: "Copy image" when `canCopyImage`, "Copy link" otherwise
4. Update error hint: "Try saving the image instead." (points to download link)
5. Add `<a href={recapUrl} download={...}>` "Save image" button below the copy button
6. Import `Download` from `lucide-react`

**Verification:** ClipboardItem branch: `navigator.clipboard.write` called with `image/png` ClipboardItem; fallback branch: `navigator.clipboard.writeText` called with URL; "Copied!" appears after click; download link has correct `href` and `download` attr.

---

### Unit 2 — OG meta preview endpoint (API)

**Goal:** New Express route that returns HTML with OG/Twitter card meta tags for the recap card.

**Files:**
- Modify: `apps/api/src/routes/createApiRouter.ts`

**Approach:**
1. Add `GET /my-team/:accountId/recap/:gw/preview` route before the existing PNG route
2. Validate params; call `recapCardService.getRecapData(accountId, gw)` (already imported)
3. Derive `origin` from `req.protocol + req.get("host")`
4. HTML-escape `data.managerName`, `data.teamName`, and computed strings before interpolating into HTML
5. Build and send the HTML with OG + Twitter card meta tags + `meta refresh`

**Patterns to follow:** Existing `/my-team/:accountId/recap/:gw` route at `apps/api/src/routes/createApiRouter.ts:155–180`

**Verification:** `GET /api/my-team/1/recap/7/preview` returns `Content-Type: text/html`; response contains `og:image`, `twitter:card: summary_large_image`, and `meta refresh` pointing to the PNG URL; visiting in browser redirects to PNG.

---

### Unit 3 — Update deep-link URLs to use /preview page

**Goal:** X/WhatsApp/Telegram buttons share the `/preview` page URL so scrapers see OG image tags.

**Files:**
- Modify: `apps/web/src/components/ui/ShareRecapDialog.tsx`

**Approach:**
1. Add `previewUrl = ${window.location.origin}/api/my-team/${accountId}/recap/${gameweek}/preview`
2. Replace `absoluteUrl` with `previewUrl` in `xUrl`, `waUrl`, `tgUrl`
3. Keep `absoluteUrl` for ClipboardItem URL fallback (direct PNG link is more useful for paste)

**Verification:** X/WhatsApp/Telegram URLs contain `/preview` path; copy fallback URL still points to raw PNG.

---

### Unit 4 — Tests

**Files:**
- Modify: `apps/web/src/components/ui/ShareRecapDialog.test.tsx` — update copy test; add ClipboardItem mock path
- Create: `apps/api/test/recapPreviewRoute.test.ts` — test the new OG endpoint

**Test scenarios:**
1. `copyImage()` calls `navigator.clipboard.write` with a `ClipboardItem` when available
2. `copyImage()` falls back to `navigator.clipboard.writeText` when `ClipboardItem` is undefined
3. Download link has `download` attribute and correct `href`
4. X/WhatsApp/Telegram URLs contain `/preview` path (not raw PNG)
5. `GET /api/my-team/1/recap/7/preview` → 200 HTML with `og:image` containing `/recap/7` path
6. `GET /api/my-team/1/recap/7/preview` with no data → 404

**Verification:** All 6 scenarios pass; existing `ShareRecapDialog.test.tsx` suite still green.

---

## Sources & References

### Origin Document
- `docs/plans/2026-03-24-001-feat-share-recap-card-dialog-plan.md` — original share dialog plan; carried forward: Dialog/Button patterns, Web Share API implementation, recap endpoint URL structure

### Internal References
- ShareRecapDialog: `apps/web/src/components/ui/ShareRecapDialog.tsx`
- Recap PNG route: `apps/api/src/routes/createApiRouter.ts:155–180`
- RecapCardService: `apps/api/src/services/recapCardService.ts`
- API test pattern: `apps/api/test/queryService.test.ts`

### External References
- ClipboardItem API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem
- `navigator.clipboard.write()` (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
- Open Graph protocol: https://ogp.me
- Twitter Card meta tags: https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/summary-card-with-large-image
