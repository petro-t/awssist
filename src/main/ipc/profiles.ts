import { ipcMain } from 'electron';
import {
  readConfig,
  removeProfile,
  removeSsoSession,
  upsertProfile,
  upsertSsoSession,
} from '../aws/config-file';
import type { Profile, SsoSessionConfig } from '@shared/types';

export function registerProfileHandlers(): void {
  ipcMain.handle('profiles:list', async () => {
    try {
      return await readConfig();
    } catch (err) {
      console.error('[ipc profiles:list]', err);
      throw err;
    }
  });

  ipcMain.handle('profiles:addSsoSession', async (_evt, session: SsoSessionConfig) => {
    try {
      await upsertSsoSession(session);
    } catch (err) {
      console.error('[ipc profiles:addSsoSession]', err);
      throw err;
    }
  });

  ipcMain.handle('profiles:upsert', async (_evt, profile: Profile) => {
    try {
      await upsertProfile(profile);
    } catch (err) {
      console.error('[ipc profiles:upsert]', err);
      throw err;
    }
  });

  ipcMain.handle('profiles:remove', async (_evt, name: string) => {
    try {
      await removeProfile(name);
    } catch (err) {
      console.error('[ipc profiles:remove]', err);
      throw err;
    }
  });

  ipcMain.handle('profiles:removeSsoSession', async (_evt, name: string) => {
    try {
      return await removeSsoSession(name);
    } catch (err) {
      console.error('[ipc profiles:removeSsoSession]', err);
      throw err;
    }
  });
}
