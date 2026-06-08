import type { KeyAction } from "@elgato/streamdeck";
import type { OAuth2Client } from "google-auth-library";
import { getAuthorizedClient } from "../calendar/auth";
import {
  AuthRequiredError,
  type CalendarEvent,
  listEvents,
} from "../calendar/client";
import { type SelectionMode, select } from "../calendar/selection";
import {
  type BlockPlacement,
  buildSvgTile,
  type RenderState,
  type RenderVariant,
} from "../render/icon";
import {
  type CountdownSettings,
  DEFAULTS,
  optionalNumber,
  toNumber,
} from "../settings";
import { log } from "../util/log";
import {
  acknowledgeEvent,
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
  selectionMode: SelectionMode;
  renderVariant: RenderVariant;
  lastDataUrl?: string;
};

// Only these two render modes form bands; the literal also distinguishes the
// two band kinds in the grouping key so they never join.
type BandMode = "upcoming" | "ongoing";

type BlockSeed = {
  actionId: string;
  deviceId: string;
  row: number;
  column: number;
  eventId: string;
  // "upcoming" bands group by imminent window too (keys with different
  // imminent settings shouldn't merge); "ongoing" bands group on the event
  // alone.
  mode: BandMode;
  imminentMs: number;
};

export type PressState =
  | "no-accounts"
  | "idle"
  | "upcoming"
  | "flashing"
  | "ongoing";

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
      // Drop the cached client so the next poll rebuilds it from stored
      // settings on a fresh connection. A client whose token state has
      // wedged (e.g. after the machine sleeps for days) can't otherwise
      // recover without a full plugin restart. toRenderState treats a
      // missing account as auth-required, so the tiles still flag it.
      accounts.delete(state.sub);
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
  const states = await Promise.all(
    Array.from(subs, (sub) => ensureAccountClient(sub)),
  );
  await Promise.all(
    states.filter((s): s is AccountState => s !== null).map(pollAccount),
  );

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
): { state: RenderState; event?: CalendarEvent } {
  const keyAccounts = reg.settings.accounts ?? [];
  if (keyAccounts.length === 0) {
    return { state: { mode: "authRequired" } };
  }

  // Gather events across every account this key uses. If any account is
  // missing from the cache (not yet polled) or flagged auth-required,
  // surface the auth-required state — the user needs to take action.
  const allEvents: CalendarEvent[] = [];
  for (const a of keyAccounts) {
    const acct = accounts.get(a.sub);
    if (!acct || acct.authRequired) return { state: { mode: "authRequired" } };
    allEvents.push(...acct.events);
  }

  // Build the set of (accountSub, calendarId) pairs this key is watching.
  // Explicit empty array = user unticked everything → show the "pick one"
  // state. Undefined = fresh key; fall back to each connected account's
  // primary so they see something while the PI auto-ticks on first open.
  const sels = reg.settings.calendarSelections;
  if (Array.isArray(sels) && sels.length === 0) {
    return { state: { mode: "noCalendars" } };
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
  const result = select(filtered, reg.settings, { mode: reg.selectionMode });

  const imminentMs =
    toNumber(reg.settings.imminentFillMinutes, DEFAULTS.imminentFillMinutes) *
    60_000;

  if (result.mode === "idle") {
    return { state: { mode: "idle", footerBand: result.footerBand } };
  }
  if (result.mode === "upcoming") {
    const dimAfterHours = optionalNumber(reg.settings.dimAfterHours);
    const dim =
      dimAfterHours !== null &&
      result.event.startMs - Date.now() > dimAfterHours * 3600_000;
    const dimOpacityPct = toNumber(
      reg.settings.dimOpacity,
      DEFAULTS.dimOpacity,
    );
    return {
      state: {
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
      },
      event: result.event,
    };
  }
  const flashBehavior =
    reg.settings.meetingStartBehavior ?? DEFAULTS.meetingStartBehavior;
  const flashing =
    flashBehavior === "flash" && !acknowledged.has(result.event.id);
  return {
    state: {
      mode: "ongoing",
      remainingMs: Math.max(0, result.event.endMs - Date.now()),
      totalMs: result.totalMs,
      imminentMs,
      extraCount: result.extraCount,
      title: result.event.summary,
      footerBand: result.footerBand,
      flashing,
    },
    event: result.event,
  };
}

// 4-connected component analysis over BlockSeeds. Keys are grouped by
// (device, mode, event[, imminent window]) — only keys that already agree on
// what the bar is showing get joined into a band. Singletons get no entry in
// the result (default single-tile behaviour). DeckCal actions are Keypad-only
// per the manifest, so controller doesn't need to participate in grouping.
function computeBlocks(seeds: BlockSeed[]): Map<string, BlockPlacement> {
  const groups = new Map<
    string,
    { actionId: string; row: number; column: number }[]
  >();
  for (const s of seeds) {
    const groupKey =
      s.mode === "ongoing"
        ? `${s.deviceId}::ongoing::${s.eventId}`
        : `${s.deviceId}::upcoming::${s.eventId}::${s.imminentMs}`;
    const bucket = groups.get(groupKey) ?? [];
    bucket.push({ actionId: s.actionId, row: s.row, column: s.column });
    groups.set(groupKey, bucket);
  }

  const result = new Map<string, BlockPlacement>();
  const deltas: ReadonlyArray<readonly [number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const byPos = new Map<string, (typeof entries)[number]>();
    for (const e of entries) byPos.set(`${e.row},${e.column}`, e);
    const visited = new Set<string>();
    for (const start of entries) {
      const startKey = `${start.row},${start.column}`;
      if (visited.has(startKey)) continue;
      visited.add(startKey);
      const component: (typeof entries)[number][] = [];
      const queue: (typeof entries)[number][] = [start];
      while (queue.length > 0) {
        const node = queue.shift() as (typeof entries)[number];
        component.push(node);
        for (const [dr, dc] of deltas) {
          const nKey = `${node.row + dr},${node.column + dc}`;
          if (visited.has(nKey)) continue;
          const next = byPos.get(nKey);
          if (!next) continue;
          visited.add(nKey);
          queue.push(next);
        }
      }
      if (component.length < 2) continue;
      let minCol = Number.POSITIVE_INFINITY;
      let maxCol = Number.NEGATIVE_INFINITY;
      for (const c of component) {
        if (c.column < minCol) minCol = c.column;
        if (c.column > maxCol) maxCol = c.column;
      }
      const columns = maxCol - minCol + 1;
      for (const c of component) {
        result.set(c.actionId, {
          columns,
          indexInBlock: c.column - minCol,
        });
      }
    }
  }
  return result;
}

async function renderAllKeys(): Promise<void> {
  if (keys.size === 0) return;
  const global = await loadGlobalSettings();
  const acked = new Set(global.acknowledgedEventIds ?? []);
  const now = Date.now();

  await autoAckExpired(acked, now);

  // 1Hz pulse synced with the 1s ticker. Faster (500ms) parity would alias
  // because the ticker only samples once per second.
  const flashOn = Math.floor(now / 1000) % 2 === 0;

  // Two-pass render: compute every key's state, gather block seeds for any
  // key showing an in-window upcoming meeting or an ongoing meeting, then
  // resolve contiguous-block info before painting so adjacent keys showing
  // the same meeting can share one horizontal bar.
  const computed: { reg: KeyRegistration; state: RenderState }[] = [];
  const seeds: BlockSeed[] = [];
  for (const reg of keys.values()) {
    const { state, event } = toRenderState(reg, acked);
    computed.push({ reg, state });
    if (!event) continue;
    // Aliased discriminant checks (not a helper) so TS narrows `state` to the
    // band-bearing variants for the `state.imminentMs` read below.
    const inUpcomingBand =
      state.mode === "upcoming" && state.remainingMs <= state.imminentMs;
    const inOngoingBand = state.mode === "ongoing";
    if (!inUpcomingBand && !inOngoingBand) continue;
    // `action.coordinates` is undefined for sub-actions inside a multi-action
    // button — those have no grid slot, so they can't be part of a block.
    const coords = reg.action.coordinates;
    if (!coords) continue;
    seeds.push({
      actionId: reg.action.id,
      deviceId: reg.action.device.id,
      row: coords.row,
      column: coords.column,
      eventId: event.id,
      mode: inOngoingBand ? "ongoing" : "upcoming",
      imminentMs: state.imminentMs,
    });
  }

  const blocks = seeds.length > 1 ? computeBlocks(seeds) : null;

  for (const { reg, state } of computed) {
    const block = blocks?.get(reg.action.id);
    const finalState: RenderState =
      block && (state.mode === "upcoming" || state.mode === "ongoing")
        ? { ...state, block }
        : state;
    const dataUrl = buildSvgTile({
      state: finalState,
      flashOn,
      variant: reg.renderVariant,
    });
    if (dataUrl === reg.lastDataUrl) continue;
    reg.lastDataUrl = dataUrl;
    try {
      await reg.action.setImage(dataUrl);
    } catch (err) {
      log.error(`setImage failed: ${err}`);
    }
  }
}

async function autoAckExpired(acked: Set<string>, now: number): Promise<void> {
  const toAdd: string[] = [];
  for (const reg of keys.values()) {
    const cutoffMins = optionalNumber(
      reg.settings.autoAckAfterMinutes,
      DEFAULTS.autoAckAfterMinutes,
    );
    if (cutoffMins === null) continue;
    const sel = activeSelection(reg);
    if (!sel || sel.mode !== "ongoing") continue;
    if (acked.has(sel.event.id)) continue;
    if (now - sel.event.startMs < cutoffMins * 60_000) continue;
    toAdd.push(sel.event.id);
  }
  if (toAdd.length === 0) return;
  for (const id of toAdd) acked.add(id);
  await updateGlobalSettings((g) => {
    const set = new Set(g.acknowledgedEventIds ?? []);
    for (const id of toAdd) set.add(id);
    return { ...g, acknowledgedEventIds: Array.from(set) };
  });
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
  selectionMode: SelectionMode = "combined",
  renderVariant: RenderVariant = "normal",
): void {
  keys.set(action.id, { action, settings, selectionMode, renderVariant });
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
  const result = activeSelection(reg);
  if (!result || result.mode !== "ongoing") return;
  await acknowledgeEvent(result.event.id);
  reg.lastDataUrl = undefined;
  void renderAllKeys();
}

function activeSelection(
  reg: KeyRegistration,
): ReturnType<typeof select> | null {
  const filtered = filteredEventsForKey(reg.action.id);
  if (!filtered) return null;
  return select(filtered, reg.settings, { mode: reg.selectionMode });
}

export type PressContext = {
  state: PressState;
  selection: ReturnType<typeof select> | null;
};

// Press handlers call this once to get both the dispatch state and the
// selection. "flashing" = ongoing event the user hasn't dismissed yet.
export async function getPressContextForKey(
  actionId: string,
): Promise<PressContext> {
  const reg = keys.get(actionId);
  if (!reg) return { state: "idle", selection: null };
  if ((reg.settings.accounts ?? []).length === 0) {
    return { state: "no-accounts", selection: null };
  }
  const selection = activeSelection(reg);
  if (!selection || selection.mode === "idle") {
    return { state: "idle", selection };
  }
  if (selection.mode === "upcoming") return { state: "upcoming", selection };
  const global = await loadGlobalSettings();
  const acked = new Set(global.acknowledgedEventIds ?? []);
  const flashBehavior =
    reg.settings.meetingStartBehavior ?? DEFAULTS.meetingStartBehavior;
  const state: PressState =
    flashBehavior === "flash" && !acked.has(selection.event.id)
      ? "flashing"
      : "ongoing";
  return { state, selection };
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
    const cals = await listCalendars(state.client);
    state.authRequired = false;
    return cals;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      state.authRequired = true;
    }
    log.error(`listCalendars failed: ${err}`);
    return [];
  }
}

// Whether the most recent Calendar call for this account failed auth (token
// expired / revoked). Drives the PI's per-account "Reconnect" affordance.
export function accountNeedsAuth(sub: string): boolean {
  return accounts.get(sub)?.authRequired ?? false;
}
