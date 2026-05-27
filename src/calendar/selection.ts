import {
  type CountdownSettings,
  DEFAULTS,
  optionalNumber,
  type SpecialEventMode,
  toNumber,
} from "../settings";
import type { CalendarEvent } from "./client";

export type FooterBand =
  | { kind: "none" }
  | { kind: "ooo"; title: string }
  | { kind: "focus"; title: string };

export const FOOTER_BAND_NONE: FooterBand = { kind: "none" };

export type SelectionMode = "combined" | "upcoming" | "ongoing";

export type SelectionResult =
  | { mode: "idle"; footerBand: FooterBand }
  | {
      mode: "upcoming";
      event: CalendarEvent;
      gapMs: number;
      gapElapsedMs: number;
      extraCount: number;
      footerBand: FooterBand;
    }
  | {
      mode: "ongoing";
      event: CalendarEvent;
      totalMs: number;
      extraCount: number;
      footerBand: FooterBand;
    };

function specialMode(
  event: CalendarEvent,
  settings: CountdownSettings,
): SpecialEventMode | null {
  if (event.eventType === "outOfOffice") {
    return settings.outOfOfficeMode ?? DEFAULTS.outOfOfficeMode;
  }
  if (event.eventType === "focusTime") {
    return settings.focusMode ?? DEFAULTS.focusMode;
  }
  return null;
}

function passesBasicFilters(
  event: CalendarEvent,
  settings: CountdownSettings,
): boolean {
  if (event.status === "cancelled") return false;
  const includeAllDay = settings.includeAllDay ?? DEFAULTS.includeAllDay;
  if (!includeAllDay && event.isAllDay) return false;
  const includeDeclined = settings.includeDeclined ?? DEFAULTS.includeDeclined;
  if (!includeDeclined && event.attendeeSelfResponse === "declined") {
    return false;
  }
  const includeTentative =
    settings.includeTentative ?? DEFAULTS.includeTentative;
  if (!includeTentative && event.attendeeSelfResponse === "tentative") {
    return false;
  }
  if (event.transparency === "transparent") return false;
  return true;
}

export type SelectOptions = {
  now?: number;
  mode?: SelectionMode;
};

export function select(
  events: CalendarEvent[],
  settings: CountdownSettings,
  options: SelectOptions = {},
): SelectionResult {
  const { now = Date.now(), mode = "combined" } = options;
  // Optional "ignore far-future" cutoff. Empty / undefined = no cutoff. The
  // PI prefills the field with DEFAULTS.ignoreAfterHours on first open so
  // users see (and can override) the suggested 4-hour horizon.
  const ignoreAfterHours = optionalNumber(settings.ignoreAfterHours);
  const horizonMs =
    ignoreAfterHours !== null ? now + ignoreAfterHours * 3600_000 : null;

  const filtered = events.filter((e) => {
    if (!passesBasicFilters(e, settings)) return false;
    if (horizonMs !== null && e.startMs > horizonMs) return false;
    return true;
  });

  // Compute footer band from ongoing special events.
  let footerBand: FooterBand = FOOTER_BAND_NONE;
  for (const e of filtered) {
    if (!(e.startMs <= now && now < e.endMs)) continue;
    const sm = specialMode(e, settings);
    if (sm !== "footerBand") continue;
    if (e.eventType === "focusTime") {
      footerBand = {
        kind: "focus",
        title: e.summary?.trim() || "Focus time",
      };
      break; // focus wins
    }
    if (e.eventType === "outOfOffice") {
      footerBand = {
        kind: "ooo",
        title: e.summary?.trim() || "Out of office",
      };
    }
  }

  // Build the selection pool: drop events whose special mode is "ignore" or
  // "footerBand"; keep "regular" specials and all non-special events.
  const pool = filtered.filter((e) => {
    const sm = specialMode(e, settings);
    if (sm === null) return true;
    return sm === "regular";
  });

  const ongoing = pool.filter((e) => e.startMs <= now && now < e.endMs);
  const upcoming = pool
    .filter((e) => e.startMs > now)
    .sort((a, b) => a.startMs - b.startMs);

  // Spec: +N counts events that overlap with the chosen event's time range.
  // Two events overlap iff (a.start < b.end) && (a.end > b.start). For an
  // ongoing chosen event this catches double-bookings; for an upcoming chosen
  // event this catches events starting at the same slot.
  const overlapCount = (chosen: CalendarEvent): number =>
    pool.filter(
      (e) =>
        e.id !== chosen.id &&
        e.startMs < chosen.endMs &&
        e.endMs > chosen.startMs,
    ).length;

  // Spec: an upcoming meeting inside its imminent window (default 5 min)
  // takes priority over any currently-ongoing event — the "your next meeting
  // is about to start" alert is more actionable than "your current meeting
  // has 12 minutes left", so we surface it even mid-meeting.
  const imminentMs =
    toNumber(settings.imminentFillMinutes, DEFAULTS.imminentFillMinutes) *
    60_000;
  if (mode !== "ongoing") {
    const imminentUp = upcoming.find((e) => e.startMs - now <= imminentMs);
    if (imminentUp) {
      const prevEnd = filtered
        .filter((e) => e.endMs <= now)
        .reduce((max, e) => (e.endMs > max ? e.endMs : max), 0);
      const referenceMs = prevEnd > 0 ? prevEnd : now - 60 * 60_000;
      const gapMs = Math.max(60_000, imminentUp.startMs - referenceMs);
      const gapElapsedMs = Math.max(0, Math.min(gapMs, now - referenceMs));
      return {
        mode: "upcoming",
        event: imminentUp,
        gapMs,
        gapElapsedMs,
        extraCount: overlapCount(imminentUp),
        footerBand,
      };
    }
  }

  if (mode !== "upcoming" && ongoing.length > 0) {
    // Pick the most recently started.
    const chosen = ongoing.reduce((acc, e) =>
      e.startMs > acc.startMs ? e : acc,
    );
    return {
      mode: "ongoing",
      event: chosen,
      totalMs: chosen.endMs - chosen.startMs,
      extraCount: overlapCount(chosen),
      footerBand,
    };
  }

  if (mode !== "ongoing" && upcoming.length > 0) {
    const chosen = upcoming[0];
    // Anchor the gap to the most recent prior event end. If none in the
    // window, fall back to one hour before now so the top bar still has a
    // visible range to fill in instead of staying empty until the meeting.
    const prevEnd = filtered
      .filter((e) => e.endMs <= now)
      .reduce((max, e) => (e.endMs > max ? e.endMs : max), 0);
    const referenceMs = prevEnd > 0 ? prevEnd : now - 60 * 60_000;
    const gapMs = Math.max(60_000, chosen.startMs - referenceMs);
    const gapElapsedMs = Math.max(0, Math.min(gapMs, now - referenceMs));
    return {
      mode: "upcoming",
      event: chosen,
      gapMs,
      gapElapsedMs,
      extraCount: overlapCount(chosen),
      footerBand,
    };
  }

  return { mode: "idle", footerBand };
}
