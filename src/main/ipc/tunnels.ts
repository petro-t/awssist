import { randomUUID } from 'node:crypto';
import { ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { BrowserWindow, ipcMain } from 'electron';
import { makeCredentialsProvider } from '../aws/credentials';
import type { TunnelRequest, TunnelStatus } from '@shared/types';

/**
 * Briefly bind a TCP server on 127.0.0.1:<port> to probe availability. If
 * something else is already listening, bind returns EADDRINUSE and we know
 * not to even spawn the AWS CLI — otherwise `aws ssm start-session` would
 * hang indefinitely in "starting", since the wrapper python process doesn't
 * always exit when session-manager-plugin's bind fails.
 */
async function probePort(port: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    const probe = createServer();
    const done = (result: { ok: true } | { ok: false; reason: string }): void => {
      try {
        probe.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        probe.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        done({
          ok: false,
          reason:
            `Local port ${port} is already in use on 127.0.0.1. ` +
            `Stop whatever is bound to it (e.g. an older AWSsist tunnel, or a local server) — or pick a different local port and try again.`,
        });
      } else if (err.code === 'EACCES') {
        done({
          ok: false,
          reason: `Permission denied binding port ${port}. Ports below 1024 require sudo; pick a higher port (e.g. 15432).`,
        });
      } else {
        done({ ok: false, reason: `${err.code ?? 'Error'}: ${err.message}` });
      }
    });
    probe.once('listening', () => done({ ok: true }));
    probe.listen(port, '127.0.0.1');
  });
}

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

  // Pre-flight port probe. Fail fast and cleanly when the port is taken — the
  // alternative is `aws ssm start-session` hanging indefinitely in "starting".
  const probe = await probePort(req.localPort);
  if (!probe.ok) {
    status.state = 'error';
    status.error = probe.reason;
    broadcast(snapshot(tunnel));
    // Auto-drop the entry from the registry shortly so the Tunnels tab doesn't
    // accumulate errored rows the user has to click to clear.
    setTimeout(() => {
      tunnels.delete(id);
      broadcastRemoval(id);
    }, 8000);
    return snapshot(tunnel);
  }

  const args = [
    'ssm',
    'start-session',
    '--target',
    req.bastionInstanceId,
    '--document-name',
    'AWS-StartPortForwardingSessionToRemoteHost',
    '--parameters',
    `host=${req.targetHost},portNumber=${req.remotePort},localPortNumber=${req.localPort}`,
    '--region',
    req.region,
  ];

  // Resolve fresh credentials via AWSsist's own refresh-aware resolver and pass
  // them as env vars rather than `--profile`. Passing the profile would let the
  // AWS CLI pick up expired temp creds left in ~/.aws/credentials by
  // "Start session", which fails the SSM handshake with ExpiredTokenException.
  let credentialEnv: Record<string, string>;
  try {
    const creds = await makeCredentialsProvider(req.profile)();
    credentialEnv = {
      AWS_ACCESS_KEY_ID: creds.accessKeyId,
      AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
      AWS_REGION: req.region,
      AWS_DEFAULT_REGION: req.region,
    };
    if (creds.sessionToken) credentialEnv.AWS_SESSION_TOKEN = creds.sessionToken;
  } catch (err) {
    status.state = 'error';
    status.error =
      err instanceof Error ? err.message : `Failed to resolve credentials for ${req.profile}`;
    broadcast(snapshot(tunnel));
    return snapshot(tunnel);
  }

  // Start from our own env, drop any inherited profile selection, then layer in
  // the freshly-resolved keys so the CLI uses those rather than a config profile.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...credentialEnv, AWS_PAGER: '' };
  delete childEnv.AWS_PROFILE;
  delete childEnv.AWS_DEFAULT_PROFILE;

  const proc = spawn('aws', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
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

  // Safety net: if the process is still in "starting" 30 s in (no "Waiting for
  // connections" line, no exit), treat as failure and tear it down. Covers the
  // rare case where the CLI hangs without printing a usable error.
  const startupTimer = setTimeout(() => {
    if (status.state === 'starting') {
      const tail = bootBuffer.split('\n').slice(-5).join('\n').trim();
      status.state = 'error';
      status.error =
        tail ||
        'Tunnel did not establish within 30 seconds. The bastion may not have SSM access, or the AWS CLI hung. Try again, or check the bastion.';
      broadcast(snapshot(tunnel));
      killTunnelTree(tunnel);
    }
  }, 30_000);

  proc.on('close', (code) => {
    if (tunnel.killTimer) {
      clearTimeout(tunnel.killTimer);
      tunnel.killTimer = undefined;
    }
    clearTimeout(startupTimer);
    if (status.state !== 'error') {
      const tail = bootBuffer.split('\n').slice(-5).join('\n').trim();
      const exitedDuringStartup = status.state === 'starting';
      if (code !== 0 && code !== null) {
        status.state = 'error';
        status.error = tail || `aws ssm start-session exited with code ${code}`;
      } else if (exitedDuringStartup) {
        // Clean exit before we ever saw "Waiting for connections" — something
        // gave up before binding. Treat as a failure so the dialog shows red
        // rather than a misleading "stopped" green-tinged neutral.
        status.state = 'error';
        status.error =
          tail || 'aws ssm start-session exited before the tunnel finished establishing.';
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
