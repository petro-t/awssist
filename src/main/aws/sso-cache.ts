import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = join(homedir(), '.aws', 'sso', 'cache');

interface SsoTokenCacheFile {
  startUrl?: string;
  region?: string;
  accessToken?: string;
  expiresAt?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  registrationExpiresAt?: string;
}

/**
 * The AWS SSO token cache key is sha1(sso_session_name) when sso_session is configured,
 * or sha1(sso_start_url) for the legacy non-session form. We try both.
 */
function cacheKey(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

export async function readSsoToken(
  ssoSessionName: string | undefined,
  ssoStartUrl: string | undefined,
): Promise<SsoTokenCacheFile | null> {
  const candidates: string[] = [];
  if (ssoSessionName) candidates.push(`${cacheKey(ssoSessionName)}.json`);
  if (ssoStartUrl) candidates.push(`${cacheKey(ssoStartUrl)}.json`);

  for (const name of candidates) {
    try {
      const text = await fs.readFile(join(CACHE_DIR, name), 'utf8');
      const parsed = JSON.parse(text) as SsoTokenCacheFile;
      if (parsed.accessToken) return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Surface unexpected errors
        console.warn('[sso-cache] read error', err);
      }
    }
  }
  return null;
}

export function isTokenValid(token: SsoTokenCacheFile | null): boolean {
  if (!token?.accessToken || !token.expiresAt) return false;
  const expiresMs = Date.parse(token.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > Date.now() + 30_000;
}
