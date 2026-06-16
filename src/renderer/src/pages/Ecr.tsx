import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Package, RefreshCw, Search, Terminal } from 'lucide-react';
import { PageHeader, ProfilePicker, RegionInput } from '../components/PageHeader';
import { WhoamiBanner } from '../components/WhoamiBanner';
import { useApp } from '../store';
import type { EcrImageRef, EcrRepositoryRef } from '@shared/types';

export function Ecr(): JSX.Element {
  const profiles = useApp((s) => s.profiles);
  const [profile, setProfile] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [repos, setRepos] = useState<EcrRepositoryRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, EcrImageRef[] | 'loading' | undefined>>({});
  const [imageError, setImageError] = useState<Record<string, string>>({});

  useEffect(() => {
    const p = profiles.find((x) => x.name === profile);
    if (p?.region) setRegion(p.region);
  }, [profile, profiles]);

  async function refresh(): Promise<void> {
    if (!profile) return;
    setLoading(true);
    setError(null);
    setExpanded({});
    setImageError({});
    try {
      setRepos(await window.awssist.listEcrRepositories(profile, region));
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
    if (!q) return repos;
    return repos.filter((r) => r.name.toLowerCase().includes(q) || r.uri.toLowerCase().includes(q));
  }, [repos, search]);

  async function toggleExpand(repo: EcrRepositoryRef): Promise<void> {
    const open = expanded[repo.name];
    if (open !== undefined) {
      // Collapse
      setExpanded((s) => ({ ...s, [repo.name]: undefined }));
      return;
    }
    setExpanded((s) => ({ ...s, [repo.name]: 'loading' }));
    try {
      const imgs = await window.awssist.listEcrImages(profile, region, repo.name);
      setExpanded((s) => ({ ...s, [repo.name]: imgs }));
    } catch (err) {
      setImageError((s) => ({ ...s, [repo.name]: err instanceof Error ? err.message : String(err) }));
      setExpanded((s) => ({ ...s, [repo.name]: [] }));
    }
  }

  return (
    <>
      <PageHeader
        title="ECR"
        subtitle={profile ? `${profile} · ${region} · ${repos.length} repositories` : 'Pick a profile'}
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
            placeholder="Search by repository name or URI…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {!profile ? (
          <div className="text-sm text-fg-subtle py-12 text-center">Pick a profile to list ECR repositories.</div>
        ) : filtered.length === 0 && !loading ? (
          <div className="text-sm text-fg-subtle py-12 text-center">
            {repos.length === 0 ? 'No ECR repositories in this region.' : 'No repositories match the search.'}
          </div>
        ) : (
          <div className="grid gap-2">
            {filtered.map((r) => (
              <RepoRow
                key={r.arn}
                repo={r}
                profile={profile}
                region={region}
                state={expanded[r.name]}
                imagesError={imageError[r.name]}
                onToggle={() => void toggleExpand(r)}
              />
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

function RepoRow({
  repo,
  profile,
  region,
  state,
  imagesError,
  onToggle,
}: {
  repo: EcrRepositoryRef;
  profile: string;
  region: string;
  state: EcrImageRef[] | 'loading' | undefined;
  imagesError: string | undefined;
  onToggle: () => void;
}): JSX.Element {
  // Registry URI without a tag — what you'd pass to `docker pull` minus the :tag.
  const registry = `${repo.registryId}.dkr.ecr.${region}.amazonaws.com`;
  const loginCmd = `aws ecr get-login-password --region ${region} --profile ${profile} | docker login --username AWS --password-stdin ${registry}`;

  const open = state !== undefined;

  return (
    <div className="card">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-bg-2 rounded-t"
      >
        {open ? <ChevronDown size={14} className="text-fg-subtle shrink-0" /> : <ChevronRight size={14} className="text-fg-subtle shrink-0" />}
        <Package size={16} className="text-fg-subtle shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-fg truncate">{repo.name}</div>
          <div className="text-[11px] text-fg-subtle font-mono mt-0.5 truncate selectable">{repo.uri}</div>
        </div>
        {repo.tagMutability && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-3 text-fg-muted border border-border-muted shrink-0">
            {repo.tagMutability.toLowerCase()}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border-muted px-4 py-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <CopyButton label="Copy URI" value={repo.uri} icon={<Copy size={12} />} />
            <CopyButton label="Copy docker login" value={loginCmd} icon={<Terminal size={12} />} />
          </div>

          {state === 'loading' && (
            <div className="text-xs text-fg-subtle flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin" /> loading images…
            </div>
          )}

          {imagesError && (
            <div className="text-xs px-2 py-1.5 bg-err/10 border border-err/40 rounded text-err selectable">
              {imagesError}
            </div>
          )}

          {Array.isArray(state) && state.length === 0 && !imagesError && (
            <div className="text-xs text-fg-subtle">No images in this repository.</div>
          )}

          {Array.isArray(state) && state.length > 0 && (
            <div className="grid gap-1">
              {state.map((img) => (
                <ImageRow key={img.digest} repo={repo} image={img} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImageRow({ repo, image }: { repo: EcrRepositoryRef; image: EcrImageRef }): JSX.Element {
  const sizeMB = image.sizeBytes ? (image.sizeBytes / 1_000_000).toFixed(1) : '?';
  const pushedAgo = image.pushedAt ? relativeTime(image.pushedAt) : 'unknown';
  // Prefer first tag for "docker pull X" target; fall back to digest.
  const ref = image.tags[0] ? `${repo.uri}:${image.tags[0]}` : `${repo.uri}@${image.digest}`;

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-bg-2">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          {image.tags.length > 0 ? (
            image.tags.map((t) => (
              <span
                key={t}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30"
              >
                {t}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-fg-subtle italic">untagged</span>
          )}
        </div>
        <div className="text-[10px] text-fg-subtle font-mono mt-0.5 truncate selectable">
          {image.digest.slice(0, 19)}… · {sizeMB} MB · pushed {pushedAgo}
        </div>
      </div>
      <CopyButton label="Copy ref" value={ref} icon={<Copy size={11} />} small />
    </div>
  );
}

function CopyButton({
  label,
  value,
  icon,
  small,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  small?: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await window.awssist.copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={() => void copy()}
      className={`inline-flex items-center gap-1.5 rounded border border-border-muted bg-bg-2 hover:bg-bg-3 text-fg-muted ${
        small ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2 py-1'
      }`}
      title={value}
    >
      {copied ? <Check size={12} className="text-ok" /> : icon}
      {copied ? 'Copied' : label}
    </button>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
