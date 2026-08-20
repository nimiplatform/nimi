import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { OfflineCoordinator, type OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type WorkbenchRuntimeGateProjection =
  | { readonly status: 'ready' }
  | {
      readonly status: 'unavailable';
      readonly body: string;
      readonly signInRequired: boolean;
      readonly nextAction?: string;
    };

export type WorkbenchRuntimeGateCopy = {
  readonly checking: string;
  readonly setupRequired: string;
  readonly signInRequired: string;
  readonly connectionRequired: string;
  readonly retry: string;
  readonly offlineTier: (tier: OfflineTier) => string;
  readonly nextAction: (action: string) => string;
};

export type WorkbenchRuntimeGateProps = {
  readonly appTitle: string;
  readonly copy: WorkbenchRuntimeGateCopy;
  readonly resolve: () => Promise<WorkbenchRuntimeGateProjection>;
  readonly clear: () => void;
  readonly toErrorMessage: (error: unknown) => string;
  readonly children: ReactNode;
};

type WorkbenchRuntimeGateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'blocked';
      readonly projection: Extract<WorkbenchRuntimeGateProjection, { readonly status: 'unavailable' }>;
      readonly offlineTier: OfflineTier;
    };

export function WorkbenchRuntimeGate({
  appTitle,
  copy,
  resolve,
  clear,
  toErrorMessage,
  children,
}: WorkbenchRuntimeGateProps) {
  const [offlineCoordinator] = useState(() => new OfflineCoordinator());
  const [state, setState] = useState<WorkbenchRuntimeGateState>({ kind: 'checking' });
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    clear();
    setReloadKey((value) => value + 1);
  }, [clear]);

  useEffect(() => {
    let active = true;
    setState({ kind: 'checking' });
    void resolve().then((projection) => {
      if (!active) return;
      if (projection.status === 'ready') {
        offlineCoordinator.markRuntimeReachability('reachable');
        setState({ kind: 'ready' });
        return;
      }
      offlineCoordinator.markRuntimeReachability('unreachable');
      setState({
        kind: 'blocked',
        projection,
        offlineTier: offlineCoordinator.getTier(),
      });
    }).catch((error) => {
      if (!active) return;
      offlineCoordinator.markRuntimeReachability('unreachable');
      setState({
        kind: 'blocked',
        projection: {
          status: 'unavailable',
          body: toErrorMessage(error),
          signInRequired: false,
        },
        offlineTier: offlineCoordinator.getTier(),
      });
    });
    return () => {
      active = false;
    };
  }, [offlineCoordinator, reloadKey, resolve, toErrorMessage]);

  if (state.kind === 'checking') {
    return (
      <main className="runtime-check-screen">
        <StatusBadge tone="neutral" shape="dot">{copy.checking}</StatusBadge>
      </main>
    );
  }

  if (state.kind === 'blocked') {
    const { projection } = state;
    return (
      <main className="runtime-unavailable-screen" aria-live="polite">
        <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
          <div className="runtime-unavailable-heading">
            <StatusBadge tone="warning" shape="dot">{copy.setupRequired}</StatusBadge>
            <h1>{appTitle}</h1>
          </div>
          <InlineAlert tone="warning">
            <div className="runtime-alert-copy">
              <strong>{projection.signInRequired ? copy.signInRequired : copy.connectionRequired}</strong>
              <span>{projection.body}</span>
            </div>
          </InlineAlert>
          <p className="runtime-action-hint">{copy.offlineTier(state.offlineTier)}</p>
          {projection.nextAction ? <p className="runtime-action-hint">{copy.nextAction(projection.nextAction)}</p> : null}
          <Button type="button" tone="primary" onClick={retry}>{copy.retry}</Button>
        </Surface>
      </main>
    );
  }

  return <>{children}</>;
}
