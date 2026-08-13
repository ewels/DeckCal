import { describe, expect, it } from "vitest";
import {
  type CountdownSettings,
  DEFAULTS,
  migrateSettings,
  optionalNumber,
  resolveNextMeeting,
  resolveProvider,
  retainAccounts,
  toNumber,
} from "./settings";

describe("toNumber", () => {
  it("passes through finite non-negative numbers", () => {
    expect(toNumber(5, 1)).toBe(5);
    expect(toNumber(0, 1)).toBe(0);
    expect(toNumber(2.5, 1)).toBe(2.5);
  });

  it("parses the strings sdpi-textfield actually stores", () => {
    expect(toNumber("7", 1)).toBe(7);
    expect(toNumber("2.5", 1)).toBe(2.5);
  });

  it("falls back for missing, empty, negative and unparseable values", () => {
    expect(toNumber(undefined, 1)).toBe(1);
    expect(toNumber("", 1)).toBe(1);
    expect(toNumber("abc", 1)).toBe(1);
    expect(toNumber("-3", 1)).toBe(1);
    expect(toNumber(-3, 1)).toBe(1);
    expect(toNumber(Number.NaN, 1)).toBe(1);
    expect(toNumber(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });
});

describe("optionalNumber", () => {
  // The three-state contract: untouched vs explicitly cleared vs set.
  it("returns the undefined-default when the field was never touched", () => {
    expect(optionalNumber(undefined)).toBeNull();
    expect(optionalNumber(undefined, 4)).toBe(4);
    expect(optionalNumber(null, 4)).toBe(4);
  });

  it("returns null when the user explicitly cleared the field", () => {
    // Distinct from untouched: a cleared field disables the feature even when
    // a default was supplied.
    expect(optionalNumber("", 4)).toBeNull();
    expect(optionalNumber("   ", 4)).toBeNull();
  });

  it("returns the parsed value when set", () => {
    expect(optionalNumber("7", 4)).toBe(7);
    expect(optionalNumber(0, 4)).toBe(0);
  });

  it("returns null for invalid values rather than the default", () => {
    expect(optionalNumber("abc", 4)).toBeNull();
    expect(optionalNumber(-1, 4)).toBeNull();
    expect(optionalNumber(Number.NaN, 4)).toBeNull();
  });
});

describe("migrateSettings", () => {
  it("lifts a legacy single account into accounts[]", () => {
    const { next, changed } = migrateSettings({
      account: { sub: "s1", email: "a@example.com" },
    });
    expect(changed).toBe(true);
    expect(next.accounts).toEqual([{ sub: "s1", email: "a@example.com" }]);
    expect(next.account).toBeUndefined();
  });

  it("qualifies legacy calendarIds with the migrated account's sub", () => {
    const { next, changed } = migrateSettings({
      account: { sub: "s1", email: "a@example.com" },
      calendarIds: ["primary", "team@group.calendar.google.com"],
    });
    expect(changed).toBe(true);
    expect(next.calendarSelections).toEqual([
      { accountSub: "s1", calendarId: "primary" },
      { accountSub: "s1", calendarId: "team@group.calendar.google.com" },
    ]);
    expect(next.calendarIds).toBeUndefined();
  });

  it("leaves legacy calendarIds alone when there is no account to attribute them to", () => {
    const { next } = migrateSettings({ calendarIds: ["primary"] });
    expect(next.calendarSelections).toBeUndefined();
    expect(next.calendarIds).toEqual(["primary"]);
  });

  it("inverts ignoreAllDay into includeAllDay", () => {
    expect(migrateSettings({ ignoreAllDay: true }).next.includeAllDay).toBe(
      false,
    );
    expect(migrateSettings({ ignoreAllDay: false }).next.includeAllDay).toBe(
      true,
    );
    expect(
      migrateSettings({ ignoreAllDay: true }).next.ignoreAllDay,
    ).toBeUndefined();
  });

  it("does not clobber a modern value with a legacy one", () => {
    const { next } = migrateSettings({
      account: { sub: "old", email: "old@example.com" },
      accounts: [{ sub: "new", email: "new@example.com" }],
      ignoreAllDay: true,
      includeAllDay: true,
    });
    expect(next.accounts).toEqual([{ sub: "new", email: "new@example.com" }]);
    expect(next.includeAllDay).toBe(true);
  });

  it("reports no change for already-migrated settings", () => {
    const settings: CountdownSettings = {
      accounts: [{ sub: "s1", email: "a@example.com" }],
      calendarSelections: [{ accountSub: "s1", calendarId: "primary" }],
      includeAllDay: false,
    };
    const { next, changed } = migrateSettings(settings);
    expect(changed).toBe(false);
    expect(next).toEqual(settings);
  });
});

describe("retainAccounts", () => {
  const twoAccounts: CountdownSettings = {
    accounts: [
      { sub: "a", email: "a@example.com" },
      { sub: "b", email: "b@example.com" },
    ],
    calendarSelections: [
      { accountSub: "a", calendarId: "primary" },
      { accountSub: "b", calendarId: "primary" },
    ],
  };

  it("drops accounts and their calendar selections together", () => {
    const next = retainAccounts(twoAccounts, (sub) => sub === "a");
    expect(next.accounts).toEqual([{ sub: "a", email: "a@example.com" }]);
    expect(next.calendarSelections).toEqual([
      { accountSub: "a", calendarId: "primary" },
    ]);
  });

  it("resets selections to unconfigured when the last one's account disappears", () => {
    // Losing every selection because the account went away must not pin the
    // key to the noCalendars state forever: that is reserved for a user who
    // deliberately unticked everything.
    const next = retainAccounts(twoAccounts, () => false);
    expect(next.accounts).toEqual([]);
    expect(next.calendarSelections).toBeUndefined();
  });

  it("preserves a deliberately empty selection array", () => {
    const next = retainAccounts(
      {
        accounts: [{ sub: "a", email: "a@example.com" }],
        calendarSelections: [],
      },
      () => true,
    );
    expect(next.calendarSelections).toEqual([]);
  });

  it("tolerates settings with no accounts at all", () => {
    const next = retainAccounts({}, () => true);
    expect(next.accounts).toEqual([]);
    expect(next.calendarSelections).toBeUndefined();
  });
});

describe("resolveProvider", () => {
  it("defaults every provider to a URL launch", () => {
    for (const p of ["meet", "zoom", "teams"] as const) {
      expect(resolveProvider({}, p)).toEqual({ type: "url" });
    }
  });

  it("resolves each provider's app independently", () => {
    const settings: CountdownSettings = {
      providerMeetType: "app",
      providerMeetApp: "Google Chrome",
      providerZoomType: "app",
      providerZoomApp: "zoom.us",
      providerTeamsType: "url",
      providerTeamsApp: "Microsoft Teams",
    };
    expect(resolveProvider(settings, "meet")).toEqual({
      type: "app",
      app: "Google Chrome",
    });
    expect(resolveProvider(settings, "zoom")).toEqual({
      type: "app",
      app: "zoom.us",
    });
    // type is "url", so the stale app name must be ignored.
    expect(resolveProvider(settings, "teams")).toEqual({ type: "url" });
  });

  it("falls back to URL when type is app but no app was named", () => {
    expect(resolveProvider({ providerZoomType: "app" }, "zoom")).toEqual({
      type: "url",
    });
  });
});

describe("resolveNextMeeting", () => {
  it("defaults to Google Calendar", () => {
    expect(resolveNextMeeting({})).toEqual({
      type: "url",
      url: DEFAULTS.nextMeetingActionUrl,
    });
  });

  it("trims the configured URL and falls back when it is blank", () => {
    expect(
      resolveNextMeeting({ nextMeetingUrl: "  https://x.test  " }),
    ).toEqual({ type: "url", url: "https://x.test" });
    expect(resolveNextMeeting({ nextMeetingUrl: "   " })).toEqual({
      type: "url",
      url: DEFAULTS.nextMeetingActionUrl,
    });
  });

  it("returns an app launch when configured", () => {
    expect(
      resolveNextMeeting({
        nextMeetingActionType: "app",
        nextMeetingApp: "Fantastical",
      }),
    ).toEqual({ type: "app", app: "Fantastical" });
  });

  it("falls back to URL when type is app but no app was named", () => {
    expect(resolveNextMeeting({ nextMeetingActionType: "app" })).toEqual({
      type: "url",
      url: DEFAULTS.nextMeetingActionUrl,
    });
  });
});
