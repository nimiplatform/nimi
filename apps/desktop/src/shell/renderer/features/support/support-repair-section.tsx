/**
 * Support `repair` sub-area (`D-SUP-003`).
 *
 * Consumes the `P-COLD-*` product-control projection and the `P-MIG-*`
 * `nimi_data` directory-ownership / cleanup bridge. It presents and triggers
 * repair — it never re-implements schema migration, pointer rebuild, or data
 * relocation. The destructive-cleanup action is gated by the `P-MIG-008`
 * confirmation token; a non-cache cleanup is never run without it.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererStorageDirs as DesktopStorageDirs } from '../../renderer/settings-port.js';
import {
  NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION,
  type DesktopRendererSupportRepairPort,
  type NimiDataCleanupPlan,
} from '../../renderer/support-repair-port.js';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useTypedProjection as useSupportProjection } from '@nimiplatform/kit/ui';
import {
  NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY,
  isNimiProductControlRepairRoutedState,
} from '@nimiplatform/sdk/runtime';
import {
  SupportCard,
  SupportFailClosed,
  SupportInfoRow,
  SupportLoading,
  SupportSectionShell,
} from './support-section-shell.js';

interface RepairProjection {
  readonly control: NimiProductControlRecordProjection;
  readonly dirs: DesktopStorageDirs | null;
  readonly dirsError: string | null;
}

async function loadRepairProjection(
  repair: DesktopRendererSupportRepairPort,
): Promise<RepairProjection> {
  // The product-control record is the load-bearing typed projection — if it
  // fails, the whole sub-area fail-closes. The storage-dirs read is a
  // secondary input; its failure is captured inline, not promoted to a
  // whole-section fail-close (repair must stay reachable).
  const control = await repair.loadProductControlRecord();
  let dirs: DesktopStorageDirs | null = null;
  let dirsError: string | null = null;
  try {
    dirs = await repair.loadStorageDirs();
  } catch (error) {
    dirsError = error instanceof Error ? error.message : String(error ?? 'storage dirs unavailable');
  }
  return { control, dirs, dirsError };
}

export function SupportRepairSection(props: { onNavigateToRecovery: () => void }) {
  const { t } = useTranslation();
  const repair = useDesktopRendererCommands().supportRepair;
  const loadProjection = useCallback(() => loadRepairProjection(repair), [repair]);
  const projection = useSupportProjection(loadProjection, {
    failClosedMessage: t('Support.repairProjectionUnavailable'),
  });

  if (projection.status === 'loading') {
    return (
      <SupportSectionShell
        title={t('Support.repairTitle')}
        description={t('Support.repairDescription')}
        testId="support-section-repair"
      >
        <SupportLoading testId="support-repair-loading" />
      </SupportSectionShell>
    );
  }

  if (projection.status === 'failed' || !projection.data) {
    return (
      <SupportSectionShell
        title={t('Support.repairTitle')}
        description={t('Support.repairDescription')}
        testId="support-section-repair"
      >
        <SupportFailClosed
          testId="support-repair-fail-closed"
          reason={projection.error ?? t('Support.repairProjectionUnavailable')}
          onRetry={projection.reload}
        />
      </SupportSectionShell>
    );
  }

  const { control, dirs, dirsError } = projection.data;
  const repairRouted = isNimiProductControlRepairRoutedState(control.state)
    || control.record?.repair.required === true;
  const repairReason = control.error
    ?? control.record?.repair.reason
    ?? null;

  return (
    <SupportSectionShell
      title={t('Support.repairTitle')}
      description={t('Support.repairDescription')}
      testId="support-section-repair"
    >
      <SupportCard
        title={t('Support.repairStatusTitle')}
        description={
          repairRouted
            ? t('Support.repairStatusRoutedBody')
            : t('Support.repairStatusHealthyBody')
        }
        testId="support-repair-status"
      >
        <div className="divide-y divide-[var(--nimi-border-subtle)]">
          <SupportInfoRow
            label={t('Support.repairProductState')}
            value={t(`${NIMI_PRODUCT_CONTROL_RECOVERY_STATE_COPY_KEY[control.state]}.title`)}
          />
          <SupportInfoRow
            label={t('Support.repairRecordPath')}
            value={control.path || t('Support.valueUnknown')}
          />
        </div>
        {repairReason ? (
          <p
            data-testid="support-repair-reason"
            className="mt-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]"
          >
            {repairReason}
          </p>
        ) : null}
        {repairRouted ? (
          <button
            type="button"
            data-testid="support-repair-open-recovery"
            onClick={props.onNavigateToRecovery}
            className="mt-4 inline-flex items-center rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-medium text-[var(--nimi-action-primary-fg)] transition hover:bg-[var(--nimi-action-primary-bg-hover)]"
          >
            {t('Support.repairOpenRecovery')}
          </button>
        ) : null}
      </SupportCard>

      <SupportPointerCard control={control} />

      <SupportDataRootCleanupCard dirs={dirs} dirsError={dirsError} />
    </SupportSectionShell>
  );
}

/**
 * Broken-pointer surface (`D-SUP-003` / `P-MIG-004`). Renders the `~/.nimi`
 * governed-config pointer set from the product-control record so the user can
 * see which pointer is unresolved. It never recreates a pointer — silent
 * recreation would orphan the user's data root.
 */
function SupportPointerCard(props: { control: NimiProductControlRecordProjection }) {
  const { t } = useTranslation();
  const pointers = props.control.record?.pointers;
  if (!pointers) {
    return null;
  }
  const rows: Array<{ label: string; value: string }> = [
    { label: t('Support.repairPointerRuntimeConfig'), value: pointers.runtimeConfigPath ?? t('Support.valueMissing') },
    { label: t('Support.repairPointerFactoryProfileIndex'), value: pointers.factoryProfileIndex ?? t('Support.valueMissing') },
    { label: t('Support.repairPointerAppRegistry'), value: pointers.appRegistry ?? t('Support.valueMissing') },
    { label: t('Support.repairPointerAppPackages'), value: pointers.appPackages ?? t('Support.valueMissing') },
  ];
  return (
    <SupportCard
      title={t('Support.repairPointersTitle')}
      description={t('Support.repairPointersDescription')}
      testId="support-repair-pointers"
    >
      <div className="divide-y divide-[var(--nimi-border-subtle)]">
        {rows.map((row) => (
          <SupportInfoRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
    </SupportCard>
  );
}

/**
 * Destructive-cleanup entry (`D-SUP-003` / `P-MIG-008`). The cleanup is
 * delegated entirely to the `nimi_data` cleanup bridge: the renderer plans the
 * impact, shows it, requires the explicit confirmation token for any
 * non-pure-cache directory, then runs the confirmed cleanup. It never deletes
 * or relocates data itself.
 */
function SupportDataRootCleanupCard(props: {
  dirs: DesktopStorageDirs | null;
  dirsError: string | null;
}) {
  const { t } = useTranslation();
  const repair = useDesktopRendererCommands().supportRepair;
  const [directoryInput, setDirectoryInput] = useState('');
  const [confirmationInput, setConfirmationInput] = useState('');
  const [plan, setPlan] = useState<NimiDataCleanupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);

  const handlePlan = useCallback(async () => {
    const directory = directoryInput.trim();
    if (!directory) {
      setFeedback({ tone: 'error', message: t('Support.repairCleanupDirectoryRequired') });
      return;
    }
    setBusy(true);
    setPlan(null);
    setFeedback(null);
    try {
      const result = await repair.planDataCleanup(directory);
      setPlan(result);
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : t('Support.repairCleanupPlanFailed'),
      });
    } finally {
      setBusy(false);
    }
  }, [directoryInput, repair, t]);

  const handleExecute = useCallback(async () => {
    if (!plan) {
      return;
    }
    const needsConfirmation = plan.requiresConfirmation;
    const confirmation = needsConfirmation ? confirmationInput.trim() : undefined;
    if (needsConfirmation && confirmation !== NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION) {
      setFeedback({
        tone: 'error',
        message: t('Support.repairCleanupConfirmationRequired', {
          confirmation: NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION,
        }),
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const outcome = await repair.executeDataCleanup(plan.directory, confirmation);
      setPlan(null);
      setConfirmationInput('');
      setFeedback({
        tone: 'success',
        message: t('Support.repairCleanupSucceeded', {
          files: outcome.removedFiles,
        }),
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : t('Support.repairCleanupExecuteFailed'),
      });
    } finally {
      setBusy(false);
    }
  }, [plan, confirmationInput, repair, t]);

  return (
    <SupportCard
      title={t('Support.repairCleanupTitle')}
      description={t('Support.repairCleanupDescription')}
      testId="support-repair-cleanup"
    >
      {props.dirsError ? (
        <p className="mb-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
          {props.dirsError}
        </p>
      ) : null}
      {props.dirs ? (
        <p className="mb-3 break-all text-xs text-[var(--nimi-text-secondary)]">
          {t('Support.repairCleanupDataRootLabel')}: {props.dirs.nimiDataDir}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <input
          value={directoryInput}
          onChange={(event) => {
            setDirectoryInput(event.target.value);
            setPlan(null);
          }}
          placeholder={t('Support.repairCleanupDirectoryPlaceholder')}
          data-testid="support-repair-cleanup-directory-input"
          className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
        />
        <button
          type="button"
          data-testid="support-repair-cleanup-plan-button"
          disabled={busy}
          onClick={() => { void handlePlan(); }}
          className="self-start rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)] disabled:opacity-50"
        >
          {t('Support.repairCleanupPlanButton')}
        </button>
      </div>

      {plan ? (
        <div
          data-testid="support-repair-cleanup-plan"
          className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-surface-card))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] p-4"
        >
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <SupportInfoRow label={t('Support.repairCleanupPlanDirectory')} value={plan.directory} />
            <SupportInfoRow label={t('Support.repairCleanupPlanOwner')} value={plan.owner} />
            <SupportInfoRow label={t('Support.repairCleanupPlanClass')} value={plan.cleanupClass} />
            <SupportInfoRow
              label={t('Support.repairCleanupPlanFiles')}
              value={String(plan.fileCount)}
            />
          </div>
          {plan.runtimeOwnerBlocked ? (
            <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">
              {t('Support.repairCleanupRuntimeBlocked')}
            </p>
          ) : (
            <>
              {plan.requiresConfirmation ? (
                <div className="mt-3">
                  <label
                    className="block text-xs font-medium text-[var(--nimi-text-secondary)]"
                    htmlFor="support-repair-cleanup-confirmation-input"
                  >
                    {t('Support.repairCleanupConfirmationLabel', {
                      confirmation: NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION,
                    })}
                  </label>
                  <input
                    id="support-repair-cleanup-confirmation-input"
                    value={confirmationInput}
                    onChange={(event) => setConfirmationInput(event.target.value)}
                    autoComplete="off"
                    data-testid="support-repair-cleanup-confirmation-input"
                    className="mt-2 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
                  />
                </div>
              ) : null}
              <button
                type="button"
                data-testid="support-repair-cleanup-execute-button"
                disabled={busy}
                onClick={() => { void handleExecute(); }}
                className="mt-3 inline-flex items-center rounded-lg bg-[var(--nimi-status-danger)] px-3 py-2 text-xs font-medium text-white transition disabled:opacity-50"
              >
                {t('Support.repairCleanupExecuteButton')}
              </button>
            </>
          )}
        </div>
      ) : null}

      {feedback ? (
        <p
          data-testid="support-repair-cleanup-feedback"
          className={
            feedback.tone === 'error'
              ? 'mt-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]'
              : 'mt-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-text-primary)]'
          }
        >
          {feedback.message}
        </p>
      ) : null}
    </SupportCard>
  );
}
