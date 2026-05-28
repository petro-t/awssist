import { useEffect, useState } from 'react';
import { Boxes, Database, KeyRound, Monitor, Moon, Network, Server, Settings, Sun, Terminal as TerminalIcon } from 'lucide-react';
import { useApp } from './store';
import { Profiles } from './pages/Profiles';
import { Tunnels } from './pages/Tunnels';
import { Ecs } from './pages/Ecs';
import { Ec2 } from './pages/Ec2';
import { Sessions } from './pages/Sessions';
import { Resources } from './pages/Resources';
import { SettingsPage } from './pages/Settings';
import { useTheme, useThemeBootstrap, type ThemePref } from './theme';

type Tab = 'profiles' | 'sessions' | 'ec2' | 'ecs' | 'tunnels' | 'resources' | 'settings';

const TABS: { id: Tab; label: string; Icon: typeof Boxes }[] = [
  { id: 'profiles', label: 'Profiles', Icon: KeyRound },
  { id: 'sessions', label: 'Sessions', Icon: TerminalIcon },
  { id: 'ec2', label: 'EC2', Icon: Server },
  { id: 'ecs', label: 'ECS', Icon: Boxes },
  { id: 'tunnels', label: 'Tunnels', Icon: Network },
  { id: 'resources', label: 'RDS / Redis', Icon: Database },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function App(): JSX.Element {
  useThemeBootstrap();
  const [tab, setTab] = useState<Tab>('profiles');
  const {
    refreshProfiles,
    refreshSessions,
    refreshTunnels,
    refreshDeps,
    upsertTunnel,
    removeTunnel,
    setSessions,
  } = useApp();
  useEffect(() => {
    void refreshProfiles();
    void refreshSessions();
    void refreshTunnels();
    void refreshDeps();

    const off1 = window.awssist.onTunnelUpdate(upsertTunnel);
    const off2 = window.awssist.onSessionUpdate(setSessions);
    const off3 = window.awssist.onTunnelRemove(removeTunnel);
    // Bridge main-process console output into DevTools so [sso-device]/etc.
    // are visible — main-process stdout is otherwise invisible in a packaged app.
    const off4 = window.awssist.onMainLog((entry) => {
      const fn =
        entry.level === 'error'
          ? console.error
          : entry.level === 'warn'
            ? console.warn
            : console.log;
      fn(`[main] ${entry.message}`);
    });
    return () => {
      off1();
      off2();
      off3();
      off4();
    };
  }, [refreshProfiles, refreshSessions, refreshTunnels, refreshDeps, upsertTunnel, removeTunnel, setSessions]);

  return (
    <div className="flex h-full">
      <aside className="w-60 bg-bg-1 border-r border-border flex flex-col">
        {/* Empty drag region for the macOS traffic-light spacing */}
        <div className="titlebar-drag h-10 shrink-0" />
        <nav className="flex-1 py-2 overflow-y-auto">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`titlebar-nodrag w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                tab === id
                  ? 'bg-bg-3 text-fg border-l-2 border-accent'
                  : 'text-fg-muted hover:text-fg hover:bg-bg-2 border-l-2 border-transparent'
              }`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <ThemeToggle />
        <DepsBanner />
      </aside>
      <main className="flex-1 overflow-hidden flex flex-col">
        {tab === 'profiles' && <Profiles />}
        {tab === 'sessions' && <Sessions />}
        {tab === 'ec2' && <Ec2 />}
        {tab === 'ecs' && <Ecs />}
        {tab === 'tunnels' && <Tunnels />}
        {tab === 'resources' && <Resources />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function ThemeToggle(): JSX.Element {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);
  const opts: { value: ThemePref; Icon: typeof Sun; title: string }[] = [
    { value: 'light', Icon: Sun, title: 'Light' },
    { value: 'system', Icon: Monitor, title: 'System' },
    { value: 'dark', Icon: Moon, title: 'Dark' },
  ];
  return (
    <div className="px-2 pb-2 titlebar-nodrag">
      <div className="flex items-center justify-center gap-1 p-1 rounded bg-bg-2 border border-border-muted">
        {opts.map(({ value, Icon, title }) => (
          <button
            key={value}
            onClick={() => setPref(value)}
            title={title}
            className={`flex-1 flex items-center justify-center py-1 rounded transition-colors ${
              pref === value ? 'bg-bg-3 text-fg' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}

function DepsBanner(): JSX.Element | null {
  const deps = useApp((s) => s.deps);
  if (!deps) return null;
  const missing: string[] = [];
  if (!deps.aws) missing.push('aws-cli');
  if (!deps.sessionManagerPlugin) missing.push('session-manager-plugin');
  if (missing.length === 0) return null;
  return (
    <div className="text-xs px-3 py-2 m-2 bg-err/10 border border-err/40 rounded text-err">
      Missing: {missing.join(', ')}. SSM/SSO features will not work.
    </div>
  );
}
