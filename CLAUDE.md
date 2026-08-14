# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Stream Deck plugin (`com.ewels.deckcal`, "DeckCal") that turns a key into a live Google Calendar countdown. Four actions, all driven by the same `BaseCountdownAction` and the same shared runtime:

- `com.ewels.deckcal.countdown` — "Meeting countdown": ongoing if you're in one, otherwise next upcoming.
- `com.ewels.deckcal.upcoming` — "Upcoming meeting": next upcoming only; ignores ongoing.
- `com.ewels.deckcal.ongoing` — "Ongoing meeting": current meeting only; idle otherwise.
- `com.ewels.deckcal.alert` — "Meeting alert": blank tile that lights up only during the meeting-start flash.

The visible keys auto-update every second from a 60-second Google Calendar poll, with progress bars, a yellow imminent-fill in the last 5 minutes, a full-tile 50%-opacity green fill while a meeting is ongoing (both sweeping across adjacent keys as one band when they resolve to the same meeting), a yellow flash on meeting start (auto-dismissed after `autoAckAfterMinutes`, default 5), and a footer band for OOO / focus overlaps.

## Commands

```sh
npm run build         # one-off rollup build → com.ewels.deckcal.sdPlugin/bin/plugin.js
npm run watch         # rebuild on save; restarts the plugin in Stream Deck via @elgato/cli
npm test              # vitest run — the unit suite
npm run test:watch    # vitest in watch mode
```

Those four are the only npm scripts. Linting, formatting and type-checking all
run through prek, which is the single entry point CI uses too:

```sh
prek run --all-files                  # everything below, plus the whitespace hooks
prek run biome-check --all-files      # lint + format JS/TS
prek run prettier --all-files         # json / yaml / markdown / html / css
prek run tsc --all-files              # tsc --noEmit
```

biome and prettier are **not** devDependencies: prek installs its own pinned
copies (2.4.15 and 3.4.2) in isolated environments. Their config files
(`biome.json`, `.prettierrc.json`, `.prettierignore`) stay in the repo because
prek's copies read them from the working tree.

typescript is different and **must** stay a devDependency: it is a required
peer of `@rollup/plugin-typescript`, so `npm run build` breaks without it. Its
prek hook is therefore `language = "system"` and runs `npx tsc --noEmit`
against the project's own `node_modules` — an isolated env holding only
typescript could not resolve `@types/node` or the `.d.ts` files shipped by
`@elgato/streamdeck`, `@googleapis/calendar` and `google-auth-library`. Run `npm ci`
before `prek run --all-files` on a clean checkout.

A code change does not appear in Stream Deck until the plugin process is restarted (`npm run watch` handles this automatically, or run `streamdeck restart com.ewels.deckcal`). Property-inspector HTML / JS edits are picked up by reopening the action's settings panel.

## Logging and debugging

`src/util/log.ts` is a `streamDeck.logger` scope, so the SDK decides where
entries go and at what level. It writes to a rotating file under the plugin
dir (gitignored, 10 files, 50 MB each):

```sh
tail -f com.ewels.deckcal.sdPlugin/logs/com.ewels.deckcal.0.log
```

The SDK picks its level from `isDebugMode()`, which is true only when the
process was launched with `--inspect` / `--inspect-brk` / `--inspect-port`:

|                  | level   | minimumLevel | console output |
| ---------------- | ------- | ------------ | -------------- |
| normal (shipped) | `info`  | `debug`      | file only      |
| `--inspect`      | `debug` | `trace`      | file + console |

Stream Deck adds `--inspect` when the manifest's `Nodejs` block contains
`"Debug": "enabled"`. That is **deliberately absent** — it opens an inspect
port on end users' machines. To get verbose console output back while
developing, add it temporarily and `streamdeck restart com.ewels.deckcal`,
but do not commit it.

Because the default level is `info`, a `log.debug(...)` call is invisible in
any build a user runs. Two rules follow:

- Anything worth diagnosing a support issue with has to be `info` or above.
- Nothing on the 1Hz ticker or the 60s poll may log unconditionally at `info`.
  A once-per-minute line is ~1440 entries per account per day; a log file that
  size is unreadable. `pollAccount` logs only on the first poll, when the event
  count changes, or on recovery from an error state. Follow that pattern for
  anything else that fires on a timer.

## Tests

Vitest, colocated as `src/**/*.test.ts`, run by `npm test` and by the `vitest`
job in `.github/workflows/lint.yml`. Tests are **not** a prek hook: they would
slow every commit, and CI runs them as a separate job anyway.

Coverage is deliberately scoped to the four modules that hold real logic and
import nothing from `@elgato/streamdeck`, so they need no SDK harness:

| Module                     | What is covered                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.ts`              | `toNumber` / `optionalNumber` three-state parsing, `migrateSettings` legacy lifts, `retainAccounts`, provider + next-meeting resolution |
| `calendar/selection.ts`    | filter pipeline, horizon, ongoing-vs-imminent priority, gap anchoring, overlap counting, OOO / focus modes, the three selection modes   |
| `calendar/conferencing.ts` | Meet / Zoom / Teams detection and precedence, attachment pick                                                                           |
| `render/icon.ts`           | time formatting, every render state, fill geometry, the multi-key sweep, alert variant                                                  |

`runtime.ts`, `store.ts`, `launch.ts`, `client.ts` and `auth.ts` all import
`streamDeck` (directly or via `util/log`), which reads `process.execArgv` and
opens a websocket on import. Testing those means a fake SDK; not done yet.

Two conventions worth keeping:

- **Inject `now`, never fake the clock.** `select()` takes `options.now` and
  `formatUpcomingLabel()` takes a trailing `now`, so tests pass the fixed
  `NOW` from `src/test-utils.ts` instead of installing fake timers.
- **Assert on rendered SVG, not on private helpers.** `buildSvgTile` returns a
  base64 data URL; `decodeTile()` + `rectWidth()` in `src/test-utils.ts` pull
  out real rect geometry. That keeps `blockSlice`, `imminentFill` and
  `sliceRect` private while still pinning the band maths.

`src/test-utils.ts` lives under `src/` so `tsc` and biome cover it, but nothing
in the plugin's import graph (rooted at `src/plugin.ts`) reaches it, so rollup
never bundles it.

Note that prek only passes **git-tracked** files to its hooks: a brand-new test
file is invisible to biome and prettier until it is staged. `npm test` and
`npm run build` see it either way.

## Git hooks: prek, not pre-commit

Hooks live in `prek.toml` (TOML) and are run by [prek](https://github.com/j178/prek), a Rust-based replacement for `pre-commit`. **Do not invoke `pre-commit` or write `.pre-commit-config.yaml`.** TOML config requires `prek >= 0.4.0`.

```sh
prek install              # install git hook
prek run --all-files      # run hooks across the repo
```

## Release process

Version lives in `com.ewels.deckcal.sdPlugin/manifest.json` as a four-part `X.Y.Z.0` string (Elgato's format — the trailing `.0` stays zero). `package.json` is `private: true` with no `version` field, so the manifest is the only place to bump.

`CHANGELOG.md` tracks the same version without the trailing `.0`. The top
heading carries an `(unreleased)` marker while work accumulates; releasing
swaps that for the date. Both move in the same commit as the manifest bump, so
the tree never claims a version the changelog has not described.

```sh
# 1. Bump manifest "Version" to "X.Y.Z.0", swap the CHANGELOG's
#    "(unreleased)" for today's date, then push, on a clean tree.
git commit -m "Bump version to X.Y.Z" com.ewels.deckcal.sdPlugin/manifest.json CHANGELOG.md
git push origin main
# 2. Create the release, reusing the changelog entry as the notes.
gh release create vX.Y.Z --title "vX.Y.Z — <headline>" --notes "..."
```

After releasing, open a fresh `## vX.Y.Z+1 (unreleased)` heading at the top of
the changelog as changes land, rather than reconstructing it at release time.

Packaging runs on GitHub Actions (`.github/workflows/release.yml`) on `release: published`. The workflow runs `npm ci`, then `npm run build` with `DECKCAL_GOOGLE_CLIENT_ID` / `DECKCAL_GOOGLE_CLIENT_SECRET` from repo secrets, stages a tiny `package.json` inside `com.ewels.deckcal.sdPlugin/` so `@googleapis/calendar` + `google-auth-library` (and their transitive `googleapis-common` + `gaxios` + `gtoken`) are installed alongside `bin/plugin.js`, runs `streamdeck pack`, and `gh release upload`s the resulting `com.ewels.deckcal.streamDeckPlugin` to the release.

### Local pack smoke check

To verify the packed output before tagging a release — same steps the workflow does, minus the upload:

```sh
npm run build                          # produces com.ewels.deckcal.sdPlugin/bin/plugin.js

# Mirror of the workflow step: copy the external deps' ranges out of the root
# package.json so the smoke check installs exactly what a release would.
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const externals = ["@googleapis/calendar", "google-auth-library"];
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  const dependencies = Object.fromEntries(
    externals.map((name) => [name, root.dependencies[name]]),
  );
  writeFileSync(
    "com.ewels.deckcal.sdPlugin/package.json",
    `${JSON.stringify({ type: "module", private: true, dependencies }, null, 2)}\n`,
  );
'
(cd com.ewels.deckcal.sdPlugin && npm install --omit=dev --no-package-lock --no-fund --no-audit)

npx streamdeck pack com.ewels.deckcal.sdPlugin --force
unzip -l com.ewels.deckcal.streamDeckPlugin | head -30
```

Clean up before going back to `npm run watch` — the staged `package.json` + installed `node_modules/` inside the sdPlugin dir confuse the dev loop:

```sh
rm -rf com.ewels.deckcal.sdPlugin/node_modules com.ewels.deckcal.sdPlugin/package.json com.ewels.deckcal.streamDeckPlugin
npm run build   # rollup re-emits the {"type":"module"} package.json

# `streamdeck pack` rewrites manifest.json in its own formatting (expanded
# arrays, no trailing newline). Either of these restores it: the prettier and
# end-of-file-fixer hooks reformat it back byte-for-byte, so the churn is
# self-healing and manifest.json must NOT be added to .prettierignore.
git checkout -- com.ewels.deckcal.sdPlugin/manifest.json   # or: prek run --all-files
```

## Website

`docs/` is a GitHub Pages site served straight off `main` (Settings → Pages →
"Deploy from a branch", branch `main`, folder `/docs`), at
<https://ewels.github.io/DeckCal/>. It exists because Google's OAuth branding
review requires the app name on the consent screen to match the app name on
the homepage the OAuth client points at, and a page inside phil.ewels.co.uk
reads as that site's name rather than DeckCal's.

Two pages: `docs/index.html` and `docs/privacy/index.html`. These are now the
canonical ones: the OAuth client's homepage and privacy policy URLs point at
<https://ewels.github.io/DeckCal/> and
<https://ewels.github.io/DeckCal/privacy/>, and `manifest.json`'s `URL` and
`README.md` both link the homepage. The old copy of the privacy text under
phil.ewels.co.uk has been removed, so `docs/privacy/index.html` is the only
version.

Note for the Google side: an OAuth client's URLs must sit under an authorised
domain, so `ewels.github.io` has to be added to the consent screen's authorised
domain list, which in turn needs the site verified in Google Search Console.
`github.io` is on the public suffix list, so `ewels.github.io` verifies as its
own site.

Deliberately hand-written HTML + CSS with **no build step and no JavaScript**,
so a `git push` publishes it. It borrows the layout idea of phil.ewels.co.uk
(Mona Sans, a photo backdrop behind a translucent content card) but not that
site's own assets: the backdrop is `docs/assets/background.jpg`, a sunlit
forest photo by Gustav Gullstrand (@outoforbit) from Unsplash, credited in the
footer of both pages. Dark mode is `prefers-color-scheme` only, driven by CSS custom
properties in `docs/assets/style.css`.

`docs/logo-*.svg` and `docs/examples/` are shared with `README.md`, which links
them by relative path, so do not move or rename them. `.nojekyll` keeps GitHub
Pages from running the files through Jekyll.

The prettier prek hook formats the site's `.html` and `.css` (80 column default
config), and, as everywhere else in this repo, prettier only sees git-tracked
files. biome 2.x formats CSS too and disagrees with prettier about it, so
`biome.json` excludes `**/*.css`; without that the two hooks reformat
`style.css` back and forth on every commit. The split stays as it always was:
biome owns JS/TS, prettier owns everything else.

`check-added-large-files` is raised to `--maxkb=1000` in `prek.toml` for
`sweep.mp4`.

## Architecture

```
src/
  plugin.ts             bootstrap: registers the 4 actions + connect()
  settings.ts           CountdownSettings, GlobalSettings, DEFAULTS, resolveProvider/resolveNextMeeting
  actions/
    countdown.ts        BaseCountdownAction + 4 subclasses (CountdownAction,
                        UpcomingAction, OngoingAction, AlertAction) — shared
                        key lifecycle, state-driven press dispatch, PI bridge.
                        Subclasses differ only in `selectionMode` (combined /
                        upcoming / ongoing) and `renderVariant` (alert).
  calendar/
    auth.ts             OAuth 2.0 PKCE loopback flow, token persistence in global settings
    client.ts           @googleapis/calendar wrapper: listCalendars, listEvents, normalize → CalendarEvent
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
  test-utils.ts         test-only fixtures (ev(), NOW) + SVG assertion helpers
  **/*.test.ts          vitest suites, colocated with the module they cover
com.ewels.deckcal.sdPlugin/
  manifest.json         plugin manifest (Elgato schema)
  ui/countdown.html     property inspector (sdpi-components v4 over CDN)
  ui/countdown.js       PI bridge: sign-in, calendar checkbox list, conditional show/hide
  bin/plugin.js         rollup output, gitignored
  imgs/                 action + plugin icons (svg sources + rsvg-rendered pngs)
docs/                   GitHub Pages site (see "Website" below) + README assets
  index.html            homepage
  privacy/index.html    privacy policy (the URL Google's OAuth config points at)
  assets/               style.css, Mona-Sans.woff2, background.jpg
  actions/              144x144 tile renderings of the four action icons
  examples/             key-state screenshots + sweep.mp4, also used by README.md
  logo-*.svg            wordmark, light and dark, also used by README.md
vitest.config.ts        test config: include src/**/*.test.ts, node environment
rollup.config.mjs       bundles src/ to bin/plugin.js
                        @googleapis/calendar + google-auth-library + googleapis-common
                        + gaxios + gtoken are external
                        — resolved from node_modules at runtime
```

Stream Deck spawns `node bin/plugin.js`; the SDK translates websocket events into per-action handlers via `SingletonAction`. The runtime module owns shared state: one OAuth2Client per Google account, one cached event list per account, one ticker that re-renders all visible keys at 1Hz, one poller that refreshes Calendar data at 60s with exponential backoff (60s → 120 → 240 → 480 → 600).

### Settings shape (per-key)

Flat keys (sdpi-components binds via flat `setting="X"` paths). `resolveProvider()` and `resolveNextMeeting()` in `src/settings.ts` reassemble structured handlers from the flat fields. Number fields stored by sdpi-textfield arrive as strings, so always re-parse via `toNumber(value, fallback)`.

`account` is a structured `{ sub, email }` set by the plugin after OAuth completes; the PI displays the email but does not edit this field directly. OAuth tokens themselves live in global settings under `accounts[sub]`, so they survive button reassignment and aren't duplicated per key.

### Key press lifecycle

`BaseCountdownAction.onKeyDown` records a timestamp and starts a `setTimeout(longPressThresholdMs)` (default 600 ms). If `onKeyUp` arrives first, clear the timer and dispatch the short-press branch. If the timer fires first, dispatch long press. This is the same pattern as `type-deck/src/actions/base.ts:242-281`.

Any keyDown also calls `acknowledgeForKey(actionId)`, which pushes the currently-ongoing event's ID into `global.acknowledgedEventIds`. The ticker uses that set to decide whether to flash an ongoing event — the user has seen the alert, no more flashing.

Press dispatch is state-driven and shared by all four actions. `getPressContextForKey(actionId)` reads the cached selection for that key and reports one of `no-accounts`, `flashing`, `ongoing`, `upcoming`, or `idle`. The base class fans those into:

Short press:

- **no-accounts** → run the OAuth flow.
- **flashing** / **ongoing** → `detectConference()` → look up the per-provider handler via `resolveProvider()` → `openInApp(app, url)` or `openUrl(url)`. If no conference detected, fall back to `event.htmlLink`.
- **upcoming** → `resolveNextMeeting()` → URL or app launcher.
- **idle** → no-op.

Long press:

- **flashing** / **ongoing** / **upcoming** → first `event.attachments[].fileUrl` if any, else `event.htmlLink`.
- everything else → no-op.

`AlertAction` overrides this with a much narrower rule: short press only triggers OAuth (when not signed in); long press only joins the meeting during the start-of-meeting flash. Everything else is silent so the alert tile stays out of the way of the user's other DeckCal keys.

### Selection rules

`select(events, settings)` runs the filter pipeline:

1. Basic filters: drop cancelled, drop all-day if `ignoreAllDay`, drop declined / tentative depending on flags, drop transparency `transparent`.
2. Special-event modes: events of type `outOfOffice` or `focusTime` are run through `outOfOfficeMode` / `focusMode`. Mode `ignore` drops them. Mode `footerBand` drops them from the selection pool but lets ongoing ones contribute to the footer band color (purple for focus, grey for OOO; focus wins if both ongoing). Mode `regular` keeps them in the pool.
3. Pick: ongoing events first (most recently started wins on ties), then the next upcoming.
4. `extraCount` = total qualifying events in the pool minus 1.

### Render states

`buildSvgTile({ state, flashOn, variant })` outputs a `data:image/svg+xml;base64,…` URL (or, for the static error states, a path to a pre-rendered SVG asset under `imgs/states/`). States:

- `idle` — calendar glyph (today's date) + optional footer band.
- `upcoming` — blue top progress bar (gap elapsed / gap total), yellow imminent fill in the last N minutes (single rectangle spanning the imminent window), center countdown, +N footer, band. The runtime can pass a `block: { columns, indexInBlock }` so that when adjacent keys resolve to the same upcoming meeting with the same imminent window, the yellow fill is computed as one band stretching across all of them and each key paints just its slice.
- `ongoing` — full-tile 50%-opacity green fill that grows left→right with meeting elapsed / total, optional yellow flash overlay driven by `flashOn` parity, center countdown ("NOW" while flashing), +N footer, band. Like `upcoming`, the runtime can pass a `block: { columns, indexInBlock }` so that when adjacent keys resolve to the same ongoing meeting, the green fill is computed as one band stretching across all of them and each key paints just its slice. The flash overlay always covers the whole tile per key (every key in the band flashes together).
- `authRequired` / `noCalendars` — static SVG assets returned directly.

`variant: "alert"` (used by `AlertAction`) suppresses everything except the surfaces that justify the alert tile's existence: the upcoming imminent yellow slice, the ongoing green progress slice (both bare fills, no chrome or text, and both block-aware so the band sweeps across adjacent alert keys), and the ongoing meeting-start yellow flash. Every other state renders blank.

Text color:

- `upcoming` — white by default; the part of the text that overlaps the yellow imminent fill is rendered in dark via a clip-path split.
- `ongoing` — blue (`COLORS.topBar`) by default so the in-meeting tile reads visually distinct from upcoming; on top of the yellow flash overlay the time renders entirely in dark.

### Property inspector bridge

`countdown.js` uses `SDPIComponents.streamDeckClient`:

- `.send("sendToPlugin", payload)` — outbound, four kinds: `startAuth`, `signOut`, `listCalendars`, `getVariant`. `getVariant` lets the PI ask the plugin which action UUID this key is bound to, so the same `countdown.html` panel can hide irrelevant fields for the upcoming / ongoing / alert variants.
- `.sendToPropertyInspector.subscribe(cb)` — inbound, four kinds: `authResult`, `calendars`, `signedOut`, `variant`.
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
