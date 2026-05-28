// IPC contract shared between main and renderer.

export type ProfileKind = 'sso' | 'static' | 'role' | 'process' | 'unknown';

export interface SsoSessionConfig {
  name: string;
  ssoStartUrl: string;
  ssoRegion: string;
  ssoRegistrationScopes?: string;
}

export interface Profile {
  name: string;
  kind: ProfileKind;
  region?: string;
  output?: string;
  // Display label stored in ~/.aws/awssist.json (not in ~/.aws/config).
  alias?: string;
  // SSO
  ssoSession?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
  ssoStartUrl?: string;
  ssoRegion?: string;
  // Role chaining
  sourceProfile?: string;
  roleArn?: string;
  mfaSerial?: string;
  externalId?: string;
  // Process credentials
  credentialProcess?: string;
  // Static IAM-user credentials. Only carried on create; the values land in
  // ~/.aws/credentials and are never read back into Profile.
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface SessionState {
  profile: string;
  accessKeyId: string;
  expiresAt: string; // ISO
  accountId?: string;
  arn?: string;
  region?: string;
}

export interface SsoLoginStatus {
  profile: string;
  loggedIn: boolean;
  expiresAt?: string;
}

export interface SsoSessionStatus {
  session: string;
  loggedIn: boolean;
  expiresAt?: string;
}

export interface SsoAccountRole {
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  roleName: string;
}

export interface SsoDeviceAuth {
  verificationUriComplete: string;
  userCode: string;
  expiresAt: string;
  pollKey: string;
}

export interface ImportSelection {
  accountId: string;
  accountName?: string;
  roleName: string;
  profileName: string;
  region: string;
}

export interface EcsClusterRef {
  arn: string;
  name: string;
}

export interface EcsServiceRef {
  arn: string;
  name: string;
  cluster: string;
  desiredCount: number;
  runningCount: number;
  status: string;
}

export interface EcsTaskRef {
  arn: string;
  taskId: string;
  cluster: string;
  serviceName?: string;
  lastStatus: string;
  desiredStatus: string;
  startedAt?: string;
  containers: EcsContainerRef[];
}

export interface EcsContainerRef {
  name: string;
  image?: string;
  lastStatus?: string;
}

export interface RdsClusterRef {
  identifier: string;
  engine: string;
  status: string;
  endpoint?: string;
  readerEndpoint?: string;
  port: number;
}

export interface ElastiCacheNodeRef {
  cacheClusterId: string;
  engine: string;
  status: string;
  endpoint?: string;
  port: number;
  subnetGroup?: string;
}

export interface Ec2InstanceRef {
  instanceId: string;
  name?: string;
  state: string;
  tags: Record<string, string>;
  privateIp?: string;
  publicIp?: string;
  instanceType?: string;
  platform?: string;
  availabilityZone?: string;
  launchTime?: string;
  imageId?: string;
}

export interface TunnelRequest {
  profile: string;
  region: string;
  bastionInstanceId: string;
  targetHost: string;
  remotePort: number;
  localPort: number;
  label: string; // Human-readable name shown in UI
}

export interface TunnelStatus {
  id: string;
  label: string;
  profile: string;
  region: string;
  bastionInstanceId: string;
  targetHost: string;
  remotePort: number;
  localPort: number;
  pid?: number;
  state: 'starting' | 'running' | 'stopped' | 'error';
  startedAt?: string;
  error?: string;
}

export interface ExecRequest {
  profile: string;
  region: string;
  cluster: string;
  task: string;
  container: string;
  command?: string;
}

// API surface exposed to renderer via contextBridge.
export interface AwssistApi {
  // Profiles & config
  listProfiles(): Promise<{ profiles: Profile[]; ssoSessions: SsoSessionConfig[] }>;
  addSsoSession(session: SsoSessionConfig): Promise<void>;
  addProfile(profile: Profile): Promise<void>;
  removeProfile(name: string): Promise<void>;
  removeSsoSession(name: string): Promise<string[]>;

  // Auth
  ssoLogin(profile: string): Promise<{ ok: boolean; message?: string }>;
  ssoStatus(profile: string): Promise<SsoLoginStatus>;
  ssoSessionStatus(session: string): Promise<SsoSessionStatus>;
  ssoSessionDeviceLogin(session: string): Promise<SsoDeviceAuth>;
  ssoSessionPoll(pollKey: string): Promise<{ done: boolean; expiresAt?: string; error?: string }>;
  ssoSessionSignOut(session: string): Promise<void>;
  ssoListAccountsAndRoles(session: string): Promise<SsoAccountRole[]>;
  importSsoProfiles(session: string, selections: ImportSelection[]): Promise<void>;
  startSession(profile: string, writeAsDefault: boolean): Promise<SessionState>;
  endSession(profile: string): Promise<void>;
  activeSessions(): Promise<SessionState[]>;
  openConsole(profile: string): Promise<void>;

  // ECS
  listEcsClusters(profile: string, region: string): Promise<EcsClusterRef[]>;
  listEcsServices(profile: string, region: string, cluster: string): Promise<EcsServiceRef[]>;
  listEcsTasks(profile: string, region: string, cluster: string, service?: string): Promise<EcsTaskRef[]>;

  // ECS Exec — opens shell in the OS-native terminal.
  execInTerminal(req: ExecRequest): Promise<void>;

  // RDS / Redis
  listRdsClusters(profile: string, region: string): Promise<RdsClusterRef[]>;
  listElastiCacheNodes(profile: string, region: string): Promise<ElastiCacheNodeRef[]>;
  listBastions(profile: string, region: string): Promise<Ec2InstanceRef[]>;
  listEc2Instances(profile: string, region: string): Promise<Ec2InstanceRef[]>;
  ssmStartSession(profile: string, region: string, instanceId: string, name?: string): Promise<void>;

  // Tunnels
  startTunnel(req: TunnelRequest): Promise<TunnelStatus>;
  stopTunnel(id: string): Promise<void>;
  listTunnels(): Promise<TunnelStatus[]>;

  // Events (subscribe)
  onTunnelUpdate(cb: (status: TunnelStatus) => void): () => void;
  onTunnelRemove(cb: (id: string) => void): () => void;
  onSessionUpdate(cb: (sessions: SessionState[]) => void): () => void;
  onMainLog(cb: (entry: { level: 'log' | 'warn' | 'error'; message: string; time: number }) => void): () => void;

  // Misc
  platform(): string;
  checkDeps(): Promise<{ aws: boolean; sessionManagerPlugin: boolean }>;
  whoami(profile: string, region: string): Promise<
    | { ok: true; account?: string; arn?: string; userId?: string }
    | { ok: false; name: string; message: string }
  >;
}
