import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ipcMain } from 'electron';
import type { ExecRequest } from '@shared/types';

// ---------- Shell quoting ----------

function shellSingleQuote(value: string): string {
  // POSIX-safe: wrap in single quotes, escape embedded single quotes.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function winQuoteForCmd(value: string): string {
  // cmd.exe escaping is fiddly. Wrap in double quotes; escape internal " as "".
  // The values we pass (AWS resource ARNs/IDs/profiles/regions) don't contain
  // shell metacharacters in practice, so this is sufficient.
  return `"${value.replace(/"/g, '""')}"`;
}

// ---------- Per-platform launchers ----------

interface Job {
  title: string;
  // The command + args to run in the terminal window.
  argv: string[];
}

async function openOnMac(job: Job): Promise<void> {
  const lines = [
    '#!/bin/bash',
    `echo "AWSsist → ${job.title}"`,
    'echo',
    `exec ${job.argv.map(shellSingleQuote).join(' ')}`,
    '',
  ];
  const scriptPath = join(tmpdir(), `awssist-${randomUUID()}.command`);
  await fs.writeFile(scriptPath, lines.join('\n'), { mode: 0o700 });
  spawn('open', ['-a', 'Terminal', scriptPath], { stdio: 'ignore', detached: true }).unref();
}

const LINUX_TERMINALS: Array<{ bin: string; toArgs: (script: string) => string[] }> = [
  { bin: 'gnome-terminal', toArgs: (s) => ['--', 'bash', s] },
  { bin: 'konsole', toArgs: (s) => ['-e', 'bash', s] },
  { bin: 'kitty', toArgs: (s) => ['bash', s] },
  { bin: 'alacritty', toArgs: (s) => ['-e', 'bash', s] },
  { bin: 'wezterm', toArgs: (s) => ['start', '--', 'bash', s] },
  { bin: 'tilix', toArgs: (s) => ['-e', `bash ${s}`] },
  { bin: 'xfce4-terminal', toArgs: (s) => ['-e', `bash ${s}`] },
  { bin: 'xterm', toArgs: (s) => ['-e', 'bash', s] },
  { bin: 'x-terminal-emulator', toArgs: (s) => ['-e', 'bash', s] },
];

function hasBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', [bin], { timeout: 1000 }, (err, stdout) => resolve(!err && stdout.trim().length > 0));
  });
}

async function openOnLinux(job: Job): Promise<void> {
  const lines = [
    '#!/bin/bash',
    `echo "AWSsist → ${job.title}"`,
    'echo',
    `${job.argv.map(shellSingleQuote).join(' ')}`,
    'status=$?',
    'echo',
    'echo "[session ended, exit $status — press Enter to close]"',
    'read',
    '',
  ];
  const scriptPath = join(tmpdir(), `awssist-${randomUUID()}.sh`);
  await fs.writeFile(scriptPath, lines.join('\n'), { mode: 0o755 });

  for (const t of LINUX_TERMINALS) {
    if (await hasBinary(t.bin)) {
      spawn(t.bin, t.toArgs(scriptPath), { stdio: 'ignore', detached: true }).unref();
      return;
    }
  }
  throw new Error(
    'No supported terminal emulator was found. Install one of: gnome-terminal, konsole, kitty, alacritty, wezterm, tilix, xfce4-terminal, xterm.',
  );
}

async function openOnWindows(job: Job): Promise<void> {
  const lines = [
    '@echo off',
    `title AWSsist - ${job.title.replace(/[<>|]/g, '_')}`,
    `echo AWSsist - ${job.title}`,
    'echo.',
    `${job.argv.map(winQuoteForCmd).join(' ')}`,
    'echo.',
    'echo [session ended - press any key to close]',
    'pause >nul',
    '',
  ];
  const scriptPath = join(tmpdir(), `awssist-${randomUUID()}.bat`);
  await fs.writeFile(scriptPath, lines.join('\r\n'));
  // `cmd /c start "" "<script>"` launches it in a fresh window without blocking.
  // Windows Terminal (wt.exe) would be nicer when present, but plain cmd is universally available.
  spawn('cmd.exe', ['/c', 'start', '""', scriptPath], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

async function openInTerminal(job: Job): Promise<void> {
  switch (platform()) {
    case 'darwin':
      return openOnMac(job);
    case 'win32':
      return openOnWindows(job);
    default:
      return openOnLinux(job);
  }
}

// ---------- IPC handlers ----------

async function execInTerminal(req: ExecRequest): Promise<void> {
  const cmd = req.command ?? '/bin/bash';
  return openInTerminal({
    title: `exec ${req.container} (${req.task.split('/').pop()})`,
    argv: [
      'aws',
      'ecs',
      'execute-command',
      '--cluster',
      req.cluster,
      '--task',
      req.task,
      '--container',
      req.container,
      '--command',
      cmd,
      '--interactive',
      '--profile',
      req.profile,
      '--region',
      req.region,
    ],
  });
}

async function ssmInTerminal(
  profile: string,
  region: string,
  instanceId: string,
  displayName?: string,
): Promise<void> {
  const label = displayName ? `${displayName} (${instanceId})` : instanceId;
  return openInTerminal({
    title: `SSM session: ${label}`,
    argv: ['aws', 'ssm', 'start-session', '--target', instanceId, '--profile', profile, '--region', region],
  });
}

export function registerExecHandlers(): void {
  ipcMain.handle('exec:inTerminal', (_e, req: ExecRequest) => execInTerminal(req));
  ipcMain.handle('ssm:startSession', (_e, profile: string, region: string, instanceId: string, name?: string) =>
    ssmInTerminal(profile, region, instanceId, name),
  );
}

// Kept for symmetry with shutdownAllTunnels; no in-process child sessions to clean up
// now that PTY sessions are gone.
export function shutdownAllExec(): void {
  /* no-op */
}
