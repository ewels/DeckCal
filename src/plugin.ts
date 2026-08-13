import streamDeck from "@elgato/streamdeck";

import {
  AlertAction,
  CountdownAction,
  OngoingAction,
  UpcomingAction,
} from "./actions/countdown";

// "debug", not "trace": outside Stream Deck's debug mode the SDK caps the
// logger at a minimum level of "debug", and asking for anything finer makes
// setLevel silently clamp all the way back to "info" (see
// @elgato/utils logging/logger.js). Requesting "trace" therefore *suppressed*
// every debug log rather than enabling more of them.
streamDeck.logger.setLevel("debug");

streamDeck.actions.registerAction(new CountdownAction());
streamDeck.actions.registerAction(new UpcomingAction());
streamDeck.actions.registerAction(new OngoingAction());
streamDeck.actions.registerAction(new AlertAction());

streamDeck.connect();
