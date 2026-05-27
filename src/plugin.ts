import streamDeck from "@elgato/streamdeck";

import { CountdownAction } from "./actions/countdown";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new CountdownAction());

streamDeck.connect();
