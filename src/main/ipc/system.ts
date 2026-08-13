import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { clipboard, ipcMain } from 'electron';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { sts } from '../aws/client';

function tryBin(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 4000 }, (err) => resolve(!err));
  });
}

async function checkBin(bin: string, args: string[], fallbacks: string[]): Promise<boolean> {
  if (await tryBin(bin, args)) return true;
  // PATH lookup failed. Some AWS CLI installers (the official .pkg) drop the
  // binary in a non-standard directory the login shell may have added via
  // symlink we haven't picked up. Probe well-known absolute paths.
  for (const abs of fallbacks) {
    if (existsSync(abs) && (await tryBin(abs, args))) return true;
  }
  return false;
}

export function registerSystemHandlers(): void {
  ipcMain.handle('system:checkDeps', async () => {
    const [aws, smp] = await Promise.all([
      checkBin('aws', ['--version'], [
        '/usr/local/bin/aws',
        '/opt/homebrew/bin/aws',
        '/usr/local/aws-cli/aws',
        '/usr/bin/aws',
      ]),
      checkBin('session-manager-plugin', ['--version'], [
        '/usr/local/bin/session-manager-plugin',
        '/opt/homebrew/bin/session-manager-plugin',
        '/usr/local/sessionmanagerplugin/bin/session-manager-plugin',
      ]),
    ]);
    return { aws, sessionManagerPlugin: smp };
  });

  ipcMain.handle('clipboard:writeText', (_evt, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('aws:whoami', async (_evt, profile: string, region: string) => {
    try {
      const client = sts(profile, region);
      const out = await client.send(new GetCallerIdentityCommand({}));
      return {
        ok: true as const,
        account: out.Account,
        arn: out.Arn,
        userId: out.UserId,
      };
    } catch (err) {
      const e = err as { name?: string; message?: string };
      console.error('[ipc aws:whoami]', e);
      return {
        ok: false as const,
        name: e.name ?? 'Error',
        message: e.message ?? String(err),
      };
    }
  });
}
