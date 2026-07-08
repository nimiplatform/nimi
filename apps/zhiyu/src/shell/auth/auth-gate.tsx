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
} from './runtime-platform';
import { loadRuntimeAccountUser } from './runtime-account-auth';
import { RuntimeLoginPage } from './runtime-login-page';
import { RuntimeUnavailablePage } from './runtime-unavailable-page';
import { createInitialZhiyuEvidence } from '../app/evidence';
import './runtime-auth.css';

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

  useEffect(() => {
    if (state.kind !== 'blocked') {
      return;
    }
    const reasonCode = state.projection?.reasonCode ?? 'runtime-unavailable';
    const actionHint = state.projection?.actionHint ?? 'start_external_runtime_daemon';
    const message = state.message || state.projection?.message || 'Runtime session projection is not ready.';
    window.__nimiZhiyuEvidence = {
      ...createInitialZhiyuEvidence(),
      runtime: {
        transport: 'electron-ipc',
        ready: false,
        reasonCode,
        actionHint,
        source: 'runtime',
        message,
      },
      auth: {
        transport: 'electron-ipc',
        ready: false,
        state: 'runtime-unavailable',
        reasonCode,
        accountReasonCode: 'RUNTIME_UNAVAILABLE',
        actionHint,
        source: 'runtime',
        message,
        accountId: null,
        displayName: null,
        productionInert: false,
      },
    };
  }, [state]);

  if (state.kind === 'checking') {
    return (
      <main className="runtime-check-screen">
        <StatusBadge tone="neutral" shape="dot">检查本地服务</StatusBadge>
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
