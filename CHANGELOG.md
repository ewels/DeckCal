# Changelog

## v0.1.0 (unreleased)

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
