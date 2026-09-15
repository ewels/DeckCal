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

// Returns false when the launch could not be dispatched, so the caller can
// flag it on the key with showAlert(). A launch that fails *after* dispatch
// (the app is missing, the browser refuses the URL) is only visible on the
// spawned process's error event, so that path logs rather than returns.
export function openUrl(url: string): boolean {
  if (!isSafeUrl(url)) {
    log.warn("openUrl blocked: unsupported URL scheme");
    return false;
  }
  try {
    streamDeck.system.openUrl(url);
    return true;
  } catch (err) {
    log.error(`openUrl failed: ${err}`);
    return false;
  }
}

export function openInApp(app: string, url?: string): boolean {
  if (url && !isSafeUrl(url)) {
    log.warn("openInApp blocked: unsupported URL scheme");
    return false;
  }
  try {
    if (IS_MAC) {
      const args = ["-a", app];
      if (url) args.push(url);
      spawnDetached("open", args);
      return true;
    }
    if (IS_WIN) {
      // cmd.exe re-parses its command line and honors `&`, `|`, `^`, `<`, `>`
      // as statement separators even after Node quotes argv for CreateProcess.
      // Double-quote each arg (cmd skips metacharacters inside quotes) and
      // pass the line verbatim.
      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const parts = ["/c", "start", '""', quote(app)];
      if (url) parts.push(quote(url));
      spawnDetached("cmd.exe", parts, true);
      return true;
    }
    log.warn("openInApp is only implemented for macOS and Windows.");
    return false;
  } catch (err) {
    log.error(`openInApp failed: ${err}`);
    return false;
  }
}

function spawnDetached(
  command: string,
  args: string[],
  windowsVerbatimArguments = false,
): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments,
  });
  // Without a listener, a spawn failure (missing binary) raises an unhandled
  // 'error' event and takes the plugin process down with it.
  child.on("error", (err) => log.error(`${command} failed: ${err.message}`));
  child.unref();
}
