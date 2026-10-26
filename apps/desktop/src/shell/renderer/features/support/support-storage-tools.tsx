import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import type { DesktopRendererStorageDirs as DesktopStorageDirs } from '../../renderer/settings-port.js';
import { NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION, type NimiAppHostCachePlan, type NimiDataCleanupPlan } from '../../renderer/support-repair-port.js';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { formatBytes } from '../../components/download-format.js';
import { SupportCard, SupportInfoRow } from './support-section-shell.js';
// @nimi-authority: rule.nimi.desktop.product-surfaces.r024
/**
 * Standard App cache (`P-MIG-006e`): clears only the fixed regenerable browser
 * caches of stopped standard App Hosts in this data root. Cookies, site
 * storage, App data and Nimi's own profile are never touched, so the click is
 * the intent and no destructive confirmation token applies.
 */
export function SupportAppHostCacheCard() {
  const { t } = useTranslation();
  const repair = useDesktopRendererCommands().supportRepair;
  const [plan, setPlan] = useState<NimiAppHostCachePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);

  const handlePlan = useCallback(async () => {
    setBusy(true);
    setPlan(null);
    setFeedback(null);
    try {
      setPlan(await repair.planAppHostCacheCleanup());
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : t('Support.repairAppCachePlanFailed'),
      });
    } finally {
      setBusy(false);
    }
  }, [repair, t]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const outcome = await repair.executeAppHostCacheCleanup();
      setPlan(null);
      setFeedback(outcome.complete
        ? { tone: 'success', message: t('Support.repairAppCacheCleared', { size: formatBytes(outcome.removedBytes) }) }
        : {
          tone: 'error',
          message: t('Support.repairAppCachePartial', {
            size: formatBytes(outcome.removedBytes),
            failed: outcome.failedEntries,
          }),
        });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : t('Support.repairAppCacheClearFailed'),
      });
    } finally {
      setBusy(false);
    }
  }, [repair, t]);

  return (
    <SupportCard
      title={t('Support.repairAppCacheTitle')}
      description={t('Support.repairAppCacheDescription')}
      testId="support-repair-app-cache"
    >
      <button
        type="button"
        data-testid="support-repair-app-cache-plan-button"
        disabled={busy}
        onClick={() => { void handlePlan(); }}
        className="self-start rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)] disabled:opacity-50"
      >
        {t('Support.repairAppCachePlanButton')}
      </button>
      {plan ? (
        <div data-testid="support-repair-app-cache-plan" className="mt-4">
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <SupportInfoRow label={t('Support.repairAppCacheProfiles')} value={String(plan.profileCount)} />
            <SupportInfoRow label={t('Support.repairAppCacheSize')} value={formatBytes(plan.totalBytes)} />
            <SupportInfoRow label={t('Support.repairCleanupPlanFiles')} value={String(plan.fileCount)} />
          </div>
          {plan.hostsRunning ? (
            <p
              data-testid="support-repair-app-cache-hosts-running"
              className="mt-3 text-xs text-[var(--nimi-status-warning)]"
            >
              {t('Support.repairAppCacheHostsRunning')}
            </p>
          ) : (
            <Button
              size="sm"
              data-testid="support-repair-app-cache-clear-button"
              disabled={busy || plan.totalBytes === 0}
              onClick={() => { void handleClear(); }}
              className="mt-3 self-start"
            >
              {t('Support.repairAppCacheClearButton')}
            </Button>
          )}
        </div>
      ) : null}
      {feedback ? (
        <p
          data-testid="support-repair-app-cache-feedback"
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

// apps and accounts are previewable but only their owners remove content:
// installed Apps through uninstall, account data through its own owners.
function cleanupOwnerBlockedCopyKey(directory: string): string {
  if (directory === 'apps') return 'Support.repairCleanupAppsOwnerManaged';
  if (directory === 'accounts') return 'Support.repairCleanupAccountsOwnerManaged';
  return 'Support.repairCleanupRuntimeBlocked';
}

/**
 * Destructive-cleanup entry (`rule.nimi.desktop.product-surfaces.r024` / `P-MIG-008`). The cleanup is
 * delegated entirely to the `nimi_data` cleanup bridge: the renderer plans the
 * impact, shows it, requires the explicit confirmation token for any
 * non-pure-cache directory, then runs the confirmed cleanup. It never deletes
 * or changes the active Product Control root itself.
 */
export function SupportDataRootCleanupCard(props: {
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
          {t('Support.repairCleanupDataRootLabel')}: {props.dirs.dataRoot}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <label htmlFor="support-cleanup-directory" className="text-sm text-[var(--nimi-text-secondary)]">{t('Support.repairDirectoryIdentifier')}</label>
        <input
          id="support-cleanup-directory"
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
            <p
              data-testid="support-repair-cleanup-owner-blocked"
              className="mt-3 text-xs text-[var(--nimi-status-danger)]"
            >
              {t(cleanupOwnerBlockedCopyKey(plan.directory))}
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
              <Button
                tone="danger"
                size="sm"
                data-testid="support-repair-cleanup-execute-button"
                disabled={busy}
                onClick={() => { void handleExecute(); }}
                className="mt-3 self-start"
              >
                {t('Support.repairCleanupExecuteButton')}
              </Button>
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
