import { Monitor, Moon, Sun } from 'lucide-react';
import { useApp } from '../store';
import { PageHeader } from '../components/PageHeader';
import { useTheme, type ThemePref } from '../theme';

export function SettingsPage(): JSX.Element {
  const deps = useApp((s) => s.deps);
  const pref = useTheme((s) => s.pref);
  const resolved = useTheme((s) => s.resolved);
  const setPref = useTheme((s) => s.setPref);

  const themes: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'system', label: 'System', Icon: Monitor },
    { value: 'dark', label: 'Dark', Icon: Moon },
  ];

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        <section>
          <h3 className="text-sm font-semibold text-fg mb-2">Appearance</h3>
          <div className="card p-3">
            <div className="grid grid-cols-3 gap-2">
              {themes.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setPref(value)}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded border transition-colors ${
                    pref === value
                      ? 'bg-accent/10 border-accent/50 text-fg'
                      : 'border-border-muted text-fg-muted hover:text-fg hover:bg-bg-2'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-xs">{label}</span>
                </button>
              ))}
            </div>
            {pref === 'system' && (
              <div className="text-[11px] text-fg-subtle mt-2 text-center">
                Following macOS appearance — currently <span className="font-medium">{resolved}</span>.
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-fg mb-2">System dependencies</h3>
          <div className="grid gap-2">
            <DepRow name="aws CLI" ok={deps?.aws ?? false} hint="brew install awscli" />
            <DepRow
              name="session-manager-plugin"
              ok={deps?.sessionManagerPlugin ?? false}
              hint="brew install --cask session-manager-plugin"
            />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-fg mb-2">About</h3>
          <div className="text-sm text-fg-muted space-y-1">
            <div>AWSsist 0.2.1</div>
            <div>
              ~/.aws/config and ~/.aws/credentials are the source of truth — edits made here are reflected in your shell environment.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function DepRow({ name, ok, hint }: { name: string; ok: boolean; hint: string }): JSX.Element {
  return (
    <div className="card px-3 py-2 flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full ${ok ? 'bg-ok' : 'bg-err'}`} />
      <div className="flex-1">
        <div className="text-sm font-medium">{name}</div>
        {!ok && <div className="text-xs text-fg-subtle font-mono">{hint}</div>}
      </div>
      <div className={`text-xs ${ok ? 'text-ok' : 'text-err'}`}>{ok ? 'installed' : 'missing'}</div>
    </div>
  );
}
