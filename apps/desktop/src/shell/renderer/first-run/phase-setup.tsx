// First-Run Phase 3 — Setup.
//
// Folds the four product-progress states
// (`local_ai_profile_selected_assets_missing`,
// `local_ai_profile_selected_environment_not_ready`,
// `local_ai_assets_downloaded_environment_not_ready`, `local_ai_ready`) into
// one calm progress screen with a sub-step checklist. The checklist projects
// the real Runtime materialization job/state progression. A failing sub-step
// row surfaces the typed Retry / Repair / Cancel materialization affordance
// exactly where it failed; the happy path stays calm.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, ProgressIndicator } from '@nimiplatform/kit/ui';
import {
  AlertIcon,
  CheckCircleFilledIcon,
  EmptyCircleIcon,
  SpinnerIcon,
} from './first-run-icons.js';
import type {
  FirstRunSetupChecklist,
  FirstRunSetupStep,
  FirstRunSetupStepId,
} from './first-run-setup-checklist.js';
import type { NimiFirstRunMaterializationDependencyProjection } from './runtime-materialization.js';

const STEP_LABEL_DEFAULTS: Record<FirstRunSetupStepId, string> = {
  download: 'Downloading local models',
  verify: 'Verifying files',
  environment: 'Preparing local environment',
  finalize: 'Finalizing your AI profile',
};

function stepLabel(t: TFunction, id: FirstRunSetupStepId): string {
  return t(`FirstRun.setup.steps.${id}`, { defaultValue: STEP_LABEL_DEFAULTS[id] });
}

/** Formats a byte count into a compact human-readable size. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Formats a remaining-seconds count into a compact `Nm Ns` / `Ns` string. */
function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (total >= 60) {
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  return `${total}s`;
}

type SetupActionHandlers = {
  readonly onRetry: (dependency: NimiFirstRunMaterializationDependencyProjection) => void;
  readonly onRepair: (dependency: NimiFirstRunMaterializationDependencyProjection) => void;
  readonly onCancel: (dependency: NimiFirstRunMaterializationDependencyProjection) => void;
};

type PhaseSetupProps = {
  readonly checklist: FirstRunSetupChecklist;
  /** A bridge action is in flight; disables the failing-row action buttons. */
  readonly busy: boolean;
  readonly actions: SetupActionHandlers;
  /** Optional last typed error string surfaced above the checklist. */
  readonly error: string | null;
};

function StepRow(props: {
  readonly step: FirstRunSetupStep;
  readonly busy: boolean;
  readonly actions: SetupActionHandlers;
  readonly t: TFunction;
}): ReactElement {
  const { step, t } = props;

  let icon: ReactElement;
  if (step.status === 'done') {
    icon = <CheckCircleFilledIcon className="h-5 w-5 text-[var(--nimi-action-primary-bg)]" />;
  } else if (step.status === 'active') {
    icon = <SpinnerIcon className="h-5 w-5 text-[var(--nimi-action-primary-bg)]" />;
  } else if (step.status === 'failed') {
    icon = <AlertIcon className="h-5 w-5 text-[var(--nimi-status-danger)]" />;
  } else {
    icon = <EmptyCircleIcon className="h-5 w-5 text-[color-mix(in_srgb,var(--nimi-text-muted)_50%,transparent)]" />;
  }

  // Action affordances and the red error indicator are gated on a genuine
  // typed failure only. An `active` (queued / downloading / verifying /
  // installing) step is in progress — it never renders red and never offers
  // Retry / Repair.
  const failing = step.status === 'failed' && step.failingDependency;
  const progress = step.status === 'active' ? step.downloadProgress : null;

  return (
    <li
      data-testid={`first-run-setup-step-${step.id}`}
      data-step-status={step.status}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="shrink-0">{icon}</span>
        <span
          className={
            step.status === 'pending'
              ? 'text-sm text-[var(--nimi-text-muted)]'
              : step.status === 'failed'
                ? 'text-sm font-medium text-[var(--nimi-status-danger)]'
                : 'text-sm text-[var(--nimi-text-primary)]'
          }
        >
          {stepLabel(t, step.id)}
        </span>
        {progress && progress.percent !== null ? (
          <span
            data-testid={`first-run-setup-step-${step.id}-percent`}
            className="ml-auto text-sm tabular-nums text-[var(--nimi-text-secondary)]"
          >
            {progress.percent}%
          </span>
        ) : null}
      </div>

      {progress ? (
        <div
          data-testid={`first-run-setup-step-${step.id}-progress`}
          data-progress-determinate={progress.percent !== null ? 'true' : 'false'}
          className="ml-8 flex flex-col gap-1"
        >
          {progress.percent !== null ? (
            <ProgressIndicator value={progress.percent} />
          ) : (
            <div
              className="nimi-progress__track h-2 w-full overflow-hidden rounded-full bg-[var(--nimi-surface-active)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="nimi-progress__bar h-full w-1/3 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
            </div>
          )}
          <span className="text-xs tabular-nums text-[var(--nimi-text-muted)]">
            {progress.percent !== null
              ? t('FirstRun.setup.progressOf', {
                  defaultValue: '{{received}} of {{total}}',
                  received: formatBytes(progress.bytesReceived),
                  total: formatBytes(progress.bytesTotal),
                })
              : t('FirstRun.setup.progressReceived', {
                  defaultValue: '{{received}} downloaded',
                  received: formatBytes(progress.bytesReceived),
                })}
            {progress.speedBytesPerSec !== null
              ? ` · ${t('FirstRun.setup.progressRate', {
                  defaultValue: '{{rate}}/s',
                  rate: formatBytes(progress.speedBytesPerSec),
                })}`
              : ''}
            {progress.etaSeconds !== null
              ? ` · ${t('FirstRun.setup.progressEta', {
                  defaultValue: '{{eta}} left',
                  eta: formatEta(progress.etaSeconds),
                })}`
              : ''}
          </span>
        </div>
      ) : null}

      {failing ? (
        <div className="ml-8 flex flex-wrap gap-2">
          {step.canCancel ? (
            <Button
              type="button"
              tone="secondary"
              size="sm"
              data-testid="first-run-setup-cancel"
              disabled={props.busy}
              onClick={() => props.actions.onCancel(step.failingDependency!)}
            >
              {t('FirstRun.setup.cancel', { defaultValue: 'Cancel' })}
            </Button>
          ) : null}
          {step.canRetry ? (
            <Button
              type="button"
              tone="secondary"
              size="sm"
              data-testid="first-run-setup-retry"
              disabled={props.busy}
              onClick={() => props.actions.onRetry(step.failingDependency!)}
            >
              {t('FirstRun.setup.retry', { defaultValue: 'Retry' })}
            </Button>
          ) : null}
          {step.canRepair ? (
            <Button
              type="button"
              tone="primary"
              size="sm"
              data-testid="first-run-setup-repair"
              disabled={props.busy}
              onClick={() => props.actions.onRepair(step.failingDependency!)}
            >
              {t('FirstRun.setup.repair', { defaultValue: 'Repair' })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Phase 3 content — the calm setup progress screen.
 */
export function PhaseSetup(props: PhaseSetupProps): ReactElement {
  const { t } = useTranslation();

  return (
    <div data-testid="first-run-phase-setup" className="flex flex-col gap-7">
      <header className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.setup.heading', { defaultValue: 'Setting up Nimi…' })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.setup.subline', {
            defaultValue: 'This may take a few minutes. You can relax.',
          })}
        </p>
      </header>

      <ProgressIndicator
        data-testid="first-run-setup-progress"
        value={props.checklist.progressPercent}
      />

      {props.error ? (
        <p
          data-testid="first-run-setup-error"
          className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,white)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,white)] px-3 py-2 text-sm text-[var(--nimi-status-danger)]"
        >
          {props.error}
        </p>
      ) : null}

      <ul data-testid="first-run-setup-checklist" className="flex flex-col gap-4">
        {props.checklist.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            busy={props.busy}
            actions={props.actions}
            t={t}
          />
        ))}
      </ul>
    </div>
  );
}
