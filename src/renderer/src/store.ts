import { create } from 'zustand';
import type { Profile, SessionState, SsoSessionConfig, TunnelStatus } from '@shared/types';

interface AppState {
  profiles: Profile[];
  ssoSessions: SsoSessionConfig[];
  sessions: SessionState[];
  tunnels: TunnelStatus[];
  selectedProfile: string | null;
  deps: { aws: boolean; sessionManagerPlugin: boolean } | null;

  refreshProfiles: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshTunnels: () => Promise<void>;
  refreshDeps: () => Promise<void>;
  setSelectedProfile: (name: string | null) => void;
  upsertTunnel: (t: TunnelStatus) => void;
  removeTunnel: (id: string) => void;
  setSessions: (s: SessionState[]) => void;
}

export const useApp = create<AppState>((set) => ({
  profiles: [],
  ssoSessions: [],
  sessions: [],
  tunnels: [],
  selectedProfile: null,
  deps: null,

  async refreshProfiles() {
    const { profiles, ssoSessions } = await window.awssist.listProfiles();
    set({ profiles, ssoSessions });
  },
  async refreshSessions() {
    const sessions = await window.awssist.activeSessions();
    set({ sessions });
  },
  async refreshTunnels() {
    const tunnels = await window.awssist.listTunnels();
    set({ tunnels });
  },
  async refreshDeps() {
    const deps = await window.awssist.checkDeps();
    set({ deps });
  },
  setSelectedProfile(name) {
    set({ selectedProfile: name });
  },
  upsertTunnel(t) {
    set((state) => {
      const others = state.tunnels.filter((x) => x.id !== t.id);
      return { tunnels: [...others, t].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '')) };
    });
  },
  removeTunnel(id) {
    set((state) => ({ tunnels: state.tunnels.filter((x) => x.id !== id) }));
  },
  setSessions(sessions) {
    set({ sessions });
  },
}));
