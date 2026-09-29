import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { OfflineCoordinator, type OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type WorkbenchRuntimeGateTechnicalDetail = {
  readonly label: string;
  readonly value: string;
};

// A real way out of the blocked state besides checking again, such as opening
// Nimi. `run` resolves to one short plain-language result for the person.
export type WorkbenchRuntimeGateRecoveryAction = {
  readonly label: string;
  readonly run: () => Promise<string>;
};

export type WorkbenchRuntimeGateProjection =
  | { readonly status: 'ready' }
  | {
      readonly status: 'unavailable';
      readonly body: string;
      readonly signInRequired: boolean;
      readonly nextAction?: string;
      readonly recoveryAction?: WorkbenchRuntimeGateRecoveryAction;
      // Reason codes and hints stay in the folded technical area.
      readonly technicalDetails?: readonly WorkbenchRuntimeGateTechnicalDetail[];
    };

export type WorkbenchRuntimeGateCopy = {
  readonly checking: string;
  readonly setupRequired: string;
  readonly signInRequired: string;
  readonly connectionRequired: string;
  readonly retry: string;
  readonly offlineTier: (tier: OfflineTier) => string;
  readonly nextAction: (action: string) => string;
  readonly technicalDetails: string;
};

export type WorkbenchRuntimeGateProps = {
  readonly appTitle: string;
  readonly copy: WorkbenchRuntimeGateCopy;
  readonly resolve: () => Promise<WorkbenchRuntimeGateProjection>;
  readonly clear: () => void;
  readonly toErrorMessage: (error: unknown) => string;
  readonly children: ReactNode;
};

type WorkbenchRuntimeGateBlockedProjection = Extract<WorkbenchRuntimeGateProjection, { readonly status: 'unavailable' }>;

type WorkbenchRuntimeGateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'blocked';
      readonly projection: WorkbenchRuntimeGateBlockedProjection;
      readonly offlineTier: OfflineTier;
    };

type WorkbenchRuntimeGateRecoveryState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly message: string };

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
  const [recovery, setRecovery] = useState<WorkbenchRuntimeGateRecoveryState>({ kind: 'idle' });
  // A recovery result belongs to the blocked check that offered it.
  const recoveryGeneration = useRef(0);

  const retry = useCallback(() => {
    recoveryGeneration.current += 1;
    setRecovery({ kind: 'idle' });
    clear();
    setReloadKey((value) => value + 1);
  }, [clear]);

  const runRecovery = useCallback((action: WorkbenchRuntimeGateRecoveryAction) => {
    const generation = recoveryGeneration.current + 1;
    recoveryGeneration.current = generation;
    setRecovery({ kind: 'running' });
    void action.run().then((message) => {
      if (recoveryGeneration.current === generation) setRecovery({ kind: 'done', message });
    }, () => {
      // The action owns its plain result; a rejected run reports nothing and
      // leaves the action available again.
      if (recoveryGeneration.current === generation) setRecovery({ kind: 'idle' });
    });
  }, []);

  useEffect(() => {
    let active = true;
    // A re-run triggered by a changed resolve/toErrorMessage identity (for
    // example a locale switch) must not tear down the ready subtree: keep the
    // current state while re-checking, and only surface the checking screen
    // when no successful check has completed yet.
    setState((current) => (current.kind === 'ready' ? current : { kind: 'checking' }));
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
    const recoveryAction = projection.recoveryAction;
    return (
      <main className="runtime-unavailable-screen" aria-live="polite">
        <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
          <div className="runtime-unavailable-heading">
            <StatusBadge tone="info" shape="dot">{copy.setupRequired}</StatusBadge>
            <h1>{appTitle}</h1>
          </div>
          <InlineAlert tone="info">
            <div className="runtime-alert-copy">
              <strong>{projection.signInRequired ? copy.signInRequired : copy.connectionRequired}</strong>
              <span>{projection.body}</span>
            </div>
          </InlineAlert>
          {projection.nextAction ? <p className="runtime-action-hint">{copy.nextAction(projection.nextAction)}</p> : null}
          <div className="runtime-gate-actions">
            <Button type="button" tone="primary" onClick={retry}>{copy.retry}</Button>
            {recoveryAction ? (
              <Button
                type="button"
                tone="secondary"
                loading={recovery.kind === 'running'}
                disabled={recovery.kind === 'running'}
                onClick={() => runRecovery(recoveryAction)}
              >
                {recoveryAction.label}
              </Button>
            ) : null}
          </div>
          {recovery.kind === 'done' ? <p className="runtime-action-hint" role="status">{recovery.message}</p> : null}
          <details className="runtime-gate-details">
            <summary>{copy.technicalDetails}</summary>
            {projection.technicalDetails?.length ? (
              <dl>
                {projection.technicalDetails.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p>{copy.offlineTier(state.offlineTier)}</p>
          </details>
        </Surface>
      </main>
    );
  }

  return <>{children}</>;
}
