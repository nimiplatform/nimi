// First-Run Readiness View — pure presentational React component.
//
// Receives a `FirstRunReadinessProjection` as prop and renders one row per
// canonical FirstRunStep with its current ColdStartState label. Stateless;
// fail-closed rendering: if `projection.isReady` is false, the overall
// banner shows the non-ready state — never claims ready when projection
// says otherwise.

import type { ReactElement } from 'react';
import type {
  ColdStartState,
  FirstRunReadinessProjection,
  FirstRunStep,
} from './types.js';

const STEP_LABELS: Record<FirstRunStep, string> = {
  runtimeDaemon: 'Runtime',
  account: 'Account',
  defaultExperienceProfile: 'Default Experience Profile',
  materialization: 'Local Environment',
  appRegistry: 'App Registry',
  cognitionMemory: 'Memory',
};

const STATE_LABELS: Record<ColdStartState, string> = {
  unavailable: 'Unavailable',
  'setup-required': 'Setup Required',
  'needs-confirmation': 'Needs Confirmation',
  'in-progress': 'In Progress',
  failed: 'Failed',
  unsupported: 'Unsupported',
  'stale-projection': 'Stale',
  ready: 'Ready',
};

export interface FirstRunReadinessViewProps {
  readonly projection: FirstRunReadinessProjection;
}

export function FirstRunReadinessView({ projection }: FirstRunReadinessViewProps): ReactElement {
  const overallLabel = STATE_LABELS[projection.overall.state];
  return (
    <section data-testid="first-run-readiness" aria-labelledby="first-run-readiness-title">
      <h2 id="first-run-readiness-title">First-Run Readiness</h2>
      <p
        data-testid="first-run-overall-state"
        data-state={projection.overall.state}
        data-ready={projection.isReady ? 'true' : 'false'}
      >
        {overallLabel}
        {projection.overall.detail ? ` — ${projection.overall.detail}` : null}
      </p>
      <ul data-testid="first-run-step-list">
        {projection.steps.map((step) => (
          <li
            key={step.step}
            data-testid={`first-run-step-${step.step}`}
            data-state={step.state}
          >
            <span data-testid={`first-run-step-${step.step}-label`}>{STEP_LABELS[step.step]}</span>
            <span data-testid={`first-run-step-${step.step}-state`}>{STATE_LABELS[step.state]}</span>
            {step.detail ? <span data-testid={`first-run-step-${step.step}-detail`}>{step.detail}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
