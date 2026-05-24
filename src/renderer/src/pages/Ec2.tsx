import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Search, Server } from 'lucide-react';
import { PageHeader, ProfilePicker, RegionInput } from '../components/PageHeader';
import { WhoamiBanner } from '../components/WhoamiBanner';
import { useApp } from '../store';
import type { Ec2InstanceRef } from '@shared/types';

export function Ec2(): JSX.Element {
  const profiles = useApp((s) => s.profiles);
  const [profile, setProfile] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [instances, setInstances] = useState<Ec2InstanceRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Default region from the picked profile.
  useEffect(() => {
    const p = profiles.find((x) => x.name === profile);
    if (p?.region) setRegion(p.region);
  }, [profile, profiles]);

  async function refresh(): Promise<void> {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      setInstances(await window.awssist.listEc2Instances(profile, region));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, region]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return instances;
    return instances.filter((i) => {
      const hay = [
        i.name,
        i.instanceId,
        i.privateIp,
        i.publicIp,
        i.instanceType,
        i.state,
        ...Object.values(i.tags),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [instances, search]);

  async function openSsm(inst: Ec2InstanceRef): Promise<void> {
    try {
      await window.awssist.ssmStartSession(profile, region, inst.instanceId, inst.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHeader
        title="EC2"
        subtitle={profile ? `${profile} · ${region} · ${instances.length} instances` : 'Pick a profile'}
      >
        <ProfilePicker value={profile} onChange={setProfile} />
        <RegionInput value={region} onChange={setRegion} />
        <button className="btn-secondary" disabled={!profile || loading} onClick={() => void refresh()}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </PageHeader>

      <WhoamiBanner profile={profile} region={region} />

      <div className="px-6 pt-3 pb-2">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            className="input pl-7"
            placeholder="Search by name, instance id, IP, tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {!profile ? (
          <div className="text-sm text-fg-subtle py-12 text-center">
            Pick a profile to list EC2 instances.
          </div>
        ) : filtered.length === 0 && !loading ? (
          <div className="text-sm text-fg-subtle py-12 text-center">
            {instances.length === 0 ? 'No EC2 instances found in this region.' : 'No instances match the search.'}
          </div>
        ) : (
          <div className="grid gap-2">
            {filtered.map((i) => (
              <InstanceRow key={i.instanceId} inst={i} onSsm={() => void openSsm(i)} />
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-err/30 bg-err/10 text-err text-xs px-4 py-3 selectable whitespace-pre-wrap break-words font-mono">
          {error}
        </div>
      )}
    </>
  );
}

function StateBadge({ state }: { state: string }): JSX.Element {
  const map: Record<string, string> = {
    running: 'bg-ok/15 text-ok border-ok/30',
    pending: 'bg-warn/15 text-warn border-warn/30',
    stopping: 'bg-warn/15 text-warn border-warn/30',
    stopped: 'bg-gray-500/15 text-fg-subtle border-gray-500/30',
  };
  const cls = map[state] ?? 'bg-gray-500/15 text-fg-subtle border-gray-500/30';
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>{state}</span>
  );
}

function InstanceRow({
  inst,
  onSsm,
}: {
  inst: Ec2InstanceRef;
  onSsm: () => void;
}): JSX.Element {
  const isRunning = inst.state === 'running';
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <Server size={18} className="text-fg-subtle shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-fg">{inst.name ?? inst.instanceId}</span>
          <StateBadge state={inst.state} />
          {inst.instanceType && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-3 text-fg-muted border border-border-muted font-mono">
              {inst.instanceType}
            </span>
          )}
        </div>
        <div className="text-xs text-fg-subtle mt-0.5 font-mono selectable break-all">
          {inst.instanceId}
          {inst.availabilityZone ? ` · ${inst.availabilityZone}` : ''}
          {inst.privateIp ? ` · priv ${inst.privateIp}` : ''}
          {inst.publicIp ? ` · pub ${inst.publicIp}` : ''}
        </div>
      </div>
      <button
        className="btn-secondary shrink-0"
        title={isRunning ? 'Open SSM shell in Terminal.app' : 'Instance must be running to open an SSM session'}
        disabled={!isRunning}
        onClick={onSsm}
      >
        <ExternalLink size={12} /> SSM
      </button>
    </div>
  );
}
