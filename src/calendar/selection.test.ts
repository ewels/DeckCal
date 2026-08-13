import { describe, expect, it } from "vitest";
import type { CountdownSettings } from "../settings";
import { ev, HOUR, MINUTE, NOW } from "../test-utils";
import type { CalendarEvent } from "./client";
import { type SelectionMode, select } from "./selection";

const at = (offsetMinutes: number): number => NOW + offsetMinutes * MINUTE;
const pick = (
  events: CalendarEvent[],
  settings: CountdownSettings = {},
  mode?: SelectionMode,
) => select(events, settings, { now: NOW, mode });

describe("select — basic filters", () => {
  it("returns idle for an empty calendar", () => {
    expect(pick([])).toEqual({ mode: "idle", footerBand: { kind: "none" } });
  });

  it("drops cancelled events", () => {
    const e = ev({ status: "cancelled", startMs: at(10), endMs: at(40) });
    expect(pick([e]).mode).toBe("idle");
  });

  it("always drops transparent (free) events, even when otherwise includable", () => {
    const e = ev({
      transparency: "transparent",
      startMs: at(10),
      endMs: at(40),
    });
    expect(pick([e], { includeAllDay: true, includeDeclined: true }).mode).toBe(
      "idle",
    );
  });

  it("drops all-day events by default and keeps them when included", () => {
    const e = ev({ isAllDay: true, startMs: at(10), endMs: at(40) });
    expect(pick([e]).mode).toBe("idle");
    expect(pick([e], { includeAllDay: true }).mode).toBe("upcoming");
  });

  it("drops declined events by default and keeps them when included", () => {
    const e = ev({
      attendeeSelfResponse: "declined",
      startMs: at(10),
      endMs: at(40),
    });
    expect(pick([e]).mode).toBe("idle");
    expect(pick([e], { includeDeclined: true }).mode).toBe("upcoming");
  });

  it("keeps tentative events by default and drops them when excluded", () => {
    const e = ev({
      attendeeSelfResponse: "tentative",
      startMs: at(10),
      endMs: at(40),
    });
    expect(pick([e]).mode).toBe("upcoming");
    expect(pick([e], { includeTentative: false }).mode).toBe("idle");
  });
});

describe("select — far-future horizon", () => {
  const far = ev({ startMs: at(300), endMs: at(330) });

  it("applies no cutoff when ignoreAfterHours was never set", () => {
    // The PI prefills the field; select() itself must not invent a horizon,
    // or a key would silently hide events before the user ever saw the option.
    expect(pick([far]).mode).toBe("upcoming");
  });

  it("drops events beyond an explicit horizon", () => {
    expect(pick([far], { ignoreAfterHours: 4 }).mode).toBe("idle");
    expect(pick([far], { ignoreAfterHours: 6 }).mode).toBe("upcoming");
  });

  it("treats a cleared horizon field as no cutoff", () => {
    expect(pick([far], { ignoreAfterHours: "" }).mode).toBe("upcoming");
  });

  it("accepts the horizon as a string, as sdpi-textfield stores it", () => {
    expect(pick([far], { ignoreAfterHours: "4" }).mode).toBe("idle");
  });
});

describe("select — picking between ongoing and upcoming", () => {
  it("prefers the ongoing meeting over a distant upcoming one", () => {
    const ongoing = ev({ id: "on", startMs: at(-10), endMs: at(20) });
    const later = ev({ id: "up", startMs: at(90), endMs: at(120) });
    const result = pick([ongoing, later]);
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("on");
    expect(result.totalMs).toBe(30 * MINUTE);
  });

  it("promotes an imminent upcoming meeting over the ongoing one", () => {
    // "Your next meeting starts in 3 minutes" is more actionable mid-meeting
    // than "this one has 20 minutes left".
    const ongoing = ev({ id: "on", startMs: at(-10), endMs: at(20) });
    const soon = ev({ id: "soon", startMs: at(3), endMs: at(33) });
    const result = pick([ongoing, soon]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.event.id).toBe("soon");
  });

  it("respects a custom imminent window when promoting", () => {
    const ongoing = ev({ id: "on", startMs: at(-10), endMs: at(20) });
    const soon = ev({ id: "soon", startMs: at(8), endMs: at(38) });
    // 8 minutes out: outside the default 5-minute window, inside a 10.
    expect(pick([ongoing, soon]).mode).toBe("ongoing");
    expect(pick([ongoing, soon], { imminentFillMinutes: 10 }).mode).toBe(
      "upcoming",
    );
  });

  it("picks the most recently started of several ongoing meetings", () => {
    const early = ev({ id: "early", startMs: at(-30), endMs: at(30) });
    const late = ev({ id: "late", startMs: at(-5), endMs: at(25) });
    const result = pick([early, late]);
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("late");
  });

  it("picks the soonest of several upcoming meetings", () => {
    const later = ev({ id: "later", startMs: at(90), endMs: at(120) });
    const sooner = ev({ id: "sooner", startMs: at(40), endMs: at(70) });
    const result = pick([later, sooner]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.event.id).toBe("sooner");
  });

  it("treats an event as over the instant it ends", () => {
    // Half-open interval: start <= now < end.
    const justEnded = ev({ id: "x", startMs: at(-30), endMs: NOW });
    expect(pick([justEnded]).mode).toBe("idle");
    const justStarted = ev({ id: "y", startMs: NOW, endMs: at(30) });
    expect(pick([justStarted]).mode).toBe("ongoing");
  });
});

describe("select — selection modes", () => {
  const ongoing = ev({ id: "on", startMs: at(-10), endMs: at(20) });
  const upcoming = ev({ id: "up", startMs: at(30), endMs: at(60) });

  it("combined mode considers both", () => {
    expect(pick([ongoing], {}, "combined").mode).toBe("ongoing");
    expect(pick([upcoming], {}, "combined").mode).toBe("upcoming");
  });

  it("upcoming mode ignores the ongoing meeting", () => {
    const result = pick([ongoing, upcoming], {}, "upcoming");
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.event.id).toBe("up");
  });

  it("upcoming mode is idle when nothing is upcoming", () => {
    expect(pick([ongoing], {}, "upcoming").mode).toBe("idle");
  });

  it("ongoing mode ignores upcoming meetings, imminent or not", () => {
    const soon = ev({ id: "soon", startMs: at(2), endMs: at(32) });
    const result = pick([ongoing, soon], {}, "ongoing");
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("on");
  });

  it("ongoing mode is idle when no meeting is in progress", () => {
    expect(pick([upcoming], {}, "ongoing").mode).toBe("idle");
  });
});

describe("select — gap progress for upcoming events", () => {
  it("anchors the gap to the previous event's end", () => {
    const prev = ev({ id: "prev", startMs: at(-60), endMs: at(-20) });
    const next = ev({ id: "next", startMs: at(40), endMs: at(70) });
    const result = pick([prev, next]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    // Gap runs from prev end (-20m) to next start (+40m) = 60m, of which
    // 20m has elapsed.
    expect(result.gapMs).toBe(60 * MINUTE);
    expect(result.gapElapsedMs).toBe(20 * MINUTE);
  });

  it("falls back to a one-hour window when nothing precedes it", () => {
    const next = ev({ id: "next", startMs: at(30), endMs: at(60) });
    const result = pick([next]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.gapMs).toBe(90 * MINUTE);
    expect(result.gapElapsedMs).toBe(HOUR);
  });

  it("uses the latest prior end when several events have finished", () => {
    const old = ev({ id: "old", startMs: at(-120), endMs: at(-90) });
    const recent = ev({ id: "recent", startMs: at(-40), endMs: at(-10) });
    const next = ev({ id: "next", startMs: at(50), endMs: at(80) });
    const result = pick([old, recent, next]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.gapMs).toBe(60 * MINUTE);
    expect(result.gapElapsedMs).toBe(10 * MINUTE);
  });

  it("never reports a gap shorter than a minute", () => {
    // A meeting starting seconds after the previous one ended would otherwise
    // produce a near-zero denominator.
    const prev = ev({ id: "prev", startMs: at(-30), endMs: NOW - 1000 });
    const next = ev({ id: "next", startMs: NOW + 2000, endMs: at(30) });
    const result = pick([prev, next]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.gapMs).toBe(MINUTE);
    expect(result.gapElapsedMs).toBeLessThanOrEqual(result.gapMs);
  });
});

describe("select — overlap count", () => {
  it("is zero for a lone meeting", () => {
    const result = pick([ev({ startMs: at(30), endMs: at(60) })]);
    expect(result.mode === "upcoming" && result.extraCount).toBe(0);
  });

  it("counts double-bookings against an ongoing meeting", () => {
    const chosen = ev({ id: "a", startMs: at(-5), endMs: at(25) });
    const clash = ev({ id: "b", startMs: at(-10), endMs: at(20) });
    const separate = ev({ id: "c", startMs: at(120), endMs: at(150) });
    const result = pick([chosen, clash, separate]);
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("a");
    expect(result.extraCount).toBe(1);
  });

  it("does not count events that merely abut the chosen one", () => {
    // Overlap is strict: a.start < b.end && a.end > b.start. Back-to-back
    // meetings touch at a single instant and must not inflate +N.
    const chosen = ev({ id: "a", startMs: at(-30), endMs: at(30) });
    const before = ev({ id: "b", startMs: at(-60), endMs: at(-30) });
    const after = ev({ id: "c", startMs: at(30), endMs: at(60) });
    const result = pick([chosen, before, after]);
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("a");
    expect(result.extraCount).toBe(0);
  });

  it("excludes filtered-out events from the count", () => {
    const chosen = ev({ id: "a", startMs: at(30), endMs: at(60) });
    const declined = ev({
      id: "b",
      startMs: at(35),
      endMs: at(55),
      attendeeSelfResponse: "declined",
    });
    const result = pick([chosen, declined]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.extraCount).toBe(0);
  });
});

describe("select — out-of-office and focus time", () => {
  const oooOngoing = ev({
    id: "ooo",
    eventType: "outOfOffice",
    summary: "Annual leave",
    startMs: at(-60),
    endMs: at(180),
  });
  const focusOngoing = ev({
    id: "focus",
    eventType: "focusTime",
    summary: "Deep work",
    startMs: at(-30),
    endMs: at(90),
  });

  it("shows an ongoing OOO event as a footer band, not as the meeting", () => {
    const result = pick([oooOngoing]);
    expect(result.mode).toBe("idle");
    expect(result.footerBand).toEqual({ kind: "ooo", title: "Annual leave" });
  });

  it("keeps the next real meeting visible behind the band", () => {
    const meeting = ev({ id: "m", startMs: at(30), endMs: at(60) });
    const result = pick([oooOngoing, meeting]);
    expect(result.mode).toBe("upcoming");
    if (result.mode !== "upcoming") return;
    expect(result.event.id).toBe("m");
    expect(result.extraCount).toBe(0);
    expect(result.footerBand.kind).toBe("ooo");
  });

  it("lets focus time win when both are in progress", () => {
    expect(pick([oooOngoing, focusOngoing]).footerBand).toEqual({
      kind: "focus",
      title: "Deep work",
    });
    // Order in the event list must not matter.
    expect(pick([focusOngoing, oooOngoing]).footerBand).toEqual({
      kind: "focus",
      title: "Deep work",
    });
  });

  it("only bands special events that are actually in progress", () => {
    const futureOoo = ev({
      id: "ooo2",
      eventType: "outOfOffice",
      startMs: at(120),
      endMs: at(240),
    });
    expect(pick([futureOoo]).footerBand).toEqual({ kind: "none" });
  });

  it("falls back to a generic band title when the event has no summary", () => {
    expect(pick([ev({ ...oooOngoing, summary: "  " })]).footerBand).toEqual({
      kind: "ooo",
      title: "Out of office",
    });
    expect(pick([ev({ ...focusOngoing, summary: "" })]).footerBand).toEqual({
      kind: "focus",
      title: "Focus time",
    });
  });

  it("mode 'ignore' removes the event entirely, band included", () => {
    const result = pick([oooOngoing], { outOfOfficeMode: "ignore" });
    expect(result.mode).toBe("idle");
    expect(result.footerBand).toEqual({ kind: "none" });
  });

  it("mode 'regular' makes the event selectable like any meeting", () => {
    const result = pick([oooOngoing], { outOfOfficeMode: "regular" });
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("ooo");
    expect(result.footerBand).toEqual({ kind: "none" });
  });

  it("applies the two special modes independently", () => {
    const result = pick([oooOngoing, focusOngoing], {
      outOfOfficeMode: "ignore",
      focusMode: "regular",
    });
    expect(result.mode).toBe("ongoing");
    if (result.mode !== "ongoing") return;
    expect(result.event.id).toBe("focus");
    expect(result.footerBand).toEqual({ kind: "none" });
  });

  it("still drops a special event that fails the basic filters", () => {
    const declinedOoo = ev({
      ...oooOngoing,
      attendeeSelfResponse: "declined",
    });
    expect(pick([declinedOoo]).footerBand).toEqual({ kind: "none" });
  });
});
