import { describe, expect, it } from "vitest";
import { ev } from "../test-utils";
import { detectConference, pickAttachment, withAuthUser } from "./conferencing";

describe("detectConference — Google Meet", () => {
  it("prefers hangoutLink above everything else", () => {
    const c = detectConference(
      ev({
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        conferenceUri: "https://acme.zoom.us/j/999",
        location: "https://acme.zoom.us/j/111",
      }),
    );
    expect(c).toEqual({
      provider: "meet",
      url: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("recognises a Meet URL in conferenceUri", () => {
    expect(
      detectConference(
        ev({ conferenceUri: "https://meet.google.com/xyz-1234-abc" }),
      ),
    ).toEqual({
      provider: "meet",
      url: "https://meet.google.com/xyz-1234-abc",
    });
  });
});

describe("detectConference — Zoom", () => {
  it("finds a Zoom link in the location field", () => {
    expect(
      detectConference(ev({ location: "https://acme.zoom.us/j/1234567890" })),
    ).toEqual({ provider: "zoom", url: "https://acme.zoom.us/j/1234567890" });
  });

  it("finds a Zoom link buried in the description", () => {
    const c = detectConference(
      ev({
        description:
          "Agenda attached.\nJoin: https://acme.zoom.us/j/98765?pwd=Sekret\nDial in: +44...",
      }),
    );
    expect(c).toEqual({
      provider: "zoom",
      url: "https://acme.zoom.us/j/98765?pwd=Sekret",
    });
  });

  it("accepts the /my and /w personal-room forms", () => {
    expect(
      detectConference(ev({ location: "https://zoom.us/my/philewels" })),
    ).toEqual({ provider: "zoom", url: "https://zoom.us/my/philewels" });
    expect(
      detectConference(ev({ location: "https://acme.zoom.us/w/555" })),
    ).toEqual({ provider: "zoom", url: "https://acme.zoom.us/w/555" });
  });

  it("does not mistake a Zoom marketing link for a meeting", () => {
    // No /j//my//w path segment, so it must not match.
    expect(
      detectConference(ev({ location: "https://zoom.us/pricing" })),
    ).toBeNull();
  });

  it("stops the URL at surrounding punctuation", () => {
    const c = detectConference(
      ev({ description: "(see https://acme.zoom.us/j/42) for details" }),
    );
    expect(c).toEqual({ provider: "zoom", url: "https://acme.zoom.us/j/42" });
  });
});

describe("detectConference — Teams", () => {
  it("finds a Teams meetup-join link", () => {
    const url =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0";
    expect(detectConference(ev({ location: url }))).toEqual({
      provider: "teams",
      url,
    });
  });

  it("ignores other teams.microsoft.com links", () => {
    expect(
      detectConference(
        ev({ location: "https://teams.microsoft.com/l/channel/19%3aabc" }),
      ),
    ).toBeNull();
  });
});

describe("detectConference — precedence and fallbacks", () => {
  it("prefers Zoom over Teams when both appear", () => {
    const c = detectConference(
      ev({
        location: "https://acme.zoom.us/j/1",
        description:
          "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0",
      }),
    );
    expect(c?.provider).toBe("zoom");
  });

  it("finds a Zoom link that arrived via conferenceUri", () => {
    // conferenceUri is part of the searched haystack, so a third-party Zoom
    // conference is classified as Zoom rather than falling through to Meet.
    expect(
      detectConference(ev({ conferenceUri: "https://acme.zoom.us/j/777" })),
    ).toEqual({ provider: "zoom", url: "https://acme.zoom.us/j/777" });
  });

  it("treats an unrecognised conferenceUri as Meet", () => {
    // Documented fallback: an unknown conferencing provider is still worth
    // opening, and Meet's handler is the URL default.
    expect(
      detectConference(ev({ conferenceUri: "https://whereby.com/room-42" })),
    ).toEqual({ provider: "meet", url: "https://whereby.com/room-42" });
  });

  it("returns null when there is nothing to join", () => {
    expect(detectConference(ev())).toBeNull();
    expect(
      detectConference(
        ev({
          location: "Meeting room 3, 2nd floor",
          description: "Bring notes",
        }),
      ),
    ).toBeNull();
  });
});

describe("pickAttachment", () => {
  it("returns the first attachment's URL", () => {
    const url = pickAttachment(
      ev({
        attachments: [
          { fileUrl: "https://docs.google.com/document/d/first" },
          { fileUrl: "https://docs.google.com/document/d/second" },
        ],
      }),
    );
    expect(url).toBe("https://docs.google.com/document/d/first");
  });

  it("returns null when there are no attachments", () => {
    expect(pickAttachment(ev())).toBeNull();
  });
});

describe("withAuthUser", () => {
  it("adds the account email to Google URLs", () => {
    expect(
      withAuthUser("https://meet.google.com/abc-defg-hij", "me@example.com"),
    ).toBe("https://meet.google.com/abc-defg-hij?authuser=me%40example.com");
    expect(
      withAuthUser(
        "https://www.google.com/calendar/event?eid=xyz&authuser=0",
        "me@example.com",
      ),
    ).toBe(
      "https://www.google.com/calendar/event?eid=xyz&authuser=me%40example.com",
    );
  });

  it("leaves non-Google URLs, bad URLs and unknown accounts alone", () => {
    for (const url of [
      "https://acme.zoom.us/j/999",
      "https://evilgoogle.com/x",
      "not a url",
    ]) {
      expect(withAuthUser(url, "me@example.com")).toBe(url);
    }
    expect(withAuthUser("https://meet.google.com/x", undefined)).toBe(
      "https://meet.google.com/x",
    );
  });
});
