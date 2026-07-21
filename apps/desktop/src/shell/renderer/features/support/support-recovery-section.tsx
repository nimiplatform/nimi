/**
 * Support `recovery` sub-area (`D-SUP-007`).
 *
 * Presents recovery help for fail-closed scenarios — corrupt `~/.nimi`,
 * missing / unreachable `nimi_data`, incomplete first-run. It consumes the
 * `P-COLD-001` typed product-control projection and renders the copy-floor
 * guidance via `RECOVERY_STATE_COPY_KEY`; it never shows the raw technical
 * enum name as the primary user copy, and it never claims readiness — the
 * readiness truth stays with the product-control record (`P-COLD-015/016`).
 */

import { useTranslation } from 'react-i18next';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useTypedProjection as useSupportProjection } from '@nimiplatform/kit/ui';
import {
  NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  isNimiProductControlDegradedState,
  isNimiProductControlRepairRoutedState,
} from '@nimiplatform/sdk/runtime';
import {
  SupportCard,
  SupportFailClosed,
  SupportLoading,
  SupportSectionShell,
} from './support-section-shell.js';

async function loadRecoveryProjection(
  repair: ReturnType<typeof useDesktopRendererCommands>['supportRepair'],
): Promise<NimiProductControlRecordProjection> {
  return repair.loadProductControlRecord();
}

export function SupportRecoverySection(props: { onNavigateToRepair: () => void }) {
  const { t } = useTranslation();
  const repair = useDesktopRendererCommands().supportRepair;
  const projection = useSupportProjection(() => loadRecoveryProjection(repair), {
    failClosedMessage: t('Support.recoveryProjectionUnavailable'),
  });

  if (projection.status === 'loading') {
    return (
      <SupportSectionShell
        title={t('Support.recoveryTitle')}
        description={t('Support.recoveryDescription')}
        testId="support-section-recovery"
      >
        <SupportLoading testId="support-recovery-loading" />
      </SupportSectionShell>
    );
  }

  // A failed product-control projection is itself a fail-closed scenario. The
  // recovery sub-area must stay reachable and route the user to repair — it
  // surfaces the typed reason and the repair entry, never a fabricated
  // "recovered" state.
  if (projection.status === 'failed' || !projection.data) {
    return (
      <SupportSectionShell
        title={t('Support.recoveryTitle')}
        description={t('Support.recoveryDescription')}
        testId="support-section-recovery"
      >
        <SupportFailClosed
          testId="support-recovery-fail-closed"
          reason={projection.error ?? t('Support.recoveryProjectionUnavailable')}
          onRetry={projection.reload}
        />
        <SupportCard title={t('Support.recoveryNextStepTitle')} testId="support-recovery-next-step">
          <button
            type="button"
            data-testid="support-recovery-open-repair"
            onClick={props.onNavigateToRepair}
            className="inline-flex items-center rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-medium text-[var(--nimi-action-primary-fg)] transition hover:bg-[var(--nimi-action-primary-bg-hover)]"
          >
            {t('Support.recoveryOpenRepair')}
          </button>
        </SupportCard>
      </SupportSectionShell>
    );
  }

  const control = projection.data;
  const copyKey = NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[control.state];
  const degraded = isNimiProductControlDegradedState(control.state);
  const repairRouted = isNimiProductControlRepairRoutedState(control.state);

  return (
    <SupportSectionShell
      title={t('Support.recoveryTitle')}
      description={t('Support.recoveryDescription')}
      testId="support-section-recovery"
    >
      <SupportCard
        title={t(`${copyKey}.title`)}
        description={t(`${copyKey}.body`)}
        testId="support-recovery-state"
      >
        <p
          data-testid="support-recovery-state-id"
          className="text-[11px] uppercase tracking-wide text-[var(--nimi-text-muted)]"
        >
          {t('Support.recoveryTechnicalStateLabel')}: {control.state}
        </p>
      </SupportCard>

      {degraded ? (
        <SupportCard
          title={t('Support.recoveryNextStepTitle')}
          description={
            repairRouted
              ? t('Support.recoveryNextStepRepairBody')
              : t('Support.recoveryNextStepSetupBody')
          }
          testId="support-recovery-next-step"
        >
          <button
            type="button"
            data-testid="support-recovery-open-repair"
            onClick={props.onNavigateToRepair}
            className="inline-flex items-center rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-medium text-[var(--nimi-action-primary-fg)] transition hover:bg-[var(--nimi-action-primary-bg-hover)]"
          >
            {t('Support.recoveryOpenRepair')}
          </button>
        </SupportCard>
      ) : (
        <SupportCard
          title={t('Support.recoveryHealthyTitle')}
          description={t('Support.recoveryHealthyBody')}
          testId="support-recovery-healthy"
        />
      )}
    </SupportSectionShell>
  );
}
