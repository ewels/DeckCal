import streamDeck from "@elgato/streamdeck";

import {
  CountdownAction,
  OngoingAction,
  UpcomingAction,
} from "./actions/countdown";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new CountdownAction());
streamDeck.actions.registerAction(new UpcomingAction());
streamDeck.actions.registerAction(new OngoingAction());

streamDeck.connect();
