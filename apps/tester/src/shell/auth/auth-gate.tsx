import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { OfflineCoordinator, type OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { StatusBadge } from '@nimiplatform/kit/ui';
import {
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
  runtimeAccountLoginEnabled,
  type RuntimePlatformLoginRequiredProjection,
  type RuntimePlatformReadyProjection,
  type RuntimePlatformUnavailableProjection,
} from './runtime-platform.js';
import { loadRuntimeAccountUser } from './runtime-account-auth.js';
import { RuntimeLoginPage } from './runtime-login-page.js';
import { RuntimeUnavailablePage } from './runtime-unavailable-page.js';

const runtimeGateOfflineCoordinator = new OfflineCoordinator();

type RuntimePlatformLoginProjection = RuntimePlatformLoginRequiredProjection | RuntimePlatformReadyProjection;

type GateState =
  | { kind: 'checking' }
  | { kind: 'ready'; projection: RuntimePlatformReadyProjection }
  | {
      kind: 'login-required';
      projection: RuntimePlatformLoginProjection;
      message?: string;
    }
  | {
      kind: 'blocked';
      projection?: RuntimePlatformUnavailableProjection;
      message?: string;
      offlineTier: OfflineTier;
    };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Runtime check failed');
}

async function resolveGateState(): Promise<GateState> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'login-required') {
    runtimeGateOfflineCoordinator.markRuntimeReachable(true);
    return { kind: 'login-required', projection, message: projection.message };
  }
  if (projection.status !== 'ready') {
    runtimeGateOfflineCoordinator.markRuntimeReachable(false);
    return { kind: 'blocked', projection, offlineTier: runtimeGateOfflineCoordinator.getTier() };
  }
  runtimeGateOfflineCoordinator.markRuntimeReachable(true);

  if (!runtimeAccountLoginEnabled) {
    return { kind: 'ready', projection };
  }

  try {
    const user = await loadRuntimeAccountUser(projection.client);
    if (user) {
      return { kind: 'ready', projection };
    }
    return { kind: 'login-required', projection };
  } catch (error) {
    return { kind: 'login-required', projection, message: toMessage(error) };
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    clearRuntimePlatformProjection();
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'checking' });
    void resolveGateState().then((nextState) => {
      if (active) setState(nextState);
    }).catch((error) => {
      runtimeGateOfflineCoordinator.markRuntimeReachable(false);
      if (active) {
        setState({
          kind: 'blocked',
          message: toMessage(error),
          offlineTier: runtimeGateOfflineCoordinator.getTier(),
        });
      }
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
    return <RuntimeLoginPage client={state.projection.client} errorMessage={state.message} onReady={retry} />;
  }

  if (state.kind === 'blocked') {
    return (
      <RuntimeUnavailablePage
        projection={state.projection}
        message={state.message}
        offlineTier={state.offlineTier}
        onRetry={retry}
      />
    );
  }

  return <>{children}</>;
}
