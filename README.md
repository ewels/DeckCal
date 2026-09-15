<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="DeckCal" width="320">
  </picture>
</p>

<p align="center">
  <a href="https://deckcal.ewels.co.uk/">deckcal.ewels.co.uk</a>
</p>

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that turns one key,
or a whole row of them, into a live indicator for your Google Calendar. The key
counts down to your next meeting, or the time left in the one you are in, with
a progress bar across the top and a yellow fill over the last few minutes.
Press it to join the meeting, or to open the next meeting's notes.

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

Short press clears the flashing `NOW` and another joins the current meeting (Google Meet, Zoom, or Teams).
Long press opens the meeting's first attached doc, falling back to the
event detail page.

## Multi-key sweep

https://github.com/user-attachments/assets/42d28e97-5eb9-4187-94fb-ffbc773e179a

If you place two or more DeckCal keys side by side with their edges touching
(vertically and / or horizontally) will show the yellow run-up bar and
the green in-meeting bars spanning the whole group.

Mix **Meeting countdown** and **Meeting alert** keys to pick which ones carry
the text and which are only the background-colour bar.

## Actions

|                                                                                         | Action                | What it shows                                                                                                |
| :-------------------------------------------------------------------------------------: | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| <img src="com.ewels.deckcal.sdPlugin/imgs/actions/countdown/key.svg" alt="" width="56"> | **Meeting countdown** | Countdown text, meeting title, progress bars, press to join.                                                 |
|   <img src="com.ewels.deckcal.sdPlugin/imgs/actions/alert/key.svg" alt="" width="56">   | **Meeting alert**     | The same bars but without any text: blank until a meeting is close. Used to make the countdown sweep larger. |

**Meeting countdown** has a **Show** setting that picks which meetings it
follows:

- **Current meeting, else the next one** (default): whichever is most relevant.
- **Next meeting only**: ignores a meeting that is already under way.
- **Current meeting only**: idle when you are not in a meeting.

## Installation

Download the latest `com.ewels.deckcal.streamDeckPlugin` from the
[releases page](https://github.com/ewels/deckcal/releases), double-click to
install in Stream Deck, drag **Meeting countdown** onto a key, click the
gear icon, and **Sign in with Google**.

See [contribution guidelines](CONTRIBUTING.md) if you want to build from source.

## Property inspector

In the Stream Deck app, drag the "Meeting countdown" action onto a key, then
click the gear icon to open settings:

- **Show**: which meetings this key follows. The current one falling back to
  the next (default), only the next, or only the current.
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
