import streamDeck from "@elgato/streamdeck";
import type { GlobalSettings } from "../settings";

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  return (await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {};
}

export async function updateGlobalSettings(
  fn: (current: GlobalSettings) => GlobalSettings,
): Promise<GlobalSettings> {
  const current = await loadGlobalSettings();
  const next = fn(current);
  await streamDeck.settings.setGlobalSettings<GlobalSettings>(next);
  return next;
}

export async function acknowledgeEvent(eventId: string): Promise<void> {
  await updateGlobalSettings((g) => {
    const acked = new Set(g.acknowledgedEventIds ?? []);
    acked.add(eventId);
    return { ...g, acknowledgedEventIds: Array.from(acked) };
  });
}

export async function pruneAcknowledged(
  liveEventIds: Set<string>,
): Promise<void> {
  await updateGlobalSettings((g) => {
    const before = g.acknowledgedEventIds ?? [];
    const after = before.filter((id) => liveEventIds.has(id));
    if (after.length === before.length) return g;
    return { ...g, acknowledgedEventIds: after };
  });
}
