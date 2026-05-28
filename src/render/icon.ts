// SVG icon builder for the meeting-countdown action. Returns a
// `data:image/svg+xml;base64,...` URL ready for `action.setImage(...)`.

import type { FooterBand } from "../calendar/selection";

export type RenderState =
  | { mode: "idle"; footerBand: FooterBand }
  | {
      mode: "upcoming";
      remainingMs: number;
      eventStartMs: number;
      gapMs: number;
      gapElapsedMs: number;
      imminentMs: number;
      extraCount: number;
      title?: string;
      footerBand: FooterBand;
      dim?: boolean;
      // 0-1; only consulted when `dim` is true.
      dimOpacity?: number;
      // When this key is part of a contiguous group of keys showing the same
      // event with the same imminent window, the bar sweeps across the group
      // as a single band. Each key paints the slice that falls within its
      // own column. Absent for stand-alone keys.
      block?: { columns: number; indexInBlock: number };
    }
  | {
      mode: "ongoing";
      remainingMs: number;
      totalMs: number;
      imminentMs: number;
      extraCount: number;
      title?: string;
      footerBand: FooterBand;
      flashing: boolean;
    }
  | { mode: "authRequired" }
  | { mode: "noCalendars" };

export type RenderVariant = "normal" | "alert";

export type RenderInput = {
  state: RenderState;
  // Caller controls flash parity so it matches the 1Hz tick clock.
  flashOn?: boolean;
  // "alert" — the meeting-alert action. Renders blank for every state except
  // authRequired and flashing-ongoing (the only states this action exists to
  // surface).
  variant?: RenderVariant;
};

const SIZE = 144;
const TOP_BAR_HEIGHT = 4;
const FOOTER_BAND_HEIGHT = 22;
const FOOTER_BAND_FONT_SIZE = 14;
const FOOTER_BAND_Y = SIZE - FOOTER_BAND_HEIGHT;
const FOOTER_BAND_TEXT_Y = SIZE - 6;

const COLORS = {
  bg: "#0d0d0d",
  topBar: "#4285F4",
  upcomingFill: "#FFC107",
  ongoingFill: "#34A853",
  flash: "#FFD600",
  textLight: "#ffffff",
  textDark: "#0d0d0d",
  bandOoo: "#9AA0A6",
  bandFocus: "#A142F4",
  authRed: "#f10000",
  glyphIdle: "#5f6368",
} as const;

export function formatRemaining(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  if (secs <= 0) return "0s";
  if (secs < 60) return `${secs}s`;
  // Round minutes up — matches macOS Calendar etc. "2 minutes" stays "2m"
  // until the meeting is 1m00s away, rather than collapsing to "1m" the
  // instant we cross 1:59.
  const mins = Math.ceil(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}:${remMins.toString().padStart(2, "0")}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Pick the label for an upcoming event. If the start is on a future
// calendar day, show "Tomorrow 08:00" / "Mon 14:30" as a two-line label.
// Inside the imminent window (or on the same day) keep the live countdown.
export function formatUpcomingLabel(
  remainingMs: number,
  eventStartMs: number,
  imminentMs: number,
  now: number = Date.now(),
): string | [string, string] {
  if (remainingMs <= imminentMs) return formatRemaining(remainingMs);
  const eventDate = new Date(eventStartMs);
  const nowDate = new Date(now);
  if (sameLocalDay(eventDate, nowDate)) return formatRemaining(remainingMs);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayLabel = sameLocalDay(eventDate, tomorrow)
    ? "Tomorrow"
    : eventDate.toLocaleDateString(undefined, { weekday: "short" });
  const hh = String(eventDate.getHours()).padStart(2, "0");
  const mm = String(eventDate.getMinutes()).padStart(2, "0");
  return [dayLabel, `${hh}:${mm}`];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function dataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

function bandRect(band: FooterBand): string {
  if (band.kind === "none") return "";
  const fill = band.kind === "focus" ? COLORS.bandFocus : COLORS.bandOoo;
  // Grey OOO band: dark text reads best; purple focus band: white.
  const textColor = band.kind === "focus" ? COLORS.textLight : COLORS.textDark;
  const label = escapeXml(truncateTitle(band.title, 18));
  return [
    `<rect x="0" y="${FOOTER_BAND_Y}" width="${SIZE}" height="${FOOTER_BAND_HEIGHT}" fill="${fill}"/>`,
    `<text x="${SIZE / 2}" y="${FOOTER_BAND_TEXT_Y}" font-family="Helvetica,Arial,sans-serif" font-size="${FOOTER_BAND_FONT_SIZE}" font-weight="600" fill="${textColor}" text-anchor="middle">${label}</text>`,
  ].join("");
}

function truncateTitle(title: string, max = 12): string {
  // First N chars, no ellipsis.
  return title.length <= max ? title : title.slice(0, max);
}

function footerStack(
  title: string | undefined,
  extraCount: number,
  bandPresent: boolean,
): string {
  // Sit fully inside the viewbox at font-size 22.
  const baseY = bandPresent ? SIZE - FOOTER_BAND_HEIGHT - 8 : SIZE - 10;
  const lines: string[] = [];
  // SVG 2's paint-order isn't reliable across renderers, so to get the
  // "stroke behind the fill" outline effect we render the text twice: first
  // the stroked silhouette, then the filled glyphs on top.
  const outlined = (
    label: string,
    y: number,
    fontSize: number,
    strokeWidth: number,
  ): string => {
    const common = `x="${SIZE / 2}" y="${y}" font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle"`;
    const safe = escapeXml(label);
    return [
      `<text ${common} fill="none" stroke="${COLORS.textDark}" stroke-width="${strokeWidth}" stroke-linejoin="round">${safe}</text>`,
      `<text ${common} fill="${COLORS.textLight}">${safe}</text>`,
    ].join("");
  };
  if (title && title.trim().length > 0) {
    lines.push(outlined(truncateTitle(title.trim()), baseY, 22, 3));
  }
  if (extraCount > 0) {
    const y = title ? baseY - 20 : baseY;
    lines.push(outlined(`+${extraCount}`, y, 16, 2.5));
  }
  return lines.join("");
}

function centerText(
  label: string | [string, string],
  fillWidth: number,
  rightColor: string = COLORS.textLight,
): string {
  const lines: string[] = Array.isArray(label) ? label : [label];
  const x = SIZE / 2;
  let size: number;
  if (lines.length === 1) {
    const len = lines[0].length;
    size = len <= 2 ? 64 : len === 3 ? 56 : len === 4 ? 48 : 40;
  } else {
    // Two lines need to share the central area; tune down so both fit.
    size = 30;
  }
  // Centre the block of lines vertically inside the tile.
  const lineHeight = size * 1.1;
  const blockCentre = SIZE / 2 + size * 0.2;
  const baseY = (i: number): number =>
    blockCentre - ((lines.length - 1) * lineHeight) / 2 + i * lineHeight;
  const textNode = (color: string, clipAttr = ""): string =>
    lines
      .map(
        (line, i) =>
          `<text x="${x}" y="${baseY(i)}" font-family="Helvetica,Arial,sans-serif" font-size="${size}" font-weight="700" fill="${color}" text-anchor="middle"${clipAttr}>${escapeXml(line)}</text>`,
      )
      .join("");

  const boundary = Math.max(0, Math.min(SIZE, Math.round(fillWidth)));
  // No imminent fill → single render in the caller's chosen color (white for
  // upcoming, blue for ongoing). Avoids emitting zero-width clipPath rects,
  // which some SVG rasterisers (including Stream Deck's) treat as malformed.
  if (boundary === 0) return textNode(rightColor);
  if (boundary === SIZE) return textNode(COLORS.textDark);
  // Partial fill → render twice, each half clipped to its side of the
  // boundary. Left half (on the yellow/green fill) is dark; right half
  // (on the dark background) is the caller's color.
  return [
    `<defs>`,
    `<clipPath id="ct-l"><rect x="0" y="0" width="${boundary}" height="${SIZE}"/></clipPath>`,
    `<clipPath id="ct-r"><rect x="${boundary}" y="0" width="${SIZE - boundary}" height="${SIZE}"/></clipPath>`,
    `</defs>`,
    textNode(COLORS.textDark, ' clip-path="url(#ct-l)"'),
    textNode(rightColor, ' clip-path="url(#ct-r)"'),
  ].join("");
}

function topProgressBar(
  progress: number,
  color: string = COLORS.topBar,
): string {
  const w = Math.max(0, Math.min(1, progress)) * SIZE;
  return `<rect x="0" y="0" width="${w}" height="${TOP_BAR_HEIGHT}" fill="${color}"/>`;
}

function imminentFill(
  remainingMs: number,
  imminentMs: number,
  color: string,
  block?: { columns: number; indexInBlock: number },
): { svg: string; ratio: number } {
  if (imminentMs <= 0) return { svg: "", ratio: 0 };
  if (remainingMs > imminentMs) return { svg: "", ratio: 0 };
  const baseRatio = Math.max(0, 1 - remainingMs / imminentMs);
  const columns = block?.columns ?? 1;
  const indexInBlock = block?.indexInBlock ?? 0;
  // Bar spans the whole block; this key paints the slice that falls within
  // its column. baseRatio*columns is bar width in block-columns; subtracting
  // indexInBlock translates it into this key's local 0..1 fill.
  const keyRatio = Math.max(0, Math.min(1, baseRatio * columns - indexInBlock));
  if (keyRatio <= 0) return { svg: "", ratio: 0 };
  const rawWidth = Math.round(keyRatio * SIZE);
  // 1px minimum on the leading edge so the bar is immediately visible the
  // moment it enters a tile.
  const fillWidth = keyRatio < 1 ? Math.max(1, rawWidth) : SIZE;
  return {
    svg: `<rect x="0" y="0" width="${fillWidth}" height="${SIZE}" fill="${color}"/>`,
    ratio: keyRatio,
  };
}

function wrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${COLORS.bg}"/>${inner}</svg>`;
}

function idleGlyph(): string {
  // Calendar icon sized to occupy most of the tile, with today's date
  // rendered inside: day number large on top, month name below.
  const now = new Date();
  const day = String(now.getDate());
  const month = now.toLocaleDateString(undefined, { month: "short" });

  const x = 22;
  const y = 22;
  const w = 100;
  const h = 104;
  const r = 8;
  return [
    // Outer rounded body.
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="none" stroke="${COLORS.glyphIdle}" stroke-width="5"/>`,
    // Two binding tabs on top.
    `<rect x="${x + 20}" y="${y - 8}" width="6" height="14" fill="${COLORS.glyphIdle}"/>`,
    `<rect x="${x + w - 26}" y="${y - 8}" width="6" height="14" fill="${COLORS.glyphIdle}"/>`,
    // Day number (top half, large).
    `<text x="${x + w / 2}" y="${y + 60}" font-family="Helvetica,Arial,sans-serif" font-size="52" font-weight="700" fill="${COLORS.glyphIdle}" text-anchor="middle">${escapeXml(day)}</text>`,
    // Month (bottom, smaller).
    `<text x="${x + w / 2}" y="${y + 92}" font-family="Helvetica,Arial,sans-serif" font-size="20" font-weight="600" fill="${COLORS.glyphIdle}" text-anchor="middle">${escapeXml(month)}</text>`,
  ].join("");
}

const BLANK_TILE = dataUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${COLORS.bg}"/></svg>`,
);

export function buildSvgTile(input: RenderInput): string {
  const { state, flashOn, variant = "normal" } = input;

  if (state.mode === "authRequired") {
    // Static SVG asset — Stream Deck reads files relative to the plugin root.
    // Mirrors the type-deck pattern (one viewBox, one path, simple text).
    return "imgs/states/auth-required.svg";
  }

  // Alert variant is blank except for two surfaces: (a) the imminent yellow
  // fill bar (no text, no other chrome) during the run-up to a meeting, and
  // (b) the ongoing-meeting flash. Anything else renders blank.
  if (variant === "alert") {
    if (state.mode === "idle" || state.mode === "noCalendars") {
      return BLANK_TILE;
    }
    if (state.mode === "upcoming") {
      if (state.remainingMs > state.imminentMs) return BLANK_TILE;
      const fill = imminentFill(
        state.remainingMs,
        state.imminentMs,
        COLORS.upcomingFill,
        state.block,
      );
      if (!fill.svg) return BLANK_TILE;
      return dataUrl(wrap(fill.svg));
    }
    // ongoing — only the flash renders; everything else stays blank.
    if (!state.flashing) return BLANK_TILE;
    // Fall through to the shared ongoing render below, which paints the
    // yellow flash + NOW label.
  }

  if (state.mode === "noCalendars") {
    return "imgs/states/no-calendars.svg";
  }

  if (state.mode === "idle") {
    return dataUrl(wrap([idleGlyph(), bandRect(state.footerBand)].join("")));
  }

  const parts: string[] = [];

  if (state.mode === "upcoming") {
    const fill = imminentFill(
      state.remainingMs,
      state.imminentMs,
      COLORS.upcomingFill,
      state.block,
    );
    parts.push(fill.svg);
    const progress = state.gapMs > 0 ? state.gapElapsedMs / state.gapMs : 0;
    parts.push(topProgressBar(progress));
    // boundary = how far the colored fill extends from the left. The text
    // splitter uses it to render black on the fill / white on the dark.
    const boundary =
      fill.ratio > 0 ? Math.max(1, Math.round(fill.ratio * SIZE)) : 0;
    const label = formatUpcomingLabel(
      state.remainingMs,
      state.eventStartMs,
      state.imminentMs,
    );
    const textBlock = [
      centerText(label, boundary),
      footerStack(
        state.title,
        state.extraCount,
        state.footerBand.kind !== "none",
      ),
    ].join("");
    // Dim text for events still well in the future. The progress bar and
    // band keep full opacity so the timeline cues stay readable.
    const dimOpacity = Math.max(0, Math.min(1, state.dimOpacity ?? 0.3));
    parts.push(
      state.dim ? `<g opacity="${dimOpacity}">${textBlock}</g>` : textBlock,
    );
    parts.push(bandRect(state.footerBand));
    return dataUrl(wrap(parts.join("")));
  }

  // ongoing — no green imminent fill (the top progress bar already shows
  // meeting elapsed, so the full-tile fill was redundant).
  let boundary = 0;
  if (state.flashing && flashOn) {
    // Flash overlay covers the entire tile in yellow → treat the text
    // boundary as the full width so the time renders entirely in dark.
    parts.push(
      `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${COLORS.flash}"/>`,
    );
    boundary = SIZE;
  }

  const progress =
    state.totalMs > 0 ? (state.totalMs - state.remainingMs) / state.totalMs : 1;
  // Green top bar so ongoing meetings are immediately distinguishable from
  // the blue bar used for upcoming.
  parts.push(topProgressBar(progress, COLORS.ongoingFill));
  // While the meeting-start flash is unacknowledged, replace the countdown
  // with "NOW" — paired with the yellow pulse, it's a clearer alert than
  // a number that's just slowly counting up from the meeting duration.
  const timeLabel = state.flashing ? "NOW" : formatRemaining(state.remainingMs);
  // Blue right-side text for ongoing meetings, so it's easy to tell apart
  // from the white text used for upcoming.
  parts.push(centerText(timeLabel, boundary, COLORS.topBar));
  parts.push(
    footerStack(
      state.title,
      state.extraCount,
      state.footerBand.kind !== "none",
    ),
  );
  parts.push(bandRect(state.footerBand));
  return dataUrl(wrap(parts.join("")));
}
