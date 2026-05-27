import { spawn } from "node:child_process";
import streamDeck from "@elgato/streamdeck";
import { log } from "./log";

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";

// Calendar event fields (attachment fileUrl, conferenceUri, location,
// description) are populated by anyone who can put an event on the user's
// calendar. Restrict launches to http(s) so that a hostile invite can't
// dispatch file://, UNC paths, javascript:, ms-msdt:, etc. via the OS shell.
function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function openUrl(url: string): void {
  if (!isSafeUrl(url)) {
    log.warn("openUrl blocked: unsupported URL scheme");
    return;
  }
  try {
    streamDeck.system.openUrl(url);
  } catch (err) {
    log.error(`openUrl failed: ${err}`);
  }
}

export function openInApp(app: string, url?: string): void {
  if (url && !isSafeUrl(url)) {
    log.warn("openInApp blocked: unsupported URL scheme");
    return;
  }
  try {
    if (IS_MAC) {
      const args = ["-a", app];
      if (url) args.push(url);
      spawn("open", args, { detached: true, stdio: "ignore" }).unref();
      return;
    }
    if (IS_WIN) {
      // cmd.exe re-parses its command line and honors `&`, `|`, `^`, `<`, `>`
      // as statement separators even after Node quotes argv for CreateProcess.
      // Double-quote each arg (cmd skips metacharacters inside quotes) and
      // pass the line verbatim.
      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const parts = ["/c", "start", '""', quote(app)];
      if (url) parts.push(quote(url));
      spawn("cmd.exe", parts, {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
      }).unref();
      return;
    }
    log.warn("openInApp is only implemented for macOS and Windows.");
  } catch (err) {
    log.error(`openInApp failed: ${err}`);
  }
}
