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

  return (
    <RuntimePageShell maxWidth="full" className="max-w-[78rem] space-y-4 px-6 py-6">
      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-loadout-export">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.profiles.exportLoadoutsTitle', { defaultValue: 'Export Loadouts' })}</h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.exportLoadoutsDescription', { defaultValue: 'Choose one configured Loadout per capability. Machine ids, bindings, paths, selections, and secrets are stripped.' })}</p>
        </div>
        <div className="grid gap-2">
          {availableLoadouts.map((loadout) => (
            <label key={loadout.loadoutId} className="flex items-center gap-2 rounded-lg border border-[var(--nimi-border-subtle)] p-2 text-xs">
              <input
                type="checkbox"
                checked={selectedExportIds.includes(loadout.loadoutId)}
                disabled={loadout.validationState !== 'configured'}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelectedExportIds((current) => checked
                    ? [...current.filter((id) => id !== loadout.loadoutId), loadout.loadoutId]
                    : current.filter((id) => id !== loadout.loadoutId));
                }}
              />
              <span className="font-semibold">{loadout.displayName}</span>
              <span className="text-[var(--nimi-text-muted)]">{loadout.capabilityContract} · {loadout.recipeId}</span>
            </label>
          ))}
        </div>
        <Button size="sm" tone="secondary" disabled={busy || selectedExportIds.length === 0} onClick={exportSelectedLoadouts}>
          {t('runtimeConfig.profiles.exportSelectedLoadouts', { defaultValue: 'Export selected Loadouts' })}
        </Button>
      </Surface>

      <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-catalog">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.profiles.savedProfilesTitle', { defaultValue: 'Saved portable Profiles' })}</h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.savedProfilesDescription', { defaultValue: 'Import Profile writes only this account-scoped document catalog. Loading a saved document has no machine side effects.' })}</p>
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
            {t('runtimeConfig.profiles.portableTitle', { defaultValue: 'Portable AIProfile' })}
          </h3>
          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.portableDescription', {
              defaultValue: 'Import saves the portable document first. Model acquisition, Loadout Commit, AIConfig Apply, and machine Select remain separate confirmed actions.',
            })}
          </p>
        </div>
        <textarea
          aria-label={t('runtimeConfig.profiles.portableJsonLabel', { defaultValue: 'Portable AIProfile JSON' })}
          value={sourceText}
          onChange={(event) => clearPreview(event.currentTarget.value)}
          rows={12}
          spellCheck={false}
          placeholder={t('runtimeConfig.profiles.portableJsonPlaceholder', {
            defaultValue: 'Paste a canonical portable AIProfile JSON document',
          })}
          className="w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
        />
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[var(--nimi-border-subtle)] px-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.loadJsonFile', { defaultValue: 'Load JSON file…' })}
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
              : t('runtimeConfig.profiles.previewAction', { defaultValue: 'Import Profile' })}
          </Button>
        </div>
      </Surface>

      {transferPlan ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-transfer-confirmation">
          <div>
            <h3 className="text-sm font-semibold">{t('runtimeConfig.profiles.transferConfirmationTitle', { defaultValue: 'Confirm model acquisition and Loadouts' })}</h3>
            <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.profiles.transferConfirmationBody', { defaultValue: 'Nothing has been downloaded yet. This confirmation covers the listed transfers and any machine-wide change to future Local execution when an existing selected Loadout is committed. It does not select a different Loadout.' })}</p>
          </div>
          <div className="grid gap-2">
            {transferPlan.capabilities.flatMap((capability) => capability.axes.map((axis) => (
              <div key={`${capability.capabilityContract}:${axis.slotId}`} className="rounded-lg border border-[var(--nimi-border-subtle)] p-2 text-xs" data-axis-state={axis.state}>
                <div className="font-semibold">{capability.capabilityContract} · {axis.displayLabel}</div>
                <div className="text-[var(--nimi-text-secondary)]">{axis.state} · {formatBytes(axis.sizeBytes > 0 ? axis.sizeBytes : null, t('runtimeConfig.profiles.unknownSize', { defaultValue: 'unknown size' }))} · {axis.contentId}</div>
                {axis.source ? (
                  <div className="font-mono text-[var(--nimi-text-muted)]">{axis.source.repo}@{axis.source.revision}/{axis.source.file}</div>
                ) : axis.templateId ? (
                  <div className="font-mono text-[var(--nimi-text-muted)]">catalog:{axis.templateId}</div>
                ) : null}
                {axis.reasonCode ? <div className="font-mono text-[var(--nimi-danger-text)]">{axis.reasonCode}</div> : null}
              </div>
            )))}
            {transferPlan.capabilities.filter((capability) => capability.state === 'upgrade-required').map((capability) => (
              <InlineAlert key={capability.capabilityContract} tone="danger">{capability.capabilityContract}: {t('runtimeConfig.profiles.recipeUpgradeRequired', { defaultValue: 'This recipe is unknown. Upgrade Nimi before importing this capability.' })}</InlineAlert>
            ))}
          </div>
          <div className="text-sm font-semibold">{t('runtimeConfig.profiles.totalDownload', { defaultValue: 'Total download: {{size}}', size: formatBytes(transferPlan.totalDownloadBytes, t('runtimeConfig.profiles.unknownSize', { defaultValue: 'unknown size' })) })}</div>
          <div className="flex gap-2">
            <Button size="sm" tone="secondary" disabled={busy} onClick={() => { setTransferPlan(null); setTransferResult(null); }}>
              {t('runtimeConfig.profiles.cancelImport', { defaultValue: 'Cancel' })}
            </Button>
            <Button size="sm" tone="primary" disabled={busy} onClick={() => { void confirmTransfer(); }}>
              {t('runtimeConfig.profiles.confirmTransfer', { defaultValue: 'Confirm transfer and Loadout impact' })}
            </Button>
          </div>
        </Surface>
      ) : null}

      {transferResult ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="runtime-portable-profile-selection-confirmation">
          <h3 className="text-sm font-semibold">{t('runtimeConfig.profiles.selectionImpactTitle', { defaultValue: 'Confirm machine selection impact' })}</h3>
          {transferResult.capabilities.map((capability) => (
            <div key={`${capability.capabilityContract}:${capability.state}`} className="text-xs" data-capability-state={capability.state}>
              {capability.capabilityContract} · {capability.state}
              {capability.reasonCode ? ` · ${capability.reasonCode}` : ''}
              {capability.unresolvedSlotIds.length > 0 ? ` · unresolved: ${capability.unresolvedSlotIds.join(', ')}` : ''}
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selectImported} onChange={(event) => setSelectImported(event.currentTarget.checked)} />
            {t('runtimeConfig.profiles.selectAllImported', { defaultValue: 'Select all newly configured Loadouts (recommended)' })}
          </label>
          <Button size="sm" tone="primary" disabled={busy} onClick={() => { void confirmImportedSelection(); }}>
            {t('runtimeConfig.profiles.confirmSelection', { defaultValue: 'Confirm final selection' })}
          </Button>
          {selectionCompleted ? (
            <Button
              size="sm"
              tone="secondary"
              disabled={busy}
              onClick={() => {
                setActiveTab('runtime');
                runtimeConfigNavigation.openPage('environment');
              }}
            >
              {t('runtimeConfig.profiles.reviewEnvironment', { defaultValue: 'Review Runtime environment confirmation' })}
            </Button>
          ) : null}
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
            <div className="mt-1 font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{summary.profileId}</div>
          </div>
          <div className="grid gap-2">
            {summary.capabilities.map((capability) => (
              <div key={capability.capabilityContract} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs">
                <div className="font-semibold text-[var(--nimi-text-primary)]">{capability.capabilityContract}</div>
                <div className="mt-1 text-[var(--nimi-text-secondary)]">
                  {capability.route === 'local'
                    ? t('runtimeConfig.profiles.intentLocal', { defaultValue: 'Local intent' })
                    : t('runtimeConfig.profiles.intentCloud', { defaultValue: 'Cloud intent' })}
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
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      {cloudGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-cloud-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.cloudConfigurationTitle', {
              defaultValue: 'Cloud execution stays Nimi-owned',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.cloudConfigurationGuidance', {
              defaultValue: 'Portable AIProfiles carry an exact implementation and provider-model catalog target, but never Connector, account, credential, or secret identity. Confirm Apply to write that target choice into the Nimi Desktop AIConfig. Runtime resolves only the current-account Connector bound by that exact catalog identity.',
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
                defaultValue: 'Review Cloud Connectors',
              })}
            </Button>
          </div>
        </Surface>
      ) : null}

      {localGuidanceCount > 0 ? (
        <Surface tone="card" className="space-y-2 p-4" data-testid="runtime-portable-profile-local-guidance">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.localSelectionTitle', {
              defaultValue: 'Local capability selection stays on this machine',
            })}
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.localSelectionGuidance', {
              defaultValue: 'Local capability intent is written to the App AIConfig. Machine-side Loadout resolution and selection are managed on the Loadouts page. Until a Loadout is selected, Runtime reports an informational selection-required state; this is not an error.',
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
                defaultValue: 'Open Loadouts',
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
