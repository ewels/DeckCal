# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Stream Deck plugin (`com.ewels.deckcal`, "DeckCal") that turns a key into a live Google Calendar countdown. One action: `com.ewels.deckcal.countdown` ("Meeting countdown"). The key auto-updates every second from a 60-second Google Calendar poll, surfacing the next meeting (or the current one if you are in it), with progress bars, an imminent-fill in the last 5 minutes, a flash on meeting start, and a footer band for OOO / focus overlaps.

## Commands

```sh
npm run build         # one-off rollup build → com.ewels.deckcal.sdPlugin/bin/plugin.js
npm run watch         # rebuild on save; restarts the plugin in Stream Deck via @elgato/cli
npm run lint          # biome lint
npm run lint:fix      # biome lint --write
npm run check         # biome check (lint + format)
npm run format        # prettier --write + biome format --write
npm run format:check  # prettier --check + biome format (no write)
```

A code change does not appear in Stream Deck until the plugin process is restarted (`npm run watch` handles this automatically, or run `streamdeck restart com.ewels.deckcal`). Property-inspector HTML / JS edits are picked up by reopening the action's settings panel.

## Git hooks: prek, not pre-commit

Hooks live in `prek.toml` (TOML) and are run by [prek](https://github.com/j178/prek), a Rust-based replacement for `pre-commit`. **Do not invoke `pre-commit` or write `.pre-commit-config.yaml`.** TOML config requires `prek >= 0.4.0`.

```sh
prek install              # install git hook
prek run --all-files      # run hooks across the repo
```

## Release process

Version lives in `com.ewels.deckcal.sdPlugin/manifest.json` as a four-part `X.Y.Z.0` string (Elgato's format — the trailing `.0` stays zero). `package.json` is `private: true` with no `version` field, so the manifest is the only place to bump.

```sh
# 1. Bump manifest "Version" to "X.Y.Z.0" on a clean tree, then push.
git commit -m "Bump version to X.Y.Z" com.ewels.deckcal.sdPlugin/manifest.json
git push origin main
# 2. Create the release.
gh release create vX.Y.Z --title "vX.Y.Z — <headline>" --notes "..."
```

A GitHub Actions release workflow should mirror type-deck's: on `release: published`, run `npm ci && npm run build`, stage a tiny `package.json` inside `com.ewels.deckcal.sdPlugin/` so `googleapis` and `google-auth-library` are installed alongside `bin/plugin.js`, then `streamdeck pack` and upload. Not wired up yet — see TODO.

## Architecture

```
src/
  plugin.ts             bootstrap: registers the action + connect()
  settings.ts           CountdownSettings, GlobalSettings, DEFAULTS, resolveProvider/resolveNextMeeting
  actions/
    countdown.ts        SingletonAction — key lifecycle, press handlers, PI bridge
  calendar/
    auth.ts             OAuth 2.0 PKCE loopback flow, token persistence in global settings
    client.ts           googleapis wrapper: listCalendars, listEvents, normalize → CalendarEvent
    selection.ts        filter + pick (ongoing-most-recent > next upcoming) + footer band
    conferencing.ts     detect Meet / Zoom / Teams URL + first attachment fileUrl
  render/
    icon.ts             buildSvgTile(state) → data URL (144×144 SVG)
  runtime/
    runtime.ts          poller (60s), ticker (1Hz), per-account client cache, key registry
    store.ts            global-settings helpers (acknowledgedEventIds, etc.)
  util/
    log.ts              streamDeck.logger scope
    launch.ts           openUrl + openInApp (macOS / Windows)
com.ewels.deckcal.sdPlugin/
  manifest.json         plugin manifest (Elgato schema)
  ui/countdown.html     property inspector (sdpi-components v4 over CDN)
  ui/countdown.js       PI bridge: sign-in, calendar checkbox list, conditional show/hide
  bin/plugin.js         rollup output, gitignored
  imgs/                 icons (placeholders; replace before release)
rollup.config.mjs       bundles src/ to bin/plugin.js
                        googleapis + google-auth-library + gaxios + gtoken are external
                        — resolved from node_modules at runtime
```

Stream Deck spawns `node bin/plugin.js`; the SDK translates websocket events into per-action handlers via `SingletonAction`. The runtime module owns shared state: one OAuth2Client per Google account, one cached event list per account, one ticker that re-renders all visible keys at 1Hz, one poller that refreshes Calendar data at 60s with exponential backoff (60s → 120 → 240 → 480 → 600).

### Settings shape (per-key)

Flat keys (sdpi-components binds via flat `setting="X"` paths). `resolveProvider()` and `resolveNextMeeting()` in `src/settings.ts` reassemble structured handlers from the flat fields. Number fields stored by sdpi-textfield arrive as strings, so always re-parse via `toNumber(value, fallback)`.

`account` is a structured `{ sub, email }` set by the plugin after OAuth completes; the PI displays the email but does not edit this field directly. OAuth tokens themselves live in global settings under `accounts[sub]`, so they survive button reassignment and aren't duplicated per key.

### Key press lifecycle

`CountdownAction.onKeyDown` records a timestamp and starts a `setTimeout(longPressThresholdMs)` (default 600 ms). If `onKeyUp` arrives first, clear the timer and dispatch the short-press branch. If the timer fires first, dispatch long press. This is the same pattern as `type-deck/src/actions/base.ts:242-281`.

Any keyDown also calls `acknowledgeForKey(actionId)`, which pushes the currently-ongoing event's ID into `global.acknowledgedEventIds`. The ticker uses that set to decide whether to flash an ongoing event — the user has seen the alert, no more flashing.

Short press dispatch:

- **ongoing** → `detectConference()` → look up the per-provider handler via `resolveProvider()` → `openInApp(app, url)` or `openUrl(url)`. If no conference detected, fall back to `event.htmlLink`.
- **upcoming** → `resolveNextMeeting()` → URL or app launcher.

Long press dispatch:

- First `event.attachments[].fileUrl` → open it.
- Else `event.htmlLink`.

### Selection rules

`select(events, settings)` runs the filter pipeline:

1. Basic filters: drop cancelled, drop all-day if `ignoreAllDay`, drop declined / tentative depending on flags, drop transparency `transparent`.
2. Special-event modes: events of type `outOfOffice` or `focusTime` are run through `outOfOfficeMode` / `focusMode`. Mode `ignore` drops them. Mode `footerBand` drops them from the selection pool but lets ongoing ones contribute to the footer band color (purple for focus, grey for OOO; focus wins if both ongoing). Mode `regular` keeps them in the pool.
3. Pick: ongoing events first (most recently started wins on ties), then the next upcoming.
4. `extraCount` = total qualifying events in the pool minus 1.

### Render states

`buildSvgTile({ state, flashOn })` outputs a `data:image/svg+xml;base64,…` URL. States:

- `idle` — calendar glyph + optional footer band.
- `upcoming` — top progress (gap elapsed / gap total), imminent yellow fill in last N minutes, center countdown, +N footer, band.
- `ongoing` — top progress (meeting elapsed / total), imminent green fill in last N minutes, optional yellow flash overlay driven by `flashOn` parity, center countdown, +N footer, band.
- `authRequired` — red key glyph + "Sign in" text.

Text color is white by default; inverted to black when the yellow imminent fill is more than half covering the tile or when the flash overlay is on (green is dark enough to keep white text on top).

### Property inspector bridge

`countdown.js` uses `SDPIComponents.streamDeckClient`:

- `.send("sendToPlugin", payload)` — outbound, three kinds: `startAuth`, `signOut`, `listCalendars`.
- `.sendToPropertyInspector.subscribe(cb)` — inbound, three kinds: `authResult`, `calendars`, `signedOut`.
- `.getSettings()` / `.setSettings()` — read/write the action settings.
- `.didReceiveSettings.subscribe(cb)` — refresh the UI when something else changes settings (e.g., the plugin saving `account` after sign-in).

`data-show-when="settingKey=value"` attributes on HTML elements drive the conditional show/hide for App vs URL rows; `applyConditionals()` reads the current settings and toggles `.hidden`.

### OAuth (loopback PKCE)

1. PI calls `startAuth` → plugin generates `code_verifier` + `code_challenge`, picks an OS-assigned port (`server.listen(0)`), builds the Google authorize URL.
2. Plugin opens the URL in the user's browser via `streamDeck.system.openUrl(...)`.
3. Plugin runs a one-shot HTTP server on `127.0.0.1:<port>`. The server captures `?code=...&state=...`, validates state, returns a "you can close this tab" page, and closes.
4. Plugin exchanges code at `https://oauth2.googleapis.com/token` with the verifier (handled by `google-auth-library`).
5. Plugin decodes `id_token` to get `sub` + `email`, persists `{ sub, email, tokens }` to global settings, writes `account = { sub, email }` to per-key settings, sends `authResult` to PI.

Refresh is handled transparently by `OAuth2Client`. The `tokens` event handler persists refreshed `access_token`s back to global settings.

## Conventions

**No em-dashes in user-facing text.** README copy, UI HTML labels and tooltips, anything visible to a Stream Deck user: use a period, colon, or parentheses instead of `—`. This rule does **not** apply to internal docs like this file or `MEMORY.md`.

## TODOs

- Replace placeholder icons in `imgs/` with real artwork before publishing.
- Wire up GitHub Actions release workflow (clone `type-deck/.github/workflows/release.yml` with the `googleapis`+`google-auth-library`+`gaxios`+`gtoken` set instead of `@nut-tree-fork/libnut`).
- Document the `streamdeck pack` smoke check once icons exist.
