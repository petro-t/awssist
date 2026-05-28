import { spawn } from 'node:child_process';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { GetRoleCredentialsCommand, SSOClient } from '@aws-sdk/client-sso';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { readConfig, removeCredentialEntry, upsertProfile, writeCredentialEntry } from '../aws/config-file';
import { isTokenValid, readSsoToken } from '../aws/sso-cache';
import {
  ensureFreshToken,
  listAccountsAndRoles,
  pollDeviceLogin,
  sessionStatus,
  signOut as signOutSession,
  startDeviceLogin,
} from '../aws/sso-device';
import { invalidateCredentialsCache } from '../aws/credentials';
import { sts } from '../aws/client';
import type { ImportSelection, SessionState, SsoLoginStatus } from '@shared/types';

const activeSessions = new Map<string, SessionState>();
let sessionTickHandle: NodeJS.Timeout | null = null;

function broadcastSessions(): void {
  const payload = Array.from(activeSessions.values());
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sessions:update', payload);
  }
}

function ensureSessionTick(): void {
  if (sessionTickHandle) return;
  sessionTickHandle = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [profile, sess] of activeSessions) {
      if (Date.parse(sess.expiresAt) <= now) {
        activeSessions.delete(profile);
        changed = true;
      }
    }
    if (changed) broadcastSessions();
  }, 30_000);
}

async function lookupProfile(profileName: string) {
  const { profiles, ssoSessions } = await readConfig();
  const profile = profiles.find((p) => p.name === profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  let ssoStartUrl = profile.ssoStartUrl;
  let ssoRegion = profile.ssoRegion;
  if (profile.ssoSession) {
    const sess = ssoSessions.find((s) => s.name === profile.ssoSession);
    if (sess) {
      ssoStartUrl = sess.ssoStartUrl;
      ssoRegion = sess.ssoRegion;
    }
  }
  return { profile, ssoStartUrl, ssoRegion };
}

async function ssoStatus(profileName: string): Promise<SsoLoginStatus> {
  const { profile, ssoStartUrl } = await lookupProfile(profileName);
  if (profile.kind !== 'sso') return { profile: profileName, loggedIn: false };
  const token = await readSsoToken(profile.ssoSession, ssoStartUrl);
  return {
    profile: profileName,
    loggedIn: isTokenValid(token),
    expiresAt: token?.expiresAt,
  };
}

async function ssoLogin(profileName: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('aws', ['sso', 'login', '--profile', profileName], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AWS_PAGER: '' },
    });
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      // aws sso login emits a verification URL — open it in the user's default browser.
      const match = text.match(/https?:\/\/\S+/);
      if (match) shell.openExternal(match[0]).catch(() => {});
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => resolve({ ok: false, message: err.message }));
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, message: stderr.trim() || `aws sso login exited with code ${code}` });
    });
  });
}

async function startSession(profileName: string, writeAsDefault: boolean): Promise<SessionState> {
  ensureSessionTick();
  const { profile, ssoRegion } = await lookupProfile(profileName);

  let entry: Record<string, string>;
  let expiresAt: string;

  if (profile.kind === 'sso') {
    // Refresh-aware: if the access token is close to expiring, exchange the
    // refresh_token for a fresh one before calling GetRoleCredentials.
    let accessToken: string | undefined;
    if (profile.ssoSession) {
      const fresh = await ensureFreshToken(profile.ssoSession);
      accessToken = fresh?.accessToken;
    }
    if (!accessToken) {
      const legacy = await readSsoToken(profile.ssoSession, profile.ssoStartUrl);
      if (isTokenValid(legacy)) accessToken = legacy?.accessToken;
    }
    if (!accessToken) {
      throw new Error(
        `SSO session "${profile.ssoSession ?? '?'}" has no usable token. Sign in again from the Profiles tab. ` +
          `(If this happens repeatedly, open View → Toggle Developer Tools and look for "[sso-device] refresh failed" in the console — AWS's reason is logged there.)`,
      );
    }
    const client = new SSOClient({ region: ssoRegion ?? profile.region ?? 'us-east-1' });
    const out = await client.send(
      new GetRoleCredentialsCommand({
        accessToken,
        accountId: profile.ssoAccountId!,
        roleName: profile.ssoRoleName!,
      }),
    );
    if (!out.roleCredentials?.accessKeyId) throw new Error('Empty role credentials response');
    entry = {
      aws_access_key_id: out.roleCredentials.accessKeyId!,
      aws_secret_access_key: out.roleCredentials.secretAccessKey!,
      aws_session_token: out.roleCredentials.sessionToken!,
    };
    expiresAt = new Date(Number(out.roleCredentials.expiration ?? 0)).toISOString();
  } else {
    // For static/role/process profiles, resolve via fromIni — yields a credentials object
    // that we can write back as-is for tools that don't honor named profiles directly.
    const provider = fromIni({ profile: profileName });
    const resolved = await provider();
    entry = {
      aws_access_key_id: resolved.accessKeyId,
      aws_secret_access_key: resolved.secretAccessKey,
    };
    if (resolved.sessionToken) entry.aws_session_token = resolved.sessionToken;
    expiresAt = resolved.expiration?.toISOString() ?? new Date(Date.now() + 3600_000).toISOString();
  }

  await writeCredentialEntry(profileName, entry);
  if (writeAsDefault) await writeCredentialEntry('default', entry);

  let accountId: string | undefined;
  let arn: string | undefined;
  try {
    const stsClient = sts(profileName, profile.region ?? 'us-east-1');
    const ident = await stsClient.send(new GetCallerIdentityCommand({}));
    accountId = ident.Account;
    arn = ident.Arn;
  } catch {
    // identity check failure shouldn't block session
  }

  const state: SessionState = {
    profile: profileName,
    accessKeyId: entry.aws_access_key_id,
    expiresAt,
    accountId,
    arn,
    region: profile.region,
  };
  activeSessions.set(profileName, state);
  broadcastSessions();
  return state;
}

async function endSession(profileName: string): Promise<void> {
  await removeCredentialEntry(profileName);
  activeSessions.delete(profileName);
  broadcastSessions();
}

async function openConsole(profileName: string): Promise<void> {
  // Best-effort: open the AWS console; user must already be logged in via browser.
  // For deeper SSO console deep-linking we'd federate via SSO portal start URL.
  const { profile, ssoStartUrl } = await lookupProfile(profileName);
  const url = ssoStartUrl ?? 'https://console.aws.amazon.com/';
  await shell.openExternal(url);
  void profile;
}

async function importSsoProfiles(session: string, selections: ImportSelection[]): Promise<void> {
  for (const sel of selections) {
    await upsertProfile({
      name: sel.profileName,
      kind: 'sso',
      region: sel.region,
      ssoSession: session,
      ssoAccountId: sel.accountId,
      ssoRoleName: sel.roleName,
    });
  }
}

export function registerSsoHandlers(): void {
  ipcMain.handle('sso:login', (_evt, profile: string) => ssoLogin(profile));
  ipcMain.handle('sso:status', (_evt, profile: string) => ssoStatus(profile));
  ipcMain.handle('session:start', (_evt, profile: string, asDefault: boolean) =>
    startSession(profile, asDefault),
  );
  ipcMain.handle('session:end', (_evt, profile: string) => endSession(profile));
  ipcMain.handle('session:list', () => Array.from(activeSessions.values()));
  ipcMain.handle('console:open', (_evt, profile: string) => openConsole(profile));

  ipcMain.handle('sso:sessionStatus', async (_evt, session: string) => {
    const out = await sessionStatus(session);
    return { session, ...out };
  });
  ipcMain.handle('sso:deviceLogin', async (_evt, session: string) => {
    const out = await startDeviceLogin(session);
    void shell.openExternal(out.verificationUriComplete);
    return out;
  });
  ipcMain.handle('sso:poll', (_evt, pollKey: string) => pollDeviceLogin(pollKey));
  ipcMain.handle('sso:signOut', async (_evt, session: string) => {
    await signOutSession(session);
    // Flush cached short-term credentials for every profile tied to this session
    // so the next AWS call cleanly re-asks for sign-in rather than reusing memo'd creds.
    const { profiles } = await readConfig();
    for (const p of profiles) {
      if (p.kind === 'sso' && p.ssoSession === session) {
        invalidateCredentialsCache(p.name);
      }
    }
  });
  ipcMain.handle('sso:listAccountsAndRoles', (_evt, session: string) => listAccountsAndRoles(session));
  ipcMain.handle('sso:importProfiles', (_evt, session: string, selections: ImportSelection[]) =>
    importSsoProfiles(session, selections),
  );
}
