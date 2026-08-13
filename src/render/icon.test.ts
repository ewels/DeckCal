import { describe, expect, it } from "vitest";
import { FOOTER_BAND_NONE } from "../calendar/selection";
import {
  decodeTile,
  isDataUrl,
  MINUTE,
  rectWidth,
  TILE_COLORS,
} from "../test-utils";
import {
  buildSvgTile,
  formatRemaining,
  formatUpcomingLabel,
  type RenderState,
} from "./icon";

const TILE_SIZE = 144;

describe("formatRemaining", () => {
  it("counts seconds under a minute", () => {
    expect(formatRemaining(1_000)).toBe("1s");
    expect(formatRemaining(59_000)).toBe("59s");
  });

  it("clamps zero and negative to 0s", () => {
    expect(formatRemaining(0)).toBe("0s");
    expect(formatRemaining(-5_000)).toBe("0s");
  });

  it("rounds minutes up, matching how calendars phrase it", () => {
    // 2 minutes stays "2m" until it is genuinely 1m00s away, rather than
    // collapsing the instant it crosses 1:59.
    expect(formatRemaining(60_000)).toBe("1m");
    expect(formatRemaining(61_000)).toBe("2m");
    expect(formatRemaining(119_000)).toBe("2m");
    expect(formatRemaining(120_000)).toBe("2m");
  });

  it("switches to h:mm at an hour", () => {
    expect(formatRemaining(3_600_000)).toBe("1:00");
    expect(formatRemaining(3_660_000)).toBe("1:01");
    expect(formatRemaining(2 * 3_600_000 + 5 * 60_000)).toBe("2:05");
  });
});

describe("formatUpcomingLabel", () => {
  const imminentMs = 5 * MINUTE;
  // Local-time constructors throughout, so the assertions hold in any timezone.
  const now = new Date(2026, 0, 15, 22, 0).getTime();

  it("shows a countdown once inside the imminent window", () => {
    const start = new Date(2026, 0, 16, 8, 0).getTime();
    // Even though the event is on another calendar day, being imminent wins.
    expect(formatUpcomingLabel(3 * MINUTE, start, imminentMs, now)).toBe("3m");
  });

  it("shows a countdown for events later the same day", () => {
    const start = new Date(2026, 0, 15, 23, 30).getTime();
    expect(formatUpcomingLabel(90 * MINUTE, start, imminentMs, now)).toBe(
      "1:30",
    );
  });

  it("shows a two-line Tomorrow label for the next day", () => {
    const start = new Date(2026, 0, 16, 8, 5).getTime();
    expect(formatUpcomingLabel(start - now, start, imminentMs, now)).toEqual([
      "Tomorrow",
      "08:05",
    ]);
  });

  it("shows a weekday and time for events further out", () => {
    const start = new Date(2026, 0, 19, 9, 30).getTime();
    const label = formatUpcomingLabel(start - now, start, imminentMs, now);
    expect(Array.isArray(label)).toBe(true);
    if (!Array.isArray(label)) return;
    // Weekday name is locale-dependent; the time half is not.
    expect(label[0]).not.toBe("Tomorrow");
    expect(label[0].length).toBeGreaterThan(0);
    expect(label[1]).toBe("09:30");
  });
});

describe("buildSvgTile — static states", () => {
  it("returns asset paths for the error states", () => {
    expect(buildSvgTile({ state: { mode: "authRequired" } })).toBe(
      "imgs/states/auth-required.svg",
    );
    expect(buildSvgTile({ state: { mode: "noCalendars" } })).toBe(
      "imgs/states/no-calendars.svg",
    );
  });

  it("returns the auth-required asset even for the alert variant", () => {
    // Sign-in is the one problem an otherwise-blank alert key must surface.
    expect(
      buildSvgTile({ state: { mode: "authRequired" }, variant: "alert" }),
    ).toBe("imgs/states/auth-required.svg");
  });

  it("renders an idle tile with a calendar glyph", () => {
    const svg = decodeTile(
      buildSvgTile({ state: { mode: "idle", footerBand: FOOTER_BAND_NONE } }),
    );
    expect(svg).toContain(`viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}"`);
    // The glyph draws today's date, so assert on structure not on the digits.
    expect(svg).toContain("<text");
    expect(svg).toContain(TILE_COLORS.bg);
  });
});

describe("buildSvgTile — footer band", () => {
  it("paints a grey band with the OOO title", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: {
          mode: "idle",
          footerBand: { kind: "ooo", title: "Annual leave" },
        },
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.bandOoo)).toBe(TILE_SIZE);
    expect(svg).toContain("Annual leave");
  });

  it("paints a purple band for focus time", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: {
          mode: "idle",
          footerBand: { kind: "focus", title: "Deep work" },
        },
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.bandFocus)).toBe(TILE_SIZE);
    expect(svg).toContain("Deep work");
  });

  it("truncates a long band title", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: {
          mode: "idle",
          footerBand: {
            kind: "ooo",
            title: "Out of office until next Thursday",
          },
        },
      }),
    );
    expect(svg).toContain("Out of office ");
    expect(svg).not.toContain("Thursday");
  });

  it("emits no band rect when there is none", () => {
    const svg = decodeTile(
      buildSvgTile({ state: { mode: "idle", footerBand: FOOTER_BAND_NONE } }),
    );
    expect(rectWidth(svg, TILE_COLORS.bandOoo)).toBeNull();
    expect(rectWidth(svg, TILE_COLORS.bandFocus)).toBeNull();
  });
});

const upcoming = (over: Partial<RenderState & { mode: "upcoming" }> = {}) =>
  ({
    mode: "upcoming",
    remainingMs: 30 * MINUTE,
    eventStartMs: Date.now() + 30 * MINUTE,
    gapMs: 60 * MINUTE,
    gapElapsedMs: 30 * MINUTE,
    imminentMs: 5 * MINUTE,
    extraCount: 0,
    footerBand: FOOTER_BAND_NONE,
    ...over,
  }) satisfies RenderState;

const ongoing = (over: Partial<RenderState & { mode: "ongoing" }> = {}) =>
  ({
    mode: "ongoing",
    remainingMs: 15 * MINUTE,
    totalMs: 30 * MINUTE,
    imminentMs: 5 * MINUTE,
    extraCount: 0,
    footerBand: FOOTER_BAND_NONE,
    flashing: false,
    ...over,
  }) satisfies RenderState;

describe("buildSvgTile — upcoming", () => {
  it("draws the top progress bar from gap elapsed", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: upcoming({ gapMs: 60 * MINUTE, gapElapsedMs: 15 * MINUTE }),
      }),
    );
    // 25% of the gap has elapsed.
    expect(rectWidth(svg, TILE_COLORS.topBar)).toBeCloseTo(TILE_SIZE * 0.25, 5);
  });

  it("paints no imminent fill while the meeting is far off", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ remainingMs: 30 * MINUTE }) }),
    );
    expect(rectWidth(svg, TILE_COLORS.upcomingFill)).toBeNull();
  });

  it("grows the yellow fill as the meeting approaches", () => {
    const half = decodeTile(
      buildSvgTile({ state: upcoming({ remainingMs: 2.5 * MINUTE }) }),
    );
    expect(rectWidth(half, TILE_COLORS.upcomingFill)).toBe(TILE_SIZE / 2);

    const nearly = decodeTile(
      buildSvgTile({ state: upcoming({ remainingMs: 0.5 * MINUTE }) }),
    );
    expect(rectWidth(nearly, TILE_COLORS.upcomingFill)).toBe(
      Math.round(0.9 * TILE_SIZE),
    );
  });

  it("shows at least a 1px sliver the moment the fill starts", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ remainingMs: 5 * MINUTE - 10 }) }),
    );
    expect(rectWidth(svg, TILE_COLORS.upcomingFill)).toBe(1);
  });

  it("splits the countdown text across the fill boundary", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ remainingMs: 2.5 * MINUTE }) }),
    );
    // Dark text over the yellow, light text over the background.
    expect(svg).toContain('clip-path="url(#ct-l)"');
    expect(svg).toContain('clip-path="url(#ct-r)"');
  });

  it("renders a single text pass when there is no fill", () => {
    // Zero-width clipPath rects render as malformed in Stream Deck.
    const svg = decodeTile(buildSvgTile({ state: upcoming() }));
    expect(svg).not.toContain("clipPath");
  });

  it("renders the +N overlap count and the title", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ extraCount: 3, title: "Standup" }) }),
    );
    expect(svg).toContain("+3");
    expect(svg).toContain("Standup");
  });

  it("truncates a long meeting title to fit the tile", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ title: "Sprint review and retro" }) }),
    );
    expect(svg).toContain("Sprint revie");
    expect(svg).not.toContain("retro");
  });

  it("omits +N when there are no overlaps", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ extraCount: 0 }) }),
    );
    expect(svg).not.toContain("+0");
  });

  it("wraps the text block in a dim group for distant events", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ dim: true, dimOpacity: 0.25 }) }),
    );
    expect(svg).toContain('<g opacity="0.25">');
  });

  it("defaults the dim opacity and clamps out-of-range values", () => {
    expect(
      decodeTile(buildSvgTile({ state: upcoming({ dim: true }) })),
    ).toContain('<g opacity="0.3">');
    expect(
      decodeTile(
        buildSvgTile({ state: upcoming({ dim: true, dimOpacity: 5 }) }),
      ),
    ).toContain('<g opacity="1">');
  });

  it("escapes XML-significant characters in the title", () => {
    const svg = decodeTile(
      buildSvgTile({ state: upcoming({ title: "Ben & <Jerry>" }) }),
    );
    expect(svg).toContain("Ben &amp; &lt;Jerry");
    expect(svg).not.toContain("<Jerry>");
  });
});

describe("buildSvgTile — ongoing", () => {
  it("grows the green fill with meeting progress", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: ongoing({ totalMs: 30 * MINUTE, remainingMs: 15 * MINUTE }),
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.ongoingFill)).toBe(TILE_SIZE / 2);
  });

  it("paints the fill at half opacity so text stays readable", () => {
    const svg = decodeTile(buildSvgTile({ state: ongoing() }));
    expect(svg).toMatch(
      new RegExp(`fill="${TILE_COLORS.ongoingFill}" opacity="0.5"`),
    );
  });

  it("treats a zero-length meeting as fully elapsed", () => {
    const svg = decodeTile(
      buildSvgTile({ state: ongoing({ totalMs: 0, remainingMs: 0 }) }),
    );
    expect(rectWidth(svg, TILE_COLORS.ongoingFill)).toBe(TILE_SIZE);
  });

  it("shows the remaining time in blue, distinct from upcoming's white", () => {
    const svg = decodeTile(
      buildSvgTile({ state: ongoing({ remainingMs: 15 * MINUTE }) }),
    );
    expect(svg).toContain("15m");
    expect(svg).toContain(`fill="${TILE_COLORS.topBar}"`);
  });

  it("replaces the countdown with NOW while flashing", () => {
    const svg = decodeTile(
      buildSvgTile({ state: ongoing({ flashing: true }), flashOn: true }),
    );
    expect(svg).toContain("NOW");
    expect(svg).not.toContain("15m");
  });

  it("covers the whole tile in yellow on the flash-on beat", () => {
    const svg = decodeTile(
      buildSvgTile({ state: ongoing({ flashing: true }), flashOn: true }),
    );
    expect(rectWidth(svg, TILE_COLORS.flash)).toBe(TILE_SIZE);
  });

  it("falls back to the green fill on the flash-off beat", () => {
    const svg = decodeTile(
      buildSvgTile({ state: ongoing({ flashing: true }), flashOn: false }),
    );
    expect(rectWidth(svg, TILE_COLORS.flash)).toBeNull();
    expect(rectWidth(svg, TILE_COLORS.ongoingFill)).toBe(TILE_SIZE / 2);
    // NOW still shows: the label tracks `flashing`, not the blink parity.
    expect(svg).toContain("NOW");
  });
});

describe("buildSvgTile — multi-key sweep", () => {
  it("fills the first key completely before the second begins", () => {
    // A two-key band 25% of the way through: key 0 is half full, key 1 empty.
    const quarter = (indexInBlock: number) =>
      decodeTile(
        buildSvgTile({
          state: ongoing({
            totalMs: 40 * MINUTE,
            remainingMs: 30 * MINUTE,
            block: { columns: 2, indexInBlock },
          }),
        }),
      );
    expect(rectWidth(quarter(0), TILE_COLORS.ongoingFill)).toBe(TILE_SIZE / 2);
    expect(rectWidth(quarter(1), TILE_COLORS.ongoingFill)).toBeNull();
  });

  it("hands over to the second key past the halfway point", () => {
    // 75% through a two-key band: key 0 saturated, key 1 half full.
    const threeQuarters = (indexInBlock: number) =>
      decodeTile(
        buildSvgTile({
          state: ongoing({
            totalMs: 40 * MINUTE,
            remainingMs: 10 * MINUTE,
            block: { columns: 2, indexInBlock },
          }),
        }),
      );
    expect(rectWidth(threeQuarters(0), TILE_COLORS.ongoingFill)).toBe(
      TILE_SIZE,
    );
    expect(rectWidth(threeQuarters(1), TILE_COLORS.ongoingFill)).toBe(
      TILE_SIZE / 2,
    );
  });

  it("sweeps the imminent yellow band across three keys", () => {
    // 50% through a three-key band: key 0 full, key 1 half, key 2 empty.
    const slice = (indexInBlock: number) =>
      decodeTile(
        buildSvgTile({
          state: upcoming({
            remainingMs: 2.5 * MINUTE,
            imminentMs: 5 * MINUTE,
            block: { columns: 3, indexInBlock },
          }),
        }),
      );
    expect(rectWidth(slice(0), TILE_COLORS.upcomingFill)).toBe(TILE_SIZE);
    expect(rectWidth(slice(1), TILE_COLORS.upcomingFill)).toBe(TILE_SIZE / 2);
    expect(rectWidth(slice(2), TILE_COLORS.upcomingFill)).toBeNull();
  });

  it("matches the stand-alone fill when the block is a single key", () => {
    const state = { totalMs: 30 * MINUTE, remainingMs: 15 * MINUTE };
    const solo = decodeTile(buildSvgTile({ state: ongoing(state) }));
    const block = decodeTile(
      buildSvgTile({
        state: ongoing({ ...state, block: { columns: 1, indexInBlock: 0 } }),
      }),
    );
    expect(rectWidth(block, TILE_COLORS.ongoingFill)).toBe(
      rectWidth(solo, TILE_COLORS.ongoingFill),
    );
  });

  it("flashes every key in the band together", () => {
    // The flash overlay ignores `block` by design.
    for (const indexInBlock of [0, 1, 2]) {
      const svg = decodeTile(
        buildSvgTile({
          state: ongoing({
            flashing: true,
            block: { columns: 3, indexInBlock },
          }),
          flashOn: true,
        }),
      );
      expect(rectWidth(svg, TILE_COLORS.flash)).toBe(TILE_SIZE);
    }
  });
});

describe("buildSvgTile — alert variant", () => {
  it("renders blank for idle and noCalendars", () => {
    for (const state of [
      { mode: "idle", footerBand: FOOTER_BAND_NONE },
      { mode: "noCalendars" },
    ] satisfies RenderState[]) {
      const tile = buildSvgTile({ state, variant: "alert" });
      expect(isDataUrl(tile)).toBe(true);
      const svg = decodeTile(tile);
      expect(svg).not.toContain("<text");
      expect(rectWidth(svg, TILE_COLORS.bg)).toBe(TILE_SIZE);
    }
  });

  it("stays blank for an upcoming meeting outside the imminent window", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: upcoming({ remainingMs: 30 * MINUTE }),
        variant: "alert",
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.upcomingFill)).toBeNull();
    expect(svg).not.toContain("<text");
  });

  it("shows a bare yellow slice inside the imminent window", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: upcoming({ remainingMs: 2.5 * MINUTE }),
        variant: "alert",
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.upcomingFill)).toBe(TILE_SIZE / 2);
    // No chrome: no countdown text, no progress bar.
    expect(svg).not.toContain("<text");
    expect(rectWidth(svg, TILE_COLORS.topBar)).toBeNull();
  });

  it("shows a bare green slice during an ongoing meeting", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: ongoing({ remainingMs: 15 * MINUTE }),
        variant: "alert",
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.ongoingFill)).toBe(TILE_SIZE / 2);
    expect(svg).not.toContain("<text");
  });

  it("suppresses the footer band that the normal variant would draw", () => {
    const svg = decodeTile(
      buildSvgTile({
        state: ongoing({ footerBand: { kind: "focus", title: "Deep work" } }),
        variant: "alert",
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.bandFocus)).toBeNull();
    expect(svg).not.toContain("Deep work");
  });

  it("shows the full flash treatment when a meeting starts", () => {
    // The one moment the alert key is meant to shout.
    const svg = decodeTile(
      buildSvgTile({
        state: ongoing({ flashing: true }),
        flashOn: true,
        variant: "alert",
      }),
    );
    expect(rectWidth(svg, TILE_COLORS.flash)).toBe(TILE_SIZE);
    expect(svg).toContain("NOW");
  });

  it("sweeps the ongoing band across adjacent alert keys", () => {
    const slice = (indexInBlock: number) =>
      decodeTile(
        buildSvgTile({
          state: ongoing({
            totalMs: 40 * MINUTE,
            remainingMs: 10 * MINUTE,
            block: { columns: 2, indexInBlock },
          }),
          variant: "alert",
        }),
      );
    expect(rectWidth(slice(0), TILE_COLORS.ongoingFill)).toBe(TILE_SIZE);
    expect(rectWidth(slice(1), TILE_COLORS.ongoingFill)).toBe(TILE_SIZE / 2);
  });

  it("renders blank when this key's slice of the band has not arrived", () => {
    const tile = buildSvgTile({
      state: ongoing({
        totalMs: 40 * MINUTE,
        remainingMs: 30 * MINUTE,
        block: { columns: 2, indexInBlock: 1 },
      }),
      variant: "alert",
    });
    expect(rectWidth(decodeTile(tile), TILE_COLORS.ongoingFill)).toBeNull();
  });
});
