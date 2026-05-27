import type { CalendarEvent } from "./client";

export type Provider = "meet" | "zoom" | "teams";

export type Conference = {
  provider: Provider;
  url: string;
};

const ZOOM_RE = /https?:\/\/[\w.-]*zoom\.us\/(?:j|my|w)\/[^\s<>"'()]+/i;
const TEAMS_RE =
  /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"'()]+/i;

export function detectConference(event: CalendarEvent): Conference | null {
  // Google Meet — explicit fields first.
  if (event.hangoutLink) return { provider: "meet", url: event.hangoutLink };
  if (event.conferenceUri?.includes("meet.google.com")) {
    return { provider: "meet", url: event.conferenceUri };
  }

  // Zoom can show up in conferenceData (3rd-party conference) or in
  // location/description.
  const haystack = `${event.location ?? ""}\n${event.description ?? ""}\n${event.conferenceUri ?? ""}`;
  const zoom = haystack.match(ZOOM_RE);
  if (zoom) return { provider: "zoom", url: zoom[0] };

  const teams = haystack.match(TEAMS_RE);
  if (teams) return { provider: "teams", url: teams[0] };

  // Generic conferenceData fallback (Meet would have been caught above).
  if (event.conferenceUri) {
    return { provider: "meet", url: event.conferenceUri };
  }
  return null;
}

export function pickAttachment(event: CalendarEvent): string | null {
  const a = event.attachments.find((x) => x.fileUrl);
  return a ? a.fileUrl : null;
}
