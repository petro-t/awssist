import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
import { GetRoleCredentialsCommand, SSOClient } from '@aws-sdk/client-sso';
import { fromIni } from '@aws-sdk/credential-providers';
import { readConfig } from './config-file';
import { isTokenValid, readSsoToken } from './sso-cache';

interface CacheEntry {
  creds: AwsCredentialIdentity;
  // Renew slightly before AWS expires the creds so we don't hand out
  // credentials that the SDK rejects on the next call.
  renewAfter: number;
}

const cache = new Map<string, CacheEntry>();

const RENEW_MARGIN_MS = 5 * 60 * 1000;

function shouldUse(entry: CacheEntry | undefined): boolean {
  return !!entry && Date.now() < entry.renewAfter;
}

async function resolveSsoCredentials(profileName: string): Promise<AwsCredentialIdentity> {
  const { profiles, ssoSessions } = await readConfig();
  const profile = profiles.find((p) => p.name === profileName);
  if (!profile) throw new Error(`Profile not found in ~/.aws/config: ${profileName}`);
  if (profile.kind !== 'sso') throw new Error(`resolveSsoCredentials called for non-SSO profile: ${profileName}`);

  // Resolve session block (the profile points to it by name).
  let ssoRegion = profile.ssoRegion;
  let ssoStartUrl = profile.ssoStartUrl;
  if (profile.ssoSession) {
    const sess = ssoSessions.find((s) => s.name === profile.ssoSession);
    if (!sess) {
      throw new Error(
        `SSO session "${profile.ssoSession}" referenced by profile "${profileName}" is missing from ~/.aws/config.`,
      );
    }
    ssoRegion = sess.ssoRegion;
    ssoStartUrl = sess.ssoStartUrl;
  }
  if (!ssoRegion || !ssoStartUrl) {
    throw new Error(`Profile "${profileName}" is SSO but missing region or start URL.`);
  }
  if (!profile.ssoAccountId || !profile.ssoRoleName) {
    throw new Error(`Profile "${profileName}" is missing sso_account_id or sso_role_name.`);
  }

  // Read SSO token from cache (keyed by session name when sso_session is set,
  // falling back to the legacy start-URL key for older configs).
  const token = await readSsoToken(profile.ssoSession, ssoStartUrl);
  if (!isTokenValid(token)) {
    throw new Error(
      `Not signed in to SSO session "${profile.ssoSession ?? ssoStartUrl}". Open the Profiles page and click "Sign in" on the session.`,
    );
  }

  const client = new SSOClient({ region: ssoRegion });
  const out = await client.send(
    new GetRoleCredentialsCommand({
      accessToken: token!.accessToken!,
      accountId: profile.ssoAccountId,
      roleName: profile.ssoRoleName,
    }),
  );
  if (!out.roleCredentials?.accessKeyId || !out.roleCredentials.secretAccessKey) {
    throw new Error(`Empty GetRoleCredentials response for ${profileName}.`);
  }

  const expirationMs = Number(out.roleCredentials.expiration ?? 0);
  return {
    accessKeyId: out.roleCredentials.accessKeyId,
    secretAccessKey: out.roleCredentials.secretAccessKey,
    sessionToken: out.roleCredentials.sessionToken,
    expiration: expirationMs ? new Date(expirationMs) : undefined,
  };
}

/**
 * Build a credential provider for a profile. SSO profiles are resolved natively
 * (read token cache → SSO.GetRoleCredentials) so we don't depend on
 * @aws-sdk/credential-provider-ini's runtime lazy-require of the SSO sub-package,
 * which is unreliable inside a bundled Electron main process.
 *
 * Non-SSO profiles (static, role, process) still go through fromIni — those
 * paths don't have the lazy-require problem.
 */
export function makeCredentialsProvider(profileName: string): AwsCredentialIdentityProvider {
  return async () => {
    const cached = cache.get(profileName);
    if (shouldUse(cached)) return cached!.creds;

    const { profiles } = await readConfig();
    const profile = profiles.find((p) => p.name === profileName);
    if (!profile) {
      throw new Error(`Profile not found in ~/.aws/config: ${profileName}`);
    }

    let creds: AwsCredentialIdentity;
    if (profile.kind === 'sso') {
      creds = await resolveSsoCredentials(profileName);
    } else {
      // Static, role-chain, and process-credential profiles work fine through fromIni.
      creds = await fromIni({ profile: profileName })();
    }

    const expiresMs = creds.expiration?.getTime();
    const renewAfter = expiresMs
      ? Math.max(Date.now() + 60_000, expiresMs - RENEW_MARGIN_MS)
      : Date.now() + 30 * 60 * 1000;
    cache.set(profileName, { creds, renewAfter });
    return creds;
  };
}

export function invalidateCredentialsCache(profileName?: string): void {
  if (profileName) cache.delete(profileName);
  else cache.clear();
}
