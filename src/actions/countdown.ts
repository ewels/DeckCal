import {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type SendToPluginEvent,
  SingletonAction,
  streamDeck,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import {
  authorize,
  loadGlobalSettings,
  removeAccount,
  saveAccount,
} from "../calendar/auth";
import type { CalendarEvent, CalendarSummary } from "../calendar/client";
import { detectConference, pickAttachment } from "../calendar/conferencing";
import type { SelectionMode } from "../calendar/selection";
import type { RenderVariant } from "../render/icon";
import {
  accountNeedsAuth,
  acknowledgeForKey,
  addAccountToKeys,
  dropAccount,
  forceRefresh,
  getPressContextForKey,
  listKnownCalendars,
  registerKey,
  removeAccountFromKeys,
  unregisterKey,
  updateKeySettings,
} from "../runtime/runtime";
import {
  type Account,
  type CountdownSettings,
  DEFAULTS,
  migrateSettings,
  resolveNextMeeting,
  resolveProvider,
  retainAccounts,
  toNumber,
} from "../settings";
import { openInApp, openUrl } from "../util/launch";
import { log } from "../util/log";

type CalendarsByAccount = Record<
  string,
  { email: string; items: CalendarSummary[]; authRequired: boolean }
>;

type IncomingMessage =
  | { kind: "startAuth" }
  | { kind: "signOut"; sub?: string }
  | { kind: "listCalendars" }
  | { kind: "getVariant" };

type PaneVariant = SelectionMode | "alert";

type OutgoingMessage =
  | { kind: "authResult"; ok: true; account: Account }
  | { kind: "authResult"; ok: false; error: string }
  | { kind: "calendars"; byAccount: CalendarsByAccount }
  | { kind: "signedOut" }
  | { kind: "variant"; variant: PaneVariant };

abstract class BaseCountdownAction extends SingletonAction<CountdownSettings> {
  protected abstract readonly selectionMode: SelectionMode;
  protected readonly renderVariant: RenderVariant = "normal";

  private readonly longPressTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; fired: boolean }
  >();

  override async onWillAppear(
    ev: WillAppearEvent<CountdownSettings>,
  ): Promise<void> {
    if (!ev.action.isKey()) return;

    // Migrate legacy single-account fields (`account`, `calendarIds`) to the
    // multi-account shape on every appear so older keys stay compatible.
    const migration = migrateSettings(ev.payload.settings);
    let settings = migration.next;

    const global = await loadGlobalSettings();
    const known = new Set(Object.keys(global.accounts ?? {}));

    // Self-heal: drop any accounts signed out from another tile while this key
    // wasn't visible, so it doesn't show a permanent sign-in icon for an
    // account that no longer exists globally.
    const before = settings.accounts ?? [];
    if (before.some((a) => !known.has(a.sub))) {
      settings = retainAccounts(settings, (sub) => known.has(sub));
    }

    // A freshly-dropped key with no accounts: adopt every account already
    // signed in globally, so the user doesn't have to re-auth. Only when the
    // key was originally empty, not when pruning just emptied it, so a key
    // tied to a since-removed account doesn't silently adopt a different one.
    if (before.length === 0) {
      const stored = Object.entries(global.accounts ?? {});
      if (stored.length > 0) {
        settings = {
          ...settings,
          accounts: stored.map(([sub, a]) => ({ sub, email: a.email })),
        };
      }
    }

    if (migration.changed || settings !== ev.payload.settings) {
      await ev.action.setSettings(settings);
    }
    registerKey(ev.action, settings, this.selectionMode, this.renderVariant);
  }

  override async onWillDisappear(
    ev: WillDisappearEvent<CountdownSettings>,
  ): Promise<void> {
    const pending = this.longPressTimers.get(ev.action.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.longPressTimers.delete(ev.action.id);
    }
    unregisterKey(ev.action.id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<CountdownSettings>,
  ): Promise<void> {
    updateKeySettings(ev.action.id, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<CountdownSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const threshold = toNumber(
      settings.longPressThresholdMs,
      DEFAULTS.longPressThresholdMs,
    );
    const state = {
      timer: null as unknown as ReturnType<typeof setTimeout>,
      fired: false,
    };
    state.timer = setTimeout(() => {
      state.fired = true;
      void this.handleLongPress(ev);
    }, threshold);
    this.longPressTimers.set(ev.action.id, state);

    // Any press dismisses the start-of-meeting flash, even if it ends up being
    // a long press — the user has clearly seen the alert.
    void acknowledgeForKey(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<CountdownSettings>): Promise<void> {
    const state = this.longPressTimers.get(ev.action.id);
    if (state) {
      clearTimeout(state.timer);
      this.longPressTimers.delete(ev.action.id);
      if (state.fired) return;
    }
    await this.handleShortPress(ev);
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<JsonValue, CountdownSettings>,
  ): Promise<void> {
    const msg = ev.payload as IncomingMessage;
    if (!msg || typeof msg !== "object" || !("kind" in msg)) return;

    if (msg.kind === "startAuth") {
      if (ev.action.isKey()) await this.runAuthFlow(ev.action);
      return;
    }

    if (msg.kind === "signOut") {
      if (!ev.action.isKey()) return;
      // Sign-out is global to the account: remove it from every key, not just
      // this one, so all tiles stay in sync instead of flipping to the
      // sign-in icon while still listing the removed account. Targeted
      // sign-out (by sub) removes just that account; legacy signOut with no
      // sub removes all (backwards compatibility with older PI builds).
      const removedSubs = new Set(await removeAccountFromKeys(msg.sub ?? null));
      // The current key always carries the target sub, but guard against the
      // edge where it wasn't matched so the global token still gets cleaned.
      if (msg.sub) removedSubs.add(msg.sub);
      for (const sub of removedSubs) {
        await removeAccount(sub);
        dropAccount(sub);
      }
      await this.send(ev, { kind: "signedOut" });
      // Refresh PI calendars list (now without the removed account).
      await this.sendCalendars(ev);
      return;
    }

    if (msg.kind === "listCalendars") {
      if (!ev.action.isKey()) return;
      await this.sendCalendars(ev);
      return;
    }

    if (msg.kind === "getVariant") {
      const variant: PaneVariant =
        this.renderVariant === "alert" ? "alert" : this.selectionMode;
      await this.send(ev, { kind: "variant", variant });
      return;
    }
  }

  private async buildCalendarsByAccount(
    accounts: Account[],
  ): Promise<CalendarsByAccount> {
    const entries = await Promise.all(
      accounts.map(async (acct) => {
        const items = await listKnownCalendars(acct.sub);
        // Read auth state after the list attempt — listKnownCalendars sets it.
        const authRequired = accountNeedsAuth(acct.sub);
        return [acct.sub, { email: acct.email, items, authRequired }] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  private async sendCalendars(
    ev: SendToPluginEvent<JsonValue, CountdownSettings>,
  ): Promise<void> {
    if (!ev.action.isKey()) return;
    const current = await ev.action.getSettings();
    const byAccount = await this.buildCalendarsByAccount(
      current.accounts ?? [],
    );
    await this.send(ev, { kind: "calendars", byAccount });
  }

  private async send(
    _ev: SendToPluginEvent<JsonValue, CountdownSettings>,
    msg: OutgoingMessage,
  ): Promise<void> {
    await streamDeck.ui.sendToPropertyInspector(msg as unknown as JsonValue);
  }

  // Press model dispatch table:
  //
  //   state          short                long
  //   no-accounts    runAuthFlow          —
  //   idle           next-meeting         —
  //   upcoming       next-meeting         notes (if attachment)
  //   flashing       (ack on keyDown)     join (+ ack on keyDown)
  //   ongoing        join                 notes (fallback htmlLink)
  protected async handleShortPress(
    ev: KeyUpEvent<CountdownSettings>,
  ): Promise<void> {
    const settings = ev.payload.settings;
    const { state, selection } = await getPressContextForKey(ev.action.id);

    if (state === "no-accounts") {
      await this.runAuthFlow(ev.action);
      return;
    }
    if (state === "idle" || state === "upcoming") {
      this.runNextMeetingAction(settings);
      return;
    }
    if (state === "flashing") return; // ack already fired on keyDown
    if (selection?.mode === "ongoing") {
      this.joinMeeting(selection.event, settings);
    }
  }

  protected async handleLongPress(
    ev: KeyDownEvent<CountdownSettings>,
  ): Promise<void> {
    const settings = ev.payload.settings;
    const { state, selection } = await getPressContextForKey(ev.action.id);

    if (state === "no-accounts" || state === "idle") return;
    if (!selection || selection.mode === "idle") return;

    if (state === "flashing") {
      this.joinMeeting(selection.event, settings);
      return;
    }
    this.openNotes(selection.event);
  }

  protected joinMeeting(
    event: CalendarEvent,
    settings: CountdownSettings,
  ): void {
    const conf = detectConference(event);
    if (!conf) {
      if (event.htmlLink) openUrl(event.htmlLink);
      return;
    }
    const handler = resolveProvider(settings, conf.provider);
    if (handler.type === "app") {
      openInApp(handler.app, conf.url);
    } else {
      openUrl(conf.url);
    }
  }

  private openNotes(event: CalendarEvent): void {
    const attachment = pickAttachment(event);
    if (attachment) {
      openUrl(attachment);
      return;
    }
    if (event.htmlLink) openUrl(event.htmlLink);
  }

  private runNextMeetingAction(settings: CountdownSettings): void {
    const a = resolveNextMeeting(settings);
    if (a.type === "app") {
      openInApp(a.app, a.arg);
    } else {
      openUrl(a.url);
    }
  }

  protected async runAuthFlow(
    action: KeyAction<CountdownSettings>,
  ): Promise<void> {
    try {
      const info = await authorize();
      await saveAccount(info);
      const account: Account = { sub: info.sub, email: info.email };
      // Resolve the new account's primary calendar so keys that already carry
      // explicit calendar selections can seed it; without that the account is
      // attached but contributes no events.
      const cals = await listKnownCalendars(info.sub);
      const primaryId = cals.find((c) => c.primary)?.id ?? null;
      // Sign-in is global to the account: attach it to every registered key,
      // not just this one, so all tiles pick up the new account and stay in
      // sync (the mirror of the global sign-out path).
      await addAccountToKeys(account, primaryId);
      // Rebuild the PI calendar list from this key's freshly-synced accounts;
      // guard against getSettings lagging the in-memory sync above.
      const current = await action.getSettings();
      const synced = current.accounts ?? [];
      const nextAccounts: Account[] = synced.some((a) => a.sub === info.sub)
        ? synced
        : [...synced, account];
      forceRefresh();
      // Tell the PI which account just signed in, then push the full
      // (multi-account) calendar list. No-op if the PI isn't open.
      await streamDeck.ui.sendToPropertyInspector({
        kind: "authResult",
        ok: true,
        account,
      } as unknown as JsonValue);
      const byAccount = await this.buildCalendarsByAccount(nextAccounts);
      await streamDeck.ui.sendToPropertyInspector({
        kind: "calendars",
        byAccount,
      } as unknown as JsonValue);
    } catch (err) {
      // googleapis/gaxios errors hide useful detail in response.data — log it.
      const detail = (err as { response?: { data?: unknown } })?.response?.data;
      log.error(
        `Auth failed: ${err instanceof Error ? err.message : String(err)} ${
          detail ? `(detail: ${JSON.stringify(detail)})` : ""
        }`,
      );
      let message = err instanceof Error ? err.message : String(err);
      if (
        detail &&
        typeof detail === "object" &&
        "error_description" in (detail as object)
      ) {
        message = `${message}: ${(detail as { error_description: string }).error_description}`;
      }
      await streamDeck.ui.sendToPropertyInspector({
        kind: "authResult",
        ok: false,
        error: message,
      } as unknown as JsonValue);
    }
  }
}

@action({ UUID: "com.ewels.deckcal.countdown" })
export class CountdownAction extends BaseCountdownAction {
  protected readonly selectionMode: SelectionMode = "combined";
}

@action({ UUID: "com.ewels.deckcal.upcoming" })
export class UpcomingAction extends BaseCountdownAction {
  protected readonly selectionMode: SelectionMode = "upcoming";
}

@action({ UUID: "com.ewels.deckcal.ongoing" })
export class OngoingAction extends BaseCountdownAction {
  protected readonly selectionMode: SelectionMode = "ongoing";
}

// Blank tile that only lights up during the meeting-start flash. Every state
// other than no-accounts (sign in) and flashing (join on long press) is a
// silent no-op — the user's other DeckCal keys carry the visible interactions.
@action({ UUID: "com.ewels.deckcal.alert" })
export class AlertAction extends BaseCountdownAction {
  protected readonly selectionMode: SelectionMode = "combined";
  protected override readonly renderVariant: RenderVariant = "alert";

  protected override async handleShortPress(
    ev: KeyUpEvent<CountdownSettings>,
  ): Promise<void> {
    const { state } = await getPressContextForKey(ev.action.id);
    if (state === "no-accounts") await this.runAuthFlow(ev.action);
  }

  protected override async handleLongPress(
    ev: KeyDownEvent<CountdownSettings>,
  ): Promise<void> {
    const { state, selection } = await getPressContextForKey(ev.action.id);
    if (state !== "flashing" || selection?.mode !== "ongoing") return;
    this.joinMeeting(selection.event, ev.payload.settings);
  }
}
