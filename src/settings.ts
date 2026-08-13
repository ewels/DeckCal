// Per-key settings — stored flat because sdpi-components binds via flat
// `setting="X"` paths. Internal callers reassemble structured handlers from
// the flat fields where useful.

export type SpecialEventMode = "footerBand" | "ignore" | "regular";

export type ProviderHandler = { type: "url" } | { type: "app"; app: string };

export type NextMeetingAction =
  | { type: "url"; url: string }
  | { type: "app"; app: string; arg?: string };

export type Account = { sub: string; email: string };

export type CalendarSelection = {
  accountSub: string;
  calendarId: string;
};

export type CountdownSettings = {
  // Signed-in accounts the key pulls from. Set by the plugin after OAuth
  // completes; the PI displays the emails but does not edit these directly.
  accounts?: Account[];

  // Selected calendars, qualified by accountSub. Empty array = "user picked
  // nothing, show the 'pick a calendar' state". Undefined = brand-new key,
  // poller falls back to each account's primary.
  calendarSelections?: CalendarSelection[];

  // --- Legacy single-account fields, migrated to the arrays above ---
  /** @deprecated migrate to `accounts[]` via `migrateSettings()`. */
  account?: Account;
  /** @deprecated migrate to `calendarSelections[]` via `migrateSettings()`. */
  calendarIds?: string[];

  longPressThresholdMs?: number | string;
  imminentFillMinutes?: number | string;
  meetingStartBehavior?: "flash" | "none";
  // Auto-dismiss the start-of-meeting flash this many minutes after the
  // meeting starts, if the user hasn't pressed the key. Empty/undefined =
  // never auto-dismiss.
  autoAckAfterMinutes?: number | string;

  // Action when the displayed event is upcoming (no ongoing meeting).
  nextMeetingActionType?: "url" | "app";
  nextMeetingUrl?: string;
  nextMeetingApp?: string;

  // Per-provider handlers (when an ongoing meeting has a Meet/Zoom/Teams link).
  providerMeetType?: "url" | "app";
  providerMeetApp?: string;
  providerZoomType?: "url" | "app";
  providerZoomApp?: string;
  providerTeamsType?: "url" | "app";
  providerTeamsApp?: string;

  includeTentative?: boolean;
  includeDeclined?: boolean;
  includeAllDay?: boolean;
  // Upcoming events whose start is more than this many hours away are
  // dropped from the candidate list. Empty/undefined = never drop.
  ignoreAfterHours?: number | string;
  // Upcoming events whose start is more than this many hours away render
  // their text at the dim opacity. Empty = never dim. Default UI value: 2.
  dimAfterHours?: number | string;
  // Opacity used when dimming, expressed as a percentage (0-100).
  // Default UI value: 30.
  dimOpacity?: number | string;
  outOfOfficeMode?: SpecialEventMode;
  focusMode?: SpecialEventMode;

  /** @deprecated migrated to `includeAllDay` (inverted). */
  ignoreAllDay?: boolean;
};

// Tokens live at the plugin's global-settings level so they survive button
// reassignment and aren't duplicated per key.
export type StoredTokens = {
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
};

export type GlobalSettings = {
  accounts?: Record<string, { email: string; tokens: StoredTokens }>;
  acknowledgedEventIds?: string[];
};

export const DEFAULTS = {
  longPressThresholdMs: 600,
  imminentFillMinutes: 5,
  meetingStartBehavior: "flash" as const,
  autoAckAfterMinutes: 5,
  nextMeetingActionUrl: "https://calendar.google.com",
  includeTentative: true,
  includeDeclined: false,
  includeAllDay: false,
  ignoreAfterHours: 4,
  dimAfterHours: 1,
  dimOpacity: 30,
  outOfOfficeMode: "footerBand" as const,
  focusMode: "footerBand" as const,
} as const;

export function toNumber(
  value: number | string | undefined,
  fallback: number,
): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  if (typeof value === "string" && value.length > 0) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

// Parse a settings value that the user can explicitly disable by clearing
// the field. The three states:
//   - undefined → field has never been touched → fall back to
//     `defaultIfUndefined` (null when not provided)
//   - "" (empty string) → user explicitly cleared the field → null (disabled)
//   - valid non-negative number → that number
export function optionalNumber(
  value: number | string | undefined | null,
  defaultIfUndefined: number | null = null,
): number | null {
  if (value === undefined || value === null) return defaultIfUndefined;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

// One-shot migration from the legacy single-account shape. Run on every
// onWillAppear / onDidReceiveSettings; the action persists the migrated
// settings back so the legacy fields disappear after first run.
export function migrateSettings(s: CountdownSettings): {
  next: CountdownSettings;
  changed: boolean;
} {
  let changed = false;
  const next: CountdownSettings = { ...s };
  if (s.account && !s.accounts) {
    next.accounts = [s.account];
    next.account = undefined;
    changed = true;
  }
  if (s.calendarIds && !s.calendarSelections) {
    const firstSub = next.accounts?.[0]?.sub;
    if (firstSub) {
      next.calendarSelections = s.calendarIds.map((calendarId) => ({
        accountSub: firstSub,
        calendarId,
      }));
      next.calendarIds = undefined;
      changed = true;
    }
  }
  if (s.ignoreAllDay !== undefined && s.includeAllDay === undefined) {
    next.includeAllDay = !s.ignoreAllDay;
    next.ignoreAllDay = undefined;
    changed = true;
  }
  return { next, changed };
}

// Return a copy of `settings` with accounts (and the calendar selections that
// reference them) reduced to those whose sub satisfies `keep`. Shared by
// sign-out (drop one or all accounts) and the on-appear self-heal (drop
// accounts that no longer exist globally).
export function retainAccounts(
  settings: CountdownSettings,
  keep: (sub: string) => boolean,
): CountdownSettings {
  const sels = settings.calendarSelections;
  const kept = sels?.filter((s) => keep(s.accountSub));
  // An empty array is meaningful: it says "the user unticked every calendar",
  // which pins the key to the noCalendars state and suppresses the primary
  // fallback. Only the property inspector should ever produce that. Losing
  // every selection because its account went away is a different thing, so
  // reset to undefined (unconfigured) instead — otherwise the key stays blank
  // forever, even after the user signs back in.
  const nextSels =
    kept && kept.length === 0 && (sels?.length ?? 0) > 0 ? undefined : kept;
  return {
    ...settings,
    accounts: (settings.accounts ?? []).filter((a) => keep(a.sub)),
    calendarSelections: nextSels,
  };
}

export function resolveProvider(
  settings: CountdownSettings,
  provider: "meet" | "zoom" | "teams",
): ProviderHandler {
  if (provider === "meet") {
    if (settings.providerMeetType === "app" && settings.providerMeetApp) {
      return { type: "app", app: settings.providerMeetApp };
    }
    return { type: "url" };
  }
  if (provider === "zoom") {
    if (settings.providerZoomType === "app" && settings.providerZoomApp) {
      return { type: "app", app: settings.providerZoomApp };
    }
    return { type: "url" };
  }
  if (settings.providerTeamsType === "app" && settings.providerTeamsApp) {
    return { type: "app", app: settings.providerTeamsApp };
  }
  return { type: "url" };
}

export function resolveNextMeeting(
  settings: CountdownSettings,
): NextMeetingAction {
  if (settings.nextMeetingActionType === "app" && settings.nextMeetingApp) {
    return { type: "app", app: settings.nextMeetingApp };
  }
  return {
    type: "url",
    url: settings.nextMeetingUrl?.trim() || DEFAULTS.nextMeetingActionUrl,
  };
}
