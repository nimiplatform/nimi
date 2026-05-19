// First-Run Readiness View — pure presentational React component.
//
// Receives a `FirstRunReadinessProjection` as prop and renders one row per
// canonical FirstRunStep with its current ColdStartState label. Stateless;
// fail-closed rendering: if `projection.isReady` is false, the overall
// banner shows the non-ready state — never claims ready when projection
// says otherwise.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ColdStartState,
  FirstRunReadinessProjection,
  FirstRunStep,
} from './types.js';

const STEP_LABELS: Record<FirstRunStep, string> = {
  runtimeDaemon: 'Runtime',
  account: 'Account',
  productControlRecord: 'Product Record',
  dataRoot: 'Data Root',
  aiProfileSelection: 'AIProfile Selection',
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

const STATE_TONES: Record<ColdStartState, string> = {
  ready: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  'in-progress': 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  'needs-confirmation': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  'setup-required': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  unavailable: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[color:var(--nimi-text-muted)]',
  failed: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  unsupported: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  'stale-projection': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
};

export interface FirstRunReadinessViewProps {
  readonly projection: FirstRunReadinessProjection;
}

export function FirstRunReadinessView({ projection }: FirstRunReadinessViewProps): ReactElement {
  const { t } = useTranslation();
  const overallLabel = STATE_LABELS[projection.overall.state];
  const readyCount = projection.steps.filter((step) => step.state === 'ready').length;
  return (
    <section data-testid="first-run-readiness" aria-labelledby="first-run-readiness-title" className="flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="first-run-readiness-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
            Environment
          </h2>
          <p className="mt-1 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
            {projection.isReady ? 'Ready to run Nimi apps.' : 'Preparing the local Nimi environment.'}
          </p>
        </div>
        <span
          data-testid="first-run-overall-state"
          data-state={projection.overall.state}
          data-ready={projection.isReady ? 'true' : 'false'}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${STATE_TONES[projection.overall.state]}`}
        >
          {overallLabel}
        </span>
      </div>

      {projection.overall.detail ? (
        <p className="rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,transparent)] px-3 py-2 text-sm leading-6 text-[color:var(--nimi-text-secondary)]">
          {projection.overall.detail}
        </p>
      ) : null}

      <div className="flex items-center justify-between border-y border-[color:var(--nimi-border-subtle)] py-3 text-sm">
        <span className="text-[color:var(--nimi-text-muted)]">{t('Home.firstRun.readinessMetric')}</span>
        <span className="font-medium text-[color:var(--nimi-text-primary)]">{readyCount}/{projection.steps.length}</span>
      </div>

      <ul data-testid="first-run-step-list" className="grid gap-2 sm:grid-cols-2">
        {projection.steps.map((step) => (
          <li
            key={step.step}
            data-testid={`first-run-step-${step.step}`}
            data-state={step.state}
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-2"
          >
            <span data-testid={`first-run-step-${step.step}-label`} className="truncate text-sm text-[color:var(--nimi-text-secondary)]">
              {STEP_LABELS[step.step]}
            </span>
            <span
              data-testid={`first-run-step-${step.step}-state`}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${STATE_TONES[step.state]}`}
            >
              {STATE_LABELS[step.state]}
            </span>
            {step.detail ? <span data-testid={`first-run-step-${step.step}-detail`} className="sr-only">{step.detail}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
