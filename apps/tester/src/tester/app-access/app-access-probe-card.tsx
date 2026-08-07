import type { ReactNode } from 'react';
import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';

import {
  appAccessPageCopy,
  type AppAccessProbeDefinition,
} from './app-access-catalog.js';
import type { AppAccessGate, AppAccessProbeState } from './app-access-state.js';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

function badgeFor(state: AppAccessProbeState, gated: boolean): { readonly tone: BadgeTone; readonly label: string } {
  if (gated && state.status === 'not-run') return { tone: 'info', label: 'Setup needed' };
  switch (state.status) {
    case 'running': return { tone: 'info', label: 'Running' };
    case 'passed': return { tone: 'success', label: 'Passed' };
    case 'failed': return { tone: 'danger', label: 'Failed' };
    default: return { tone: 'neutral', label: 'Not run' };
  }
}

export function AppAccessProbeCard({
  definition,
  state,
  gate,
  onRun,
  children,
}: {
  readonly definition: AppAccessProbeDefinition;
  readonly state: AppAccessProbeState;
  readonly gate: AppAccessGate;
  readonly onRun: () => void;
  readonly children?: ReactNode;
}) {
  const gated = !gate.runnable;
  const badge = badgeFor(state, gated);
  return (
    <Surface
      as="article"
      tone="panel"
      elevation="base"
      padding="md"
      className="app-access-probe-card"
      data-testid={definition.testId}
      data-state={state.status}
    >
      <div className="app-access-probe-card__head">
        <StatusBadge tone={badge.tone} shape="dot">{badge.label}</StatusBadge>
        <h3 className="app-access-probe-card__title">{definition.title}</h3>
        <Button
          type="button"
          tone="secondary"
          size="sm"
          className="app-access-probe-card__run"
          data-testid={definition.runTestId}
          disabled={gated || state.status === 'running'}
          loading={state.status === 'running'}
          onClick={onRun}
        >
          Run
        </Button>
      </div>
      <p className="app-access-probe-card__proves">{definition.proves}</p>
      {definition.requires ? (
        <p className="app-access-probe-card__requires">Requires: {definition.requires}</p>
      ) : null}
      {children}
      <div
        className="app-access-probe-card__result"
        data-testid={definition.resultTestId}
        data-state={state.status}
      >
        {gated && state.status === 'not-run' ? (
          <p className="app-access-probe-card__guidance">{gate.guidance}</p>
        ) : state.status === 'failed' ? (
          <>
            <p className="app-access-probe-card__failure">{state.headline}</p>
            <details className="app-access-diag">
              <summary>{appAccessPageCopy.technicalDetails}</summary>
              <dl className="app-access-diag__grid">
                <div>
                  <dt>Reason code</dt>
                  <dd><code>{state.reasonCode}</code></dd>
                </div>
                {state.detail ? (
                  <div>
                    <dt>Detail</dt>
                    <dd>{state.detail}</dd>
                  </div>
                ) : null}
              </dl>
            </details>
          </>
        ) : (
          <>
            <p className="app-access-probe-card__headline">{state.headline}</p>
            {state.facts.length > 0 ? (
              <ul className="app-access-probe-card__facts">
                {state.facts.map((fact) => <li key={fact}>{fact}</li>)}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </Surface>
  );
}
