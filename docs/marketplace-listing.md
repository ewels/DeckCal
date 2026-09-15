# Marketplace listing

Copy and assets for the Elgato Maker Console listing, kept here so the wording
is reviewed in pull requests like everything else. Nothing in this file ships
with the plugin. Rules: <https://docs.elgato.com/guidelines/products/>

## Name

DeckCal

## Description

Between 250 and 1,500 characters. The first 250 are taken as the search engine
description, so the opening block stays unformatted, and the bullets come
after. Current draft is 1,251 characters.

---

DeckCal turns a Stream Deck key into a live countdown to your next Google
Calendar meeting. A blue bar closes the gap to the meeting, a yellow fill
creeps across the key over the last few minutes, and a green bar tracks the
time left once it is under way. Give it more than one key and those fills span
the whole group as a single band, turning a row of keys into one countdown bar
you can read from across the room.

- Two actions. Meeting countdown carries the text and the bars, and follows
  the meeting you are in, the next one, or whichever matters most. Meeting
  alert is bars only, for widening the band.
- Short press joins the call in Google Meet, Zoom or Microsoft Teams, in your
  browser or an app you choose. Long press opens the first attached document.
- The key flashes as a meeting starts, until you press it or it times out.
- Out of office and focus time show as a coloured footer band, so the next
  real meeting stays visible behind them.
- Sign in to more than one Google account and tick which calendars each key
  follows.
- Read only access. Your calendar data and sign in tokens stay on your
  computer.

Requirements: Stream Deck 7.1 or later, macOS 12 or Windows 10 and above, and
a Google account. Free, no subscription.

---

## Assets

| Slot                     | Spec                           | File                                                             |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| App icon                 | PNG, 288 x 288                 | `marketplace-app-icon.png`                                       |
| Thumbnail                | PNG, 1920 x 960                | `marketplace-thumbnail.png`                                      |
| Gallery (3 to 10)        | PNG, 1920 x 960                | `marketplace-1.png`, `marketplace-2.png`, `marketplace-3.png`    |
| Gallery video (optional) | MP4, 1920 x 1080, under 250 MB | none yet: `examples/sweep.mp4` is 872 x 480, too small to submit |

Also set the privacy policy link on the product page to
<https://deckcal.ewels.co.uk/privacy/>.
