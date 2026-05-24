import { StopCircle } from 'lucide-react';
import { useApp } from '../store';
import { PageHeader } from '../components/PageHeader';
import type { TunnelStatus } from '@shared/types';

export function Tunnels(): JSX.Element {
  const tunnels = useApp((s) => s.tunnels);
  return (
    <>
      <PageHeader title="SSM Tunnels" subtitle={`${tunnels.filter((t) => t.state === 'running').length} active`} />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tunnels.length === 0 ? (
          <div className="text-fg-subtle text-sm py-12 text-center">
            No tunnels yet. Open the <span className="text-fg-muted">RDS / Redis</span> tab to start one.
          </div>
        ) : (
          <div className="grid gap-2">
            {tunnels.map((t) => (
              <TunnelRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TunnelRow({ t }: { t: TunnelStatus }): JSX.Element {
  const colors: Record<TunnelStatus['state'], string> = {
    starting: 'text-warn',
    running: 'text-ok',
    stopped: 'text-fg-subtle',
    error: 'text-err',
  };
  return (
    <div className="card px-4 py-3 flex items-start gap-3">
      <div
        className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${
          t.state === 'running'
            ? 'bg-ok'
            : t.state === 'error'
            ? 'bg-err'
            : t.state === 'starting'
            ? 'bg-warn animate-pulse'
            : 'bg-gray-600'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium break-all">{t.label}</span>
          <span className={`text-[10px] uppercase ${colors[t.state]}`}>{t.state}</span>
        </div>
        <div className="text-xs text-fg-subtle mt-1 font-mono selectable break-all leading-relaxed">
          <span className="text-fg-muted">127.0.0.1:{t.localPort}</span>
          <span className="text-fg-subtle"> → </span>
          <span>{t.targetHost}:{t.remotePort}</span>
        </div>
        <div className="text-[11px] text-fg-subtle mt-1 selectable">
          {t.profile} · {t.region}
        </div>
        {t.error && (
          <div className="text-xs text-err mt-2 selectable whitespace-pre-wrap break-words">
            {t.error}
          </div>
        )}
      </div>
      {(t.state === 'running' || t.state === 'starting') && (
        <button
          className="btn-icon text-warn shrink-0"
          title="Stop tunnel"
          onClick={() => void window.awssist.stopTunnel(t.id)}
        >
          <StopCircle size={14} />
        </button>
      )}
    </div>
  );
}
