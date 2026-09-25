import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';
import {
  getRuntimePlatformProjection,
  type RuntimePlatformLoginRequiredProjection,
  type RuntimePlatformReadyProjection,
  type RuntimePlatformUnavailableProjection,
} from './runtime-platform';
import { RuntimeLoginPage } from './runtime-login-page';
import { zhiyuRuntimeUnavailableKind } from './runtime-unavailable-kind';
import { RuntimeConnectingScreen, RuntimeUnavailablePage } from './runtime-unavailable-page';

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
      readonly retrying: boolean;
    };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '本地服务检查失败');
}

async function resolveGateState(): Promise<GateState> {
  try {
    const projection = await getRuntimePlatformProjection();
    if (projection.status === 'login-required') {
      return { kind: 'login-required', projection, message: projection.message };
    }
    if (projection.status !== 'ready') {
      return { kind: 'blocked', projection, retrying: false };
    }
    return { kind: 'ready', projection };
  } catch (error) {
    return { kind: 'blocked', message: toMessage(error), retrying: false };
  }
}

// An unreachable local Runtime fails within milliseconds; hold a manual retry
// long enough for the user to see that the click did something.
const MANUAL_RETRY_MIN_DURATION_MS = 700;

function isRuntimeUnreachable(state: GateState): boolean {
  return state.kind === 'blocked' && zhiyuRuntimeUnavailableKind(state.projection) === 'connection';
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

export function AuthGate({ children }: { readonly children: ReactNode }) {
  const [offlineCoordinator] = useState(() => new OfflineCoordinator());
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const latestCheckRef = useRef(0);

  // Checks never swap the page for a loading screen; the newest one wins, so a
  // slow background probe cannot overwrite a later manual retry.
  const check = useCallback(async (minimumDurationMs = 0): Promise<boolean> => {
    const checkId = ++latestCheckRef.current;
    const [nextState] = await Promise.all([resolveGateState(), wait(minimumDurationMs)]);
    if (checkId !== latestCheckRef.current) return false;
    const unreachable = isRuntimeUnreachable(nextState);
    offlineCoordinator.markRuntimeReachability(unreachable ? 'unreachable' : 'reachable');
    setState(nextState);
    return !unreachable;
  }, [offlineCoordinator]);

  const retry = useCallback(() => {
    setState((current) => (current.kind === 'blocked' ? { ...current, retrying: true } : current));
    void check(MANUAL_RETRY_MIN_DURATION_MS);
  }, [check]);

  // While Runtime is unreachable the coordinator re-probes with backoff and
  // stops once Runtime answers, so Zhiyu continues as soon as Nimi is back.
  useEffect(() => {
    offlineCoordinator.configureReconnectHandlers({ probeRuntimeReachability: () => check() });
    void check();
    return () => {
      latestCheckRef.current += 1;
      offlineCoordinator.configureReconnectHandlers({});
    };
  }, [check, offlineCoordinator]);

  const runtimeUnreachable = isRuntimeUnreachable(state);
  useEffect(() => {
    if (!runtimeUnreachable) return undefined;
    // Coming back from Nimi should not wait for the next backoff probe.
    const recheckOnFocus = () => {
      void check();
    };
    window.addEventListener('focus', recheckOnFocus);
    return () => window.removeEventListener('focus', recheckOnFocus);
  }, [check, runtimeUnreachable]);

  if (state.kind === 'checking') {
    return <RuntimeConnectingScreen />;
  }

  if (state.kind === 'login-required') {
    return <RuntimeLoginPage errorMessage={state.message} onRetry={retry} />;
  }

  if (state.kind === 'blocked') {
    return (
      <RuntimeUnavailablePage
        projection={state.projection}
        message={state.message}
        retrying={state.retrying}
        onRetry={retry}
      />
    );
  }

  return <>{children}</>;
}
