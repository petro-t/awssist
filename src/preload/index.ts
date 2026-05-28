import { contextBridge, ipcRenderer } from 'electron';
import type {
  AwssistApi,
  EcsClusterRef,
  EcsServiceRef,
  EcsTaskRef,
  Ec2InstanceRef,
  ElastiCacheNodeRef,
  ExecRequest,
  Profile,
  RdsClusterRef,
  SessionState,
  SsoLoginStatus,
  SsoSessionConfig,
  TunnelRequest,
  TunnelStatus,
} from '@shared/types';

const api: AwssistApi = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  addSsoSession: (s: SsoSessionConfig) => ipcRenderer.invoke('profiles:addSsoSession', s),
  addProfile: (p: Profile) => ipcRenderer.invoke('profiles:upsert', p),
  removeProfile: (n: string) => ipcRenderer.invoke('profiles:remove', n),
  removeSsoSession: (n: string) => ipcRenderer.invoke('profiles:removeSsoSession', n),

  ssoLogin: (profile: string) => ipcRenderer.invoke('sso:login', profile),
  ssoStatus: (profile: string): Promise<SsoLoginStatus> => ipcRenderer.invoke('sso:status', profile),
  ssoSessionStatus: (session: string) => ipcRenderer.invoke('sso:sessionStatus', session),
  ssoSessionDeviceLogin: (session: string) => ipcRenderer.invoke('sso:deviceLogin', session),
  ssoSessionPoll: (pollKey: string) => ipcRenderer.invoke('sso:poll', pollKey),
  ssoSessionSignOut: (session: string) => ipcRenderer.invoke('sso:signOut', session),
  ssoListAccountsAndRoles: (session: string) => ipcRenderer.invoke('sso:listAccountsAndRoles', session),
  importSsoProfiles: (session: string, selections) => ipcRenderer.invoke('sso:importProfiles', session, selections),
  startSession: (profile: string, asDefault: boolean): Promise<SessionState> =>
    ipcRenderer.invoke('session:start', profile, asDefault),
  endSession: (profile: string) => ipcRenderer.invoke('session:end', profile),
  activeSessions: (): Promise<SessionState[]> => ipcRenderer.invoke('session:list'),
  openConsole: (profile: string) => ipcRenderer.invoke('console:open', profile),

  listEcsClusters: (p: string, r: string): Promise<EcsClusterRef[]> =>
    ipcRenderer.invoke('ecs:listClusters', p, r),
  listEcsServices: (p: string, r: string, c: string): Promise<EcsServiceRef[]> =>
    ipcRenderer.invoke('ecs:listServices', p, r, c),
  listEcsTasks: (p: string, r: string, c: string, s?: string): Promise<EcsTaskRef[]> =>
    ipcRenderer.invoke('ecs:listTasks', p, r, c, s),

  execInTerminal: (req: ExecRequest) => ipcRenderer.invoke('exec:inTerminal', req),

  listRdsClusters: (p: string, r: string): Promise<RdsClusterRef[]> =>
    ipcRenderer.invoke('rds:listClusters', p, r),
  listElastiCacheNodes: (p: string, r: string): Promise<ElastiCacheNodeRef[]> =>
    ipcRenderer.invoke('elasticache:listNodes', p, r),
  listBastions: (p: string, r: string): Promise<Ec2InstanceRef[]> =>
    ipcRenderer.invoke('ec2:listBastions', p, r),
  listEc2Instances: (p: string, r: string): Promise<Ec2InstanceRef[]> =>
    ipcRenderer.invoke('ec2:listInstances', p, r),
  ssmStartSession: (p: string, r: string, instanceId: string, name?: string) =>
    ipcRenderer.invoke('ssm:startSession', p, r, instanceId, name),

  startTunnel: (req: TunnelRequest): Promise<TunnelStatus> =>
    ipcRenderer.invoke('tunnel:start', req),
  stopTunnel: (id: string) => ipcRenderer.invoke('tunnel:stop', id),
  listTunnels: (): Promise<TunnelStatus[]> => ipcRenderer.invoke('tunnel:list'),

  onTunnelUpdate(cb) {
    const handler = (_: unknown, status: TunnelStatus): void => cb(status);
    ipcRenderer.on('tunnel:update', handler);
    return () => ipcRenderer.removeListener('tunnel:update', handler);
  },
  onTunnelRemove(cb) {
    const handler = (_: unknown, id: string): void => cb(id);
    ipcRenderer.on('tunnel:remove', handler);
    return () => ipcRenderer.removeListener('tunnel:remove', handler);
  },
  onSessionUpdate(cb) {
    const handler = (_: unknown, sessions: SessionState[]): void => cb(sessions);
    ipcRenderer.on('sessions:update', handler);
    return () => ipcRenderer.removeListener('sessions:update', handler);
  },
  onMainLog(cb) {
    const handler = (
      _: unknown,
      entry: { level: 'log' | 'warn' | 'error'; message: string; time: number },
    ): void => cb(entry);
    ipcRenderer.on('main:log', handler);
    return () => ipcRenderer.removeListener('main:log', handler);
  },

  platform: () => process.platform,
  checkDeps: () => ipcRenderer.invoke('system:checkDeps'),
  whoami: (profile: string, region: string) => ipcRenderer.invoke('aws:whoami', profile, region),
};

contextBridge.exposeInMainWorld('awssist', api);
