import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { OfflineCoordinator, type OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';

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
      readonly title?: string;
      readonly body: string;
      readonly signInRequired: boolean;
      readonly nextAction?: string;
      readonly recoveryAction?: WorkbenchRuntimeGateRecoveryAction;
      // Reason codes and hints stay in the folded technical area.
      readonly technicalDetails?: readonly WorkbenchRuntimeGateTechnicalDetail[];
    };

export type WorkbenchRuntimeGateCopy = {
  readonly checking: string;
  readonly checkingHint?: string;
  readonly setupRequired: string;
  readonly signInRequired: string;
  readonly connectionRequired: string;
  readonly retry: string;
  readonly offlineTier: (tier: OfflineTier) => string;
  readonly nextAction: (action: string) => string;
  readonly stepLabel?: string;
  readonly recheckStillUnavailable?: string;
  readonly protectionLabel?: string;
  readonly technicalDetails: string;
};

export type WorkbenchRuntimeGateProps = {
  readonly appTitle: string;
  readonly brandMark?: ReactNode;
  readonly copy: WorkbenchRuntimeGateCopy;
  readonly resolve: () => Promise<WorkbenchRuntimeGateProjection>;
  readonly clear: () => void;
  readonly toErrorMessage: (error: unknown) => string;
  // Reports a lost session after the gate opened; the gate then runs the same
  // check again instead of leaving the App on stale access.
  readonly revalidate?: (onLoss: () => void) => () => void;
  // Called when such a re-check finds the session ready again.
  readonly onRevalidated?: () => void;
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

function DesktopConnectionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.42 1.41" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.41-1.41" />
    </svg>
  );
}

function AccountSignInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function RefreshActionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function ChevronDisclosureIcon() {
  return (
    <svg className="runtime-gate-details__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function WorkbenchRuntimeGate({
  appTitle,
  brandMark,
  copy,
  resolve,
  clear,
  toErrorMessage,
  revalidate,
  onRevalidated,
  children,
}: WorkbenchRuntimeGateProps) {
  const titleId = useId();
  const [offlineCoordinator] = useState(() => new OfflineCoordinator());
  const [state, setState] = useState<WorkbenchRuntimeGateState>({ kind: 'checking' });
  const [rechecking, setRechecking] = useState(false);
  const [manualRetryNotice, setManualRetryNotice] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [recovery, setRecovery] = useState<WorkbenchRuntimeGateRecoveryState>({ kind: 'idle' });
  // A recovery result belongs to the blocked check that offered it.
  const recoveryGeneration = useRef(0);
  // One re-check at a time answers every loss reported while it runs.
  const revalidating = useRef(false);
  const checkInFlight = useRef(false);
  const manualRetryPending = useRef(false);
  const onRevalidatedRef = useRef(onRevalidated);
  onRevalidatedRef.current = onRevalidated;

  useEffect(() => {
    if (!revalidate) return undefined;
    return revalidate(() => {
      if (revalidating.current) return;
      revalidating.current = true;
      // The failed request is not retried; the ready subtree stays mounted
      // while the check runs and only a failed check blocks it.
      clear();
      setReloadKey((value) => value + 1);
    });
  }, [clear, revalidate]);

  useEffect(() => {
    if (state.kind !== 'blocked' || typeof window === 'undefined') return undefined;
    const onFocus = () => {
      if (checkInFlight.current) return;
      clear();
      setReloadKey((value) => value + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [clear, state.kind]);

  const retry = useCallback(() => {
    if (checkInFlight.current) return;
    recoveryGeneration.current += 1;
    manualRetryPending.current = true;
    setManualRetryNotice(false);
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
    checkInFlight.current = true;
    const wasManualRetry = manualRetryPending.current;
    manualRetryPending.current = false;
    // A re-run triggered by a manual retry, focus check, or locale switch must
    // not tear down the ready subtree or flash-unmount the blocked panel.
    setState((current) => (current.kind === 'ready' || current.kind === 'blocked' ? current : { kind: 'checking' }));
    setRechecking(true);
    void resolve().then((projection) => {
      if (!active) return;
      checkInFlight.current = false;
      setRechecking(false);
      const revalidated = revalidating.current;
      revalidating.current = false;
      if (projection.status === 'ready') {
        setManualRetryNotice(false);
        offlineCoordinator.markRuntimeReachability('reachable');
        setState({ kind: 'ready' });
        if (revalidated) onRevalidatedRef.current?.();
        return;
      }
      offlineCoordinator.markRuntimeReachability('unreachable');
      if (wasManualRetry) setManualRetryNotice(true);
      setState({
        kind: 'blocked',
        projection,
        offlineTier: offlineCoordinator.getTier(),
      });
    }).catch((error) => {
      if (!active) return;
      checkInFlight.current = false;
      setRechecking(false);
      revalidating.current = false;
      offlineCoordinator.markRuntimeReachability('unreachable');
      if (wasManualRetry) setManualRetryNotice(true);
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
      checkInFlight.current = false;
    };
  }, [offlineCoordinator, reloadKey, resolve, toErrorMessage]);

  const brandIdentity = (
    <div className="runtime-gate-brand">
      <span className="runtime-gate-brand__mark" aria-hidden="true">
        {brandMark ?? appTitle.trim().slice(0, 1).toUpperCase()}
      </span>
      <span className="runtime-gate-brand__title">{appTitle}</span>
    </div>
  );

  if (state.kind === 'checking') {
    return (
      <main className="runtime-check-screen" aria-live="polite" aria-busy="true">
        <Surface className="runtime-check-panel" material="glass-thick" tone="card" elevation="floating" padding="none">
          <div className="runtime-gate-topbar">
            {brandIdentity}
            <StatusBadge tone="neutral" shape="dot">{copy.checking}</StatusBadge>
          </div>
          {copy.checkingHint ? <p className="runtime-check-hint">{copy.checkingHint}</p> : null}
        </Surface>
      </main>
    );
  }

  if (state.kind === 'blocked') {
    const { projection } = state;
    const recoveryAction = projection.recoveryAction;
    const headline = projection.title || (projection.signInRequired ? copy.signInRequired : copy.connectionRequired);
    const badgeTone = projection.signInRequired ? 'warning' : 'info';
    const feedbackMessage = recovery.kind === 'done'
      ? recovery.message
      : (manualRetryNotice && !rechecking ? copy.recheckStillUnavailable : undefined);
    return (
      <main className="runtime-unavailable-screen" aria-labelledby={titleId} aria-live="polite">
        <Surface className="runtime-unavailable-panel" material="glass-thick" tone="card" elevation="floating" padding="none">
          <div className="runtime-gate-topbar">
            {brandIdentity}
            <StatusBadge tone={badgeTone} shape="dot">{copy.setupRequired}</StatusBadge>
          </div>

          <div className="runtime-gate-hero">
            <span className="runtime-gate-icon" data-tone={badgeTone}>
              {projection.signInRequired ? <AccountSignInIcon /> : <DesktopConnectionIcon />}
            </span>
            <h1 id={titleId}>{headline}</h1>
            <p className="runtime-gate-summary">{projection.body}</p>
          </div>

          {projection.nextAction ? (
            <div className="runtime-gate-guidance">
              {copy.stepLabel ? <span className="runtime-gate-guidance__label">{copy.stepLabel}</span> : null}
              <p className="runtime-action-hint">
                {copy.stepLabel ? projection.nextAction : copy.nextAction(projection.nextAction)}
              </p>
            </div>
          ) : null}

          <div className="runtime-gate-action-group">
            <div className="runtime-gate-actions">
              <Button
                type="button"
                tone="primary"
                loading={rechecking}
                disabled={rechecking}
                leadingIcon={!rechecking ? <RefreshActionIcon /> : undefined}
                onClick={retry}
              >
                {copy.retry}
              </Button>
              {recoveryAction ? (
                <Button
                  type="button"
                  tone="secondary"
                  loading={recovery.kind === 'running'}
                  disabled={recovery.kind === 'running' || rechecking}
                  onClick={() => runRecovery(recoveryAction)}
                >
                  {recoveryAction.label}
                </Button>
              ) : null}
            </div>
            {feedbackMessage ? <p className="runtime-gate-feedback" role="status">{feedbackMessage}</p> : null}
          </div>

          <div className="runtime-gate-footer">
            <details className="runtime-gate-details">
              <summary>
                <ChevronDisclosureIcon />
                <span>{copy.technicalDetails}</span>
              </summary>
              <div className="runtime-gate-details__body">
                {projection.technicalDetails?.length || copy.protectionLabel ? (
                  <dl>
                    {projection.technicalDetails?.map((detail) => (
                      <div key={detail.label}>
                        <dt>{detail.label}</dt>
                        <dd>{detail.value}</dd>
                      </div>
                    ))}
                    {copy.protectionLabel ? (
                      <div>
                        <dt>{copy.protectionLabel}</dt>
                        <dd>{state.offlineTier}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                {!copy.protectionLabel ? <p>{copy.offlineTier(state.offlineTier)}</p> : null}
              </div>
            </details>
          </div>
        </Surface>
      </main>
    );
  }

  return <>{children}</>;
}
