# Contribution guidelines

Contributions to fix or improve the plugin are welcome!
Please open a pull-request or issue.

## Building from source

To develop the plugin locally you'll need to clone the repository and build from source.

```sh
npm install
cp .env.local.example .env.local       # then paste your own OAuth values
npm run build                          # rollup substitutes env values at build time
```

You need your own Google OAuth Desktop client to build a working binary.
One-time setup (~5 min):

1. Go to <https://console.cloud.google.com/> and create or pick a project.
2. Enable the **Google Calendar API** under **APIs & Services → Library**.
3. Open **Google Auth Platform → Branding**. Configure as an _External_
   app, app name `DeckCal`, user support + developer contact email = yours.
4. Open **Google Auth Platform → Audience**. Add yourself as a **Test
   user**. Publishing status stays **Testing**.
5. Open **Google Auth Platform → Clients → Create client**. Type:
   **Desktop app**. After **Create**, copy both the **Client ID** and the
   **Client secret**.
6. Paste them into `.env.local` as `DECKCAL_GOOGLE_CLIENT_ID` and
   `DECKCAL_GOOGLE_CLIENT_SECRET`.

`.env.local` is gitignored. The repo never contains real credentials.
Release CI passes them as environment variables to the build step.

### Development commands

```sh
npm install
npm run build         # one-off rollup build → com.ewels.deckcal.sdPlugin/bin/plugin.js
npm run watch         # rebuild on save, restart the plugin in Stream Deck
npm test              # run the unit tests
npm run test:watch    # re-run tests on save
```

Tests are [Vitest](https://vitest.dev) suites living beside the code they
cover (`src/**/*.test.ts`), covering settings parsing, event selection,
conferencing detection and tile rendering.

Linting, formatting and type-checking all run through
[prek](https://github.com/j178/prek), which installs its own pinned copies of
biome and prettier:

```sh
prek install          # install the git hook (once)
prek run --all-files  # lint, format and type-check the whole repo
```

Run `npm ci` first on a clean checkout: the type-check hook uses the project's
own `node_modules`.

A code change does not appear in Stream Deck until the plugin process is
restarted (`npm run watch` does this automatically; otherwise run
`streamdeck restart com.ewels.deckcal`).

The plugin logs to a rotating file inside the plugin folder, which is the
first place to look when something misbehaves:

```sh
tail -f com.ewels.deckcal.sdPlugin/logs/com.ewels.deckcal.0.log
```
