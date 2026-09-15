# Changelog

## v1.1.0 (unreleased)

- **Breaking:** the **Upcoming meeting** and **Ongoing meeting** actions are
  gone. **Meeting countdown** has a **Show** setting covering the same three
  jobs: the current meeting falling back to the next one (default), the next
  one only, or the current one only. A key still sitting on one of the removed
  actions will not load; replace it with **Meeting countdown** and pick the
  matching **Show** option.
- The multi-key sweep is now described where people actually see it: the
  plugin description, the README opening, and the top of the website, rather
  than in a subsection halfway down. The green in-meeting band is part of that
  description now too, alongside the yellow run-up band.
- The action list icons follow Elgato's icon guidelines: monochrome white on
  a transparent background, SVG only. The yellow bell, amber arrow and green
  play triangle were the only colour left in them.
- Clearer wording for **Meeting alert** everywhere it is described: it also
  carries the yellow run-up fill and the green in-meeting bar, not just the
  flash as a meeting starts.

## v1.0.0 (2026-08-17)

First release.

- Four actions: **Meeting countdown** (the meeting you are in, otherwise the
  next one), **Upcoming meeting**, **Ongoing meeting**, and **Meeting alert**
  (a blank tile that lights up only as a meeting starts).
- A live countdown on the key, refreshed every second from a 60 second Google
  Calendar poll.
- Progress cues on the tile: a blue bar closing the gap to the next meeting, a
  yellow fill over the last 5 minutes before it starts, and a green fill
  tracking elapsed time once it is under way.
- Put matching keys next to each other and the yellow and green fills sweep
  across them as one band.
- A yellow flash when a meeting starts, cleared by pressing the key or
  automatically after a few minutes.
- Short press joins the meeting (Google Meet, Zoom, or Teams) by URL or in an
  app of your choosing. Long press opens the first attached document.
- Sign in to one or more Google accounts, and pick which calendars each key
  follows.
- A **Refresh now** button in the settings panel, for when you have just
  changed something in Google Calendar and do not want to wait for the next
  60 second check.
- Out of office and focus time appear as a coloured footer band, so the next
  real meeting stays visible behind them.
- Filters for all day, tentative, and declined events, plus a horizon for
  dimming or hiding events too far out to matter.
