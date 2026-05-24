import { useApp } from '../store';

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="titlebar-drag border-b border-border bg-bg-1/60 backdrop-blur px-6 py-3 flex items-center">
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
        {subtitle && <p className="text-xs text-fg-subtle mt-0.5">{subtitle}</p>}
      </div>
      <div className="titlebar-nodrag flex items-center gap-2">{children}</div>
    </div>
  );
}

export function ProfilePicker({
  value,
  onChange,
  filterFn,
}: {
  value: string;
  onChange: (v: string) => void;
  filterFn?: (name: string) => boolean;
}): JSX.Element {
  const profiles = useApp((s) => s.profiles);
  const list = filterFn ? profiles.filter((p) => filterFn(p.name)) : profiles;
  return (
    <select className="input max-w-[260px]" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select profile…</option>
      {list.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name}
          {p.region ? ` · ${p.region}` : ''}
        </option>
      ))}
    </select>
  );
}

export function RegionInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <select className="input max-w-[140px]" value={value} onChange={(e) => onChange(e.target.value)}>
      {['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-southeast-2'].map(
        (r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ),
      )}
    </select>
  );
}
