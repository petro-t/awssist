import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Network, RotateCcw, Server, X, XCircle } from 'lucide-react';
import { useApp } from '../store';
import type { Ec2InstanceRef, TunnelRequest, TunnelStatus } from '@shared/types';

export interface TunnelTarget {
  label: string;
  host: string;
  remotePort: number;
  defaultLocalPort: number;
  profile: string;
  region: string;
}

// Per-target local-port memory. Some databases refuse to bind the "obvious"
// default (5432/6379) locally — devs pick a personal port and don't want to
// retype it every session. Key is deterministic per target so a Postgres
// cluster remembers its own port independently of Redis.
function portStorageKey(t: TunnelTarget): string {
  return `awssist:tunnelPort:${t.profile}:${t.host}:${t.remotePort}`;
}

function loadSavedPort(t: TunnelTarget): number | null {
  try {
    const raw = localStorage.getItem(portStorageKey(t));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : null;
  } catch {
    return null;
  }
}

function saveSavedPort(t: TunnelTarget, port: number): void {
  try {
    localStorage.setItem(portStorageKey(t), String(port));
  } catch {
    /* localStorage unavailable */
  }
}

function clearSavedPort(t: TunnelTarget): void {
  try {
    localStorage.removeItem(portStorageKey(t));
  } catch {
    /* localStorage unavailable */
  }
}

export function TunnelDialog({
  target,
  bastions,
  onClose,
}: {
  target: TunnelTarget;
  bastions: Ec2InstanceRef[];
  onClose: () => void;
}): JSX.Element {
  const [bastionId, setBastionId] = useState<string>(bastions[0]?.instanceId ?? '');
  const savedPort = useMemo(() => loadSavedPort(target), [target]);
  const [localPort, setLocalPort] = useState<string>(
    String(savedPort ?? target.defaultLocalPort),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once a tunnel is in flight, we track its id and surface live status from the store.
  const [tunnelId, setTunnelId] = useState<string | null>(null);

  // Subscribe to the live tunnel state for the tunnel this dialog started.
  // The dialog stays open even after the tunnel reaches `running` so the user
  // can read the success confirmation; they close it explicitly via the Close
  // button. The tunnel itself keeps running in the background after close.
  const liveTunnel = useApp((s) => (tunnelId ? s.tunnels.find((t) => t.id === tunnelId) : undefined));

  // If bastion list shrinks/changes, keep selection valid.
  useEffect(() => {
    if (!bastions.some((b) => b.instanceId === bastionId) && bastions[0]) {
      setBastionId(bastions[0].instanceId);
    }
  }, [bastions, bastionId]);

  const portNumNow = useMemo(() => Number(localPort), [localPort]);
  const portValid = Number.isFinite(portNumNow) && portNumNow >= 1 && portNumNow <= 65535;

  async function start(): Promise<void> {
    setError(null);
    if (bastions.length === 0) {
      setError('No bastion host found in this account/region. Tag an EC2 instance with Name=*bastion* and refresh.');
      return;
    }
    if (!bastionId) {
      setError('Pick a bastion host.');
      return;
    }
    if (!portValid) {
      setError('Local port must be between 1 and 65535.');
      return;
    }
    const req: TunnelRequest = {
      profile: target.profile,
      region: target.region,
      bastionInstanceId: bastionId,
      targetHost: target.host,
      remotePort: target.remotePort,
      localPort: portNumNow,
      label: target.label,
    };
    setBusy(true);
    try {
      const status = await window.awssist.startTunnel(req);
      // Persist as this target's remembered port so it prefills next time —
      // but only when it actually differs from the built-in default. That
      // keeps the storage empty for anyone who has never customised it.
      if (portNumNow === target.defaultLocalPort) {
        clearSavedPort(target);
      } else {
        saveSavedPort(target, portNumNow);
      }
      setTunnelId(status.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  // Once we have a tunnelId, the dialog body switches to the status view.
  const inFlight = tunnelId !== null;
  const finalState = liveTunnel?.state;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={busy && !inFlight ? undefined : onClose}
    >
      <div
        className="bg-bg-2 border border-border rounded-lg shadow-xl w-[520px] max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-border-muted">
          <Network size={14} className="text-accent mr-2" />
          <h2 className="text-sm font-semibold flex-1">
            {inFlight ? 'Tunnel status' : 'Start tunnel'}
          </h2>
          <button className="text-fg-muted hover:text-fg" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="card p-3 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-fg-subtle w-24">Target</span>
              <span className="font-medium text-fg">{target.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-fg-subtle w-24">Host</span>
              <span className="font-mono text-fg-muted selectable break-all">{target.host}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-fg-subtle w-24">Remote port</span>
              <span className="font-mono text-fg-muted">{target.remotePort}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-fg-subtle w-24">Profile</span>
              <span className="font-mono text-fg-muted">{target.profile} · {target.region}</span>
            </div>
          </div>

          {!inFlight && (
            <>
              <div>
                <div className="text-xs uppercase tracking-wide text-fg-subtle mb-1">Bastion host</div>
                {bastions.length === 0 ? (
                  <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1.5">
                    No bastion EC2 instances found. The script-based toolbox uses tag <code>Name=*bastion*</code>.
                  </div>
                ) : bastions.length === 1 ? (
                  <div className="card p-2 text-sm flex items-center gap-2">
                    <Server size={14} className="text-fg-subtle" />
                    <span className="flex-1">{bastions[0].name ?? bastions[0].instanceId}</span>
                    <span className="text-[11px] text-fg-subtle font-mono">{bastions[0].instanceId}</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {bastions.map((b) => (
                      <label
                        key={b.instanceId}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-sm ${
                          bastionId === b.instanceId
                            ? 'bg-accent/10 border-accent/40 text-fg'
                            : 'border-border-muted hover:border-border text-fg-muted'
                        }`}
                      >
                        <input
                          type="radio"
                          name="bastion"
                          checked={bastionId === b.instanceId}
                          onChange={() => setBastionId(b.instanceId)}
                        />
                        <Server size={12} className="text-fg-subtle" />
                        <span className="flex-1 truncate">{b.name ?? b.instanceId}</span>
                        <span className="text-[11px] text-fg-subtle font-mono">{b.instanceId}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-fg-subtle mb-1 flex items-center gap-2">
                  <span>Local port</span>
                  {portNumNow !== target.defaultLocalPort && Number.isFinite(portNumNow) && (
                    <button
                      type="button"
                      className="ml-auto flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg"
                      title={`Reset to default (${target.defaultLocalPort})`}
                      onClick={() => setLocalPort(String(target.defaultLocalPort))}
                    >
                      <RotateCcw size={10} /> reset to {target.defaultLocalPort}
                    </button>
                  )}
                </div>
                <input
                  className="input"
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  placeholder={String(target.defaultLocalPort)}
                />
                <div className="text-[11px] text-fg-subtle mt-1">
                  Connect to <span className="font-mono">127.0.0.1:{localPort || target.defaultLocalPort}</span> from your local tools.
                  {savedPort !== null && savedPort !== target.defaultLocalPort && (
                    <span className="ml-1">Remembered from last time.</span>
                  )}
                </div>
              </div>
            </>
          )}

          {inFlight && (
            <StatusBlock
              status={liveTunnel}
              localPort={portNumNow}
              host={target.host}
              remotePort={target.remotePort}
            />
          )}

          {error && (
            <div className="text-xs px-2 py-1.5 bg-err/10 border border-err/40 rounded text-err selectable whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-muted flex justify-end gap-2">
          {!inFlight && (
            <>
              <button className="btn-secondary" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={busy || bastions.length === 0}
                onClick={() => void start()}
              >
                {busy ? 'Starting…' : 'Start tunnel'}
              </button>
            </>
          )}
          {inFlight && (
            <>
              {finalState === 'running' || finalState === 'error' || finalState === 'stopped' ? (
                <button className="btn-secondary" onClick={onClose}>Close</button>
              ) : (
                <button className="btn-secondary" disabled onClick={onClose}>
                  Establishing…
                </button>
              )}
              {finalState === 'running' && tunnelId && (
                <button
                  className="btn-primary"
                  onClick={() => {
                    void window.awssist.stopTunnel(tunnelId);
                  }}
                >
                  Stop tunnel
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBlock({
  status,
  localPort,
  host,
  remotePort,
}: {
  status: TunnelStatus | undefined;
  localPort: number;
  host: string;
  remotePort: number;
}): JSX.Element {
  // Until the main-process broadcast lands, status may be undefined for a beat.
  const state = status?.state ?? 'starting';

  if (state === 'running') {
    return (
      <div className="rounded border border-ok/40 bg-ok/10 px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-ok">
          <CheckCircle2 size={16} />
          <span className="font-medium">Tunnel established</span>
        </div>
        <div className="text-xs text-fg-muted mt-1.5">
          Connect from your local tools to{' '}
          <span className="font-mono text-fg">127.0.0.1:{localPort}</span> — it forwards
          to <span className="font-mono">{host}:{remotePort}</span>.
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded border border-err/40 bg-err/10 px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-err">
          <XCircle size={16} />
          <span className="font-medium">Tunnel failed to start</span>
        </div>
        {status?.error && (
          <div className="text-xs text-err mt-1.5 font-mono whitespace-pre-wrap break-words selectable">
            {status.error}
          </div>
        )}
      </div>
    );
  }

  if (state === 'stopped') {
    return (
      <div className="rounded border border-border-muted bg-bg-3 px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-fg-muted">
          <XCircle size={16} />
          <span className="font-medium">Tunnel stopped</span>
        </div>
      </div>
    );
  }

  // starting
  return (
    <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2 text-warn">
        <Loader2 size={16} className="animate-spin" />
        <span className="font-medium">Establishing tunnel…</span>
      </div>
      <div className="text-xs text-fg-muted mt-1.5">
        Spawning <span className="font-mono">aws ssm start-session</span> and waiting for
        the local listener on <span className="font-mono">127.0.0.1:{localPort}</span> to come up.
        This usually takes 2–5 seconds.
      </div>
    </div>
  );
}
