import { useEffect, useMemo, useState } from 'react';
import { Boxes, ExternalLink, RefreshCw } from 'lucide-react';
import { PageHeader, ProfilePicker, RegionInput } from '../components/PageHeader';
import { WhoamiBanner } from '../components/WhoamiBanner';
import { useApp } from '../store';
import type {
  EcsClusterRef,
  EcsServiceRef,
  EcsTaskRef,
} from '@shared/types';

export function Ecs(): JSX.Element {
  const profiles = useApp((s) => s.profiles);
  const [profile, setProfile] = useState('');
  const [region, setRegion] = useState('us-east-1');

  useEffect(() => {
    const p = profiles.find((x) => x.name === profile);
    if (p?.region) setRegion(p.region);
  }, [profile, profiles]);
  const [clusters, setClusters] = useState<EcsClusterRef[]>([]);
  const [cluster, setCluster] = useState<EcsClusterRef | null>(null);
  const [services, setServices] = useState<EcsServiceRef[]>([]);
  const [service, setService] = useState<EcsServiceRef | null>(null);
  const [tasks, setTasks] = useState<EcsTaskRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadClusters(): Promise<void> {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      setClusters(await window.awssist.listEcsClusters(profile, region));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCluster(null);
    setServices([]);
    setService(null);
    setTasks([]);
    if (profile) void loadClusters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, region]);

  useEffect(() => {
    setService(null);
    setTasks([]);
    if (cluster && profile) {
      window.awssist.listEcsServices(profile, region, cluster.arn).then(setServices).catch((e) => setError(String(e)));
      window.awssist.listEcsTasks(profile, region, cluster.arn).then(setTasks).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  useEffect(() => {
    if (cluster && profile && service) {
      window.awssist.listEcsTasks(profile, region, cluster.arn, service.name).then(setTasks).catch((e) => setError(String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  const filteredTasks = useMemo(() => tasks.filter((t) => t.lastStatus === 'RUNNING'), [tasks]);

  async function openInTerminal(task: EcsTaskRef, container: string): Promise<void> {
    if (!cluster) return;
    try {
      await window.awssist.execInTerminal({
        profile,
        region,
        cluster: cluster.arn,
        task: task.arn,
        container,
        command: '/bin/bash',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHeader
        title="ECS"
        subtitle={profile ? `${profile} · ${region}` : 'Pick a profile to browse clusters'}
      >
        <ProfilePicker value={profile} onChange={setProfile} />
        <RegionInput value={region} onChange={setRegion} />
        <button className="btn-secondary" disabled={!profile} onClick={() => void loadClusters()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </PageHeader>
      <WhoamiBanner profile={profile} region={region} />

      <div className="flex-1 overflow-hidden grid grid-cols-[240px_280px_1fr] gap-px bg-border">
        <Column title="Clusters" loading={loading}>
          {clusters.map((c) => (
            <RowButton key={c.arn} active={cluster?.arn === c.arn} onClick={() => setCluster(c)}>
              <Boxes size={14} className="text-fg-subtle" />
              <span className="truncate">{c.name}</span>
            </RowButton>
          ))}
        </Column>

        <Column title="Services">
          {!cluster && <Empty hint="Select a cluster" />}
          {cluster && (
            <>
              <RowButton active={!service} onClick={() => setService(null)}>
                <span className="text-fg-subtle">(all tasks)</span>
              </RowButton>
              {services.map((s) => (
                <RowButton key={s.arn} active={service?.arn === s.arn} onClick={() => setService(s)}>
                  <span className="truncate flex-1">{s.name}</span>
                  <span className="text-[10px] text-fg-subtle">{s.runningCount}/{s.desiredCount}</span>
                </RowButton>
              ))}
            </>
          )}
        </Column>

        <Column title={`Tasks (${filteredTasks.length})`}>
          {!cluster && <Empty hint="Select a cluster" />}
          {cluster && filteredTasks.length === 0 && <Empty hint="No running tasks" />}
          {filteredTasks.map((t) => (
            <div key={t.arn} className="bg-bg-1 border-b border-border-muted px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-fg-muted">{t.taskId.slice(0, 12)}</span>
                <span className="text-[10px] text-fg-subtle">{t.lastStatus}</span>
              </div>
              <div className="space-y-1">
                {t.containers.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-fg-muted">{c.name}</span>
                    <button
                      className="btn-icon"
                      title="Open shell in Terminal.app"
                      onClick={() => void openInTerminal(t, c.name)}
                    >
                      <ExternalLink size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Column>
      </div>

      {error && (
        <div className="border-t border-err/30 bg-err/10 text-err text-xs px-4 py-3 selectable whitespace-pre-wrap break-words font-mono">
          {error}
        </div>
      )}

    </>
  );
}

function Column({
  title,
  loading,
  children,
}: {
  title: string;
  loading?: boolean;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="bg-bg-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-bg-1/95 backdrop-blur border-b border-border-muted px-3 py-2 text-[10px] uppercase tracking-wider text-fg-subtle flex items-center justify-between">
        <span>{title}</span>
        {loading && <RefreshCw size={12} className="animate-spin" />}
      </div>
      {children}
    </div>
  );
}

function RowButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left border-b border-border-muted ${
        active ? 'bg-bg-3 text-fg' : 'text-fg-muted hover:bg-bg-2'
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ hint }: { hint: string }): JSX.Element {
  return <div className="text-xs text-fg-subtle px-3 py-4 text-center">{hint}</div>;
}
