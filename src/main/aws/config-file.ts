import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import ini from 'ini';
import type { Profile, ProfileKind, SsoSessionConfig } from '@shared/types';
import { deleteAlias, readAliases, setAlias } from './aliases';

const CONFIG_PATH = join(homedir(), '.aws', 'config');
const CREDENTIALS_PATH = join(homedir(), '.aws', 'credentials');

async function readIni(path: string): Promise<Record<string, Record<string, string>>> {
  try {
    const text = await fs.readFile(path, 'utf8');
    return ini.parse(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeIni(path: string, data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, ini.stringify(data, { whitespace: true }), { mode: 0o600 });
}

function classifyKind(section: Record<string, string>): ProfileKind {
  if (section.sso_session || section.sso_start_url) return 'sso';
  if (section.role_arn) return 'role';
  if (section.credential_process) return 'process';
  if (section.aws_access_key_id) return 'static';
  return 'unknown';
}

export async function readConfig(): Promise<{
  profiles: Profile[];
  ssoSessions: SsoSessionConfig[];
}> {
  const [parsed, aliases] = await Promise.all([readIni(CONFIG_PATH), readAliases()]);

  const profiles: Profile[] = [];
  const ssoSessions: SsoSessionConfig[] = [];

  for (const [sectionKey, raw] of Object.entries(parsed)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const section = raw as Record<string, string>;

    if (sectionKey.startsWith('sso-session ')) {
      ssoSessions.push({
        name: sectionKey.slice('sso-session '.length).trim(),
        ssoStartUrl: section.sso_start_url,
        ssoRegion: section.sso_region,
        ssoRegistrationScopes: section.sso_registration_scopes,
      });
      continue;
    }

    let name: string | null = null;
    if (sectionKey === 'default') name = 'default';
    else if (sectionKey.startsWith('profile ')) name = sectionKey.slice('profile '.length).trim();
    if (!name) continue;

    profiles.push({
      name,
      kind: classifyKind(section),
      region: section.region,
      output: section.output,
      alias: aliases[name],
      ssoSession: section.sso_session,
      ssoAccountId: section.sso_account_id,
      ssoRoleName: section.sso_role_name,
      ssoStartUrl: section.sso_start_url,
      ssoRegion: section.sso_region,
      sourceProfile: section.source_profile,
      roleArn: section.role_arn,
      mfaSerial: section.mfa_serial,
      externalId: section.external_id,
      credentialProcess: section.credential_process,
    });
  }

  return { profiles, ssoSessions };
}

export async function upsertSsoSession(session: SsoSessionConfig): Promise<void> {
  const parsed = await readIni(CONFIG_PATH);
  const key = `sso-session ${session.name}`;
  parsed[key] = {
    sso_start_url: session.ssoStartUrl,
    sso_region: session.ssoRegion,
    sso_registration_scopes: session.ssoRegistrationScopes ?? 'sso:account:access',
  };
  await writeIni(CONFIG_PATH, parsed);
}

export async function upsertProfile(p: Profile): Promise<void> {
  const parsed = await readIni(CONFIG_PATH);
  const key = p.name === 'default' ? 'default' : `profile ${p.name}`;
  const section: Record<string, string> = {};

  if (p.region) section.region = p.region;
  section.output = p.output ?? 'json';
  section.cli_pager = '';

  if (p.kind === 'sso') {
    if (p.ssoSession) section.sso_session = p.ssoSession;
    if (p.ssoAccountId) section.sso_account_id = p.ssoAccountId;
    if (p.ssoRoleName) section.sso_role_name = p.ssoRoleName;
    if (p.ssoStartUrl) section.sso_start_url = p.ssoStartUrl;
    if (p.ssoRegion) section.sso_region = p.ssoRegion;
  } else if (p.kind === 'role') {
    if (p.roleArn) section.role_arn = p.roleArn;
    if (p.sourceProfile) section.source_profile = p.sourceProfile;
    if (p.mfaSerial) section.mfa_serial = p.mfaSerial;
    if (p.externalId) section.external_id = p.externalId;
  } else if (p.kind === 'static') {
    // Static long-lived keys live in ~/.aws/credentials; MFA serial (if any) stays in config.
    if (p.mfaSerial) section.mfa_serial = p.mfaSerial;
    if (p.accessKeyId && p.secretAccessKey) {
      const credEntry: Record<string, string> = {
        aws_access_key_id: p.accessKeyId,
        aws_secret_access_key: p.secretAccessKey,
      };
      await writeCredentialEntry(p.name, credEntry);
    }
  } else if (p.kind === 'process') {
    if (p.credentialProcess) section.credential_process = p.credentialProcess;
  }

  parsed[key] = section;
  await writeIni(CONFIG_PATH, parsed);

  // Persist the display alias (or remove it if not provided).
  await setAlias(p.name, p.alias);
}

export async function removeProfile(name: string): Promise<void> {
  const parsed = await readIni(CONFIG_PATH);
  const key = name === 'default' ? 'default' : `profile ${name}`;
  delete parsed[key];
  await writeIni(CONFIG_PATH, parsed);
  await removeCredentialEntry(name).catch(() => {});
  await deleteAlias(name);
}

export async function removeSsoSession(name: string): Promise<string[]> {
  const parsed = await readIni(CONFIG_PATH);
  const key = `sso-session ${name}`;
  if (!parsed[key]) return [];
  delete parsed[key];

  const orphaned: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'object' || v === null) continue;
    const section = v as Record<string, string>;
    if (section.sso_session === name) {
      orphaned.push(k.startsWith('profile ') ? k.slice('profile '.length) : k);
    }
  }
  await writeIni(CONFIG_PATH, parsed);
  return orphaned;
}

export async function readCredentials(): Promise<Record<string, Record<string, string>>> {
  return readIni(CREDENTIALS_PATH);
}

export async function writeCredentialEntry(
  profile: string,
  entry: Record<string, string>,
): Promise<void> {
  const parsed = await readIni(CREDENTIALS_PATH);
  parsed[profile] = entry;
  await writeIni(CREDENTIALS_PATH, parsed);
}

export async function removeCredentialEntry(profile: string): Promise<void> {
  const parsed = await readIni(CREDENTIALS_PATH);
  delete parsed[profile];
  await writeIni(CREDENTIALS_PATH, parsed);
}

export { CONFIG_PATH, CREDENTIALS_PATH };
