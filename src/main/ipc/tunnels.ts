import { randomUUID } from 'node:crypto';
import { ChildProcess, spawn } from 'node:child_process';
import { BrowserWindow, ipcMain } from 'electron';
import type { TunnelRequest, TunnelStatus } from '@shared/types';

interface Tunnel {
  status: TunnelStatus;
  proc?: ChildProcess;
  killTimer?: NodeJS.Timeout;
}

const tunnels = new Map<string, Tunnel>();

function broadcast(payload: TunnelStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tunnel:update', payload);
  }
}

function broadcastRemoval(id: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tunnel:remove', id);
  }
}

function snapshot(t: Tunnel): TunnelStatus {
  return { ...t.status };
}

/**
 * Kill the tunnel and every child it spawned (notably session-manager-plugin,
 * which actually holds the local listening socket). We rely on `detached: true`
 * having put the aws CLI process into its own process group so we can address
 * the whole group with a negative PID.
 */
function killTunnelTree(t: Tunnel): void {
  const proc = t.proc;
  if (!proc || proc.exitCode !== null) return;
  const pid = proc.pid;
  if (!pid) return;

  // Try graceful first: SIGTERM to the whole process group.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }

  // If it doesn't die within the grace period, escalate to SIGKILL on the group.
  if (t.killTimer) clearTimeout(t.killTimer);
  t.killTimer = setTimeout(() => {
    if (proc.exitCode === null) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
  }, 3000);
}

async function startTunnel(req: TunnelRequest): Promise<TunnelStatus> {
  const id = randomUUID();
  const status: TunnelStatus = {
    id,
    label: req.label,
    profile: req.profile,
    region: req.region,
    bastionInstanceId: req.bastionInstanceId,
    targetHost: req.targetHost,
    remotePort: req.remotePort,
    localPort: req.localPort,
    state: 'starting',
    startedAt: new Date().toISOString(),
  };
  const tunnel: Tunnel = { status };
  tunnels.set(id, tunnel);
  broadcast(snapshot(tunnel));

  const args = [
    'ssm',
    'start-session',
    '--target',
    req.bastionInstanceId,
    '--document-name',
    'AWS-StartPortForwardingSessionToRemoteHost',
    '--parameters',
    `host=${req.targetHost},portNumber=${req.remotePort},localPortNumber=${req.localPort}`,
    '--profile',
    req.profile,
    '--region',
    req.region,
  ];

  const proc = spawn('aws', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AWS_PAGER: '' },
    // detached: true puts the child (and its session-manager-plugin grandchild)
    // into its own process group, which we can later signal as a unit.
    detached: true,
  });
  tunnel.proc = proc;
  status.pid = proc.pid;

  let bootBuffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    bootBuffer += text;
    // session-manager-plugin prints "Waiting for connections..." when bound.
    if (status.state === 'starting' && /Waiting for connections/i.test(bootBuffer)) {
      status.state = 'running';
      broadcast(snapshot(tunnel));
    }
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    bootBuffer += chunk.toString();
  });

  proc.on('error', (err) => {
    status.state = 'error';
    status.error = err.message;
    broadcast(snapshot(tunnel));
  });

  proc.on('close', (code) => {
    if (tunnel.killTimer) {
      clearTimeout(tunnel.killTimer);
      tunnel.killTimer = undefined;
    }
    if (status.state !== 'error') {
      const tail = bootBuffer.split('\n').slice(-5).join('\n').trim();
      if (code !== 0 && code !== null) {
        status.state = 'error';
        status.error = tail || `aws ssm start-session exited with code ${code}`;
      } else {
        status.state = 'stopped';
      }
    }
    broadcast(snapshot(tunnel));

    // Drop the entry from the registry once the process is actually gone so the
    // next tunnel on this port doesn't see a phantom. Errored tunnels we leave
    // in place briefly so the user can read the message.
    const delay = status.state === 'error' ? 8000 : 1500;
    setTimeout(() => {
      tunnels.delete(id);
      broadcastRemoval(id);
    }, delay);
  });

  return snapshot(tunnel);
}

async function stopTunnel(id: string): Promise<void> {
  const t = tunnels.get(id);
  if (!t) return;
  killTunnelTree(t);
}

function listTunnels(): TunnelStatus[] {
  return Array.from(tunnels.values()).map((t) => snapshot(t));
}

export function shutdownAllTunnels(): void {
  for (const t of tunnels.values()) killTunnelTree(t);
}

export function registerTunnelHandlers(): void {
  ipcMain.handle('tunnel:start', (_e, req: TunnelRequest) => startTunnel(req));
  ipcMain.handle('tunnel:stop', (_e, id: string) => stopTunnel(id));
  ipcMain.handle('tunnel:list', () => listTunnels());
}
