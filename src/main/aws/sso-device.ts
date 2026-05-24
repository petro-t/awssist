import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CreateTokenCommand,
  RegisterClientCommand,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand,
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
}

interface DeviceAuthInFlight {
  session: string;
  startUrl: string;
  region: string;
  clientId: string;
  clientSecret: string;
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  interval: number; // seconds
  expiresAt: number; // epoch ms
}

const inFlight = new Map<string, DeviceAuthInFlight>();

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

export async function startDeviceLogin(
  session: string,
): Promise<{ verificationUriComplete: string; userCode: string; expiresAt: string; pollKey: string }> {
  const { startUrl, region, scopes } = await lookupSession(session);
  const oidc = new SSOOIDCClient({ region });

  const reg = await oidc.send(
    new RegisterClientCommand({
      clientName: `awssist-${session}`,
      clientType: 'public',
      scopes: (scopes ?? 'sso:account:access').split(/\s+/).filter(Boolean),
    }),
  );
  if (!reg.clientId || !reg.clientSecret) throw new Error('RegisterClient returned no credentials');

  const device = await oidc.send(
    new StartDeviceAuthorizationCommand({
      clientId: reg.clientId,
      clientSecret: reg.clientSecret,
      startUrl,
    }),
  );
  if (!device.deviceCode || !device.verificationUriComplete || !device.userCode) {
    throw new Error('StartDeviceAuthorization returned incomplete data');
  }

  const expiresInSec = device.expiresIn ?? 600;
  const intervalSec = device.interval ?? 5;
  const state: DeviceAuthInFlight = {
    session,
    startUrl,
    region,
    clientId: reg.clientId,
    clientSecret: reg.clientSecret,
    deviceCode: device.deviceCode,
    userCode: device.userCode,
    verificationUriComplete: device.verificationUriComplete,
    interval: intervalSec,
    expiresAt: Date.now() + expiresInSec * 1000,
  };
  inFlight.set(session, state);

  return {
    verificationUriComplete: device.verificationUriComplete,
    userCode: device.userCode,
    expiresAt: new Date(state.expiresAt).toISOString(),
    pollKey: session,
  };
}

export async function pollDeviceLogin(
  pollKey: string,
): Promise<{ done: boolean; expiresAt?: string; error?: string }> {
  const state = inFlight.get(pollKey);
  if (!state) return { done: false, error: 'No login in progress for this session.' };
  if (Date.now() > state.expiresAt) {
    inFlight.delete(pollKey);
    return { done: false, error: 'Verification window expired. Try again.' };
  }

  const oidc = new SSOOIDCClient({ region: state.region });
  try {
    const tok = await oidc.send(
      new CreateTokenCommand({
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        deviceCode: state.deviceCode,
      }),
    );
    if (!tok.accessToken || !tok.expiresIn) return { done: false, error: 'Token response was empty.' };

    const expiresAt = new Date(Date.now() + tok.expiresIn * 1000).toISOString();
    const cache: SsoTokenCacheFile = {
      startUrl: state.startUrl,
      region: state.region,
      accessToken: tok.accessToken,
      expiresAt,
      refreshToken: tok.refreshToken,
      clientId: state.clientId,
      clientSecret: state.clientSecret,
      registrationExpiresAt: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
    };
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(tokenCachePath(state.session), JSON.stringify(cache, null, 2), { mode: 0o600 });
    inFlight.delete(pollKey);
    return { done: true, expiresAt };
  } catch (err) {
    const name = (err as { name?: string }).name;
    // AuthorizationPendingException — keep polling, not an error.
    if (name === 'AuthorizationPendingException') return { done: false };
    if (name === 'SlowDownException') return { done: false };
    return { done: false, error: (err as Error).message };
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
  try {
    const cache = JSON.parse(await fs.readFile(tokenCachePath(session), 'utf8')) as SsoTokenCacheFile;
    const expires = Date.parse(cache.expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now() + 30_000) return { loggedIn: false };
    return { loggedIn: true, expiresAt: cache.expiresAt };
  } catch {
    return { loggedIn: false };
  }
}

export async function listAccountsAndRoles(
  session: string,
): Promise<{ accountId: string; accountName?: string; accountEmail?: string; roleName: string }[]> {
  const { region } = await lookupSession(session);
  const cache = JSON.parse(await fs.readFile(tokenCachePath(session), 'utf8')) as SsoTokenCacheFile;
  if (Date.parse(cache.expiresAt) <= Date.now() + 30_000) {
    throw new Error('SSO session expired. Sign in again.');
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
