import type { KeyAction } from "@elgato/streamdeck";
import type { OAuth2Client } from "google-auth-library";
import { getAuthorizedClient } from "../calendar/auth";
import {
  AuthRequiredError,
  type CalendarEvent,
  listEvents,
} from "../calendar/client";
import { select } from "../calendar/selection";
import { buildSvgTile, type RenderState } from "../render/icon";
import {
  type CountdownSettings,
  DEFAULTS,
  optionalNumber,
  toNumber,
} from "../settings";
import { log } from "../util/log";
import {
  loadGlobalSettings,
  pruneAcknowledged,
  updateGlobalSettings,
} from "./store";

// 24-hour look-ahead window keeps the events.list response small while still
// covering same-day countdowns and a comfortable buffer.
const POLL_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 1000;
const POLL_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000, 600_000];

type AccountState = {
  sub: string;
  email: string;
  client: OAuth2Client;
  events: CalendarEvent[];
  lastPoll: number;
  // 0 = healthy, >=1 = consecutive errors (drives backoff)
  failureCount: number;
  authRequired: boolean;
};

type KeyRegistration = {
  action: KeyAction<CountdownSettings>;
  settings: CountdownSettings;
  lastDataUrl?: string;
};

const keys = new Map<string, KeyRegistration>();
const accounts = new Map<string, AccountState>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

async function ensureAccountClient(sub: string): Promise<AccountState | null> {
  const existing = accounts.get(sub);
  if (existing) return existing;

  const global = await loadGlobalSettings();
  const acc = global.accounts?.[sub];
  if (!acc) return null;

  const client = getAuthorizedClient(sub, acc.tokens, (next) => {
    void updateGlobalSettings((g) => ({
      ...g,
      accounts: {
        ...(g.accounts ?? {}),
        [sub]: { email: acc.email, tokens: next },
      },
    }));
  });

  const state: AccountState = {
    sub,
    email: acc.email,
    client,
    events: [],
    lastPoll: 0,
    failureCount: 0,
    authRequired: false,
  };
  accounts.set(sub, state);
  return state;
}

function activeAccountSubs(): Set<string> {
  const subs = new Set<string>();
  for (const r of keys.values()) {
    for (const a of r.settings.accounts ?? []) subs.add(a.sub);
  }
  return subs;
}

function calendarIdsForAccount(sub: string): string[] {
  const set = new Set<string>();
  for (const r of keys.values()) {
    const usesAccount = (r.settings.accounts ?? []).some((a) => a.sub === sub);
    if (!usesAccount) continue;
    const sels = r.settings.calendarSelections;
    if (!sels || sels.length === 0) {
      // Fresh key with the account attached but no explicit selections yet:
      // poll the account's primary so the user sees something while the PI
      // ticks primary on first open.
      set.add("primary");
      continue;
    }
    for (const sel of sels) {
      if (sel.accountSub === sub) set.add(sel.calendarId);
    }
  }
  return Array.from(set);
}

async function pollAccount(state: AccountState): Promise<void> {
  const now = Date.now();
  const dueAfter =
    state.failureCount === 0
      ? POLL_INTERVAL_MS
      : POLL_BACKOFF_MS[
          Math.min(state.failureCount - 1, POLL_BACKOFF_MS.length - 1)
        ];
  if (state.lastPoll && now - state.lastPoll < dueAfter) return;

  const calendarIds = calendarIdsForAccount(state.sub);
  if (calendarIds.length === 0) return;

  try {
    const events = await listEvents(
      state.client,
      state.sub,
      calendarIds,
      POLL_WINDOW_MS,
      state.email,
    );
    state.events = events;
    state.lastPoll = now;
    state.failureCount = 0;
    state.authRequired = false;
    log.debug(`Polled ${state.email}: ${events.length} events`);
  } catch (err) {
    state.lastPoll = now;
    if (err instanceof AuthRequiredError) {
      state.authRequired = true;
      state.failureCount = 1;
      log.warn(`Auth required for ${state.email}`);
      return;
    }
    state.failureCount = Math.min(
      state.failureCount + 1,
      POLL_BACKOFF_MS.length,
    );
    log.error(
      `Poll failed for ${state.email} (attempt ${state.failureCount}): ${err}`,
    );
  }
}

async function runPoll(): Promise<void> {
  const subs = activeAccountSubs();
  for (const sub of subs) {
    const state = await ensureAccountClient(sub);
    if (!state) continue;
    await pollAccount(state);
  }

  // Prune acknowledged IDs that no longer correspond to live events.
  const live = new Set<string>();
  for (const a of accounts.values()) {
    for (const e of a.events) live.add(e.id);
  }
  if (live.size > 0) await pruneAcknowledged(live);
}

function toRenderState(
  reg: KeyRegistration,
  acknowledged: Set<string>,
): RenderState {
  const keyAccounts = reg.settings.accounts ?? [];
  if (keyAccounts.length === 0) {
    return { mode: "authRequired" };
  }

  // Gather events across every account this key uses. If any account is
  // missing from the cache (not yet polled) or flagged auth-required,
  // surface the auth-required state — the user needs to take action.
  const allEvents: CalendarEvent[] = [];
  for (const a of keyAccounts) {
    const acct = accounts.get(a.sub);
    if (!acct || acct.authRequired) return { mode: "authRequired" };
    allEvents.push(...acct.events);
  }

  // Build the set of (accountSub, calendarId) pairs this key is watching.
  // Explicit empty array = user unticked everything → show the "pick one"
  // state. Undefined = fresh key; fall back to each connected account's
  // primary so they see something while the PI auto-ticks on first open.
  const sels = reg.settings.calendarSelections;
  if (Array.isArray(sels) && sels.length === 0) {
    return { mode: "noCalendars" };
  }
  const selKey = (sub: string, cid: string) => `${sub}::${cid}`;
  const wanted = new Set<string>();
  if (sels && sels.length > 0) {
    for (const s of sels) wanted.add(selKey(s.accountSub, s.calendarId));
  } else {
    for (const a of keyAccounts) wanted.add(selKey(a.sub, "primary"));
  }
  const filtered = allEvents.filter((e) =>
    wanted.has(selKey(e.accountSub, e.calendarId)),
  );
  const result = select(filtered, reg.settings);

  const imminentMs =
    toNumber(reg.settings.imminentFillMinutes, DEFAULTS.imminentFillMinutes) *
    60_000;

  if (result.mode === "idle") {
    return { mode: "idle", footerBand: result.footerBand };
  }
  if (result.mode === "upcoming") {
    const dimAfterHours = optionalNumber(reg.settings.dimAfterHours);
    const dim =
      dimAfterHours !== null &&
      result.event.startMs - Date.now() > dimAfterHours * 3600_000;
    const dimOpacityPct = toNumber(reg.settings.dimOpacity, DEFAULTS.dimOpacity);
    return {
      mode: "upcoming",
      remainingMs: Math.max(0, result.event.startMs - Date.now()),
      eventStartMs: result.event.startMs,
      gapMs: result.gapMs,
      gapElapsedMs: result.gapElapsedMs,
      imminentMs,
      extraCount: result.extraCount,
      title: result.event.summary,
      footerBand: result.footerBand,
      dim,
      dimOpacity: dimOpacityPct / 100,
    };
  }
  const flashBehavior =
    reg.settings.meetingStartBehavior ?? DEFAULTS.meetingStartBehavior;
  const flashing =
    flashBehavior === "flash" && !acknowledged.has(result.event.id);
  return {
    mode: "ongoing",
    remainingMs: Math.max(0, result.event.endMs - Date.now()),
    totalMs: result.totalMs,
    imminentMs,
    extraCount: result.extraCount,
    title: result.event.summary,
    footerBand: result.footerBand,
    flashing,
  };
}

async function renderAllKeys(): Promise<void> {
  if (keys.size === 0) return;
  const global = await loadGlobalSettings();
  const acked = new Set(global.acknowledgedEventIds ?? []);
  const now = Date.now();
  // 1Hz pulse synced with the 1s ticker. Faster (500ms) parity would alias
  // because the ticker only samples once per second.
  const flashOn = Math.floor(now / 1000) % 2 === 0;

  for (const reg of keys.values()) {
    const state = toRenderState(reg, acked);
    const dataUrl = buildSvgTile({ state, flashOn });
    if (dataUrl === reg.lastDataUrl) continue;
    reg.lastDataUrl = dataUrl;
    try {
      await reg.action.setImage(dataUrl);
    } catch (err) {
      log.error(`setImage failed: ${err}`);
    }
  }
}

function startLoops(): void {
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      void runPoll();
    }, POLL_INTERVAL_MS);
    void runPoll(); // immediate first poll
  }
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      void renderAllKeys();
    }, TICK_INTERVAL_MS);
    void renderAllKeys();
  }
}

function stopLoops(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export function registerKey(
  action: KeyAction<CountdownSettings>,
  settings: CountdownSettings,
): void {
  keys.set(action.id, { action, settings });
  startLoops();
  void renderAllKeys();
}

export function unregisterKey(actionId: string): void {
  keys.delete(actionId);
  if (keys.size === 0) stopLoops();
}

export function updateKeySettings(
  actionId: string,
  settings: CountdownSettings,
): void {
  const reg = keys.get(actionId);
  if (!reg) return;
  reg.settings = settings;
  reg.lastDataUrl = undefined; // force re-render
  void runPoll();
  void renderAllKeys();
}

// Gather + filter events across all of a key's accounts. Mirrors the logic
// in toRenderState; returns null when the key isn't ready (no accounts,
// some account missing from cache, etc.).
function filteredEventsForKey(actionId: string): CalendarEvent[] | null {
  const reg = keys.get(actionId);
  if (!reg) return null;
  const keyAccounts = reg.settings.accounts ?? [];
  if (keyAccounts.length === 0) return null;

  const allEvents: CalendarEvent[] = [];
  for (const a of keyAccounts) {
    const acct = accounts.get(a.sub);
    if (!acct) return null;
    allEvents.push(...acct.events);
  }

  const sels = reg.settings.calendarSelections;
  if (Array.isArray(sels) && sels.length === 0) return [];
  const selKey = (sub: string, cid: string) => `${sub}::${cid}`;
  const wanted = new Set<string>();
  if (sels && sels.length > 0) {
    for (const s of sels) wanted.add(selKey(s.accountSub, s.calendarId));
  } else {
    for (const a of keyAccounts) wanted.add(selKey(a.sub, "primary"));
  }
  return allEvents.filter((e) =>
    wanted.has(selKey(e.accountSub, e.calendarId)),
  );
}

// Called from the action's onKeyDown to dismiss the start-of-meeting flash
// for whichever event is currently ongoing on that key.
export async function acknowledgeForKey(actionId: string): Promise<void> {
  const reg = keys.get(actionId);
  if (!reg) return;
  const filtered = filteredEventsForKey(actionId);
  if (!filtered) return;
  const result = select(filtered, reg.settings);
  if (result.mode !== "ongoing") return;
  await updateGlobalSettings((g) => {
    const acked = new Set(g.acknowledgedEventIds ?? []);
    acked.add(result.event.id);
    return { ...g, acknowledgedEventIds: Array.from(acked) };
  });
  reg.lastDataUrl = undefined;
  void renderAllKeys();
}

// Returns the SelectionResult for the given key (for the action's press
// handlers — they need to know "what event am I acting on?").
export function getActiveSelectionForKey(
  actionId: string,
): ReturnType<typeof select> | null {
  const reg = keys.get(actionId);
  if (!reg) return null;
  const filtered = filteredEventsForKey(actionId);
  if (!filtered) return null;
  return select(filtered, reg.settings);
}

// Called from the property inspector bridge when a new account signs in or
// when account/setting changes might require fresh data.
export function forceRefresh(): void {
  for (const a of accounts.values()) a.lastPoll = 0;
  void runPoll();
}

// Drop a cached client (called on sign-out so we re-read settings next time).
export function dropAccount(sub: string): void {
  accounts.delete(sub);
}

export async function listKnownCalendars(
  sub: string,
): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const state = await ensureAccountClient(sub);
  if (!state) return [];
  // Lazy import to avoid pulling Calendar list code into ticker hot path.
  const { listCalendars } = await import("../calendar/client");
  try {
    return await listCalendars(state.client);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      state.authRequired = true;
    }
    log.error(`listCalendars failed: ${err}`);
    return [];
  }
}
