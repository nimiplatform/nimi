import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createNimiAppAIProfileClient,
} from '@nimiplatform/sdk/ai';
import type {
  NimiDesktopPortableAIProfileCatalogRecord,
  NimiMachineLoadout,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, PillTabs, Surface } from '@nimiplatform/kit/ui';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';
import { AIProfileAuthoringPage } from './runtime-config-page-profile-authoring.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import {
  selectRuntimeConfigProfileExportLoadout,
  summarizeRuntimeConfigProfileDownloads,
} from './runtime-config-profile-presentation.js';
import {
  summarizeDesktopPortableAIProfile,
  type DesktopPortableAIProfileSummary,
} from './runtime-config-portable-profile.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import {
  executeRuntimeConfigAIProfileTransfer,
  exportRuntimeConfigAIProfileFromLoadouts,
  planRuntimeConfigAIProfileTransfer,
  selectRuntimeConfigAIProfileLoadouts,
  type RuntimeConfigAIProfileTransferPlan,
  type RuntimeConfigAIProfileTransferResult,
} from './runtime-config-ai-profile-transfer.js';

type ProfileFeedback = {
  readonly tone: 'info' | 'success' | 'danger';
  readonly message: string;
  readonly technicalDetail?: string;
};

export function ProfileCatalogPage() {
  const { t } = useTranslation();
  const [section, setSection] = useState<'portable' | 'author'>('portable');
  return (
    <>
      <div className="px-6 pt-6" data-testid="runtime-profiles-subnavigation">
        <PillTabs
          size="sm"
          ariaLabel={t('runtimeConfig.sidebar.profiles', { defaultValue: 'Profiles' })}
          value={section}
          onValueChange={(value) => setSection(value as 'portable' | 'author')}
          items={[
            { value: 'portable', label: t('runtimeConfig.profiles.useProfileTab') },
            { value: 'author', label: t('runtimeConfig.profiles.authorProfileTab') },
          ]}
        />
      </div>
      {section === 'author' ? <AIProfileAuthoringPage /> : <PortableProfileApplyPage />}
    </>
  );
}

function PortableProfileApplyPage() {
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
  const [sourceText, setSourceText] = useState('');
  const [summary, setSummary] = useState<DesktopPortableAIProfileSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [availableLoadouts, setAvailableLoadouts] = useState<readonly NimiMachineLoadout[]>([]);
  const [availableAssets, setAvailableAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<readonly NimiDesktopPortableAIProfileCatalogRecord[]>([]);
  const [selectedExportIds, setSelectedExportIds] = useState<readonly string[]>([]);
  const [transferPlan, setTransferPlan] = useState<RuntimeConfigAIProfileTransferPlan | null>(null);
  const [transferResult, setTransferResult] = useState<RuntimeConfigAIProfileTransferResult | null>(null);
  const [selectImported, setSelectImported] = useState(true);
  const [selectionCompleted, setSelectionCompleted] = useState(false);
  const [feedback, setFeedback] = useState<ProfileFeedback>({
    tone: 'info',
    message: t('runtimeConfig.profiles.feedbackInitial', {
      defaultValue: 'Import a portable AIProfile, review the aggregate acquisition page, then confirm each machine-impacting stage explicitly.',
    }),
  });

  const clearPreview = (nextSource: string) => {
    setSourceText(nextSource);
    setSummary(null);
    setTransferPlan(null);
    setTransferResult(null);
    setSelectionCompleted(false);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([loadoutsClient.get(), modelAssetsClient.listModelAssets()]).then(([machine, assets]) => {
      if (!active) return;
      setAvailableLoadouts(machine.loadouts);
      setAvailableAssets(assets);
      setSelectedExportIds(machine.selections.map((selection) => selection.loadoutId));
    }).catch(() => {
      // The import surface remains available when Runtime inventory is offline.
    });
    return () => { active = false; };
  }, [loadoutsClient, modelAssetsClient]);

  useEffect(() => {
    let active = true;
    void profileCatalog.list().then((profiles) => {
      if (active) setSavedProfiles(profiles);
    }).catch(() => {
      // Import remains available if the account catalog cannot be listed.
    });
    return () => { active = false; };
  }, [profileCatalog]);

  const previewSource = async () => {
    setBusy(true);
    try {
      const nextSummary = summarizeDesktopPortableAIProfile(sourceText);
      const imported = await profileCatalog.import(sourceText);
      setSavedProfiles((current) => Object.freeze([
        ...current.filter((item) => item.source.profileId !== imported.source.profileId),
        imported,
      ].sort((left, right) => left.source.profileId.localeCompare(right.source.profileId))));
      setSummary(nextSummary);
      try {
        const [assets, recipes, verifiedAssets, machine] = await Promise.all([
          modelAssetsClient.listModelAssets(),
          loadoutsClient.listRecipes(),
          modelAssetsClient.listVerifiedAssets(),
          loadoutsClient.get(),
        ]);
        const nextTransferPlan = await planRuntimeConfigAIProfileTransfer({
          profile: sourceText,
          assets,
          recipes,
          verifiedAssets,
          loadouts: machine.loadouts,
        });
        setTransferPlan(nextTransferPlan);
        setTransferResult(null);
        setFeedback({
          tone: 'info',
          message: t('runtimeConfig.profiles.feedbackPreviewReady', {
            defaultValue: 'Saved {{count}} portable capability intent(s). Review the one confirmation page before any transfer or configuration write.',
            count: nextSummary.capabilities.length,
          }),
        });
      } catch (error) {
        setTransferPlan(null);
        setTransferResult(null);
        setFeedback({
          tone: 'info',
          message: t('runtimeConfig.profiles.feedbackPlanFailed', {
            defaultValue: 'The portable document is saved, but this machine could not prepare its transfer preview yet.',
          }),
          technicalDetail: errorMessage(error),
        });
      }
    } catch (error) {
      setSummary(null);
      setTransferPlan(null);
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.profiles.feedbackPreviewFailed', {
          defaultValue: 'This portable AIProfile could not be previewed.',
        }),
        technicalDetail: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
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
      setTransferResult(result);
      setSelectionCompleted(false);
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
        technicalDetail: errorMessage(error),
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
      setSelectionCompleted(selectImported && selected.length > 0);
      setFeedback({
        tone: 'success',
        message: selectImported
          ? t('runtimeConfig.profiles.selectionComplete', { defaultValue: 'Selected {{count}} configured Loadout(s). Review the existing Runtime environment confirmation before first local execution.', count: selected.length })
          : t('runtimeConfig.profiles.selectionSkipped', { defaultValue: 'Import completed without changing machine selection. The committed Loadouts remain available.' }),
      });
      const [machine, assets] = await Promise.all([loadoutsClient.get(), modelAssetsClient.listModelAssets()]);
      setAvailableLoadouts(machine.loadouts);
      setAvailableAssets(assets);
      setSelectedExportIds(machine.selections.map((selection) => selection.loadoutId));
    } catch (error) {
      setFeedback({ tone: 'danger', message: t('runtimeConfig.profiles.selectionFailed', { defaultValue: 'The final Loadout selection failed.' }), technicalDetail: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const discardUnresolvedLoadouts = async () => {
    if (!transferResult) return;
    setBusy(true);
    try {
      const unresolved = transferResult.capabilities.flatMap((capability) => (
        capability.loadout && capability.loadout.validationState !== 'configured'
          ? [capability.loadout]
          : []
      ));
      for (const loadout of unresolved) await loadoutsClient.delete(loadout.loadoutId, false);
      setTransferResult(null);
      setSelectionCompleted(false);
      setFeedback({
        tone: 'success',
        message: t('runtimeConfig.profiles.unresolvedDiscarded', { defaultValue: 'Discarded {{count}} unresolved imported Loadout(s). Downloaded ModelAssets remain in the pool.', count: unresolved.length }),
      });
    } catch (error) {
      setFeedback({ tone: 'danger', message: t('runtimeConfig.profiles.discardFailed', { defaultValue: 'Unresolved imported Loadouts could not be discarded.' }), technicalDetail: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const exportSelectedLoadouts = () => {
    try {
      const selected = availableLoadouts.filter((loadout) => selectedExportIds.includes(loadout.loadoutId));
      const artifact = exportRuntimeConfigAIProfileFromLoadouts({
        profileId: `profile.loadouts.${Date.now()}`,
        title: t('runtimeConfig.profiles.exportedTitle', { defaultValue: 'Shared Loadouts' }),
        loadouts: selected,
        assets: availableAssets,
      });
      downloadProfileArtifact(artifact.artifactJson, `${artifact.profile.profileId}.ai-profile.json`);
      setFeedback({ tone: 'success', message: t('runtimeConfig.profiles.exportSuccess', { defaultValue: 'Exported {{count}} portable Loadout intent(s).', count: selected.length }) });
    } catch (error) {
      setFeedback({ tone: 'danger', message: t('runtimeConfig.profiles.exportFailed', { defaultValue: 'The selected Loadouts could not be exported.' }), technicalDetail: errorMessage(error) });
    }
  };

  const previewCloudIntentCount = summary?.capabilities.filter(
    (capability) => capability.route === 'cloud',
  ).length ?? 0;
  const cloudGuidanceCount = previewCloudIntentCount;
  const previewLocalIntentCount = summary?.capabilities.filter(
    (capability) => capability.route === 'local',
  ).length ?? 0;
  const localGuidanceCount = previewLocalIntentCount;
  const exportGroups = useMemo(() => {
    const grouped = new Map<string, NimiMachineLoadout[]>();
    for (const loadout of availableLoadouts) {
      const current = grouped.get(loadout.capabilityContract) ?? [];
      grouped.set(loadout.capabilityContract, [...current, loadout]);
    }
    return [...grouped.entries()];
  }, [availableLoadouts]);
  const transferDownloadSummary = transferPlan
    ? summarizeRuntimeConfigProfileDownloads(transferPlan)
    : null;
  const transferNeedsAttention = transferResult?.capabilities.some((capability) => (
    capability.state !== 'committed' || capability.unresolvedSlotIds.length > 0
  )) ?? false;

  return (
    <RuntimePageShell maxWidth="full" className="max-w-[78rem] space-y-4 px-6 py-6">
      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-loadout-export">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.profiles.exportLoadoutsTitle', { defaultValue: 'Share your current model setup' })}</h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.exportLoadoutsDescription', { defaultValue: 'Choose one model setup for each use. Private machine paths, account details, and secrets are never included.' })}</p>
        </div>
        <div className="grid gap-3">
          {exportGroups.map(([capabilityContract, loadouts]) => (
            <fieldset key={capabilityContract} className="grid gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3">
              <legend className="px-1 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {displayRuntimeConfigCapabilityLabel(capabilityContract, t)}
              </legend>
              {loadouts.map((loadout) => (
                <label key={loadout.loadoutId} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--nimi-surface-hover)]">
                  <input
                    className="mt-0.5"
                    type="checkbox"
                    checked={selectedExportIds.includes(loadout.loadoutId)}
                    disabled={loadout.validationState !== 'configured'}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      const sameUseIds = new Set(loadouts.map((item) => item.loadoutId));
                      setSelectedExportIds((current) => selectRuntimeConfigProfileExportLoadout({
                        currentIds: current,
                        loadoutId: loadout.loadoutId,
                        sameUseIds,
                        checked,
                      }));
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-[var(--nimi-text-primary)]">{loadout.displayName}</span>
                    {loadout.validationState !== 'configured' ? (
                      <span className="block text-[var(--nimi-danger-text)]">{t('runtimeConfig.profiles.setupNeedsAttention', { defaultValue: 'Needs attention before it can be shared' })}</span>
                    ) : null}
                    <details className="mt-1 text-[var(--nimi-text-muted)]">
                      <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                      <div className="mt-1 font-mono">{loadout.capabilityContract} · {loadout.recipeId}</div>
                    </details>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <Button size="sm" tone="secondary" disabled={busy || selectedExportIds.length === 0} onClick={exportSelectedLoadouts}>
          {t('runtimeConfig.profiles.exportSelectedLoadouts', { defaultValue: 'Export setup file' })}
        </Button>
      </Surface>

      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-catalog">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.profiles.savedProfilesTitle', { defaultValue: 'Saved AI setup files' })}</h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.savedProfilesDescription', { defaultValue: 'Opening a saved file only prepares a preview. Nothing is downloaded or changed until you confirm.' })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedProfiles.length === 0 ? <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.profiles.savedProfilesEmpty', { defaultValue: 'No imported Profiles yet.' })}</span> : null}
          {savedProfiles.map((profile) => (
            <Button key={profile.source.profileId} size="sm" tone="secondary" disabled={busy} onClick={() => clearPreview(profile.artifactJson)}>
              {profile.source.title}
            </Button>
          ))}
        </div>
      </Surface>

      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-source">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.portableTitle', { defaultValue: 'Import an AI setup file' })}
          </h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.portableDescription', {
              defaultValue: 'Choose a setup file, review what this computer needs, then confirm before any model is downloaded or current choice is changed.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[var(--nimi-border-subtle)] px-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.loadJsonFile', { defaultValue: 'Choose setup file…' })}
            <input
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                void file.text().then(clearPreview, (error) => {
                  setFeedback({
                    tone: 'danger',
                    message: t('runtimeConfig.profiles.feedbackFileReadFailed', {
                      defaultValue: 'The selected AIProfile file could not be read.',
                    }),
                    technicalDetail: errorMessage(error),
                  });
                });
              }}
            />
          </label>
          <Button
            size="sm"
            disabled={busy || !sourceText.trim()}
            onClick={() => { void previewSource(); }}
          >
            {busy
              ? t('runtimeConfig.profiles.previewWorking', { defaultValue: 'Working…' })
              : t('runtimeConfig.profiles.previewAction', { defaultValue: 'Check setup file' })}
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.pasteJsonAdvanced', { defaultValue: 'Paste JSON instead (advanced)' })}
          </summary>
          <textarea
            aria-label={t('runtimeConfig.profiles.portableJsonLabel', { defaultValue: 'Portable AIProfile JSON' })}
            value={sourceText}
            onChange={(event) => clearPreview(event.currentTarget.value)}
            rows={12}
            spellCheck={false}
            placeholder={t('runtimeConfig.profiles.portableJsonPlaceholder', {
              defaultValue: 'Paste a canonical portable AIProfile JSON document',
            })}
            className="mt-2 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
          />
        </details>
      </Surface>

      {transferPlan && !transferResult ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-transfer-confirmation">
          <div>
            <h3 className="text-sm font-semibold">
              {transferDownloadSummary?.kind === 'none'
                ? t('runtimeConfig.profiles.noDownloadTitle', { defaultValue: 'All required models are already on this computer' })
                : transferDownloadSummary?.kind === 'unknown'
                  ? t('runtimeConfig.profiles.unknownDownloadTitle', { defaultValue: '{{count}} model download(s), with some sizes unknown', count: transferDownloadSummary.count })
                  : t('runtimeConfig.profiles.knownDownloadTitle', { defaultValue: 'Download {{count}} model(s) · {{size}}', count: transferDownloadSummary?.count ?? 0, size: formatBytes(transferDownloadSummary?.totalBytes ?? null, '') })}
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
                      ? t('runtimeConfig.profiles.axisDownload', { defaultValue: 'Download required · {{size}}', size: formatBytes(axis.sizeBytes > 0 ? axis.sizeBytes : null, t('runtimeConfig.profiles.unknownSize', { defaultValue: 'unknown size' })) })
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
          <div className="flex gap-2">
            <Button size="sm" tone="secondary" disabled={busy} onClick={() => { setTransferPlan(null); setTransferResult(null); }}>
              {t('runtimeConfig.profiles.cancelImport', { defaultValue: 'Cancel' })}
            </Button>
            <Button size="sm" tone="primary" disabled={busy} onClick={() => { void confirmTransfer(); }}>
              {transferDownloadSummary?.kind === 'none'
                ? t('runtimeConfig.profiles.continueExistingModels', { defaultValue: 'Continue with these models' })
                : t('runtimeConfig.profiles.downloadAndContinue', { defaultValue: 'Download and continue' })}
            </Button>
          </div>
        </Surface>
      ) : null}

      {transferResult ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-selection-confirmation">
          <h3 className="text-sm font-semibold">
            {selectionCompleted
              ? t('runtimeConfig.profiles.selectionCompletedTitle', { defaultValue: 'Your model uses are ready' })
              : t('runtimeConfig.profiles.selectionImpactTitle', { defaultValue: 'Use these models now?' })}
          </h3>
          <div className="grid gap-2">
            {transferResult.capabilities.map((capability) => (
              <div key={`${capability.capabilityContract}:${capability.state}`} className="rounded-lg border border-[var(--nimi-border-subtle)] p-2 text-xs" data-capability-state={capability.state}>
                <div className="font-semibold">{displayRuntimeConfigCapabilityLabel(capability.capabilityContract, t)}</div>
                <div className={capability.state === 'committed' && capability.unresolvedSlotIds.length === 0 ? 'text-[var(--nimi-success-text)]' : 'text-[var(--nimi-danger-text)]'}>
                  {capability.state === 'committed' && capability.unresolvedSlotIds.length === 0
                    ? t('runtimeConfig.profiles.capabilityPrepared', { defaultValue: 'Ready to use' })
                    : t('runtimeConfig.profiles.capabilityNeedsAttention', { defaultValue: 'Not ready. Continue with the other models, then fix this use in Model Uses.' })}
                </div>
                {capability.reasonCode || capability.detail || capability.unresolvedSlotIds.length > 0 ? (
                  <details className="mt-1 text-[var(--nimi-text-muted)]">
                    <summary className="cursor-pointer font-semibold">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
                    <div className="mt-1 whitespace-pre-wrap break-all font-mono">{capability.state}{capability.reasonCode ? ` · ${capability.reasonCode}` : ''}{capability.unresolvedSlotIds.length > 0 ? ` · unresolved: ${capability.unresolvedSlotIds.join(', ')}` : ''}{capability.detail ? `\n${capability.detail}` : ''}</div>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
          {!selectionCompleted ? (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={selectImported} onChange={(event) => setSelectImported(event.currentTarget.checked)} />
                {t('runtimeConfig.profiles.selectAllImported', { defaultValue: 'Use all ready models for their listed uses (recommended)' })}
              </label>
              <Button size="sm" tone="primary" disabled={busy} onClick={() => { void confirmImportedSelection(); }}>
                {t('runtimeConfig.profiles.confirmSelection', { defaultValue: 'Use these models' })}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              tone="primary"
              disabled={busy}
              onClick={() => {
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
          )}
          {transferResult.capabilities.some((capability) => capability.loadout && capability.loadout.validationState !== 'configured') ? (
            <Button size="sm" tone="secondary" disabled={busy} onClick={() => { void discardUnresolvedLoadouts(); }}>
              {t('runtimeConfig.profiles.discardUnresolved', { defaultValue: 'Discard unresolved Loadouts' })}
            </Button>
          ) : null}
        </Surface>
      ) : null}

      {summary ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-summary">
          <div>
            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{summary.title}</div>
            <div className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.summaryCount', { defaultValue: '{{count}} AI use(s)', count: summary.capabilities.length })}</div>
          </div>
          <div className="grid gap-2">
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
        </Surface>
      ) : null}

      {cloudGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-cloud-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.cloudConfigurationTitle', {
              defaultValue: 'Cloud models need a connection',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.cloudConfigurationGuidance', {
              defaultValue: 'This setup file never includes account details or secrets. Connect the required cloud service before trying a cloud model.',
            })}
          </p>
          <div>
            <Button
              onClick={() => {
                setActiveTab('runtime');
                runtimeConfigNavigation.openPage('cloud');
              }}
              size="sm"
              tone="secondary"
            >
              {t('runtimeConfig.profiles.openCloudConnectors', {
                defaultValue: 'Manage cloud connections',
              })}
            </Button>
          </div>
        </Surface>
      ) : null}

      {localGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-local-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.localSelectionTitle', {
              defaultValue: 'Choose how local models are used',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.localSelectionGuidance', {
              defaultValue: 'Local model choices stay on this computer. You can review or change which model is used for text, images, speech, and other tasks.',
            })}
          </p>
          <div>
            <Button
              onClick={() => {
                setActiveTab('runtime');
                runtimeConfigNavigation.focusAction({
                  page: 'loadouts',
                  action: 'open-loadouts',
                  focus: 'runtime-config-action-focus.loadouts',
                });
              }}
              size="sm"
              tone="secondary"
            >
              {t('runtimeConfig.profiles.openLocalConfigurations', {
                defaultValue: 'Review model uses',
              })}
            </Button>
          </div>
        </Surface>
      ) : null}

      <InlineAlert tone={feedback.tone}>{feedback.message}</InlineAlert>
      {feedback.technicalDetail ? (
        <details className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
          <summary className="cursor-pointer font-semibold">
            {t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-caption-size)]">{feedback.technicalDetail}</pre>
        </details>
      ) : null}
    </RuntimePageShell>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown profile error');
}

function formatBytes(value: number | null, unknownLabel: string): string {
  if (value === null || !Number.isFinite(value) || value < 0) return unknownLabel;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function downloadProfileArtifact(source: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
