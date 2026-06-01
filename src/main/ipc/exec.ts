import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ipcMain } from 'electron';
import { makeCredentialsProvider } from '../aws/credentials';
import type { ExecRequest } from '@shared/types';

// ---------- Shell quoting ----------

function shellSingleQuote(value: string): string {
  // POSIX-safe: wrap in single quotes, escape embedded single quotes.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function winQuoteForCmd(value: string): string {
  // cmd.exe escaping is fiddly. Wrap in double quotes; escape internal " as "".
  // The values we pass (AWS resource ARNs/IDs/regions) don't contain shell
  // metacharacters in practice, so this is sufficient.
  return `"${value.replace(/"/g, '""')}"`;
}

// ---------- Per-platform launchers ----------

interface Job {
  title: string;
  // The command + args to run in the terminal window.
  argv: string[];
  // Environment variables to export before running argv. Used to inject
  // freshly-resolved AWS credentials so we never depend on the AWS CLI's own
  // profile resolution (which can pick up stale temp creds left in
  // ~/.aws/credentials by "Start session", causing ExpiredTokenException).
  env?: Record<string, string>;
}

// Best-effort delete of the temp launch script a few seconds after we hand it
// to the terminal — by then the shell has read it. The scripts on mac/linux
// also self-delete (see below); this is the cross-platform backstop, important
// on Windows where the .bat can't reliably delete itself while running.
function scheduleCleanup(path: string): void {
  setTimeout(() => {
    fs.unlink(path).catch(() => {});
  }, 15_000);
}

async function openOnMac(job: Job): Promise<void> {
  const env = job.env ?? {};
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${shellSingleQuote(v)}`);
  // Wrap in { } so bash reads the whole block before executing — that lets us
  // `rm "$0"` (limiting how long the injected creds sit on disk) before `exec`.
  const lines = [
    '#!/bin/bash',
    '{',
    // Clear any profile the user's shell rc may export — otherwise the CLI
    // would try to resolve it instead of using the injected keys.
    'unset AWS_PROFILE AWS_DEFAULT_PROFILE',
    ...exports,
    'rm -f -- "$0"',
    `printf '%s\\n\\n' ${shellSingleQuote(`AWSsist → ${job.title}`)}`,
    `exec ${job.argv.map(shellSingleQuote).join(' ')}`,
    '}',
    '',
  ];
  const scriptPath = join(tmpdir(), `awssist-${randomUUID()}.command`);
  await fs.writeFile(scriptPath, lines.join('\n'), { mode: 0o700 });
  spawn('open', ['-a', 'Terminal', scriptPath], { stdio: 'ignore', detached: true }).unref();
  scheduleCleanup(scriptPath);
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
  const env = job.env ?? {};
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${shellSingleQuote(v)}`);
  const lines = [
    '#!/bin/bash',
    '{',
    'unset AWS_PROFILE AWS_DEFAULT_PROFILE',
    ...exports,
    'rm -f -- "$0"',
    `printf '%s\\n\\n' ${shellSingleQuote(`AWSsist → ${job.title}`)}`,
    `${job.argv.map(shellSingleQuote).join(' ')}`,
    'status=$?',
    `printf '\\n[session ended, exit %s — press Enter to close]\\n' "$status"`,
    'read',
    '}',
    '',
  ];
  const scriptPath = join(tmpdir(), `awssist-${randomUUID()}.sh`);
  await fs.writeFile(scriptPath, lines.join('\n'), { mode: 0o700 });

  for (const t of LINUX_TERMINALS) {
    if (await hasBinary(t.bin)) {
      spawn(t.bin, t.toArgs(scriptPath), { stdio: 'ignore', detached: true }).unref();
      scheduleCleanup(scriptPath);
      return;
    }
  }
  await fs.unlink(scriptPath).catch(() => {});
  throw new Error(
    'No supported terminal emulator was found. Install one of: gnome-terminal, konsole, kitty, alacritty, wezterm, tilix, xfce4-terminal, xterm.',
  );
}

async function openOnWindows(job: Job): Promise<void> {
  const env = job.env ?? {};
  const sets = Object.entries(env).map(([k, v]) => `set "${k}=${v.replace(/[%]/g, '%%')}"`);
  const lines = [
    '@echo off',
    `title AWSsist - ${job.title.replace(/[<>|&]/g, '_')}`,
    // Empty `set "VAR="` removes the variable in cmd.exe (unlike bash export).
    'set "AWS_PROFILE="',
    'set "AWS_DEFAULT_PROFILE="',
    ...sets,
    `echo AWSsist - ${job.title.replace(/[<>|&]/g, '_')}`,
    'echo.',
    `${job.argv.map(winQuoteForCmd).join(' ')}`,
    'echo.',
    'echo [session ended - press any key to close]',
    'pause >nul',
    'del "%~f0"',
    '',
  ];
  const scriptPath = join(tmpdir(), `awssist-${randomUUID()}.bat`);
  await fs.writeFile(scriptPath, lines.join('\r\n'));
  spawn('cmd.exe', ['/c', 'start', '""', scriptPath], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  scheduleCleanup(scriptPath);
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

// ---------- Credential injection ----------

/**
 * Resolve fresh credentials for a profile and turn them into the AWS_* env vars
 * the CLI honours. Goes through AWSsist's own resolver, which refreshes SSO
 * tokens transparently — so the terminal never falls back to the CLI's profile
 * resolution and can't pick up expired temp creds sitting in ~/.aws/credentials.
 */
async function credEnv(profile: string, region: string): Promise<Record<string, string>> {
  const creds = await makeCredentialsProvider(profile)();
  // Only real values here. AWS_PROFILE/AWS_DEFAULT_PROFILE are *unset* in the
  // generated script (a set-but-empty AWS_PROFILE makes the CLI look up a
  // profile literally named "").
  const env: Record<string, string> = {
    AWS_ACCESS_KEY_ID: creds.accessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };
  if (creds.sessionToken) env.AWS_SESSION_TOKEN = creds.sessionToken;
  return env;
}

// ---------- IPC handlers ----------

async function execInTerminal(req: ExecRequest): Promise<void> {
  const cmd = req.command ?? '/bin/bash';
  const env = await credEnv(req.profile, req.region);
  return openInTerminal({
    title: `exec ${req.container} (${req.task.split('/').pop()})`,
    env,
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
  const env = await credEnv(profile, region);
  return openInTerminal({
    title: `SSM session: ${label}`,
    env,
    argv: ['aws', 'ssm', 'start-session', '--target', instanceId, '--region', region],
  });
}

export function registerExecHandlers(): void {
  ipcMain.handle('exec:inTerminal', (_e, req: ExecRequest) => execInTerminal(req));
  ipcMain.handle('ssm:startSession', (_e, profile: string, region: string, instanceId: string, name?: string) =>
    ssmInTerminal(profile, region, instanceId, name),
  );
}

// Kept for symmetry with shutdownAllTunnels; no in-process child sessions to
// clean up now that PTY sessions are gone.
export function shutdownAllExec(): void {
  /* no-op */
}
