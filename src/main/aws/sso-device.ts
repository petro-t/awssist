import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import {
  CreateTokenCommand,
  RegisterClientCommand,
  SSOOIDCClient,
} from '@aws-sdk/client-sso-oidc';
import {
  ListAccountRolesCommand,
  ListAccountsCommand,
  SSOClient,
} from '@aws-sdk/client-sso';
import { readConfig } from './config-file';

const CACHE_DIR = join(homedir(), '.aws', 'sso', 'cache');

interface SsoTokenCacheFile {
  startUrl: string;
  region: string;
  accessToken: string;
  expiresAt: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  registrationExpiresAt?: string;
  /**
   * Marker that this cache entry was written by AWSsist's auth_code+PKCE flow.
   * Caches without this marker came from the older device-flow code and their
   * refresh tokens may not be usable for the refresh_token grant — when we
   * detect one, we force the user to re-sign-in instead of trying to refresh
   * (which would fail with InvalidGrant) and then falling back to "not logged in".
   */
  awssistFlow?: 'auth_code_pkce' | 'device';
}

/**
 * State for an in-flight authorization-code + PKCE sign-in. The local HTTP
 * listener captures the OAuth callback into `result` (or `error`); the renderer
 * polls `pollDeviceLogin` which exchanges the code for tokens and tears the
 * listener down.
 */
interface AuthCodeInFlight {
  session: string;
  startUrl: string;
  region: string;
  clientId: string;
  clientSecret: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  server: Server;
  expiresAt: number;
  result?: { code: string };
  error?: string;
}

const inFlight = new Map<string, AuthCodeInFlight>();

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (!addr || typeof addr !== 'object') {
        probe.close();
        reject(new Error('Failed to allocate a local port for the OAuth callback.'));
        return;
      }
      const port = addr.port;
      probe.close(() => resolve(port));
    });
  });
}

const CALLBACK_PATH = '/oauth/callback';
const SUCCESS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>AWSsist – Signed in</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;text-align:center;padding:80px 20px;background:#0d1117;color:#e6edf3;">
  <h1 style="color:#ff9900;margin:0 0 8px;">Signed in to AWSsist</h1>
  <p style="opacity:.7;">You can close this tab and return to the app.</p>
</body></html>`;

function buildCallbackHandler(entry: AuthCodeInFlight): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        entry.error = `${oauthError}: ${url.searchParams.get('error_description') ?? 'unknown'}`;
        res.statusCode = 400;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end('<h1>Sign-in failed</h1><p>You can close this tab.</p>');
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || returnedState !== entry.state) {
        entry.error = 'Invalid OAuth callback (missing code or state mismatch).';
        res.statusCode = 400;
        res.end('Invalid callback.');
        return;
      }
      entry.result = { code };
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(SUCCESS_PAGE);
    } catch (err) {
      entry.error = (err as Error).message;
      res.statusCode = 500;
      res.end('Internal error.');
    }
  };
}

function closeServer(entry: AuthCodeInFlight | undefined): void {
  if (!entry) return;
  try {
    entry.server.close();
  } catch {
    /* ignore */
  }
}

/**
 * Hard cleanup — called on app quit so we don't leak ports.
 */
export function shutdownAllSsoListeners(): void {
  for (const [key, entry] of inFlight) {
    closeServer(entry);
    inFlight.delete(key);
  }
}

function tokenCachePath(ssoSessionName: string): string {
  const hash = createHash('sha1').update(ssoSessionName).digest('hex');
  return join(CACHE_DIR, `${hash}.json`);
}

async function lookupSession(name: string): Promise<{ startUrl: string; region: string; scopes?: string }> {
  const { ssoSessions } = await readConfig();
  const s = ssoSessions.find((x) => x.name === name);
  if (!s) throw new Error(`SSO session not found in ~/.aws/config: ${name}`);
  if (!s.ssoStartUrl || !s.ssoRegion) throw new Error(`SSO session "${name}" is missing start URL or region.`);
  return { startUrl: s.ssoStartUrl, region: s.ssoRegion, scopes: s.ssoRegistrationScopes };
}

/**
 * Start an authorization-code + PKCE sign-in for an SSO session.
 *
 * Allocates a local 127.0.0.1 port, registers a fresh OIDC client with
 * grantTypes=['authorization_code','refresh_token'] (refresh-eligible),
 * stands up a one-shot HTTP listener for the OAuth callback, and returns the
 * AWS /authorize URL for the renderer to open in the browser.
 *
 * The function name is preserved from the old device-flow implementation so
 * the IPC contract (ssoSessionDeviceLogin) doesn't change.
 */
export async function startDeviceLogin(
  session: string,
): Promise<{ verificationUriComplete: string; userCode: string; expiresAt: string; pollKey: string }> {
  const { startUrl, region, scopes } = await lookupSession(session);

  // Tear down anything in flight for this session — covers repeated clicks.
  const prior = inFlight.get(session);
  if (prior) {
    closeServer(prior);
    inFlight.delete(session);
  }

  const port = await findFreePort();
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const scopeList = (scopes ?? 'sso:account:access').split(/\s+/).filter(Boolean);

  const oidc = new SSOOIDCClient({ region });
  const reg = await oidc.send(
    new RegisterClientCommand({
      clientName: `awssist-${session}-${Date.now()}`,
      clientType: 'public',
      // Critical: refresh_token must be in grantTypes for the resulting refresh
      // token to be usable via /token (grant=refresh_token) later on.
      grantTypes: ['authorization_code', 'refresh_token'],
      issuerUrl: startUrl,
      redirectUris: [redirectUri],
      scopes: scopeList,
    }),
  );
  if (!reg.clientId || !reg.clientSecret) {
    throw new Error('RegisterClient returned no credentials.');
  }

  const { verifier, challenge } = pkcePair();
  const stateNonce = base64url(randomBytes(16));

  const entry: AuthCodeInFlight = {
    session,
    startUrl,
    region,
    clientId: reg.clientId,
    clientSecret: reg.clientSecret,
    codeVerifier: verifier,
    state: stateNonce,
    redirectUri,
    // Set below; placeholder satisfies the type.
    server: undefined as unknown as Server,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };

  await new Promise<void>((resolve, reject) => {
    const server = createServer(buildCallbackHandler(entry));
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      entry.server = server;
      resolve();
    });
  });

  inFlight.set(session, entry);

  // Build the authorize URL. AWS Identity Center IDP endpoint, region-scoped.
  const authorizeUrl = new URL(`https://oidc.${region}.amazonaws.com/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', reg.clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', stateNonce);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scopes', scopeList.join(' '));

  return {
    verificationUriComplete: authorizeUrl.toString(),
    // No user code in auth_code flow — the renderer renders a spinner instead.
    userCode: '',
    expiresAt: new Date(entry.expiresAt).toISOString(),
    pollKey: session,
  };
}

/**
 * Poll for the OAuth callback. The renderer calls this every few seconds while
 * the user is in the browser. We:
 *   - return { done: false } while we're still waiting for the callback
 *   - return { done: false, error } if the callback came back with an error,
 *     or the window expired
 *   - once the callback supplied a code, exchange it for tokens, persist them,
 *     and return { done: true }
 */
export async function pollDeviceLogin(
  pollKey: string,
): Promise<{ done: boolean; expiresAt?: string; error?: string }> {
  const entry = inFlight.get(pollKey);
  if (!entry) return { done: false, error: 'No login in progress for this session.' };

  if (entry.error) {
    closeServer(entry);
    inFlight.delete(pollKey);
    return { done: false, error: entry.error };
  }

  if (Date.now() > entry.expiresAt) {
    closeServer(entry);
    inFlight.delete(pollKey);
    return { done: false, error: 'Sign-in window expired. Try again.' };
  }

  if (!entry.result) {
    // No callback yet — keep waiting.
    return { done: false };
  }

  const oidc = new SSOOIDCClient({ region: entry.region });
  try {
    const tok = await oidc.send(
      new CreateTokenCommand({
        clientId: entry.clientId,
        clientSecret: entry.clientSecret,
        grantType: 'authorization_code',
        code: entry.result.code,
        redirectUri: entry.redirectUri,
        codeVerifier: entry.codeVerifier,
      }),
    );
    if (!tok.accessToken || !tok.expiresIn) {
      throw new Error('Token response was empty.');
    }
    const expiresAt = new Date(Date.now() + tok.expiresIn * 1000).toISOString();
    // Visibility into what AWS actually handed us. Critically tells us whether
    // a refresh_token came back — if it didn't, future refresh attempts can't
    // possibly succeed and we'd want to know.
    console.log(
      `[sso-device] sign-in tokens for "${entry.session}": ` +
        `accessToken=${tok.accessToken ? 'present' : 'MISSING'}, ` +
        `refreshToken=${tok.refreshToken ? 'present' : 'MISSING'}, ` +
        `expiresIn=${tok.expiresIn}s (~${Math.round(tok.expiresIn / 60)}m), ` +
        `tokenType=${tok.tokenType ?? '?'}`,
    );
    const cache: SsoTokenCacheFile = {
      startUrl: entry.startUrl,
      region: entry.region,
      accessToken: tok.accessToken,
      expiresAt,
      refreshToken: tok.refreshToken,
      clientId: entry.clientId,
      clientSecret: entry.clientSecret,
      registrationExpiresAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
      awssistFlow: 'auth_code_pkce',
    };
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(tokenCachePath(entry.session), JSON.stringify(cache, null, 2), { mode: 0o600 });

    closeServer(entry);
    inFlight.delete(pollKey);
    return { done: true, expiresAt };
  } catch (err) {
    closeServer(entry);
    inFlight.delete(pollKey);
    return { done: false, error: (err as Error).message };
  }
}

/**
 * Read the SSO token cache for a session. Returns null on any read/parse error
 * (treated as "not signed in").
 */
async function readCache(session: string): Promise<SsoTokenCacheFile | null> {
  try {
    const text = await fs.readFile(tokenCachePath(session), 'utf8');
    return JSON.parse(text) as SsoTokenCacheFile;
  } catch {
    return null;
  }
}

async function writeCache(session: string, cache: SsoTokenCacheFile): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(tokenCachePath(session), JSON.stringify(cache, null, 2), { mode: 0o600 });
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function tokenExpiringSoon(cache: SsoTokenCacheFile): boolean {
  const expiresAt = Date.parse(cache.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + REFRESH_MARGIN_MS;
}

/**
 * If the cached access token is expired or close to expiry, exchange the
 * refresh token for a fresh one and persist it back to disk. Returns the
 * (possibly-refreshed) cache, or null if no usable token is available
 * (no cache at all, or refresh failed and access token already expired).
 *
 * This mirrors how `aws sso login` + the aws CLI v2 keep sessions alive
 * transparently — the refresh token typically lasts ~90 days, so the user
 * is "signed in" for far longer than the short access-token TTL would imply.
 *
 * Legacy caches (written by the older device-flow implementation) carry
 * refresh tokens that AWS does not honour for the refresh_token grant. We
 * detect those by the missing `awssistFlow: 'auth_code_pkce'` marker and
 * treat them as expired so the user is forced to re-sign-in once — after
 * that, the new cache marker is in place and refreshes work indefinitely.
 */
export async function ensureFreshToken(session: string): Promise<SsoTokenCacheFile | null> {
  const cache = await readCache(session);
  if (!cache) {
    console.log(`[sso-device] ensureFreshToken("${session}"): no cache file → null`);
    return null;
  }

  const expiresAtMs = Date.parse(cache.expiresAt);
  const secondsLeft = Math.round((expiresAtMs - Date.now()) / 1000);
  const expiring = tokenExpiringSoon(cache);

  console.log(
    `[sso-device] ensureFreshToken("${session}"): ` +
      `flow=${cache.awssistFlow ?? 'legacy/device'}, ` +
      `expiresIn=${secondsLeft}s, ` +
      `expiring=${expiring}, ` +
      `refreshToken=${cache.refreshToken ? 'present' : 'MISSING'}, ` +
      `clientId=${cache.clientId ? 'present' : 'MISSING'}, ` +
      `clientSecret=${cache.clientSecret ? 'present' : 'MISSING'}`,
  );

  // Still well within validity — hand back as-is regardless of which flow wrote
  // the cache. The flow marker is informational, not a gate.
  if (!expiring) return cache;

  // Token is expiring or expired. Attempt refresh if we have the materials.
  // If the cache was written by the legacy device flow but happens to carry a
  // refresh-capable token (some scope configs work either way), this still
  // succeeds — and on success we upgrade the marker so we know going forward.
  if (!cache.refreshToken || !cache.clientId || !cache.clientSecret) {
    console.warn(
      `[sso-device] "${session}" needs refresh but cache lacks refresh material — user must re-sign-in`,
    );
    return Date.parse(cache.expiresAt) > Date.now() + 30_000 ? cache : null;
  }

  console.log(`[sso-device] attempting refresh_token grant for "${session}"…`);
  try {
    const oidc = new SSOOIDCClient({ region: cache.region });
    const tok = await oidc.send(
      new CreateTokenCommand({
        clientId: cache.clientId,
        clientSecret: cache.clientSecret,
        grantType: 'refresh_token',
        refreshToken: cache.refreshToken,
      }),
    );
    if (!tok.accessToken || !tok.expiresIn) {
      console.warn(`[sso-device] refresh for "${session}" returned empty response; keeping cached token`);
      return cache;
    }

    const refreshed: SsoTokenCacheFile = {
      ...cache,
      accessToken: tok.accessToken,
      expiresAt: new Date(Date.now() + tok.expiresIn * 1000).toISOString(),
      // AWS may rotate refresh tokens; keep the new one if provided.
      refreshToken: tok.refreshToken ?? cache.refreshToken,
      // Promote to the modern marker — this cache has demonstrably-working refresh.
      awssistFlow: 'auth_code_pkce',
    };
    await writeCache(session, refreshed);
    console.log(
      `[sso-device] refresh OK for "${session}": new expiresAt=${refreshed.expiresAt}, ` +
        `refreshToken=${tok.refreshToken ? 'rotated' : 'unchanged'}`,
    );
    return refreshed;
  } catch (err) {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.warn(
      `[sso-device] refresh FAILED for "${session}": ` +
        `name=${e.name ?? 'Error'}, ` +
        `httpStatus=${e.$metadata?.httpStatusCode ?? '?'}, ` +
        `message=${e.message ?? String(err)}`,
    );
    return Date.parse(cache.expiresAt) > Date.now() + 30_000 ? cache : null;
  }
}

export async function signOut(session: string): Promise<void> {
  // Drop the in-flight device login if there is one.
  inFlight.delete(session);
  // Delete the SSO token cache for this session, mirroring `aws sso logout`.
  try {
    await fs.unlink(tokenCachePath(session));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function sessionStatus(session: string): Promise<{ loggedIn: boolean; expiresAt?: string }> {
  // ensureFreshToken transparently refreshes via refresh_token when possible,
  // so the SSO card stays green long past the original access-token TTL.
  const cache = await ensureFreshToken(session);
  if (!cache) return { loggedIn: false };
  return { loggedIn: true, expiresAt: cache.expiresAt };
}

export async function listAccountsAndRoles(
  session: string,
): Promise<{ accountId: string; accountName?: string; accountEmail?: string; roleName: string }[]> {
  const { region } = await lookupSession(session);
  const cache = await ensureFreshToken(session);
  if (!cache) {
    throw new Error('SSO session expired and refresh failed. Sign in again.');
  }
  const sso = new SSOClient({ region });

  const out: { accountId: string; accountName?: string; accountEmail?: string; roleName: string }[] = [];

  let nextAccountToken: string | undefined;
  do {
    const accounts = await sso.send(
      new ListAccountsCommand({ accessToken: cache.accessToken, nextToken: nextAccountToken, maxResults: 100 }),
    );
    for (const acct of accounts.accountList ?? []) {
      if (!acct.accountId) continue;
      let nextRoleToken: string | undefined;
      do {
        const roles = await sso.send(
          new ListAccountRolesCommand({
            accessToken: cache.accessToken,
            accountId: acct.accountId,
            nextToken: nextRoleToken,
            maxResults: 100,
          }),
        );
        for (const r of roles.roleList ?? []) {
          if (!r.roleName) continue;
          out.push({
            accountId: acct.accountId,
            accountName: acct.accountName,
            accountEmail: acct.emailAddress,
            roleName: r.roleName,
          });
        }
        nextRoleToken = roles.nextToken;
      } while (nextRoleToken);
    }
    nextAccountToken = accounts.nextToken;
  } while (nextAccountToken);

  return out.sort((a, b) =>
    (a.accountName ?? a.accountId).localeCompare(b.accountName ?? b.accountId) || a.roleName.localeCompare(b.roleName),
  );
}
