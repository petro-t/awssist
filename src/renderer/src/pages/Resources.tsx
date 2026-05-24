import { useEffect, useState } from 'react';
import { Database, Network, RefreshCw } from 'lucide-react';
import { PageHeader, ProfilePicker, RegionInput } from '../components/PageHeader';
import { WhoamiBanner } from '../components/WhoamiBanner';
import { TunnelDialog, type TunnelTarget } from '../components/TunnelDialog';
import { useApp } from '../store';
import type {
  Ec2InstanceRef,
  ElastiCacheNodeRef,
  RdsClusterRef,
} from '@shared/types';

export function Resources(): JSX.Element {
  const profiles = useApp((s) => s.profiles);
  const [profile, setProfile] = useState('');
  const [region, setRegion] = useState('us-east-1');

  useEffect(() => {
    const p = profiles.find((x) => x.name === profile);
    if (p?.region) setRegion(p.region);
  }, [profile, profiles]);
  const [rds, setRds] = useState<RdsClusterRef[]>([]);
  const [redis, setRedis] = useState<ElastiCacheNodeRef[]>([]);
  const [bastions, setBastions] = useState<Ec2InstanceRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tunnelTarget, setTunnelTarget] = useState<TunnelTarget | null>(null);

  async function refresh(): Promise<void> {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const [r, e, b] = await Promise.all([
        window.awssist.listRdsClusters(profile, region),
        window.awssist.listElastiCacheNodes(profile, region),
        window.awssist.listBastions(profile, region),
      ]);
      setRds(r);
      setRedis(e);
      setBastions(b);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, region]);

  function openTunnel(label: string, host: string, remotePort: number, defaultLocal: number): void {
    if (!profile) return;
    setTunnelTarget({
      label,
      host,
      remotePort,
      defaultLocalPort: defaultLocal,
      profile,
      region,
    });
  }

  return (
    <>
      <PageHeader title="RDS / Redis" subtitle={profile ? `${profile} · ${region}` : 'Pick a profile'}>
        <ProfilePicker value={profile} onChange={setProfile} />
        <RegionInput value={region} onChange={setRegion} />
        <button className="btn-secondary" disabled={!profile || loading} onClick={() => void refresh()}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </PageHeader>
      <WhoamiBanner profile={profile} region={region} />

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        <Section title="RDS clusters" Icon={Database} count={rds.length}>
          {rds.map((c) => (
            <div key={c.identifier} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{c.identifier}</div>
                <div className="text-xs text-fg-subtle selectable truncate">
                  {c.engine} · {c.status} · :{c.port}
                </div>
                <div className="text-[11px] text-fg-subtle font-mono selectable">{c.endpoint}</div>
                {c.readerEndpoint && c.readerEndpoint !== c.endpoint && (
                  <div className="text-[11px] text-fg-subtle font-mono selectable">reader: {c.readerEndpoint}</div>
                )}
              </div>
              <div className="flex gap-1">
                {c.endpoint && (
                  <button
                    className="btn-secondary"
                    onClick={() => openTunnel(`${c.identifier} (writer)`, c.endpoint!, c.port, 5432)}
                  >
                    <Network size={12} /> Writer
                  </button>
                )}
                {c.readerEndpoint && (
                  <button
                    className="btn-secondary"
                    onClick={() => openTunnel(`${c.identifier} (reader)`, c.readerEndpoint!, c.port, 5432)}
                  >
                    <Network size={12} /> Reader
                  </button>
                )}
              </div>
            </div>
          ))}
          {rds.length === 0 && !loading && <Empty />}
        </Section>

        <Section title="ElastiCache (Redis)" Icon={Database} count={redis.length}>
          {redis.map((n) => (
            <div key={`${n.cacheClusterId}-${n.endpoint}`} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{n.cacheClusterId}</div>
                <div className="text-xs text-fg-subtle">{n.engine} · {n.status} · :{n.port}</div>
                <div className="text-[11px] text-fg-subtle font-mono selectable">{n.endpoint}</div>
              </div>
              {n.endpoint && (
                <button
                  className="btn-secondary"
                  onClick={() => openTunnel(n.cacheClusterId, n.endpoint!, n.port, 6380)}
                >
                  <Network size={12} /> Tunnel
                </button>
              )}
            </div>
          ))}
          {redis.length === 0 && !loading && <Empty />}
        </Section>

      </div>

      {error && (
        <div className="border-t border-err/30 bg-err/10 text-err text-xs px-4 py-3 selectable whitespace-pre-wrap break-words font-mono">
          {error}
        </div>
      )}

      {tunnelTarget && (
        <TunnelDialog
          target={tunnelTarget}
          bastions={bastions}
          onClose={() => setTunnelTarget(null)}
          onStarted={() => setTunnelTarget(null)}
        />
      )}
    </>
  );
}

function Section({
  title,
  Icon,
  count,
  children,
}: {
  title: string;
  Icon: typeof Database;
  count: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 text-fg-muted">
        <Icon size={14} className="text-fg-subtle" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-fg-subtle">({count})</span>
      </div>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Empty({ hint }: { hint?: string }): JSX.Element {
  return <div className="text-xs text-fg-subtle px-3 py-3">{hint ?? 'None found in this region.'}</div>;
}
