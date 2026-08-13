import {
  type calendar_v3,
  calendar as calendarApi,
} from "@googleapis/calendar";
import type { OAuth2Client } from "google-auth-library";
import { log } from "../util/log";

// Per-request timeout for Google API calls. Without this, a request that
// stalls (e.g. a stale keep-alive socket after the machine wakes from sleep)
// hangs the await forever: the poll never returns, failureCount never
// increments, and auth-required is never surfaced. A timeout lets a wedged
// request fail so the poller can back off and retry on a fresh connection.
// Kept well under the 60s poll interval, with headroom for listEvents
// iterating a handful of calendars sequentially.
const REQUEST_TIMEOUT_MS = 15_000;

export type CalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
};

export type CalendarEventAttachment = {
  fileUrl: string;
  title?: string;
  mimeType?: string;
};

export type CalendarEvent = {
  id: string;
  accountSub: string;
  // Every calendar this event was returned from. Usually one entry, but the
  // same event can arrive under several IDs — most commonly "primary" and the
  // user's own address, which are aliases for the same calendar. Keys match on
  // *any* entry, so an event fetched under one alias still satisfies a
  // selection stored under the other.
  calendarIds: string[];
  summary: string;
  status: string; // "confirmed" | "tentative" | "cancelled"
  startMs: number;
  endMs: number;
  isAllDay: boolean;
  eventType:
    | "default"
    | "outOfOffice"
    | "focusTime"
    | "workingLocation"
    | "fromGmail"
    | string;
  transparency: "opaque" | "transparent";
  attendeeSelfResponse:
    | "accepted"
    | "declined"
    | "tentative"
    | "needsAction"
    | null;
  hangoutLink?: string;
  conferenceUri?: string;
  location?: string;
  description?: string;
  attachments: CalendarEventAttachment[];
  htmlLink?: string;
};

export class AuthRequiredError extends Error {
  constructor() {
    super("Google authentication required.");
    this.name = "AuthRequiredError";
  }
}

function isInvalidGrant(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    response?: { status?: number; data?: { error?: string } };
    code?: string | number;
  };
  if (e.response?.data?.error === "invalid_grant") return true;
  if (e.response?.status === 401) return true;
  return false;
}

export async function listCalendars(
  auth: OAuth2Client,
): Promise<CalendarSummary[]> {
  const calendar = calendarApi({ version: "v3", auth });
  try {
    const res = await calendar.calendarList.list(
      { minAccessRole: "reader" },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    const items = res.data.items ?? [];
    return items
      .filter((c): c is calendar_v3.Schema$CalendarListEntry & { id: string } =>
        Boolean(c.id),
      )
      .map((c) => ({
        id: c.id,
        summary: c.summaryOverride ?? c.summary ?? c.id,
        primary: Boolean(c.primary),
        backgroundColor: c.backgroundColor ?? undefined,
      }));
  } catch (err) {
    if (isInvalidGrant(err)) throw new AuthRequiredError();
    throw err;
  }
}

function normalize(
  raw: calendar_v3.Schema$Event,
  accountSub: string,
  calendarId: string,
  userEmail: string | null,
): CalendarEvent | null {
  if (!raw.id) return null;
  const start = raw.start;
  const end = raw.end;
  if (!start || !end) return null;

  const isAllDay = !start.dateTime && Boolean(start.date);
  let startMs: number;
  let endMs: number;
  if (isAllDay) {
    // Treat all-day dates as local midnight; end.date is exclusive.
    startMs = new Date(`${start.date}T00:00:00`).getTime();
    endMs = new Date(`${end.date ?? start.date}T00:00:00`).getTime();
  } else {
    if (!start.dateTime || !end.dateTime) return null;
    startMs = new Date(start.dateTime).getTime();
    endMs = new Date(end.dateTime).getTime();
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  let attendeeSelfResponse: CalendarEvent["attendeeSelfResponse"] = null;
  if (userEmail && raw.attendees) {
    const self = raw.attendees.find(
      (a) => a.self || a.email?.toLowerCase() === userEmail.toLowerCase(),
    );
    const r = self?.responseStatus;
    if (
      r === "accepted" ||
      r === "declined" ||
      r === "tentative" ||
      r === "needsAction"
    ) {
      attendeeSelfResponse = r;
    }
  }

  const videoEntry = raw.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  );

  return {
    id: raw.id,
    accountSub,
    calendarIds: [calendarId],
    summary: raw.summary ?? "(no title)",
    status: raw.status ?? "confirmed",
    startMs,
    endMs,
    isAllDay,
    eventType: raw.eventType ?? "default",
    transparency: raw.transparency === "transparent" ? "transparent" : "opaque",
    attendeeSelfResponse,
    hangoutLink: raw.hangoutLink ?? undefined,
    conferenceUri: videoEntry?.uri ?? undefined,
    location: raw.location ?? undefined,
    description: raw.description ?? undefined,
    attachments: (raw.attachments ?? [])
      .filter(
        (a): a is calendar_v3.Schema$EventAttachment & { fileUrl: string } =>
          Boolean(a.fileUrl),
      )
      .map((a) => ({
        fileUrl: a.fileUrl,
        title: a.title ?? undefined,
        mimeType: a.mimeType ?? undefined,
      })),
    htmlLink: raw.htmlLink ?? undefined,
  };
}

export async function listEvents(
  auth: OAuth2Client,
  accountSub: string,
  calendarIds: string[],
  windowMs: number,
  userEmail: string | null,
): Promise<CalendarEvent[]> {
  const calendar = calendarApi({ version: "v3", auth });
  const timeMin = new Date(Date.now() - 5 * 60_000).toISOString(); // 5min back so currently-ongoing events are included
  const timeMax = new Date(Date.now() + windowMs).toISOString();

  const merged = new Map<string, CalendarEvent>();
  for (const calendarId of calendarIds) {
    try {
      const res = await calendar.events.list(
        {
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 25,
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );
      for (const raw of res.data.items ?? []) {
        const ev = normalize(raw, accountSub, calendarId, userEmail);
        if (!ev) continue;
        // Dedupe by id across calendars (the primary calendar can mirror
        // others, and invitations share an id across attendees' calendars) so
        // the +N overlap count doesn't double up. Record the extra calendar on
        // the surviving event rather than discarding it: which calendar we
        // happened to fetch first must not decide whether a key matches.
        const existing = merged.get(ev.id);
        if (existing) {
          if (!existing.calendarIds.includes(calendarId)) {
            existing.calendarIds.push(calendarId);
          }
          continue;
        }
        merged.set(ev.id, ev);
      }
    } catch (err) {
      if (isInvalidGrant(err)) throw new AuthRequiredError();
      log.error(`events.list failed for calendar ${calendarId}: ${err}`);
      // Continue with other calendars; one bad calendar shouldn't kill the loop.
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.startMs - b.startMs);
}
