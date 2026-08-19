import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createNimiAppAIProfileClient,
} from '@nimiplatform/sdk/ai';
import {
  Button,
  ConfirmDialog,
  InlineAlert,
  OverlayShell,
} from '@nimiplatform/kit/ui';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  formatRuntimeConfigProfileBytes,
  summarizeRuntimeConfigProfileDownloads,
} from './runtime-config-profile-presentation.js';
import {
  type DesktopPortableAIProfileSummary,
} from './runtime-config-portable-profile.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import {
  executeRuntimeConfigAIProfileTransfer,
  isRuntimeConfigAIProfileCapabilityReady,
  planRuntimeConfigAIProfileTransfer,
  runtimeConfigAIProfileDiscardableLoadouts,
  runtimeConfigAIProfileTransferNeedsAttention,
  selectRuntimeConfigAIProfileLoadouts,
  type RuntimeConfigAIProfileTransferPlan,
  type RuntimeConfigAIProfileTransferResult,
} from './runtime-config-ai-profile-transfer.js';
import { prepareRuntimeConfigAIProfilePreview } from './runtime-config-ai-profile-preview.js';

type ProfileWizardFeedback = {
  readonly tone: 'info' | 'success' | 'danger';
  readonly message: string;
  readonly technicalDetail?: string;
};

export type ProfileImportWizardProps = {
  /** When set, the wizard skips the source step and previews this artifact immediately. */
  readonly initialSourceText: string | null;
  readonly onClose: () => void;
  /** Called after the Runtime catalog gains or updates a record. */
  readonly onCatalogChanged: () => void;
};

export function ProfileImportWizard(props: ProfileImportWizardProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const profileClient = useMemo(
    () => createNimiAppAIProfileClient(sdk.accountProduct().appAIConfig(sdk.appId())),
    [sdk],
  );
  const loadoutsClient = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
  const modelAssetsClient = useRuntimeConfigLocalEnvironmentClient();
  const profileCatalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const [sourceText, setSourceText] = useState(props.initialSourceText ?? '');
  const [summary, setSummary] = useState<DesktopPortableAIProfileSummary | null>(null);
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [transferPlan, setTransferPlan] = useState<RuntimeConfigAIProfileTransferPlan | null>(null);
  const [transferResult, setTransferResult] = useState<RuntimeConfigAIProfileTransferResult | null>(null);
  const [selectImported, setSelectImported] = useState(true);
  const [selectionDecisionCompleted, setSelectionDecisionCompleted] = useState(false);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [feedback, setFeedback] = useState<ProfileWizardFeedback | null>(null);

  const previewSource = async (source: string) => {
    setBusy(true);
    try {
      const { summary: nextSummary, plan: nextTransferPlan } = await prepareRuntimeConfigAIProfilePreview({
        profile: source,
        modelAssets: modelAssetsClient,
        loadouts: loadoutsClient,
      });
      setSummary(nextSummary);
      setProfileName(nextSummary.title);
      setTransferPlan(nextTransferPlan);
      setTransferResult(null);
      setSelectImported(true);
      setSelectionDecisionCompleted(false);
      setFeedback({
        tone: 'info',
        message: t('runtimeConfig.profiles.feedbackPreviewReady', {
          defaultValue: 'Checked {{count}} AI use(s). Review the confirmation page; nothing has been saved, downloaded, or changed yet.',
          count: nextSummary.capabilities.length,
        }),
      });
    } catch (error) {
      setSummary(null);
      setTransferPlan(null);
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.profiles.feedbackPreviewFailed', {
          defaultValue: 'This portable AIProfile could not be previewed.',
        }),
        technicalDetail: wizardErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  // A saved-profile apply opens the wizard straight on the preview step.
  useEffect(() => {
    if (props.initialSourceText) void previewSource(props.initialSourceText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSourceFile = (file: File) => {
    void file.text().then((text) => {
      setSourceText(text);
      setSummary(null);
      setTransferPlan(null);
      setTransferResult(null);
      setFeedback(null);
      void previewSource(text);
    }, (error) => {
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.profiles.feedbackFileReadFailed', {
          defaultValue: 'The selected AIProfile file could not be read.',
        }),
        technicalDetail: wizardErrorMessage(error),
      });
    });
  };

  const confirmTransfer = async () => {
    if (!transferPlan) return;
    setBusy(true);
    try {
      const result = await executeRuntimeConfigAIProfileTransfer({
        plan: transferPlan,
        assets: modelAssetsClient,
        loadouts: loadoutsClient,
        confirmedMachineImpact: true,
        applyAIProfile: (profile) => profileClient.apply(profile),
      });
      // The catalog record is written only after the transfer succeeds so a
      // failed import never leaves a contradictory saved entry behind.
      const trimmedName = profileName.trim();
      await profileCatalog.import(
        trimmedName && trimmedName !== transferPlan.profile.title
          ? { ...transferPlan.profile, title: trimmedName }
          : transferPlan.profile,
      );
      props.onCatalogChanged();
      setTransferResult(result);
      setSelectionDecisionCompleted(false);
      try {
        const [assets, recipes, verifiedAssets, machine] = await Promise.all([
          modelAssetsClient.listModelAssets(),
          loadoutsClient.listRecipes(),
          modelAssetsClient.listVerifiedAssets(),
          loadoutsClient.get(),
        ]);
        setTransferPlan(await planRuntimeConfigAIProfileTransfer({
          profile: result.profile,
          assets,
          recipes,
          verifiedAssets,
          loadouts: machine.loadouts,
          selectedLoadoutIds: machine.selections.map((selection) => selection.loadoutId),
        }));
      } catch {
        // Do not leave a stale pre-transfer plan available for retry. The
        // completed result remains selectable; a later retry starts from a
        // fresh preview if Runtime inventory cannot be refreshed now.
        setTransferPlan(null);
      }
      const failed = result.capabilities.filter((item) => (
        item.state !== 'committed' || item.unresolvedSlotIds.length > 0 || item.loadout?.validationState !== 'configured'
      )).length;
      setFeedback({
        tone: failed > 0 ? 'info' : 'success',
        message: failed > 0
          ? t('runtimeConfig.profiles.transferPartial', { defaultValue: 'The confirmed import finished with {{count}} typed unresolved capability item(s). Other capabilities were committed independently.', count: failed })
          : t('runtimeConfig.profiles.transferReady', { defaultValue: 'Models are verified and Loadouts are committed. Review the final machine-selection impact.' }),
      });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.profiles.transferFailed', { defaultValue: 'The confirmed AIProfile import could not finish.' }),
        technicalDetail: wizardErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmImportedSelection = async () => {
    if (!transferResult) return;
    setBusy(true);
    try {
      const selected = selectImported
        ? await selectRuntimeConfigAIProfileLoadouts({ result: transferResult, loadouts: loadoutsClient })
        : [];
      setSelectionDecisionCompleted(true);
      setFeedback({
        tone: selectImported && selected.length === 0 ? 'info' : 'success',
        message: selectImported
          ? selected.length > 0
            ? t('runtimeConfig.profiles.selectionComplete', { defaultValue: 'Selected {{count}} configured Loadout(s). Review the existing Runtime environment confirmation before first local execution.', count: selected.length })
            : t('runtimeConfig.profiles.selectionNoneReady', { defaultValue: 'No imported model was ready to select. Fix the listed model uses to continue.' })
          : t('runtimeConfig.profiles.selectionSkipped', { defaultValue: 'Import completed without changing machine selection. The committed Loadouts remain available.' }),
      });
    } catch (error) {
      setFeedback({ tone: 'danger', message: t('runtimeConfig.profiles.selectionFailed', { defaultValue: 'The final Loadout selection failed.' }), technicalDetail: wizardErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const discardUnresolvedLoadouts = async () => {
    const discardable = runtimeConfigAIProfileDiscardableLoadouts(transferResult);
    if (discardable.length === 0) return;
    setBusy(true);
    try {
      for (const loadout of discardable) await loadoutsClient.delete(loadout.loadoutId, false);
      setTransferResult(null);
      setSelectionDecisionCompleted(false);
      setDiscardConfirmationOpen(false);
      setFeedback({
        tone: 'success',
        message: t('runtimeConfig.profiles.unresolvedDiscarded', { defaultValue: 'Removed {{count}} unfinished model setup(s) created by this import. Downloaded models remain available.', count: discardable.length }),
      });
    } catch (error) {
      setFeedback({ tone: 'danger', message: t('runtimeConfig.profiles.discardFailed', { defaultValue: 'Unresolved imported Loadouts could not be discarded.' }), technicalDetail: wizardErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const step: 'source' | 'preview' | 'result' = transferResult
    ? 'result'
    : transferPlan
      ? 'preview'
      : 'source';
  const previewCloudIntentCount = summary?.capabilities.filter(
    (capability) => capability.route === 'cloud',
  ).length ?? 0;
  const previewLocalIntentCount = summary?.capabilities.filter(
    (capability) => capability.route === 'local',
  ).length ?? 0;
  const transferDownloadSummary = transferPlan
    ? summarizeRuntimeConfigProfileDownloads(transferPlan)
    : null;
  const transferNeedsAttention = runtimeConfigAIProfileTransferNeedsAttention(transferResult);
  const discardableLoadouts = runtimeConfigAIProfileDiscardableLoadouts(transferResult);

  const stepTitle = step === 'source'
    ? t('runtimeConfig.profiles.wizardSourceTitle', { defaultValue: 'Import a profile' })
    : step === 'preview'
      ? t('runtimeConfig.profiles.wizardPreviewTitle', { defaultValue: 'Preview this profile' })
      : selectionDecisionCompleted
        ? t('runtimeConfig.profiles.wizardDoneTitle', { defaultValue: 'Import finished' })
        : t('runtimeConfig.profiles.wizardApplyTitle', { defaultValue: 'Use these models now?' });

  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      {step === 'source' ? (
        <Button size="sm" tone="secondary" disabled={busy} onClick={props.onClose}>
          {t('Common.cancel', { defaultValue: 'Cancel' })}
        </Button>
      ) : null}
      {step === 'preview' ? (
        <>
          <Button size="sm" tone="secondary" disabled={busy} onClick={() => { setTransferPlan(null); setSummary(null); setFeedback(null); }}>
            {t('runtimeConfig.profiles.cancelImport', { defaultValue: 'Cancel' })}
          </Button>
          <Button size="sm" tone="primary" disabled={busy} onClick={() => { void confirmTransfer(); }}>
            {busy
              ? t('runtimeConfig.profiles.previewWorking', { defaultValue: 'Working…' })
              : transferDownloadSummary?.kind === 'none'
                ? t('runtimeConfig.profiles.continueExistingModels', { defaultValue: 'Continue with these models' })
                : t('runtimeConfig.profiles.downloadAndContinue', { defaultValue: 'Download and continue' })}
          </Button>
        </>
      ) : null}
      {step === 'result' && !selectionDecisionCompleted ? (
        <Button size="sm" tone="primary" disabled={busy} onClick={() => { void confirmImportedSelection(); }}>
          {selectImported
            ? t('runtimeConfig.profiles.confirmSelection', { defaultValue: 'Use these models' })
            : t('runtimeConfig.profiles.keepCurrentSelection', { defaultValue: 'Keep current choices' })}
        </Button>
      ) : null}
      {step === 'result' && selectionDecisionCompleted ? (
        <Button size="sm" tone="primary" disabled={busy} onClick={props.onClose}>
          {t('runtimeConfig.profiles.wizardClose', { defaultValue: 'Close' })}
        </Button>
      ) : null}
    </div>
  );

  return (
    <OverlayShell
      open
      kind="dialog"
      size="L"
      onClose={() => { if (!busy) props.onClose(); }}
      closeOnBackdrop={!busy}
      title={stepTitle}
      dataTestId="runtime-portable-profile-wizard"
      footer={footer}
    >
      <div className="space-y-4 pb-2">
        {step === 'source' ? (
          <div className="space-y-3" data-testid="runtime-portable-profile-source">
            <p className="m-0 text-xs text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.portableDescription', {
                defaultValue: 'Choose a setup file, review what this computer needs, then confirm before any model is downloaded or current choice is changed.',
              })}
            </p>
            <div>
              <div className="mb-1 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.profiles.sourceFromFile', { defaultValue: 'From a file' })}
              </div>
              <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[var(--nimi-border-subtle)] px-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.profiles.loadJsonFile', { defaultValue: 'Choose setup file…' })}
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) handleSourceFile(file);
                  }}
                />
              </label>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.profiles.sourcePasteJson', { defaultValue: 'Paste JSON' })}
              </div>
              <textarea
                aria-label={t('runtimeConfig.profiles.portableJsonLabel', { defaultValue: 'Portable AIProfile JSON' })}
                value={sourceText}
                onChange={(event) => {
                  setSourceText(event.currentTarget.value);
                  setSummary(null);
                  setTransferPlan(null);
                  setTransferResult(null);
                }}
                rows={10}
                spellCheck={false}
                placeholder={t('runtimeConfig.profiles.portableJsonPlaceholder', {
                  defaultValue: 'Paste a canonical portable AIProfile JSON document',
                })}
                className="w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
              />
              <div className="mt-2">
                <Button
                  size="sm"
                  disabled={busy || !sourceText.trim()}
                  onClick={() => { void previewSource(sourceText); }}
                >
                  {busy
                    ? t('runtimeConfig.profiles.previewWorking', { defaultValue: 'Working…' })
                    : t('runtimeConfig.profiles.previewAction', { defaultValue: 'Check setup file' })}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'preview' && transferPlan ? (
          <div className="space-y-3" data-testid="runtime-portable-profile-transfer-confirmation">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--nimi-text-secondary)]" htmlFor="runtime-profile-import-name">
                {t('runtimeConfig.profiles.profileNameLabel', { defaultValue: 'Profile name' })}
              </label>
              <input
                id="runtime-profile-import-name"
                type="text"
                value={profileName}
                onChange={(event) => setProfileName(event.currentTarget.value)}
                className="w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {transferDownloadSummary?.kind === 'none'
                  ? t('runtimeConfig.profiles.noDownloadTitle', { defaultValue: 'All required models are already on this computer' })
                  : transferDownloadSummary?.kind === 'unknown'
                    ? t('runtimeConfig.profiles.unknownDownloadTitle', { defaultValue: '{{count}} model download(s), with some sizes unknown', count: transferDownloadSummary.count })
                    : t('runtimeConfig.profiles.knownDownloadTitle', { defaultValue: 'Download {{count}} model(s) · {{size}}', count: transferDownloadSummary?.count ?? 0, size: formatRuntimeConfigProfileBytes(transferDownloadSummary?.totalBytes ?? null, '') })}
              </h3>
              <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                {transferDownloadSummary?.kind === 'none'
                  ? t('runtimeConfig.profiles.noDownloadBody', { defaultValue: 'Continuing will prepare these models for their listed uses. Your current choices will not change until the next confirmation.' })
                  : t('runtimeConfig.profiles.downloadBody', { defaultValue: 'Review the models below. Continuing downloads only the missing files, then prepares each listed use. Your current choices will not change until the next confirmation.' })}
              </p>
            </div>
            <div className="grid gap-2">
              {transferPlan.capabilities.flatMap((capability) => capability.axes.map((axis) => (
                <div key={`${capability.capabilityContract}:${axis.slotId}`} className="rounded-lg border border-[var(--nimi-border-subtle)] p-2 text-xs" data-axis-state={axis.state}>
                  <div className="font-semibold">{displayRuntimeConfigCapabilityLabel(capability.capabilityContract, t)} · {axis.displayLabel}</div>
                  <div className={axis.state === 'matched' ? 'text-[var(--nimi-success-text)]' : axis.state === 'download-required' ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-danger-text)]'}>
                    {axis.state === 'matched'
                      ? t('runtimeConfig.profiles.axisInstalled', { defaultValue: 'Ready on this computer' })
                      : axis.state === 'download-required'
                        ? t('runtimeConfig.profiles.axisDownload', { defaultValue: 'Download required · {{size}}', size: formatRuntimeConfigProfileBytes(axis.sizeBytes > 0 ? axis.sizeBytes : null, t('runtimeConfig.profiles.unknownSize', { defaultValue: 'unknown size' })) })
                        : t('runtimeConfig.profiles.axisAttention', { defaultValue: 'Needs attention before this use can be configured' })}
                  </div>
                  <details className="mt-1 text-[var(--nimi-text-muted)]">
                    <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                    <div className="mt-1 font-mono break-all">{axis.state} · {axis.contentId} · {axis.expectedHash}</div>
                    {axis.source ? (
                      <div className="font-mono break-all">{axis.source.repo}@{axis.source.revision}/{axis.source.file}</div>
                    ) : axis.templateId ? (
                      <div className="font-mono break-all">catalog:{axis.templateId}</div>
                    ) : null}
                    {axis.reasonCode ? <div className="font-mono text-[var(--nimi-danger-text)]">{axis.reasonCode}</div> : null}
                  </details>
                </div>
              )))}
              {transferPlan.capabilities.filter((capability) => capability.state === 'upgrade-required').map((capability) => (
                <InlineAlert key={capability.capabilityContract} tone="danger">{displayRuntimeConfigCapabilityLabel(capability.capabilityContract, t)}: {t('runtimeConfig.profiles.recipeUpgradeRequired', { defaultValue: 'This setup needs a newer version of Nimi before it can be used.' })}</InlineAlert>
              ))}
            </div>
            {summary ? (
              <div className="grid gap-2" data-testid="runtime-portable-profile-summary">
                {summary.capabilities.map((capability) => (
                  <div key={capability.capabilityContract} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs">
                    <div className="font-semibold text-[var(--nimi-text-primary)]">{displayRuntimeConfigCapabilityLabel(capability.capabilityContract, t)}</div>
                    <div className="mt-1 text-[var(--nimi-text-secondary)]">
                      {capability.route === 'local'
                        ? t('runtimeConfig.profiles.intentLocal', { defaultValue: 'Runs on this computer' })
                        : t('runtimeConfig.profiles.intentCloud', { defaultValue: 'Uses a cloud connection' })}
                    </div>
                    <details className="mt-1 text-[var(--nimi-text-muted)]">
                      <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                      <div className="mt-1 font-mono break-all">
                        {capability.capabilityContract} · {summary.profileId}
                        {capability.requiredFeatures.length > 0
                          ? ` · ${t('runtimeConfig.profiles.summaryRequiredFeatures', {
                            defaultValue: 'required features: {{features}}',
                            features: capability.requiredFeatures.join(', '),
                          })}`
                          : ` · ${t('runtimeConfig.profiles.summaryNoRequiredFeatures', { defaultValue: 'no required features' })}`}
                        {capability.hasDefaults
                          ? ` · ${t('runtimeConfig.profiles.summaryPortableDefaults', { defaultValue: 'portable defaults included' })}`
                          : ''}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            ) : null}
            {previewCloudIntentCount > 0 ? (
              <div className="rounded-xl border border-[var(--nimi-border-subtle)] p-3" data-testid="runtime-portable-profile-cloud-guidance">
                <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.profiles.cloudConfigurationTitle', { defaultValue: 'Cloud models need a connection' })}
                </div>
                <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.profiles.cloudConfigurationGuidance', {
                    defaultValue: 'This setup file never includes account details or secrets. Connect the required cloud service before trying a cloud model.',
                  })}
                </p>
              </div>
            ) : null}
            {previewLocalIntentCount > 0 ? (
              <div className="rounded-xl border border-[var(--nimi-border-subtle)] p-3" data-testid="runtime-portable-profile-local-guidance">
                <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.profiles.localSelectionTitle', { defaultValue: 'Choose how local models are used' })}
                </div>
                <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.profiles.localSelectionGuidance', {
                    defaultValue: 'Local model choices stay on this computer. You can review or change which model is used for text, images, speech, and other tasks.',
                  })}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'result' && transferResult ? (
          <div className="space-y-3" data-testid="runtime-portable-profile-selection-confirmation">
            <div className="grid gap-2">
              {transferResult.capabilities.map((capability) => {
                const ready = isRuntimeConfigAIProfileCapabilityReady(capability);
                return (
                  <div key={`${capability.capabilityContract}:${capability.state}`} className="rounded-lg border border-[var(--nimi-border-subtle)] p-2 text-xs" data-capability-state={capability.state}>
                    <div className="font-semibold">{displayRuntimeConfigCapabilityLabel(capability.capabilityContract, t)}</div>
                    <div className={ready ? 'text-[var(--nimi-success-text)]' : 'text-[var(--nimi-danger-text)]'}>
                      {ready
                        ? t('runtimeConfig.profiles.capabilityPrepared', { defaultValue: 'Ready to use' })
                        : t('runtimeConfig.profiles.capabilityNeedsAttention', { defaultValue: 'Not ready. Continue with the other models, then fix this use in Model Uses.' })}
                    </div>
                    {capability.reasonCode || capability.detail || capability.unresolvedSlotIds.length > 0 || capability.loadout?.validationState !== 'configured' ? (
                      <details className="mt-1 text-[var(--nimi-text-muted)]">
                        <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                        <div className="mt-1 whitespace-pre-wrap break-all font-mono">{capability.state}{capability.loadout ? ` · ${capability.loadout.validationState}` : ''}{capability.reasonCode ? ` · ${capability.reasonCode}` : ''}{capability.unresolvedSlotIds.length > 0 ? ` · unresolved: ${capability.unresolvedSlotIds.join(', ')}` : ''}{capability.loadout?.reasons.length ? ` · ${capability.loadout.reasons.join(', ')}` : ''}{capability.detail ? `\n${capability.detail}` : ''}</div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {!selectionDecisionCompleted ? (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={selectImported} onChange={(event) => setSelectImported(event.currentTarget.checked)} />
                {t('runtimeConfig.profiles.selectAllImported', { defaultValue: 'Use all ready models for their listed uses (recommended)' })}
              </label>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={busy}
                  onClick={() => {
                    props.onClose();
                    setActiveTab('runtime');
                    if (transferNeedsAttention) {
                      runtimeConfigNavigation.focusAction({
                        page: 'loadouts',
                        action: 'open-loadouts',
                        focus: 'runtime-config-action-focus.loadouts',
                      });
                    } else {
                      runtimeConfigNavigation.openPage('environment');
                    }
                  }}
                >
                  {transferNeedsAttention
                    ? t('runtimeConfig.profiles.fixModelUses', { defaultValue: 'Fix model uses that need attention' })
                    : t('runtimeConfig.profiles.reviewEnvironment', { defaultValue: 'Check this computer and continue' })}
                </Button>
              </div>
            )}
            {discardableLoadouts.length > 0 ? (
              <Button size="sm" tone="secondary" disabled={busy} onClick={() => setDiscardConfirmationOpen(true)}>
                {t('runtimeConfig.profiles.discardUnresolved', { defaultValue: 'Remove unfinished imported setups' })}
              </Button>
            ) : null}
          </div>
        ) : null}

        {feedback ? <InlineAlert tone={feedback.tone}>{feedback.message}</InlineAlert> : null}
        {feedback?.technicalDetail ? (
          <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
            <summary className="cursor-pointer font-semibold">
              {t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)]">{feedback.technicalDetail}</pre>
          </details>
        ) : null}
      </div>

      <ConfirmDialog
        open={discardConfirmationOpen}
        title={t('runtimeConfig.profiles.discardConfirmTitle', { defaultValue: 'Remove unfinished model setups?' })}
        message={t('runtimeConfig.profiles.discardConfirmBody', {
          defaultValue: 'This removes {{count}} unfinished setup(s) created by this import. Previously saved setups and downloaded models are kept.',
          count: discardableLoadouts.length,
        })}
        confirmLabel={t('runtimeConfig.profiles.discardConfirmAction', { defaultValue: 'Remove unfinished setups' })}
        cancelLabel={t('Common.cancel', { defaultValue: 'Cancel' })}
        confirmTone="danger"
        pending={busy}
        onConfirm={() => { void discardUnresolvedLoadouts(); }}
        onClose={() => setDiscardConfirmationOpen(false)}
      />
    </OverlayShell>
  );
}

function wizardErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown profile error');
}
