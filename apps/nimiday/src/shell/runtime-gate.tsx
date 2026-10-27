import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, RefreshCw, ShieldAlert, Unplug } from 'lucide-react';
import { Button, Surface } from '@nimiplatform/kit/ui';
import appIconUrl from '../../assets/app-icon.png';
import type { Copy } from '../nimiday/i18n/index.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type RuntimeGateProjection =
  | { readonly status: 'ready' }
  | {
      readonly status: 'unavailable';
      readonly reasonCode: string;
      readonly message: string;
      readonly actionHint?: string;
      readonly retryable?: boolean;
    };

type Unavailable = Extract<RuntimeGateProjection, { status: 'unavailable' }>;
export type RuntimeGateCopy = Copy['runtimeGate'];

export function runtimeGateIssue(reasonCode: string): keyof RuntimeGateCopy['issues'] {
  switch (reasonCode) {
    case 'runtime-service-untrusted': return 'untrusted';
    case 'runtime-service-repair-required': return 'repair';
    case 'runtime-service-unavailable':
    case 'RUNTIME_UNAVAILABLE': return 'unavailable';
    case 'protected-carrier-required': return 'carrier';
    case 'local-development-registration-required': return 'registration';
    case 'local-development-project-changed':
    case 'project-changed': return 'project';
    case 'runtime-access-denied':
    case 'runtime-permission-denied':
    case 'access-denied':
    case 'local-app-access-denied': return 'access';
    case 'local-development-session-revoked':
    case 'runtime-unauthenticated':
    case 'account-changed':
    case 'process-replaced':
    case 'runtime-restarted':
    case 'revoked':
    case 'presence-expired':
    case 'session-invalid':
    case 'local-app-snapshot-unavailable': return 'session';
    default: return 'unknown';
  }
}

export type RuntimeGateProps = {
  readonly appTitle: string;
  readonly copy: RuntimeGateCopy;
  readonly resolve: () => Promise<RuntimeGateProjection>;
  readonly clear: () => void;
  readonly toError: (error: unknown) => Unavailable;
  readonly children: ReactNode;
};

export function RuntimeGate({ appTitle, copy, resolve, clear, toError, children }: RuntimeGateProps) {
  const [state, setState] = useState<RuntimeGateProjection | null>(null);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(true);

  useEffect(() => {
    let active = true;
    pending.current = true;
    setChecking(true);
    void (async () => {
      try {
        // Each attempt asks the real carrier again, including after a refused check.
        clear();
        const result = await resolve();
        if (active) setState(result);
      } catch (error) {
        if (active) setState(toError(error));
      } finally {
        if (active) {
          pending.current = false;
          setChecking(false);
        }
      }
    })();
    return () => { active = false; };
  }, [attempt, clear, resolve, toError]);

  if (state?.status === 'ready') return <>{children}</>;
  const failure = state?.status === 'unavailable' ? state : null;
  const issue = runtimeGateIssue(failure?.reasonCode ?? '');
  const guidance = copy.issues[issue];
  const Icon = checking ? LoaderCircle : issue === 'untrusted' || issue === 'access' ? ShieldAlert : Unplug;

  return (
    <main className="runtime-unavailable-screen" aria-labelledby="runtime-title">
      <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-brand">
          <img className="nd-brand-mark nd-brand-mark--image" src={appIconUrl} alt="" />
          <span>{appTitle}</span>
        </div>
        <div className="runtime-status" aria-live="polite" aria-atomic="true" aria-busy={checking}>
          <span className="runtime-status-icon" data-checking={checking}>
            <Icon size={28} aria-hidden="true" />
          </span>
          <h1 id="runtime-title">{checking ? copy.checking : guidance.title}</h1>
          <p>{checking ? copy.checkingBody : guidance.body}</p>
          {!checking && attempt > 0 ? <p className="runtime-retry-result">{copy.retryFailed}</p> : null}
        </div>
        <Button type="button" tone="primary" disabled={checking} onClick={() => {
          if (pending.current) return;
          pending.current = true;
          setChecking(true);
          setAttempt(value => value + 1);
        }}>
          <RefreshCw size={16} aria-hidden="true" />
          {checking ? copy.checking : issue === 'untrusted' || issue === 'repair' || failure?.retryable === false ? copy.checkAgain : copy.retry}
        </Button>
        {failure ? (
          <details className="runtime-diagnostics">
            <summary>{copy.diagnostics}</summary>
            <dl>
              <div><dt>{copy.reasonCode}</dt><dd>{failure.reasonCode}</dd></div>
              {failure.message && failure.message !== failure.reasonCode ? <div><dt>{copy.message}</dt><dd>{failure.message}</dd></div> : null}
              {failure.actionHint ? <div><dt>{copy.actionHint}</dt><dd>{failure.actionHint}</dd></div> : null}
            </dl>
          </details>
        ) : null}
      </Surface>
    </main>
  );
}
