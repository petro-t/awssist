import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Play, Plus, RefreshCw, StopCircle, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import type { Profile, SsoLoginStatus } from '@shared/types';
import { AddSsoSessionDialog, AddProfileDialog } from '../components/AddDialogs';
import { PageHeader } from '../components/PageHeader';
import { SsoSessionCard } from '../components/SsoSessionCard';

export function Profiles(): JSX.Element {
  const { profiles, ssoSessions, sessions, refreshProfiles } = useApp();
  const [status, setStatus] = useState<Record<string, SsoLoginStatus>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showSso, setShowSso] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  async function refreshStatuses(): Promise<void> {
    const next: Record<string, SsoLoginStatus> = {};
    await Promise.all(
      profiles.filter((p) => p.kind === 'sso').map(async (p) => {
        next[p.name] = await window.awssist.ssoStatus(p.name);
      }),
    );
    setStatus(next);
  }

  useEffect(() => {
    void refreshStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length]);

  const grouped = groupBySsoSession(profiles);

  async function startSession(p: Profile, asDefault: boolean): Promise<void> {
    setBusy(p.name);
    try {
      await window.awssist.startSession(p.name, asDefault);
    } catch (err) {
      alert(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function endSession(p: Profile): Promise<void> {
    setBusy(p.name);
    try {
      await window.awssist.endSession(p.name);
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Profile): Promise<void> {
    if (!confirm(`Remove profile "${p.name}" from ~/.aws/config?`)) return;
    await window.awssist.removeProfile(p.name);
    await refreshProfiles();
  }

  return (
    <>
      <PageHeader title="Profiles" subtitle={`${profiles.length} profiles · ${ssoSessions.length} SSO sessions`}>
        <button className="btn-secondary" onClick={() => void refreshProfiles().then(refreshStatuses)}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button className="btn-secondary" onClick={() => setShowSso(true)}>
          <Plus size={14} /> SSO session
        </button>
        <button className="btn-primary" onClick={() => setShowProfile(true)}>
          <Plus size={14} /> Profile
        </button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {ssoSessions.length > 0 && (
          <section>
            <div className="text-xs uppercase tracking-wider text-fg-subtle mb-2">SSO sessions</div>
            {ssoSessions.map((s) => (
              <SsoSessionCard key={s.name} session={s} />
            ))}
          </section>
        )}
        {grouped.map(({ session, list }) => (
          <section key={session ?? '_other'}>
            <div className="text-xs uppercase tracking-wider text-fg-subtle mb-2">
              {session ? `SSO · ${session}` : 'Other'}
            </div>
            <div className="grid gap-2">
              {list.map((p) => {
                const st = status[p.name];
                const sess = sessions.find((s) => s.profile === p.name);
                return (
                  <div
                    key={p.name}
                    className="bg-bg-1 border border-border-muted hover:border-border rounded px-4 py-3 flex items-center gap-4"
                  >
                    <KeyRound size={18} className="text-fg-subtle shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg truncate">{p.alias ?? p.name}</span>
                        {p.alias && (
                          <span className="text-[11px] text-fg-subtle font-mono truncate">{p.name}</span>
                        )}
                        <KindBadge kind={p.kind} />
                        {st?.loggedIn && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-ok/15 text-ok border border-ok/30">
                            SSO valid
                          </span>
                        )}
                        {sess && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                            session · {countdown(sess.expiresAt)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-fg-subtle mt-0.5 selectable">
                        {p.ssoAccountId && <>acct {p.ssoAccountId} · </>}
                        {p.ssoRoleName && <>role {p.ssoRoleName} · </>}
                        {p.region}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {sess ? (
                        <button
                          className="btn-icon text-warn"
                          title="End session"
                          onClick={() => void endSession(p)}
                        >
                          <StopCircle size={14} />
                        </button>
                      ) : (
                        <button
                          className="btn-icon"
                          title="Start session (write creds)"
                          disabled={busy === p.name}
                          onClick={() => void startSession(p, false)}
                        >
                          <Play size={14} />
                        </button>
                      )}
                      <button
                        className="btn-icon"
                        title="Start as default"
                        disabled={busy === p.name}
                        onClick={() => void startSession(p, true)}
                      >
                        <span className="text-[10px] font-semibold">DEF</span>
                      </button>
                      <button
                        className="btn-icon"
                        title="Open AWS console"
                        onClick={() => void window.awssist.openConsole(p.name)}
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        className="btn-icon text-err/80 hover:text-err"
                        title="Remove"
                        onClick={() => void remove(p)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {profiles.length === 0 && (
          <div className="text-center text-fg-subtle py-16">
            <p className="mb-3">No profiles found in ~/.aws/config.</p>
            <div className="flex justify-center gap-2">
              <button className="btn-secondary" onClick={() => setShowSso(true)}>
                Add SSO session
              </button>
              <button className="btn-primary" onClick={() => setShowProfile(true)}>
                Add profile
              </button>
            </div>
          </div>
        )}
      </div>

      {showSso && <AddSsoSessionDialog onClose={() => setShowSso(false)} />}
      {showProfile && <AddProfileDialog onClose={() => setShowProfile(false)} />}
    </>
  );
}

function groupBySsoSession(profiles: Profile[]): { session: string | null; list: Profile[] }[] {
  const map = new Map<string | null, Profile[]>();
  for (const p of profiles) {
    const key = p.ssoSession ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const out: { session: string | null; list: Profile[] }[] = [];
  for (const [session, list] of map) out.push({ session, list: list.sort((a, b) => a.name.localeCompare(b.name)) });
  out.sort((a, b) => (a.session ?? 'zzz').localeCompare(b.session ?? 'zzz'));
  return out;
}

function KindBadge({ kind }: { kind: Profile['kind'] }): JSX.Element {
  const colors: Record<Profile['kind'], string> = {
    sso: 'bg-accent/15 text-accent border-accent/30',
    static: 'bg-gray-500/15 text-fg-muted border-gray-500/30',
    role: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    process: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    unknown: 'bg-gray-700/40 text-fg-muted border-gray-600/30',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${colors[kind]}`}>{kind}</span>
  );
}

function countdown(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
  return `${m}m`;
}

