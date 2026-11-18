import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/core/app-session';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';
import { ModelConfigAIConfigSurface, type ModelConfigAIConfigSurfaceProps } from './model-config-ai-config-surface.js';

type Props = Pick<ModelConfigAIConfigSurfaceProps, 'capabilityContracts' | 'language' | 'onOpenOwnerConfiguration' | 'copy'> & {
  readonly scope: NimiAppScope;
  readonly appId: string;
};

/** Bind the controlled App AIConfig editor to the connected App session. */
export function AppModelConfigSurface(props: Props) {
  return <ScopedEditor key={props.scope.viewKey} {...props} />;
}

function ScopedEditor({ scope, appId, ...presentation }: Props) {
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++latest.current;
    const isCurrent = () => generation === latest.current && !scope.signal.aborted;
    setLoading(true);
    try {
      scope.signal.throwIfAborted();
      const next = await scope.client.aiConfig.get();
      if (isCurrent()) { setSnapshot(next); setError(null); }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [scope]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { ++latest.current; window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  return <ModelConfigAIConfigSurface {...presentation} context={{ owner: 'app-ai-config', appId }}
    capabilities={snapshot ? snapshot.config?.capabilities ?? null : undefined} revision={snapshot?.revision}
    effectiveSelections={snapshot?.effectiveSelections} loading={loading && !snapshot} loadError={error}
    onRetry={() => void refresh()} listOptions={query => { scope.signal.throwIfAborted(); return scope.client.aiConfig.listOptions(query); }}
    onOverwrite={async input => {
      scope.signal.throwIfAborted();
      const result = await scope.client.aiConfig.overwrite(input);
      scope.signal.throwIfAborted();
      await refresh();
      return result;
    }} />;
}
