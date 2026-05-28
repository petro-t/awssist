import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerProfileHandlers } from './ipc/profiles';
import { registerSsoHandlers } from './ipc/sso';
import { registerEcsHandlers } from './ipc/ecs';
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
  registerResourceHandlers();
  registerTunnelHandlers();
  registerExecHandlers();
  registerSystemHandlers();

  createWindow();

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
