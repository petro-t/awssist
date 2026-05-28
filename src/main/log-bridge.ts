import { BrowserWindow } from 'electron';
import { inspect } from 'node:util';

type Level = 'log' | 'warn' | 'error';

interface LogEntry {
  level: Level;
  message: string;
  time: number;
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      // util.inspect handles circulars and nested objects far better than JSON.stringify.
      return inspect(a, { depth: 4, colors: false, breakLength: 120 });
    })
    .join(' ');
}

function broadcast(entry: LogEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('main:log', entry);
    } catch {
      /* window may be closing */
    }
  }
}

function tap(level: Level): void {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    original(...args);
    broadcast({ level, message: format(args), time: Date.now() });
  };
}

/**
 * Patches console.log/warn/error in the main process so every emitted line is
 * also broadcast to renderer windows. The renderer subscribes via
 * `window.awssist.onMainLog` and replays into DevTools — otherwise main-process
 * output is invisible in a packaged app launched via `open`.
 *
 * Safe to call once at app startup. Idempotent guard via the marker flag.
 */
let installed = false;
export function installLogBridge(): void {
  if (installed) return;
  installed = true;
  tap('log');
  tap('warn');
  tap('error');
}
