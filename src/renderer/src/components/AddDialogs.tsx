import { useEffect, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { useApp } from '../store';
import type { Profile, ProfileKind } from '@shared/types';

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

type AccessMethod = 'federated' | 'user' | 'chained';

const METHOD_TO_KIND: Record<AccessMethod, ProfileKind> = {
  federated: 'sso',
  user: 'static',
  chained: 'role',
};

const METHOD_LABEL: Record<AccessMethod, string> = {
  federated: 'AWS IAM Role Federated',
  user: 'AWS IAM User',
  chained: 'AWS IAM Role Chained',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-bg-2 border border-border rounded-lg shadow-xl w-[480px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-border-muted">
          <h2 className="text-sm font-semibold flex-1">{title}</h2>
          <button className="text-fg-muted hover:text-fg" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block mb-3">
      <div className="text-xs uppercase tracking-wide text-fg-subtle mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-fg-subtle mt-1">{hint}</div>}
    </label>
  );
}

function ErrorBox({ message }: { message: string }): JSX.Element {
  return (
    <div className="text-xs px-2 py-1.5 mb-3 bg-err/10 border border-err/40 rounded text-err selectable whitespace-pre-wrap break-words">
      {message}
    </div>
  );
}

export function AddSsoSessionDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const refresh = useApp((s) => s.refreshProfiles);
  const [name, setName] = useState('sso');
  const [startUrl, setStartUrl] = useState('https://your-org.awsapps.com/start');
  const [region, setRegion] = useState('us-east-1');
  const [scopes, setScopes] = useState('sso:account:access');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError('Session name is required.');
      return;
    }
    if (!startUrl.trim()) {
      setError('Start URL is required.');
      return;
    }
    setBusy(true);
    try {
      await window.awssist.addSsoSession({
        name: name.trim(),
        ssoStartUrl: startUrl.trim(),
        ssoRegion: region.trim(),
        ssoRegistrationScopes: scopes.trim(),
      });
      await refresh();
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add SSO session" onClose={busy ? () => {} : onClose}>
      {error && <ErrorBox message={error} />}
      <Field label="Session name" hint="Used to reference this SSO session from profiles.">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Start URL">
        <input className="input" value={startUrl} onChange={(e) => setStartUrl(e.target.value)} />
      </Field>
      <Field label="SSO region">
        <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
      </Field>
      <Field label="Registration scopes">
        <input className="input" value={scopes} onChange={(e) => setScopes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

export function AddProfileDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { ssoSessions, profiles, refreshProfiles } = useApp();
  const [method, setMethod] = useState<AccessMethod>('user');

  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [region, setRegion] = useState('');

  // Federated (SSO)
  const [ssoSession, setSsoSession] = useState('');
  const [accountId, setAccountId] = useState('');
  const [roleName, setRoleName] = useState('');

  // User (static)
  const [mfaDevice, setMfaDevice] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Chained
  const [sourceProfile, setSourceProfile] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the SSO session selection valid if the list changes underneath us,
  // but don't auto-select on first render — the user must pick one.
  useEffect(() => {
    if (ssoSession && !ssoSessions.some((s) => s.name === ssoSession)) {
      setSsoSession('');
    }
  }, [ssoSessions, ssoSession]);

  function validate(): string | null {
    if (!name.trim()) return 'Named profile is required.';
    if (!region) return 'Region is required.';

    if (method === 'federated') {
      if (!ssoSession) return 'Pick an SSO session — add one first if none exist.';
      if (!accountId.trim()) return 'Account ID is required.';
      if (!roleName.trim()) return 'Role name is required.';
    } else if (method === 'user') {
      if (!accessKeyId.trim()) return 'Access Key ID is required.';
      if (!secretAccessKey.trim()) return 'Secret Access Key is required.';
    } else if (method === 'chained') {
      if (!sourceProfile.trim()) return 'Source profile is required.';
      if (!roleArn.trim()) return 'Role ARN is required.';
    }
    return null;
  }

  async function submit(): Promise<void> {
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    const p: Profile = {
      name: name.trim(),
      kind: METHOD_TO_KIND[method],
      region,
      alias: alias.trim() || undefined,
    };

    if (method === 'federated') {
      p.ssoSession = ssoSession;
      p.ssoAccountId = accountId.trim();
      p.ssoRoleName = roleName.trim();
    } else if (method === 'user') {
      if (mfaDevice.trim()) p.mfaSerial = mfaDevice.trim();
      p.accessKeyId = accessKeyId.trim();
      p.secretAccessKey = secretAccessKey;
    } else if (method === 'chained') {
      p.sourceProfile = sourceProfile.trim();
      p.roleArn = roleArn.trim();
      if (mfaDevice.trim()) p.mfaSerial = mfaDevice.trim();
      if (externalId.trim()) p.externalId = externalId.trim();
    }

    setBusy(true);
    try {
      await window.awssist.addProfile(p);
      await refreshProfiles();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to save profile: ${msg}`);
      // eslint-disable-next-line no-console
      console.error('addProfile failed', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New AWS profile" onClose={busy ? () => {} : onClose}>
      {error && <ErrorBox message={error} />}

      <Field label="Access method">
        <select
          className="input"
          value={method}
          onChange={(e) => setMethod(e.target.value as AccessMethod)}
        >
          <option value="federated">{METHOD_LABEL.federated}</option>
          <option value="user">{METHOD_LABEL.user}</option>
          <option value="chained">{METHOD_LABEL.chained}</option>
        </select>
      </Field>

      <Field label="Named profile" hint="Written to ~/.aws/config as the profile name.">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Session Alias" hint="Optional friendly name shown in AWSsist.">
        <input
          className="input"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <Field label="Region">
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Select region…</option>
          {COMMON_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </Field>

      {method === 'federated' && (
        <>
          <Field label="SSO session">
            {ssoSessions.length === 0 ? (
              <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1.5">
                No SSO sessions yet. Add one first via the “SSO session” button.
              </div>
            ) : (
              <select className="input" value={ssoSession} onChange={(e) => setSsoSession(e.target.value)}>
                <option value="">Select session…</option>
                {ssoSessions.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Account ID">
            <input
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Role name">
            <input
              className="input"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </>
      )}

      {method === 'user' && (
        <>
          <Field label="MFA Device" hint="MFA ARN or serial number — optional.">
            <input
              className="input"
              value={mfaDevice}
              onChange={(e) => setMfaDevice(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Access Key ID">
            <input
              className="input font-mono"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Secret Access Key">
            <div className="relative">
              <input
                className="input font-mono pr-9"
                type={showSecret ? 'text' : 'password'}
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
                title={showSecret ? 'Hide' : 'Show'}
              >
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
        </>
      )}

      {method === 'chained' && (
        <>
          <Field label="Source profile">
            <select
              className="input"
              value={sourceProfile}
              onChange={(e) => setSourceProfile(e.target.value)}
            >
              <option value="">Select source profile…</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Role ARN">
            <input
              className="input font-mono"
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="MFA Device" hint="MFA ARN or serial number — optional.">
            <input
              className="input"
              value={mfaDevice}
              onChange={(e) => setMfaDevice(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="External ID" hint="Optional.">
            <input
              className="input"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Create profile'}
        </button>
      </div>
    </Modal>
  );
}
