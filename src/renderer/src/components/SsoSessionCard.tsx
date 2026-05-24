import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LogIn, LogOut, Search, Loader2, Trash2 } from 'lucide-react';

const COMMON_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'sa-east-1',
];
import { useApp } from '../store';
import type {
  ImportSelection,
  SsoAccountRole,
  SsoSessionConfig,
  SsoSessionStatus,
} from '@shared/types';

export function SsoSessionCard({ session }: { session: SsoSessionConfig }): JSX.Element {
  const refreshProfiles = useApp((s) => s.refreshProfiles);
  const profiles = useApp((s) => s.profiles);

  const [status, setStatus] = useState<SsoSessionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<{ userCode: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SsoAccountRole[] | null>(null);
  const [picker, setPicker] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh(): Promise<void> {
    setStatus(await window.awssist.ssoSessionStatus(session.name));
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.name]);

  function stopPolling(): void {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  async function signIn(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const dev = await window.awssist.ssoSessionDeviceLogin(session.name);
      setDeviceInfo({ userCode: dev.userCode, uri: dev.verificationUriComplete });
      // Poll every 3s until we get a token (or fail).
      stopPolling();
      pollRef.current = setInterval(async () => {
        const out = await window.awssist.ssoSessionPoll(dev.pollKey);
        if (out.done) {
          stopPolling();
          setDeviceInfo(null);
          setBusy(false);
          await refresh();
        } else if (out.error) {
          stopPolling();
          setError(out.error);
          setBusy(false);
          setDeviceInfo(null);
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    const orphanCount = useApp.getState().profiles.filter((p) => p.ssoSession === session.name).length;
    const msg =
      orphanCount > 0
        ? `Remove SSO session "${session.name}"? ${orphanCount} profile(s) reference it and will no longer be able to sign in.`
        : `Remove SSO session "${session.name}"?`;
    if (!confirm(msg)) return;
    setError(null);
    setBusy(true);
    try {
      await window.awssist.removeSsoSession(session.name);
      await refreshProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discover(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const list = await window.awssist.ssoListAccountsAndRoles(session.name);
      setAccounts(list);
      setPicker(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    if (!confirm(`Sign out of SSO session "${session.name}"? Profiles linked to it will need a fresh sign-in before they can call AWS.`)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      stopPolling();
      setDeviceInfo(null);
      await window.awssist.ssoSessionSignOut(session.name);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg">{session.name}</span>
            {status?.loggedIn ? (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-ok/15 text-ok border border-ok/30">
                signed in
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-500/15 text-fg-muted border border-gray-500/30">
                signed out
              </span>
            )}
          </div>
          <div className="text-xs text-fg-subtle mt-0.5 selectable truncate">
            {session.ssoStartUrl} · {session.ssoRegion}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.loggedIn ? (
            <>
              <button className="btn-secondary" disabled={busy} onClick={() => void discover()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Discover accounts
              </button>
              <button
                className="btn-icon text-warn"
                title="Sign out"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut size={14} />
              </button>
            </>
          ) : (
            <button className="btn-primary" disabled={busy} onClick={() => void signIn()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
              Sign in
            </button>
          )}
          <button
            className="btn-icon text-err/80 hover:text-err"
            title="Remove SSO session"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {deviceInfo && (
        <div className="mt-3 p-3 rounded bg-bg-2 border border-border text-sm">
          <div className="flex items-center gap-2 text-fg-muted mb-1">
            <CheckCircle2 size={14} className="text-ok" />
            Browser opened. Confirm this code matches:
          </div>
          <div className="font-mono text-lg tracking-widest text-accent">{deviceInfo.userCode}</div>
          <div className="text-xs text-fg-subtle mt-2 selectable break-all">{deviceInfo.uri}</div>
        </div>
      )}

      {error && (
        <div className="mt-3 text-xs px-2 py-1.5 bg-err/10 border border-err/40 rounded text-err selectable whitespace-pre-wrap">
          {error}
        </div>
      )}

      {picker && accounts && (
        <ImportPicker
          session={session}
          accounts={accounts}
          existingProfileNames={new Set(profiles.map((p) => p.name))}
          defaultRegion="us-east-1"
          onClose={() => setPicker(false)}
          onImported={async () => {
            await refreshProfiles();
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}

function ImportPicker({
  session,
  accounts,
  existingProfileNames,
  defaultRegion,
  onClose,
  onImported,
}: {
  session: SsoSessionConfig;
  accounts: SsoAccountRole[];
  existingProfileNames: Set<string>;
  defaultRegion: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}): JSX.Element {
  type Row = SsoAccountRole & { key: string; profileName: string; region: string; selected: boolean; conflict: boolean };

  const init = (): Row[] =>
    accounts.map((a) => {
      const slug = (a.accountName ?? a.accountId).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      const profileName = slug;
      return {
        ...a,
        key: `${a.accountId}:${a.roleName}`,
        profileName,
        region: defaultRegion,
        selected: !existingProfileNames.has(profileName),
        conflict: existingProfileNames.has(profileName),
      };
    });

  const [rows, setRows] = useState<Row[]>(init);
  const [bulkRegion, setBulkRegion] = useState<string>(defaultRegion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyBulkRegion(region: string): void {
    setBulkRegion(region);
    setRows((rs) => rs.map((r) => ({ ...r, region })));
  }

  function update(key: string, patch: Partial<Row>): void {
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.profileName !== undefined) {
          next.conflict = existingProfileNames.has(next.profileName);
        }
        return next;
      }),
    );
  }

  const selected = rows.filter((r) => r.selected);
  const hasConflict = selected.some((r) => r.conflict);
  const duplicates = (() => {
    const seen = new Map<string, number>();
    for (const r of selected) seen.set(r.profileName, (seen.get(r.profileName) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  })();

  async function submit(): Promise<void> {
    setError(null);
    if (duplicates.length > 0) {
      setError(`Duplicate profile names: ${duplicates.join(', ')}`);
      return;
    }
    if (hasConflict) {
      setError('Some selected profiles already exist — rename or deselect them first.');
      return;
    }
    setBusy(true);
    try {
      const payload: ImportSelection[] = selected.map((r) => ({
        accountId: r.accountId,
        accountName: r.accountName,
        roleName: r.roleName,
        profileName: r.profileName,
        region: r.region,
      }));
      await window.awssist.importSsoProfiles(session.name, payload);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-bg-2 border border-border rounded-lg w-[820px] max-w-full max-h-full flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-muted flex items-center gap-3">
          <h2 className="text-sm font-semibold flex-1">
            Import accounts from <span className="font-mono">{session.name}</span>
          </h2>
          <label className="text-xs text-fg-muted flex items-center gap-2">
            Region for all
            <select
              className="input max-w-[140px]"
              value={bulkRegion}
              onChange={(e) => applyBulkRegion(e.target.value)}
            >
              {COMMON_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="text-xs text-fg-subtle">{selected.length}/{rows.length} selected</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-2 border-b border-border-muted">
              <tr className="text-left text-[10px] uppercase tracking-wide text-fg-subtle">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && rows.every((r) => r.selected)}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))
                    }
                  />
                </th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Profile name</th>
                <th className="px-3 py-2 w-28">Region</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border-muted/40">
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      onChange={(e) => update(r.key, { selected: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="text-fg">{r.accountName ?? '(unnamed)'}</div>
                    <div className="text-[11px] text-fg-subtle font-mono selectable">{r.accountId}</div>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-fg-muted">{r.roleName}</td>
                  <td className="px-3 py-1.5">
                    <input
                      className={`input ${r.conflict ? 'border-warn/60' : ''}`}
                      value={r.profileName}
                      onChange={(e) => update(r.key, { profileName: e.target.value })}
                    />
                    {r.conflict && (
                      <div className="text-[10px] text-warn mt-0.5">already exists in ~/.aws/config</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="input"
                      value={r.region}
                      onChange={(e) => update(r.key, { region: e.target.value })}
                    >
                      {COMMON_REGIONS.map((reg) => (
                        <option key={reg} value={reg}>{reg}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="text-center text-fg-subtle py-12">No accounts available under this SSO session.</div>
          )}
        </div>

        {error && (
          <div className="mx-4 my-2 text-xs px-2 py-1.5 bg-err/10 border border-err/40 rounded text-err selectable">
            {error}
          </div>
        )}

        <div className="px-4 py-3 border-t border-border-muted flex justify-end gap-2">
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || selected.length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Importing…' : `Import ${selected.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
