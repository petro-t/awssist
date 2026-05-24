import { useEffect, useState } from 'react';
import { Network, Server, X } from 'lucide-react';
import type { Ec2InstanceRef, TunnelRequest, TunnelStatus } from '@shared/types';

export interface TunnelTarget {
  label: string;
  host: string;
  remotePort: number;
  defaultLocalPort: number;
  profile: string;
  region: string;
}

export function TunnelDialog({
  target,
  bastions,
  onClose,
  onStarted,
}: {
  target: TunnelTarget;
  bastions: Ec2InstanceRef[];
  onClose: () => void;
  onStarted: (status: TunnelStatus) => void;
}): JSX.Element {
  const [bastionId, setBastionId] = useState<string>(bastions[0]?.instanceId ?? '');
  const [localPort, setLocalPort] = useState<string>(String(target.defaultLocalPort));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If bastion list shrinks/changes, keep selection valid.
  useEffect(() => {
    if (!bastions.some((b) => b.instanceId === bastionId) && bastions[0]) {
      setBastionId(bastions[0].instanceId);
    }
  }, [bastions, bastionId]);

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
    const portNum = Number(localPort);
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      setError('Local port must be between 1 and 65535.');
      return;
    }
    const req: TunnelRequest = {
      profile: target.profile,
      region: target.region,
      bastionInstanceId: bastionId,
      targetHost: target.host,
      remotePort: target.remotePort,
      localPort: portNum,
      label: target.label,
    };
    setBusy(true);
    try {
      const status = await window.awssist.startTunnel(req);
      onStarted(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-bg-2 border border-border rounded-lg shadow-xl w-[520px] max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-border-muted">
          <Network size={14} className="text-accent mr-2" />
          <h2 className="text-sm font-semibold flex-1">Start tunnel</h2>
          <button className="text-fg-muted hover:text-fg" disabled={busy} onClick={onClose}>
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
            <div className="text-xs uppercase tracking-wide text-fg-subtle mb-1">Local port</div>
            <input
              className="input"
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder={String(target.defaultLocalPort)}
            />
            <div className="text-[11px] text-fg-subtle mt-1">
              Connect to <span className="font-mono">127.0.0.1:{localPort || target.defaultLocalPort}</span> from your local tools.
            </div>
          </div>

          {error && (
            <div className="text-xs px-2 py-1.5 bg-err/10 border border-err/40 rounded text-err selectable whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border-muted flex justify-end gap-2">
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || bastions.length === 0} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Start tunnel'}
          </button>
        </div>
      </div>
    </div>
  );
}
