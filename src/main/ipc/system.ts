import { execFile } from 'node:child_process';
import { ipcMain } from 'electron';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { sts } from '../aws/client';

function checkBin(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 4000 }, (err) => resolve(!err));
  });
}

export function registerSystemHandlers(): void {
  ipcMain.handle('system:checkDeps', async () => {
    const [aws, smp] = await Promise.all([
      checkBin('aws', ['--version']),
      checkBin('session-manager-plugin', ['--version']),
    ]);
    return { aws, sessionManagerPlugin: smp };
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
