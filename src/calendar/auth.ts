import { createHash, randomBytes } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { type AddressInfo, createServer } from "node:net";
import streamDeck from "@elgato/streamdeck";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { GlobalSettings, StoredTokens } from "../settings";
import { log } from "../util/log";

// OAuth credentials for the bundled "Desktop app" client.
//
// These references are rewritten by `@rollup/plugin-replace` at build time
// (see rollup.config.mjs) using values from .env.local or real environment
// variables. The source repo never contains the actual values. After
// bundling, the bundle contains literal strings. RFC 8252 considers a
// Desktop OAuth client_secret a non-secret since anyone with the binary can
// extract it; the actual protection comes from PKCE. Google still requires
// it in the token exchange.
const GOOGLE_CLIENT_ID = process.env.DECKCAL_GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.DECKCAL_GOOGLE_CLIENT_SECRET;

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
background:#0d0d0d;color:#eee}div{text-align:center}</style></head>
<body><div><h1>Signed in</h1><p>You can close this tab.</p></div>
<script>setTimeout(()=>window.close(),1500)</script></body></html>`;

const FAILURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign-in failed</title>
<style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
background:#0d0d0d;color:#eee}div{text-align:center}</style></head>
<body><div><h1>Sign-in failed</h1><p>Return to Stream Deck and try again.</p>
</div></body></html>`;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export type AccountInfo = {
  sub: string;
  email: string;
  tokens: StoredTokens;
};

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address() as AddressInfo;
      const port = addr.port;
      probe.close(() => resolve(port));
    });
  });
}

type AuthCallback = { code: string; state: string };

async function awaitOAuthCallback(
  port: number,
  expectedState: string,
): Promise<AuthCallback> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new AuthError("Sign-in timed out."));
    }, AUTH_TIMEOUT_MS);

    const server = createHttpServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url) return;
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(FAILURE_HTML);
          clearTimeout(timeout);
          server.close();
          reject(new AuthError(`Google returned error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(FAILURE_HTML);
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(FAILURE_HTML);
          clearTimeout(timeout);
          server.close();
          reject(new AuthError("OAuth state mismatch (possible CSRF)."));
          return;
        }

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(SUCCESS_HTML);
        clearTimeout(timeout);
        server.close();
        resolve({ code, state });
      },
    );

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    server.listen(port, "127.0.0.1");
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new AuthError("Invalid id_token.");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
}

export async function authorize(): Promise<AccountInfo> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new AuthError(
      "Missing Google OAuth client credentials. See README for setup.",
    );
  }

  const port = await pickEphemeralPort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const { verifier, challenge } = generatePkcePair();
  const state = base64url(randomBytes(16));

  const client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
  });

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: CodeChallengeMethod.S256,
    state,
  });

  log.info(`Starting OAuth flow on ${redirectUri}`);
  const callbackPromise = awaitOAuthCallback(port, state);
  streamDeck.system.openUrl(authUrl);

  const { code } = await callbackPromise;
  const { tokens } = await client.getToken({
    code,
    codeVerifier: verifier,
  });

  if (!tokens.refresh_token) {
    throw new AuthError(
      "Google did not return a refresh token. Revoke the app in your Google Account and retry.",
    );
  }
  if (!tokens.id_token) {
    throw new AuthError("Google did not return an id_token.");
  }

  // Google's granular-consent screen lets users unselect individual scopes.
  // If the user dismissed the Calendar permission, the token works for sign-in
  // but is useless to us — fail loudly rather than store dead tokens.
  const grantedScopes = (tokens.scope ?? "").split(/\s+/);
  if (!grantedScopes.includes("https://www.googleapis.com/auth/calendar.readonly")) {
    throw new AuthError(
      'Calendar permission not granted. Re-run sign-in and tick "See events on your Google Calendar" on the consent screen.',
    );
  }

  const payload = decodeJwtPayload(tokens.id_token);
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!sub || !email) {
    throw new AuthError("id_token missing sub/email.");
  }

  const stored: StoredTokens = {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
  };

  return { sub, email, tokens: stored };
}

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  return (await streamDeck.settings.getGlobalSettings<GlobalSettings>()) ?? {};
}

export async function saveAccount(info: AccountInfo): Promise<void> {
  const global = await loadGlobalSettings();
  const accounts = { ...(global.accounts ?? {}) };
  accounts[info.sub] = { email: info.email, tokens: info.tokens };
  await streamDeck.settings.setGlobalSettings<GlobalSettings>({
    ...global,
    accounts,
  });
}

export async function removeAccount(sub: string): Promise<void> {
  const global = await loadGlobalSettings();
  if (!global.accounts) return;
  const accounts = { ...global.accounts };
  delete accounts[sub];
  await streamDeck.settings.setGlobalSettings<GlobalSettings>({
    ...global,
    accounts,
  });
}

// Build an OAuth2Client primed with the stored refresh token. The client
// transparently refreshes the access token when needed. The returned client
// emits a "tokens" event whenever a refresh happens; we listen so we can
// persist new access_tokens / expiry_dates.
export function getAuthorizedClient(
  sub: string,
  tokens: StoredTokens,
  onTokensRefreshed: (next: StoredTokens) => void,
): OAuth2Client {
  const client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  });
  client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope,
    token_type: tokens.token_type,
  });
  client.on("tokens", (next) => {
    const merged: StoredTokens = {
      refresh_token: next.refresh_token ?? tokens.refresh_token,
      access_token: next.access_token ?? undefined,
      expiry_date: next.expiry_date ?? undefined,
      scope: next.scope ?? undefined,
      token_type: next.token_type ?? undefined,
    };
    log.debug(`Refreshed tokens for ${sub}`);
    onTokensRefreshed(merged);
  });
  return client;
}
