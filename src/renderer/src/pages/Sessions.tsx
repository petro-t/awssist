import { useEffect, useState } from 'react';
import { StopCircle } from 'lucide-react';
import { useApp } from '../store';
import { PageHeader } from '../components/PageHeader';

export function Sessions(): JSX.Element {
  const { sessions, refreshSessions } = useApp();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    void refreshSessions();
    return () => clearInterval(id);
  }, [refreshSessions]);

  return (
    <>
      <PageHeader title="Sessions" subtitle={`${sessions.length} active`} />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sessions.length === 0 ? (
          <div className="text-fg-subtle text-sm py-12 text-center">
            No active sessions. Start one from the Profiles tab.
          </div>
        ) : (
          <div className="grid gap-2">
            {sessions.map((s) => (
              <div key={s.profile} className="card px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-fg">{s.profile}</div>
                  <div className="text-xs text-fg-subtle selectable mt-0.5">
                    {s.arn ?? s.accountId ?? ''} · {s.region ?? '-'} · expires in {remaining(s.expiresAt)}
                  </div>
                  <div className="text-[11px] text-fg-subtle font-mono mt-0.5 selectable">{s.accessKeyId}</div>
                </div>
                <button
                  className="btn-icon text-warn"
                  title="End session"
                  onClick={() => void window.awssist.endSession(s.profile)}
                >
                  <StopCircle size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function remaining(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}
