// Shared fixtures and assertion helpers for the *.test.ts files.
//
// This module is only ever imported by tests. Nothing in the plugin's import
// graph (rooted at src/plugin.ts) reaches it, so rollup never bundles it into
// bin/plugin.js.

import type { CalendarEvent } from "./calendar/client";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Fixed reference instant, so no test depends on the wall clock. */
export const NOW = new Date("2026-06-15T12:00:00Z").getTime();

/**
 * Build a CalendarEvent, defaulting every field to the boring case: a
 * confirmed, opaque, non-all-day, accepted, regular meeting. Tests override
 * only the fields they are about.
 */
export function ev(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    accountSub: "sub-1",
    calendarIds: ["primary"],
    summary: "Standup",
    status: "confirmed",
    startMs: NOW + 30 * MINUTE,
    endMs: NOW + 60 * MINUTE,
    isAllDay: false,
    eventType: "default",
    transparency: "opaque",
    attendeeSelfResponse: "accepted",
    attachments: [],
    ...overrides,
  };
}

const DATA_URL_PREFIX = "data:image/svg+xml;base64,";

/** True when buildSvgTile returned a rendered tile rather than a static asset path. */
export function isDataUrl(tile: string): boolean {
  return tile.startsWith(DATA_URL_PREFIX);
}

/** Decode a buildSvgTile data URL back into its SVG source. */
export function decodeTile(tile: string): string {
  if (!isDataUrl(tile)) {
    throw new Error(`not a tile data URL: ${tile.slice(0, 40)}`);
  }
  return Buffer.from(tile.slice(DATA_URL_PREFIX.length), "base64").toString(
    "utf-8",
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Width of the first `<rect>` painted in `fill`, or null when no such rect was
 * emitted. Lets the fill-geometry tests assert on real rendered pixels rather
 * than on internal helpers.
 */
export function rectWidth(svg: string, fill: string): number | null {
  const tag = svg.match(
    new RegExp(`<rect[^>]*fill="${escapeRegExp(fill)}"[^>]*/>`),
  );
  if (!tag) return null;
  const width = tag[0].match(/width="([\d.]+)"/);
  return width ? Number.parseFloat(width[1]) : null;
}

/** Colours buildSvgTile paints with, mirrored so tests can name them. */
export const TILE_COLORS = {
  bg: "#0d0d0d",
  topBar: "#4285F4",
  upcomingFill: "#FFC107",
  ongoingFill: "#34A853",
  flash: "#FFD600",
  bandOoo: "#9AA0A6",
  bandFocus: "#A142F4",
} as const;
