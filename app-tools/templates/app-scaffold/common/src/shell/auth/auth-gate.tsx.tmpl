import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { NimiAppAuthProjection } from '@nimiplatform/sdk';
import { StatusBadge } from '@nimiplatform/kit/ui';
import { getRuntimePlatformProjection, runtimeAccountLoginEnabled } from './runtime-platform.js';
import { loadRuntimeAccountUser } from './runtime-account-auth.js';
import { RuntimeLoginPage } from './runtime-login-page.js';
import { RuntimeUnavailablePage } from './runtime-unavailable-page.js';

type GateState =
  | { kind: 'checking' }
  | { kind: 'ready'; projection: Extract<NimiAppAuthProjection, { status: 'ready' }> }
  | { kind: 'login-required'; message?: string }
  | { kind: 'blocked'; projection?: Exclude<NimiAppAuthProjection, { status: 'ready' }>; message?: string };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Runtime check failed');
}

async function resolveGateState(): Promise<GateState> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return { kind: 'blocked', projection };
  }

  if (!runtimeAccountLoginEnabled) {
    return { kind: 'ready', projection };
  }

  if (projection.mode === 'dev-standalone' || projection.auth.source === 'runtime-developer-session') {
    return { kind: 'ready', projection };
  }

  try {
    const user = await loadRuntimeAccountUser(projection.client);
    if (user) {
      return { kind: 'ready', projection };
    }
    return { kind: 'login-required' };
  } catch (error) {
    return { kind: 'login-required', message: toMessage(error) };
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'checking' });
    void resolveGateState().then((nextState) => {
      if (active) setState(nextState);
    }).catch((error) => {
      if (active) setState({ kind: 'blocked', message: toMessage(error) });
    });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (state.kind === 'checking') {
    return (
      <main className="runtime-check-screen">
        <StatusBadge tone="neutral" shape="dot">Runtime check</StatusBadge>
      </main>
    );
  }

  if (state.kind === 'login-required') {
    return <RuntimeLoginPage errorMessage={state.message} onReady={retry} />;
  }

  if (state.kind === 'blocked') {
    return <RuntimeUnavailablePage projection={state.projection} message={state.message} onRetry={retry} />;
  }

  return <>{children}</>;
}
