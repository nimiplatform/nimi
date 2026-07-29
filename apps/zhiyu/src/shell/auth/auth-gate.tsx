import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { OfflineCoordinator, type OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { StatusBadge } from '@nimiplatform/kit/ui';
import {
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
  type RuntimePlatformLoginRequiredProjection,
  type RuntimePlatformReadyProjection,
  type RuntimePlatformUnavailableProjection,
} from './runtime-platform';
import { RuntimeLoginPage } from './runtime-login-page';
import { RuntimeUnavailablePage } from './runtime-unavailable-page';

const runtimeGateOfflineCoordinator = new OfflineCoordinator();

type RuntimePlatformLoginProjection = RuntimePlatformLoginRequiredProjection | RuntimePlatformReadyProjection;

type GateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly projection: RuntimePlatformReadyProjection }
  | {
      readonly kind: 'login-required';
      readonly projection: RuntimePlatformLoginProjection;
      readonly message?: string;
    }
  | {
      readonly kind: 'blocked';
      readonly projection?: RuntimePlatformUnavailableProjection;
      readonly message?: string;
      readonly offlineTier: OfflineTier;
    };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '本地服务检查失败');
}

async function resolveGateState(): Promise<GateState> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'login-required') {
    runtimeGateOfflineCoordinator.markRuntimeReachability('reachable');
    return { kind: 'login-required', projection, message: projection.message };
  }
  if (projection.status !== 'ready') {
    runtimeGateOfflineCoordinator.markRuntimeReachability('unreachable');
    return { kind: 'blocked', projection, offlineTier: runtimeGateOfflineCoordinator.getTier() };
  }
  runtimeGateOfflineCoordinator.markRuntimeReachability('reachable');

  return { kind: 'ready', projection };
}

export function AuthGate({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    clearRuntimePlatformProjection();
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'checking' });
    void resolveGateState()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch((error) => {
        runtimeGateOfflineCoordinator.markRuntimeReachability('unreachable');
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
        <StatusBadge tone="neutral" shape="dot">检查本地服务</StatusBadge>
      </main>
    );
  }

  if (state.kind === 'login-required') {
    return <RuntimeLoginPage errorMessage={state.message} onRetry={retry} />;
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
