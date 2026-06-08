// Property inspector bridge for the DeckCal countdown action.
//
// Uses SDPIComponents.streamDeckClient:
//   - .send('sendToPlugin', payload)  — outbound to plugin
//   - .sendToPropertyInspector.subscribe(cb) — inbound from plugin
//   - .getSettings() → ActionSettingsPayload  ({ settings, ... })
//   - .setSettings(settings)
//   - .didReceiveSettings.subscribe(cb)

(() => {
  function ready() {
    if (
      typeof SDPIComponents === "undefined" ||
      !SDPIComponents.streamDeckClient
    ) {
      window.setTimeout(ready, 50);
      return;
    }
    const client = SDPIComponents.streamDeckClient;

    const els = {
      signInBtn: document.getElementById("signInBtn"),
      accountList: document.getElementById("accountList"),
      authError: document.getElementById("authError"),
      calendarList: document.getElementById("calendarList"),
      loggedInOnly: document.getElementById("loggedInOnly"),
      variantBanner: document.getElementById("variantBanner"),
    };

    // Per-account auth state (sub -> true when the token has expired/been
    // revoked), learned from the plugin's `calendars` message. Drives whether
    // a "Reconnect" button is shown for each account.
    const authBySub = {};

    const VARIANT_BANNERS = {
      combined:
        "Shows your current meeting if you're in one, otherwise the next one. (Sign in once, you can use the same accounts in any other DeckCal action.)",
      upcoming:
        "Shows your next upcoming meeting. Ignores any meeting that is already happening.",
      ongoing:
        "Shows the meeting you are currently in. Idle when nothing is happening.",
      alert:
        "Blank tile that only lights up the moment a meeting starts. Short press dismisses, long press joins.",
    };

    function applyVariantVisibility(variant, showBanner) {
      const banner = els.variantBanner;
      const copy = VARIANT_BANNERS[variant];
      if (banner && copy) {
        banner.textContent = copy;
        banner.classList.toggle("hidden", !showBanner);
      }
      for (const el of document.querySelectorAll("[data-show-variant]")) {
        const spec = el.getAttribute("data-show-variant") || "";
        const list = spec.split(",").map((s) => s.trim());
        el.classList.toggle("hidden", !list.includes(variant));
      }
    }

    function showAuthError(text) {
      els.authError.textContent = text;
      els.authError.classList.toggle("hidden", !text);
    }

    function renderAccounts(accounts) {
      const list = els.accountList;
      list.innerHTML = "";
      const arr = accounts || [];
      // Show the Calendars section + "Add another account" wording only once
      // we have at least one signed-in account.
      els.loggedInOnly.classList.toggle("hidden", arr.length === 0);
      els.signInBtn.textContent =
        arr.length === 0 ? "Sign in with Google" : "Add another account";
      for (const acct of arr) {
        const row = document.createElement("div");
        row.className = "acct-row";
        const email = document.createElement("span");
        email.className = "email";
        email.textContent = acct.email;
        row.appendChild(email);
        // Reconnect re-runs the OAuth flow for this account. Signing in with
        // the same Google account refreshes its tokens in place (the plugin
        // dedupes by `sub`). Only shown when this account's session has
        // expired — a healthy account needs no reconnect.
        if (authBySub[acct.sub]) {
          email.textContent = `${acct.email} (session expired)`;
          const reconnectBtn = document.createElement("button");
          reconnectBtn.type = "button";
          reconnectBtn.className = "btn btn-primary";
          reconnectBtn.textContent = "Reconnect";
          reconnectBtn.addEventListener("click", () => {
            showAuthError("Opening browser...");
            void client.send("sendToPlugin", { kind: "startAuth" });
          });
          row.appendChild(reconnectBtn);
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.textContent = "Sign out";
        btn.addEventListener("click", () => {
          void client.send("sendToPlugin", {
            kind: "signOut",
            sub: acct.sub,
          });
        });
        row.appendChild(btn);
        list.appendChild(row);
      }
    }

    function renderCalendars(byAccount, selections) {
      const list = els.calendarList;
      list.innerHTML = "";
      const entries = Object.entries(byAccount || {});
      if (entries.length === 0) {
        const empty = document.createElement("small");
        empty.className = "help";
        empty.textContent = "No calendars yet — sign in to load them.";
        list.appendChild(empty);
        return;
      }
      // selKey + selectedSet operates on (sub, calId) tuples.
      const selKey = (sub, cid) => `${sub}::${cid}`;
      const selected = new Set(
        (selections || []).map((s) => selKey(s.accountSub, s.calendarId)),
      );
      // On first render with no saved selection, tick each account's primary
      // and persist that choice so the PI state matches what the poller does.
      let didAutoTick = false;
      if (selected.size === 0) {
        for (const [sub, info] of entries) {
          const primary = (info.items || []).find((c) => c.primary);
          if (primary) {
            selected.add(selKey(sub, primary.id));
            didAutoTick = true;
          }
        }
        if (didAutoTick) {
          void readSettings().then((settings) => {
            const already = settings.calendarSelections || [];
            if (already.length === 0) {
              const toSave = [];
              for (const [sub, info] of entries) {
                const p = (info.items || []).find((c) => c.primary);
                if (p) toSave.push({ accountSub: sub, calendarId: p.id });
              }
              client.setSettings(
                Object.assign({}, settings, { calendarSelections: toSave }),
              );
            }
          });
        }
      }
      for (const [sub, info] of entries) {
        const header = document.createElement("div");
        header.className = "acct-header";
        header.textContent = info.email;
        list.appendChild(header);

        // Primary first, then alphabetical within the account.
        const sorted = (info.items || []).slice().sort((a, b) => {
          if (a.primary && !b.primary) return -1;
          if (b.primary && !a.primary) return 1;
          return (a.summary || "").localeCompare(b.summary || "", undefined, {
            sensitivity: "base",
          });
        });
        for (const cal of sorted) {
          const row = document.createElement("label");
          row.className = "cal";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = selected.has(selKey(sub, cal.id));
          cb.addEventListener("change", () => {
            void toggleCalendar(sub, cal.id, cb.checked);
          });
          const label = document.createElement("span");
          label.textContent = cal.summary + (cal.primary ? " (primary)" : "");
          if (cal.primary) label.style.fontWeight = "600";
          row.appendChild(cb);
          row.appendChild(label);
          list.appendChild(row);
        }
      }
    }

    async function readSettings() {
      const payload = await client.getSettings();
      return payload?.settings || {};
    }

    async function toggleCalendar(accountSub, calendarId, checked) {
      const settings = await readSettings();
      const current = settings.calendarSelections || [];
      const filtered = current.filter(
        (s) => !(s.accountSub === accountSub && s.calendarId === calendarId),
      );
      const next = checked
        ? filtered.concat([{ accountSub, calendarId }])
        : filtered;
      client.setSettings(
        Object.assign({}, settings, { calendarSelections: next }),
      );
    }

    // data-show-when="settingKey=value" — element is shown iff the current
    // setting equals the value. The value "url" is also treated as the default
    // for undefined (so URL fields show on a brand-new key).
    function applyConditionals(settings) {
      const conds = document.querySelectorAll("[data-show-when]");
      for (const el of conds) {
        const spec = el.getAttribute("data-show-when");
        if (!spec) continue;
        const eq = spec.indexOf("=");
        const key = eq < 0 ? spec : spec.slice(0, eq);
        const expected = eq < 0 ? null : spec.slice(eq + 1);
        const actual = settings[key];
        let visible;
        if (expected === "url") {
          visible = actual === undefined || actual === "url";
        } else {
          visible = actual === expected;
        }
        el.classList.toggle("hidden", !visible);
      }
    }

    // Snapshot the current value of every `sdpi-*` form element with a
    // `setting` attribute. The SDK doesn't echo PI-initiated setting changes
    // back as `didReceiveSettings`, so reading straight from the DOM is the
    // only way to get the truly-current state when the user is mid-change.
    function snapshotDomSettings() {
      const out = {};
      for (const el of document.querySelectorAll("[setting]")) {
        const key = el.getAttribute("setting");
        if (key) out[key] = el.value;
      }
      return out;
    }

    // Wire `valuechange` on every dropdown that drives a show-when condition.
    // Without this, switching "Open URL" → "Open app" updates the setting but
    // never re-runs the visibility logic, so the App field stays hidden.
    function bindConditionalDrivers() {
      const drivers = new Set();
      for (const el of document.querySelectorAll("[data-show-when]")) {
        const spec = el.getAttribute("data-show-when") || "";
        const key = spec.split("=")[0];
        if (key) drivers.add(key);
      }
      for (const key of drivers) {
        const driver = document.querySelector(`[setting="${key}"]`);
        if (!driver) continue;
        driver.addEventListener("valuechange", () => {
          applyConditionals(snapshotDomSettings());
        });
      }
    }

    // Inbound from plugin.
    client.sendToPropertyInspector.subscribe((ev) => {
      const msg = ev?.payload || ev;
      if (!msg || typeof msg !== "object" || !("kind" in msg)) return;
      if (msg.kind === "authResult") {
        if (msg.ok) {
          showAuthError("");
          // The plugin has written `accounts` into settings; the
          // didReceiveSettings stream below will repaint the accounts list.
        } else {
          showAuthError(msg.error || "Sign-in failed.");
        }
        return;
      }
      if (msg.kind === "calendars") {
        // Record per-account auth state, then repaint the accounts list so
        // expired sessions surface a Reconnect button.
        for (const key of Object.keys(authBySub)) delete authBySub[key];
        for (const [sub, info] of Object.entries(msg.byAccount || {})) {
          authBySub[sub] = Boolean(info.authRequired);
        }
        void readSettings().then((settings) => {
          renderAccounts(settings.accounts);
          renderCalendars(msg.byAccount, settings.calendarSelections);
        });
        return;
      }
      if (msg.kind === "signedOut") {
        // Plugin removes the account from settings; didReceiveSettings stream
        // repaints the accounts list. Calendars message comes separately.
        return;
      }
      if (msg.kind === "variant") {
        if (
          msg.variant === "combined" ||
          msg.variant === "upcoming" ||
          msg.variant === "ongoing" ||
          msg.variant === "alert"
        ) {
          applyVariantVisibility(msg.variant, true);
        }
        return;
      }
    });

    els.signInBtn.addEventListener("click", () => {
      showAuthError("Opening browser...");
      void client.send("sendToPlugin", { kind: "startAuth" });
    });

    // Settings the PI prefills on first open so their text fields show a
    // suggested value rather than being blank. The runtime still treats
    // empty/undefined as "feature disabled" — these are display defaults
    // only, and the user can clear them to opt out.
    const FORM_DEFAULTS = {
      ignoreAfterHours: "4",
      dimAfterHours: "1",
      dimOpacity: "30",
    };

    function applyFormDefaults(settings) {
      const next = { ...settings };
      let changed = false;
      for (const [key, value] of Object.entries(FORM_DEFAULTS)) {
        if (next[key] === undefined) {
          next[key] = value;
          changed = true;
        }
      }
      if (changed) client.setSettings(next);
      return next;
    }

    // Initial hydration.
    bindConditionalDrivers();
    // All sections visible (banner hidden) until the plugin's getVariant
    // reply lands and narrows the view to the current action variant.
    applyVariantVisibility("combined", false);
    void client.send("sendToPlugin", { kind: "getVariant" });
    void readSettings().then((raw) => {
      const settings = applyFormDefaults(raw);
      renderAccounts(settings.accounts);
      applyConditionals(settings);
      if ((settings.accounts || []).length > 0) {
        void client.send("sendToPlugin", { kind: "listCalendars" });
      }
    });

    // Re-apply conditionals + accounts list whenever settings change.
    if (
      client.didReceiveSettings &&
      typeof client.didReceiveSettings.subscribe === "function"
    ) {
      client.didReceiveSettings.subscribe((ev) => {
        const settings = ev?.payload?.settings || ev?.settings || {};
        applyConditionals(settings);
        renderAccounts(settings.accounts);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
