import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; account?: string; arn?: string }
  | { kind: 'err'; name: string; message: string };

/**
 * Runs STS GetCallerIdentity whenever profile/region change and surfaces the
 * outcome inline. Acts as a pre-flight: if credentials aren't usable, this
 * tells you why before you wonder which list call broke.
 */
export function WhoamiBanner({
  profile,
  region,
  onResult,
}: {
  profile: string;
  region: string;
  onResult?: (ok: boolean) => void;
}): JSX.Element | null {
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    if (!profile) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'loading' });
    let cancelled = false;
    void (async () => {
      const out = await window.awssist.whoami(profile, region);
      if (cancelled) return;
      if (out.ok) {
        setState({ kind: 'ok', account: out.account, arn: out.arn });
        onResult?.(true);
      } else {
        setState({ kind: 'err', name: out.name, message: out.message });
        onResult?.(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, region, onResult]);

  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') {
    return (
      <div className="border-b border-border-muted bg-bg-1 px-6 py-2 text-xs text-fg-muted flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" />
        Verifying credentials for {profile} in {region}…
      </div>
    );
  }
  if (state.kind === 'ok') {
    return (
      <div className="border-b border-border-muted bg-ok/5 px-6 py-2 text-xs text-ok flex items-center gap-2">
        <CheckCircle2 size={12} />
        <span className="font-mono selectable">{state.arn ?? state.account ?? 'authenticated'}</span>
      </div>
    );
  }
  return (
    <div className="border-b border-err/30 bg-err/10 px-6 py-3 text-xs text-err flex items-start gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1 selectable">
        <div className="font-semibold mb-0.5">{state.name}: credentials are not usable for {profile} ({region})</div>
        <div className="whitespace-pre-wrap break-words font-mono text-[11px] opacity-90">{state.message}</div>
        <div className="mt-1 text-fg-muted not-italic">
          Tips: sign in to the matching SSO session, then click <em>Start session</em> on this profile. If the role lacks
          permission for the listing call, an "is not authorized" message will appear instead.
        </div>
      </div>
    </div>
  );
}
