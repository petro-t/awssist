import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

// Linux AppImages launched without a terminal (desktop file, file-manager
// double-click) have no connected stdout/stderr; any write throws EIO and
// would otherwise crash the main process. Swallow those at the source so
// nothing — Electron internals, transitive deps, our own logs — can take the
// app down on the first console.log. Must run before any logging happens.
for (const stream of [process.stdout, process.stderr] as const) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'EIO') return;
    throw err;
  });
}

import { registerProfileHandlers } from './ipc/profiles';
import { registerSsoHandlers, rehydrateActiveSessions } from './ipc/sso';
import { registerEcsHandlers } from './ipc/ecs';
import { registerEcrHandlers } from './ipc/ecr';
import { registerResourceHandlers } from './ipc/resources';
import { registerTunnelHandlers, shutdownAllTunnels } from './ipc/tunnels';
import { registerExecHandlers, shutdownAllExec } from './ipc/exec';
import { registerSystemHandlers } from './ipc/system';
import { buildAppMenu } from './menu';
import { shutdownAllSsoListeners } from './aws/sso-device';
import { installLogBridge } from './log-bridge';

// Ensure /opt/homebrew/bin is on PATH for spawned aws / session-manager-plugin.
function augmentPath(): void {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin'];
  const existing = (process.env.PATH ?? '').split(':');
  for (const dir of extras) if (!existing.includes(dir)) existing.unshift(dir);
  process.env.PATH = existing.join(':');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    title: 'AWSsist',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  augmentPath();
  installLogBridge();
  console.log(
    `[main] AWSsist starting — electron=${process.versions.electron}, node=${process.versions.node}, chrome=${process.versions.chrome}`,
  );
  buildAppMenu();

  registerProfileHandlers();
  registerSsoHandlers();
  registerEcsHandlers();
  registerEcrHandlers();
  registerResourceHandlers();
  registerTunnelHandlers();
  registerExecHandlers();
  registerSystemHandlers();

  createWindow();

  // Rehydrate the in-memory session list from ~/.aws/credentials so sessions
  // survive an app restart. Fire-and-forget — the renderer subscribes to
  // `sessions:update` and refreshes when the broadcast arrives. We deliberately
  // don't await it so the window opens immediately.
  void rehydrateActiveSessions().catch((err) => {
    console.error('[main] rehydrateActiveSessions', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdownAllTunnels();
  shutdownAllExec();
  shutdownAllSsoListeners();
});
