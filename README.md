<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="DeckCal" width="320">
  </picture>
</p>

<p align="center">
  <a href="https://deckcal.ewels.co.uk/">deckcal.ewels.co.uk</a>
</p>

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that turns a key
into a live indicator for your Google Calendar. The key shows a countdown to
the next meeting (or remaining time in the current one), with a progress bar
across the top, a yellow fill in the last few minutes before it starts, and a
footer band for out-of-office or focus-time overlaps. Press the key to join
the current meeting, open the meeting URL in a chosen app, or open the next
meeting's notes doc.

## Features

|                                                                   |                                                                                                      |
| :---------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------- |
|     <img src="docs/examples/no_event.png" alt="" width="120">     | **Idle.**<br>Nothing on the calendar today any time soon.                                            |
|    <img src="docs/examples/future_23m.png" alt="" width="120">    | **Countdown to the next meeting.**<br>Time remaining, with a blue bar.                               |
|    <img src="docs/examples/future_3m.png" alt="" width="120">     | **Imminent.**<br>In the last 5 minutes a yellow block gradually fills the key.                       |
|   <img src="docs/examples/meeting_now.gif" alt="" width="120">    | **Meeting starts.**<br>Flashes `NOW` until you press. Pressing opens the meeting.                    |
| <img src="docs/examples/ongoing_18m_left.png" alt="" width="120"> | **In the meeting.**<br>Time remaining, green bar shows time elapsed.                                 |
| <img src="docs/examples/tomorrow_dimmed.png" alt="" width="120">  | **Beyond today.**<br>Distant events are dimmed, events tomorrow get time of day instead of countdown |
|    <img src="docs/examples/focus_time.png" alt="" width="120">    | **Focus time.**<br>Purple footer band, so you can still see the next regular meeting.                |
|  <img src="docs/examples/out_of_office.png" alt="" width="120">   | **Out of office.**<br>Grey footer band so you can see the next meeting.                              |

### Multi-key sweep

https://github.com/user-attachments/assets/42d28e97-5eb9-4187-94fb-ffbc773e179a

Place two or more **Meeting countdown** (or **Upcoming meeting**) keys next
to each other and the yellow imminent-fill bar sweeps across them as a
single band in the last 5 minutes before a meeting. A much more visible cue
than a single key can give on its own.

Short press clears the flashing `NOW` and another joins the current meeting (Google Meet, Zoom, or Teams).
Long press opens the meeting's first attached doc, falling back to the
event detail page.

## Actions

|                                                                                         | Action                | What it shows                                                                                                                         |
| :-------------------------------------------------------------------------------------: | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="com.ewels.deckcal.sdPlugin/imgs/actions/countdown/key.svg" alt="" width="56"> | **Meeting countdown** | The ongoing meeting if you're in one, otherwise the next upcoming meeting. Shows yellow background block. The "do everything" action. |
|   <img src="com.ewels.deckcal.sdPlugin/imgs/actions/alert/key.svg" alt="" width="56">   | **Meeting alert**     | Blank tile that only shows the yellow bar and lights up the moment a meeting starts. Good for making a larger imminent-meeting bar.   |
| <img src="com.ewels.deckcal.sdPlugin/imgs/actions/upcoming/key.svg" alt="" width="56">  | **Upcoming meeting**  | Only the next upcoming meeting. Ignores meetings already in progress.                                                                 |
|  <img src="com.ewels.deckcal.sdPlugin/imgs/actions/ongoing/key.svg" alt="" width="56">  | **Ongoing meeting**   | Only the meeting you're currently in. Idle when nothing is happening.                                                                 |

## Installation

Download the latest `com.ewels.deckcal.streamDeckPlugin` from the
[releases page](https://github.com/ewels/deckcal/releases), double-click to
install in Stream Deck, drag **Meeting countdown** onto a key, click the
gear icon, and **Sign in with Google**.

See [contribution guidelines](CONTRIBUTING.md) if you want to build from source.

## Property inspector

In the Stream Deck app, drag the "Meeting countdown" action onto a key, then
click the gear icon to open settings:

- **Accounts**: Sign in with one or more Google accounts. Add additional
  ones with **Add another account**.
- **Calendars** :Tick which calendars feed the countdown, grouped per
  account. Primary is auto-selected on first sign-in.
- **Behavior**: Long-press threshold, imminent-fill window, what happens
  when a meeting starts (flash until pressed, or silent transition), and how
  long to flash before auto-dismissing.
- **Next meeting press**: URL or app to launch when there is no ongoing
  meeting. Defaults to <https://calendar.google.com>.
- **Join meeting press**: For Google Meet / Zoom / Teams individually,
  choose URL or app. On macOS the app field is passed to `open -a`; on
  Windows it goes to `start ""`.
- **Filters**: Include all-day / tentative / declined events; horizon
  beyond which to drop or dim distant future events.
- **Special events**: How to handle out-of-office and focus-time events:
  footer band only (default), ignore completely, or treat as a normal event.

## License

Open source: MIT.
