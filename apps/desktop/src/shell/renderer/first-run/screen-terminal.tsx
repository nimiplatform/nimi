// First-Run Terminal Screens — repair / blocked / ready.
//
// These present the three off-happy-path product-control states in the same
// visual language as the wizard phases. They are NOT phases (they carry no
// step indicator) but render inside the wizard chrome card.
//
// - `repair_required` → ScreenRepair: a calm repair surface with Retry /
//   Repair / Support. Retry / Repair re-evaluate the product-control record.
// - `blocked` → ScreenBlocked: a calm terminal surface explaining Nimi cannot
//   continue safely, pointing to Support. No mark-ready / shortcut affordance.
// - `ready_for_use` → ScreenReady: a brief "Nimi is ready" confirmation. The
//   shell auto-continues to Chat -> Nimi Chat (P-COLD-012); the actual route
//   transition is owned by the app-routes admission gate, not this screen.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { SupportDegradedEntry } from '../features/support/support-degraded-entry.js';
import { AlertIcon, CheckCircleFilledIcon, WrenchIcon } from './first-run-icons.js';

type ScreenRepairProps = {
  /** The typed repair reason from the product-control projection, if any. */
  readonly reason: string | null;
  readonly busy: boolean;
  /** Re-reads the product-control record to re-evaluate the state machine. */
  readonly onRetry: () => void;
};

/**
 * `repair_required` terminal screen. Repair restores a missing required
 * component; the renderer only triggers a re-read — the product-control
 * backend owns the actual repair evaluation.
 */
export function ScreenRepair(props: ScreenRepairProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="first-run-screen-repair" className="flex flex-col items-center gap-6 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,white)] text-[var(--nimi-status-warning)]"
      >
        <WrenchIcon className="h-7 w-7" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.repair.heading', {
            defaultValue: 'Nimi needs to repair a component',
          })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.repair.body', {
            defaultValue:
              'A required local component needs repair before normal use. Retry the setup or run a repair to restore it.',
          })}
        </p>
        {props.reason ? (
          <p data-testid="first-run-repair-reason" className="text-xs text-[var(--nimi-text-muted)]">
            {props.reason}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          tone="primary"
          className="rounded-full px-6"
          data-testid="first-run-repair-retry"
          disabled={props.busy}
          onClick={props.onRetry}
        >
          {t('FirstRun.repair.retry', { defaultValue: 'Retry' })}
        </Button>
        <div className="[&_button]:rounded-full" data-testid="first-run-repair-support">
          <SupportDegradedEntry />
        </div>
      </div>
    </div>
  );
}

type ScreenBlockedProps = {
  /** The typed blocking reason / error, if any. */
  readonly reason: string | null;
};

/**
 * `blocked` terminal screen. Nimi cannot continue safely; the only forward
 * affordance is Support. There is no shortcut to `ready_for_use`.
 */
export function ScreenBlocked(props: ScreenBlockedProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="first-run-screen-blocked" className="flex flex-col items-center gap-6 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-status-danger)_16%,white)] text-[var(--nimi-status-danger)]"
      >
        <AlertIcon className="h-7 w-7" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.blocked.heading', { defaultValue: 'Nimi cannot continue safely' })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.blocked.body', {
            defaultValue:
              'Setup cannot continue safely on this device right now. Contact Support to resolve the blocking cause.',
          })}
        </p>
        {props.reason ? (
          <p data-testid="first-run-blocked-reason" className="text-xs text-[var(--nimi-text-muted)]">
            {props.reason}
          </p>
        ) : null}
      </div>
      <div className="[&_button]:rounded-full" data-testid="first-run-blocked-support">
        <SupportDegradedEntry />
      </div>
    </div>
  );
}

/**
 * `ready_for_use` confirmation screen. Shown briefly before the app-routes
 * admission gate auto-continues into Chat -> Nimi Chat.
 */
export function ScreenReady(): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-testid="first-run-screen-ready" className="flex flex-col items-center gap-5 py-4 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] text-[var(--nimi-action-primary-bg)]"
      >
        <CheckCircleFilledIcon className="h-8 w-8" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.ready.heading', { defaultValue: 'Nimi is ready' })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.ready.body', { defaultValue: 'Opening Nimi Chat…' })}
        </p>
      </div>
    </div>
  );
}
