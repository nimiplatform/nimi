// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNimiError } from '@nimiplatform/sdk/types';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiMachineLoadouts,
  NimiPrepareLoadoutInput,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  OverlayShell,
  PillTabs,
  SelectField,
  StatusBadge,
  Surface,
  TextField,
  nimiToast,
} from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import {
  installRuntimeConfigCatalogAsset,
  useRuntimeConfigLocalEnvironmentClient,
} from './runtime-config-local-environment-sdk-service.js';
import { runtimeConfigLoadoutCatalogBadge } from './runtime-config-loadout-catalog-badge.js';
import {
  createRuntimeConfigLoadoutImpactState,
  type RuntimeConfigLoadoutPendingImpact,
} from './runtime-config-loadout-impact-state.js';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell.js';

type EditDraft = { readonly modelAssetIds: Readonly<Record<string, string>>; readonly displayName: string };
type RecommendedInstallItem = {
  readonly slotId: string;
  readonly displayLabel: string;
  readonly contentId: string;
  readonly variantId: string;
  readonly descriptor?: NimiRuntimeLocalVerifiedAssetDescriptor;
  readonly installed: boolean;
};
type PendingRecommendedInstall = {
  readonly recipe: NimiLoadoutRecipe;
  readonly items: readonly RecommendedInstallItem[];
  readonly loadout?: NimiMachineLoadout;
};

const CAPABILITY_ORDER = [
  'text.generate',
  'text.embed',
  'image.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice.create',
  'video.generate',
];

function capabilitySortIndex(capabilityContract: string): number {
  const index = CAPABILITY_ORDER.indexOf(capabilityContract);
  return index === -1 ? CAPABILITY_ORDER.length : index;
}

export function LoadoutsPage(props: { readonly onOpenEnvironment?: () => void }) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const loadoutsClient = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
  const modelAssetsClient = useRuntimeConfigLocalEnvironmentClient();
  const impactState = useMemo(() => createRuntimeConfigLoadoutImpactState(), []);
  const [aggregate, setAggregate] = useState<NimiMachineLoadouts | null>(null);
  const [recipes, setRecipes] = useState<readonly NimiLoadoutRecipe[]>([]);
  const [assets, setAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [verifiedAssets, setVerifiedAssets] = useState<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [technicalError, setTechnicalError] = useState('');
  const [axisErrors, setAxisErrors] = useState<Record<string, string>>({});
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [createCapability, setCreateCapability] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [createAxes, setCreateAxes] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, EditDraft>>({});
  const [manageLoadoutId, setManageLoadoutId] = useState<string | null>(null);
  const [, setImpactRevision] = useState(0);
  const [pendingInstall, setPendingInstall] = useState<PendingRecommendedInstall | null>(null);
  const pendingImpact = impactState.current();

  const requestImpact = useCallback((pending: RuntimeConfigLoadoutPendingImpact) => {
    impactState.request(pending);
    setImpactRevision((current) => current + 1);
  }, [impactState]);

  const cancelImpact = useCallback(() => {
    impactState.cancel();
    setImpactRevision((current) => current + 1);
  }, [impactState]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setTechnicalError('');
    try {
      const [nextAggregate, nextRecipes, nextAssets, nextVerifiedAssets] = await Promise.all([
        loadoutsClient.get(),
        loadoutsClient.listRecipes(),
        modelAssetsClient.listModelAssets(),
        modelAssetsClient.listVerifiedAssets(),
      ]);
      setAggregate(nextAggregate);
      setRecipes(nextRecipes);
      setAssets(nextAssets);
      setVerifiedAssets(nextVerifiedAssets);
    } catch (error) {
      setTechnicalError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadoutsClient, modelAssetsClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const capabilities = useMemo(() => {
    const contracts = new Set<string>();
    for (const recipe of recipes) contracts.add(recipe.capabilityContract);
    for (const loadout of aggregate?.loadouts ?? []) contracts.add(loadout.capabilityContract);
    return [...contracts].sort((left, right) => (
      capabilitySortIndex(left) - capabilitySortIndex(right) || left.localeCompare(right)
    ));
  }, [aggregate, recipes]);

  const loadoutsByCapability = useMemo(() => {
    const grouped = new Map<string, NimiMachineLoadout[]>();
    for (const loadout of aggregate?.loadouts ?? []) {
      const list = grouped.get(loadout.capabilityContract) ?? [];
      list.push(loadout);
      grouped.set(loadout.capabilityContract, list);
    }
    for (const list of grouped.values()) {
      list.sort((left, right) => Number(isSelected(aggregate, right)) - Number(isSelected(aggregate, left)));
    }
    return grouped;
  }, [aggregate]);

  const [activeCapability, setActiveCapability] = useState('');

  useEffect(() => {
    if (capabilities.length === 0) {
      setActiveCapability('');
      return;
    }
    setActiveCapability((current) => {
      if (current && capabilities.includes(current)) return current;
      const withSelection = capabilities.find((capability) => (
        (loadoutsByCapability.get(capability) ?? []).some((loadout) => isSelected(aggregate, loadout))
      ));
      return withSelection ?? capabilities[0] ?? '';
    });
  }, [aggregate, capabilities, loadoutsByCapability]);

  const activeCapabilityLoadouts = loadoutsByCapability.get(activeCapability) ?? [];

  const createCapabilities = useMemo(() => {
    const contracts = new Set<string>();
    for (const recipe of recipes) contracts.add(recipe.capabilityContract);
    return [...contracts].sort((left, right) => (
      capabilitySortIndex(left) - capabilitySortIndex(right) || left.localeCompare(right)
    ));
  }, [recipes]);

  const createCapabilityRecipes = useMemo(
    () => recipes.filter((recipe) => recipe.capabilityContract === createCapability),
    [createCapability, recipes],
  );

  const selectedRecipe = recipes.find((recipe) => recipe.recipeId === recipeId);
  const recommendations = useMemo(
    () => selectedRecipe ? recommendedInstallItems(selectedRecipe, assets, verifiedAssets) : [],
    [assets, selectedRecipe, verifiedAssets],
  );
  const missingRecommendations = recommendations.filter((item) => !item.installed);
  const missingDownload = recommendedMissingDownload(recommendations);

  const beginCreate = useCallback((capability?: string) => {
    setRecipeId('');
    setDisplayName('');
    setCreateAxes({});
    if (capability) {
      setCreateCapability(capability);
      setCreateStep(2);
    } else {
      setCreateCapability('');
      setCreateStep(1);
    }
    setShowCreate(true);
  }, []);

  const selectCreateCapability = useCallback((capability: string) => {
    setCreateCapability(capability);
    setRecipeId('');
    setDisplayName('');
    setCreateAxes({});
    setCreateStep(2);
  }, []);

  const selectCreateRecipe = useCallback((recipe: NimiLoadoutRecipe) => {
    setRecipeId(recipe.recipeId);
    const capabilityLabel = t(loadoutCapabilityLabelKey(recipe.capabilityContract), {
      defaultValue: recipe.capabilityContract,
    });
    setDisplayName(`${capabilityLabel} · ${recipe.title}`);
    setCreateAxes(recommendedAxisSelections(recipe, assets));
    setCreateStep(3);
  }, [assets, t]);

  const run = useCallback(async (key: string, action: () => Promise<void>, onError?: (message: string) => void) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      await refresh();
      nimiToast.success(t('runtimeConfig.loadouts.saved'));
    } catch (error) {
      const message = errorMessage(error);
      setTechnicalError(message);
      onError?.(message);
    } finally {
      setBusy('');
    }
  }, [busy, refresh, t]);

  const create = useCallback(() => {
    if (!selectedRecipe || !displayName.trim()) return;
    const recipe = selectedRecipe;
    const name = displayName.trim();
    const items = recommendations;
    void run('create', async () => {
      const modelAxes = recipe.slots.flatMap((slot) => {
        const modelAsset = assets.find((asset) => asset.modelAssetId === createAxes[slot.slotId]);
        return modelAsset ? [{ slotId: slot.slotId, modelAssetId: modelAsset.modelAssetId, expectedContentId: modelAsset.contentId }] : [];
      });
      const prepared = await loadoutsClient.prepare({
        capabilityContract: recipe.capabilityContract,
        recipeId: recipe.recipeId,
        options: recipe.defaultOptions,
        supportedFeatures: recipe.supportedFeatures,
        displayName: name,
        modelAxes,
      });
      await loadoutsClient.commit(prepared.prepareId, false);
      setShowCreate(false);
      if (items.some((item) => !item.installed)) {
        const nextAggregate = await loadoutsClient.get();
        const matches = nextAggregate.loadouts.filter((loadout) => (
          loadout.recipeId === recipe.recipeId
          && loadout.capabilityContract === recipe.capabilityContract
          && loadout.displayName === name
        ));
        const created = matches[matches.length - 1];
        setPendingInstall({ recipe, items, ...(created ? { loadout: created } : {}) });
      }
    });
  }, [assets, createAxes, displayName, loadoutsClient, recommendations, run, selectedRecipe]);

  const requestRecommendedInstallForRecipe = useCallback((recipe: NimiLoadoutRecipe, loadout?: NimiMachineLoadout) => {
    const items = recommendedInstallItems(recipe, assets, verifiedAssets);
    if (!items.some((item) => !item.installed)) return;
    setPendingInstall({ recipe, items, ...(loadout ? { loadout } : {}) });
  }, [assets, verifiedAssets]);

  const confirmRecommendedInstall = useCallback(() => {
    const pending = pendingInstall;
    if (!pending) return;
    setPendingInstall(null);
    void run(`install:${pending.recipe.recipeId}`, async () => {
      await installAndBindRuntimeConfigRecommendedLoadout({
        ...pending,
        assets,
        installCatalogAsset: (templateId) => installRuntimeConfigCatalogAsset(modelAssetsClient, templateId),
        updateLoadout: (next) => loadoutsClient.update(next, false),
      });
    });
  }, [assets, loadoutsClient, modelAssetsClient, pendingInstall, run]);

  const requestSelect = useCallback((loadout: NimiMachineLoadout) => {
    requestImpact({
      kind: 'select', title: loadout.displayName,
      run: async () => { await loadoutsClient.select(loadout.capabilityContract, loadout.loadoutId, true); },
    });
  }, [loadoutsClient, requestImpact]);

  const requestClear = useCallback((loadout: NimiMachineLoadout) => {
    requestImpact({
      kind: 'clear', title: loadout.displayName,
      run: async () => { await loadoutsClient.select(loadout.capabilityContract, null, true); },
    });
  }, [loadoutsClient, requestImpact]);

  const requestUpdate = useCallback((loadout: NimiMachineLoadout, slotId: string, nextModelAssetId: string) => {
    const draft = edits[loadout.loadoutId] ?? { modelAssetIds: modelAssetIdsForLoadout(loadout), displayName: loadout.displayName };
    const modelAxes = runtimeConfigLoadoutUpdateModelAxes(
      loadout,
      draft.modelAssetIds,
      assets,
      slotId,
      nextModelAssetId,
    );
    const errorKey = `${loadout.loadoutId}:${slotId}`;
    const candidateErrorKey = `${errorKey}:${nextModelAssetId}`;
    const selected = isSelected(aggregate, loadout);
    const updateInput = {
      loadoutId: loadout.loadoutId,
      capabilityContract: loadout.capabilityContract,
      recipeId: loadout.recipeId,
      options: loadout.options,
      supportedFeatures: loadout.supportedFeatures,
      displayName: draft.displayName.trim() || loadout.displayName,
      modelAxes,
      provenance: loadout.provenance,
    };
    setAxisErrors((current) => ({ ...current, [errorKey]: '' }));
    const action = async () => {
      await loadoutsClient.update(updateInput, selected);
      setCandidateErrors((current) => {
        const next = { ...current };
        delete next[candidateErrorKey];
        return next;
      });
    };
    const onError = (message: string) => {
      setAxisErrors((current) => ({ ...current, [errorKey]: message }));
      setCandidateErrors((current) => ({ ...current, [candidateErrorKey]: message }));
    };
    if (selected) {
      requestImpact({ kind: 'update', title: loadout.displayName, run: action, onError });
    } else {
      void run(`update:${loadout.loadoutId}:${slotId}`, action, onError);
    }
  }, [aggregate, assets, edits, loadoutsClient, requestImpact, run]);

  const requestRename = useCallback((loadout: NimiMachineLoadout) => {
    const draft = edits[loadout.loadoutId] ?? { modelAssetIds: modelAssetIdsForLoadout(loadout), displayName: loadout.displayName };
    const nextName = draft.displayName.trim();
    if (!nextName || nextName === loadout.displayName) return;
    const selected = isSelected(aggregate, loadout);
    const updateInput = {
      loadoutId: loadout.loadoutId,
      capabilityContract: loadout.capabilityContract,
      recipeId: loadout.recipeId,
      options: loadout.options,
      supportedFeatures: loadout.supportedFeatures,
      displayName: nextName,
      modelAxes: runtimeConfigLoadoutUpdateModelAxes(loadout, draft.modelAssetIds, assets, '', ''),
      provenance: loadout.provenance,
    };
    const action = async () => { await loadoutsClient.update(updateInput, selected); };
    if (selected) {
      requestImpact({ kind: 'update', title: loadout.displayName, run: action });
    } else {
      void run(`rename:${loadout.loadoutId}`, action);
    }
  }, [aggregate, assets, edits, loadoutsClient, requestImpact, run]);

  const requestDelete = useCallback((loadout: NimiMachineLoadout) => {
    const selected = isSelected(aggregate, loadout);
    const action = async () => { await loadoutsClient.delete(loadout.loadoutId, selected); };
    if (selected) requestImpact({ kind: 'delete', title: loadout.displayName, run: action });
    else void run(`delete:${loadout.loadoutId}`, action);
  }, [aggregate, loadoutsClient, requestImpact, run]);

  const confirmImpact = useCallback(() => {
    if (busy) return;
    const pending = impactState.confirm();
    if (!pending) return;
    setImpactRevision((current) => current + 1);
    void run(`${pending.kind}:${pending.title}`, pending.run, pending.onError);
  }, [busy, impactState, run]);

  const manageLoadout = manageLoadoutId
    ? aggregate?.loadouts.find((loadout) => loadout.loadoutId === manageLoadoutId) ?? null
    : null;
  const manageRecipe = manageLoadout
    ? recipes.find((recipe) => recipe.recipeId === manageLoadout.recipeId)
    : undefined;
  const manageDraft = manageLoadout
    ? edits[manageLoadout.loadoutId] ?? { modelAssetIds: modelAssetIdsForLoadout(manageLoadout), displayName: manageLoadout.displayName }
    : null;

  const capabilityLabel = useCallback((capabilityContract: string) => (
    t(loadoutCapabilityLabelKey(capabilityContract), { defaultValue: capabilityContract })
  ), [t]);

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={t('runtimeConfig.loadouts.title')}
        description={t('runtimeConfig.loadouts.description')}
        actions={<Button size="sm" tone="primary" onClick={() => beginCreate(activeCapability || undefined)}>{t('runtimeConfig.loadouts.create')}</Button>}
      />
      {technicalError ? (
        <InlineAlert tone="danger">
          <p>{t('runtimeConfig.loadouts.loadFailed')}</p>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
            <p className="mt-2 break-all">{technicalError}</p>
          </details>
        </InlineAlert>
      ) : null}
      {loading ? <LoadingSkeleton lines={5} /> : capabilities.length > 0 ? (
        <div className="grid gap-4" data-testid="machine-loadouts-list">
          <PillTabs
            size="sm"
            ariaLabel={t('runtimeConfig.loadouts.title')}
            items={capabilities.map((capability) => ({
              value: capability,
              label: `${capabilityLabel(capability)} (${(loadoutsByCapability.get(capability) ?? []).length})`,
            }))}
            value={activeCapability}
            onValueChange={(value) => setActiveCapability(value)}
          />
          {activeCapability ? (
            <section className="grid gap-3" data-testid={`loadout-capability:${activeCapability}`}>
              {activeCapabilityLoadouts.length > 0 ? (
                activeCapabilityLoadouts.map((loadout) => (
                  <LoadoutCard
                    key={loadout.loadoutId}
                    loadout={loadout}
                    recipe={recipes.find((recipe) => recipe.recipeId === loadout.recipeId)}
                    assets={assets}
                    verifiedAssets={verifiedAssets}
                    selected={isSelected(aggregate, loadout)}
                    busy={Boolean(busy)}
                    onSelect={() => requestSelect(loadout)}
                    onClear={() => requestClear(loadout)}
                    onInstallRecommended={(recipe) => requestRecommendedInstallForRecipe(recipe, loadout)}
                    onManage={() => setManageLoadoutId(loadout.loadoutId)}
                  />
                ))
              ) : (
                <Surface tone="card" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid={`loadout-capability-empty:${activeCapability}`}>
                  <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.sectionEmpty')}</span>
                  <Button size="sm" tone="secondary" onClick={() => beginCreate(activeCapability)}>{t('runtimeConfig.loadouts.createForCapability', { capability: capabilityLabel(activeCapability) })}</Button>
                </Surface>
              )}
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState title={t('runtimeConfig.loadouts.empty')} description={t('runtimeConfig.loadouts.emptyBody')} action={<Button size="sm" tone="primary" onClick={() => beginCreate()}>{t('runtimeConfig.loadouts.create')}</Button>} />
      )}

      <OverlayShell open={showCreate} kind="drawer" size="M" title={t('runtimeConfig.loadouts.create')} onClose={() => setShowCreate(false)}>
        <div className="grid gap-4 py-2" data-testid="create-loadout-form">
          <div className="text-xs font-medium text-[var(--nimi-text-muted)]">
            {createStep}/3 · {t(createStep === 1
              ? 'runtimeConfig.loadouts.createStepCapability'
              : createStep === 2
                ? 'runtimeConfig.loadouts.createStepRecipe'
                : 'runtimeConfig.loadouts.createStepConfigure')}
          </div>

          {createStep === 1 ? (
            <div className="grid gap-2">
              {createCapabilities.map((capability) => {
                const recipeCount = recipes.filter((recipe) => recipe.capabilityContract === capability).length;
                return (
                  <button
                    key={capability}
                    type="button"
                    data-testid={`create-capability:${capability}`}
                    onClick={() => selectCreateCapability(capability)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-left transition hover:bg-[var(--nimi-action-ghost-hover)]"
                  >
                    <span className="text-sm font-medium">{capabilityLabel(capability)}</span>
                    <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.capabilityTemplates', { count: recipeCount })}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {createStep === 2 ? (
            <div className="grid gap-2">
              {createCapabilityRecipes.map((recipe) => {
                const items = recommendedInstallItems(recipe, assets, verifiedAssets);
                const missing = recommendedMissingDownload(items);
                const installedCount = items.filter((item) => item.installed).length;
                return (
                  <button
                    key={recipe.recipeId}
                    type="button"
                    data-testid={`create-recipe:${recipe.recipeId}`}
                    onClick={() => selectCreateRecipe(recipe)}
                    className="grid gap-1 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-left transition hover:bg-[var(--nimi-action-ghost-hover)]"
                  >
                    <span className="text-sm font-medium">{recipe.title}</span>
                    <span className="text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.loadouts.recipeSummary', { slots: recipe.slots.length, installed: installedCount })}
                      {missing.count > 0 ? ` · ${missing.totalBytes !== null
                        ? t('runtimeConfig.loadouts.recipeMissing', { size: formatBytes(missing.totalBytes) })
                        : t('runtimeConfig.loadouts.recipeMissingUnknown')}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {createStep === 3 && selectedRecipe ? (
            <>
              <label className="grid gap-1 text-sm"><span>{t('runtimeConfig.loadouts.name')}</span><TextField value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label>
              {selectedRecipe.slots.map((slot) => (
                <div key={slot.slotId} className="grid gap-1 text-sm">
                  <span>{slot.displayLabel}</span>
                  <SelectField
                    value={createAxes[slot.slotId] ?? ''}
                    options={[{ value: '', label: t('runtimeConfig.loadouts.unresolved') }, ...assets.map((asset) => ({ value: asset.modelAssetId, label: loadoutAssetLabel(asset, verifiedAssets) }))]}
                    onValueChange={(modelAssetId) => setCreateAxes((current) => ({ ...current, [slot.slotId]: modelAssetId }))}
                    contentLayer="dialog"
                  />
                </div>
              ))}
              {recommendations.length > 0 ? (
                <Surface tone="card" className="grid gap-2 p-3" data-testid="recommended-loadout-combination">
                  <div className="text-sm font-medium">{t('runtimeConfig.loadouts.recommendedCombination')}</div>
                  {recommendations.map((item) => (
                    <div key={item.slotId} className="flex items-center justify-between gap-3 text-xs">
                      <span>{item.displayLabel} · {item.descriptor?.title ?? item.variantId}</span>
                      <span>{formatDownloadBytes(knownDownloadSize(item.descriptor?.totalSizeBytes), t('runtimeConfig.loadouts.unknownDownloadSize'))} · {item.installed ? t('runtimeConfig.loadouts.installed') : t('runtimeConfig.loadouts.downloadRequired')}</span>
                    </div>
                  ))}
                </Surface>
              ) : null}
              {missingRecommendations.length > 0 ? (
                <InlineAlert tone="warning">
                  <p>{missingDownload.totalBytes !== null
                    ? t('runtimeConfig.loadouts.missingSummary', { size: formatBytes(missingDownload.totalBytes) })
                    : t('runtimeConfig.loadouts.missingSummaryUnknown')}</p>
                </InlineAlert>
              ) : (
                <InlineAlert tone="success">
                  <p>{t('runtimeConfig.loadouts.readySummary')}</p>
                </InlineAlert>
              )}
            </>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <div>{createStep > 1 ? <Button size="sm" tone="ghost" onClick={() => setCreateStep((current) => (current === 3 ? 2 : 1))}>{t('runtimeConfig.loadouts.back')}</Button> : null}</div>
            <div className="flex gap-2">
              <Button size="sm" tone="ghost" onClick={() => setShowCreate(false)}>{t('runtimeConfig.loadouts.cancel')}</Button>
              {createStep === 3 ? (
                <Button
                  size="sm"
                  tone="primary"
                  loading={busy === 'create'}
                  disabled={!selectedRecipe || !displayName.trim()}
                  onClick={create}
                >
                  {missingRecommendations.length > 0 ? t('runtimeConfig.loadouts.commitDownload') : t('runtimeConfig.loadouts.commit')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </OverlayShell>

      <OverlayShell
        open={manageLoadout !== null}
        kind="drawer"
        size="M"
        title={manageLoadout?.displayName ?? ''}
        onClose={() => setManageLoadoutId(null)}
      >
        {manageLoadout && manageDraft ? (
          <div className="grid gap-5 py-2" data-testid={`loadout-manage:${manageLoadout.loadoutId}`}>
            <div className="grid gap-1 text-sm">
              <span>{t('runtimeConfig.loadouts.name')}</span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <TextField
                    value={manageDraft.displayName}
                    onChange={(event) => setEdits((current) => ({
                      ...current,
                      [manageLoadout.loadoutId]: { ...manageDraft, displayName: event.currentTarget.value },
                    }))}
                  />
                </div>
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={Boolean(busy) || !manageDraft.displayName.trim() || manageDraft.displayName.trim() === manageLoadout.displayName}
                  onClick={() => requestRename(manageLoadout)}
                >
                  {t('runtimeConfig.loadouts.renameSave')}
                </Button>
              </div>
            </div>

            <section className="grid gap-3" data-testid="loadout-model-parts-editor">
              <div>
                <h5 className="text-sm font-medium">{t('runtimeConfig.loadouts.changeModels')}</h5>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.changeModelsDescription')}</p>
              </div>
              {manageLoadout.modelAxes.map((axis) => {
                const asset = assets.find((item) => item.modelAssetId === axis.modelAssetId);
                const slot = manageRecipe?.slots.find((item) => item.slotId === axis.slotId);
                const custom = Boolean(asset && slot && !slot.recommendedContentIds.includes(asset.contentId));
                const error = axisErrors[`${manageLoadout.loadoutId}:${axis.slotId}`];
                return (
                  <div key={axis.slotId} className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium"><span>{axis.displayLabel}</span>{custom ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.customModel')}</StatusBadge> : null}</div>
                      <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{asset ? loadoutAssetLabel(asset, verifiedAssets) : axis.modelAssetId || t('runtimeConfig.loadouts.unresolved')}</div>
                      {error ? <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{t('runtimeConfig.loadouts.incompatibleSummary')}</p> : null}
                    </div>
                    <SelectField
                      value={manageDraft.modelAssetIds[axis.slotId] ?? ''}
                      options={assets.map((item) => {
                        const incompatibility = candidateErrors[`${manageLoadout.loadoutId}:${axis.slotId}:${item.modelAssetId}`];
                        const label = loadoutAssetLabel(item, verifiedAssets);
                        return { value: item.modelAssetId, label: incompatibility ? `${label} · ${t('runtimeConfig.loadouts.incompatibleOption')}` : label };
                      })}
                      onValueChange={(modelAssetId) => {
                        setEdits((current) => ({
                          ...current,
                          [manageLoadout.loadoutId]: { ...manageDraft, modelAssetIds: { ...manageDraft.modelAssetIds, [axis.slotId]: modelAssetId } },
                        }));
                        requestUpdate(manageLoadout, axis.slotId, modelAssetId);
                      }}
                      disabled={Boolean(busy)}
                      contentLayer="dialog"
                    />
                  </div>
                );
              })}
            </section>

            <section className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-3 text-xs text-[var(--nimi-text-muted)]" data-testid="loadout-execution-supply">
              <h5 className="font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.loadouts.technicalDetails')}</h5>
              <p>{manageLoadout.capabilityContract} · {manageLoadout.recipeId}@{manageLoadout.recipeRevision} · {manageLoadout.implementation.driverDialect}</p>
              {manageLoadout.modelAxes.map((axis) => {
                const asset = assets.find((item) => item.modelAssetId === axis.modelAssetId);
                const catalogBadge = runtimeConfigLoadoutCatalogBadge(asset?.catalogVerification);
                const error = axisErrors[`${manageLoadout.loadoutId}:${axis.slotId}`];
                return (
                  <div key={axis.slotId} className="grid gap-1">
                    <p>{axis.displayLabel}: {axis.modelAssetId || axis.expectedContentId || t('runtimeConfig.loadouts.unresolved')}</p>
                    <div className="flex flex-wrap gap-1"><StatusBadge tone={asset?.contentVerified ? 'success' : 'warning'} shape="soft">{t('runtimeConfig.loadouts.contentVerified')}</StatusBadge><StatusBadge tone={catalogBadge.tone} shape="soft">{t(`runtimeConfig.loadouts.catalogBadge.${catalogBadge.label}`)}</StatusBadge><StatusBadge tone={axis.recipeCompatible ? 'success' : 'warning'} shape="soft">{t('runtimeConfig.loadouts.recipeCompatible')}</StatusBadge></div>
                    {error ? <p className="break-all text-[var(--nimi-status-danger)]">{error}</p> : null}
                  </div>
                );
              })}
              <p>{t('runtimeConfig.loadouts.recipeCustody')}: {manageLoadout.recipeCustody.length > 0 ? manageLoadout.recipeCustody.map((item) => item.custodyId).join(', ') : t('runtimeConfig.loadouts.recipeCustodyEmpty')}</p>
              <p>{t('runtimeConfig.loadouts.executionSupply')}</p>
              {manageLoadout.reasons.length > 0 ? <p className="break-all text-[var(--nimi-status-danger)]">{manageLoadout.reasons.join(', ')}</p> : null}
              {props.onOpenEnvironment ? (
                <div><Button size="sm" tone="ghost" onClick={props.onOpenEnvironment}>{t('runtimeConfig.loadouts.viewInEnvironment')}</Button></div>
              ) : null}
            </section>

            <div className="flex justify-end border-t border-[var(--nimi-border-subtle)] pt-4">
              <Button size="sm" tone="danger" disabled={Boolean(busy)} onClick={() => requestDelete(manageLoadout)}>{t('runtimeConfig.loadouts.delete')}</Button>
            </div>
          </div>
        ) : null}
      </OverlayShell>

      <ConfirmDialog
        open={pendingInstall !== null}
        title={t('runtimeConfig.loadouts.installRecommendedTitle')}
        message={recommendedInstallMessage(pendingInstall?.items ?? [], {
          heading: t(pendingInstall?.loadout
            ? 'runtimeConfig.loadouts.installRecommendedAndUseBody'
            : 'runtimeConfig.loadouts.installRecommendedBody'),
          installed: t('runtimeConfig.loadouts.installed'),
          download: t('runtimeConfig.loadouts.downloadAction'),
          total: t('runtimeConfig.loadouts.totalDownload'),
          unknownSize: t('runtimeConfig.loadouts.unknownDownloadSize'),
        })}
        confirmLabel={t(pendingInstall?.loadout
          ? 'runtimeConfig.loadouts.installRecommendedAndUseConfirm'
          : 'runtimeConfig.loadouts.installRecommendedConfirm')}
        cancelLabel={t('runtimeConfig.loadouts.cancel')}
        confirmTone="primary"
        pending={Boolean(busy)}
        onConfirm={confirmRecommendedInstall}
        onClose={() => setPendingInstall(null)}
      />
      {pendingImpact ? (
        <OverlayShell
          open
          kind="dialog"
          closeOnBackdrop={false}
          title={t('runtimeConfig.loadouts.impactTitle')}
          onClose={cancelImpact}
          footer={(
            <div className="flex gap-3">
              <div className="flex-1"><Button tone="secondary" fullWidth onClick={cancelImpact}>{t('runtimeConfig.loadouts.cancel')}</Button></div>
              <div className="flex-1"><Button tone={pendingImpact.kind === 'delete' ? 'danger' : 'primary'} fullWidth loading={Boolean(busy)} onClick={confirmImpact}>{t('runtimeConfig.loadouts.confirm')}</Button></div>
            </div>
          )}
        >
          <div className="text-sm text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.loadouts.impactBody', { name: pendingImpact.title })}
          </div>
        </OverlayShell>
      ) : null}
    </RuntimePageShell>
  );
}

function LoadoutCard(props: {
  readonly loadout: NimiMachineLoadout;
  readonly recipe?: NimiLoadoutRecipe;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onClear: () => void;
  readonly onInstallRecommended: (recipe: NimiLoadoutRecipe) => void;
  readonly onManage: () => void;
}) {
  const { t } = useTranslation();
  const tone = props.loadout.validationState === 'configured' ? 'success' : props.loadout.validationState === 'blocked' ? 'danger' : 'warning';
  const recoveryRecommendations = props.recipe
    ? recommendedInstallItems(props.recipe, props.assets, props.verifiedAssets)
    : [];
  const canInstallRecommended = props.loadout.validationState !== 'configured'
    && recoveryRecommendations.some((item) => !item.installed);
  const needsAttention = props.loadout.validationState !== 'configured';
  return (
    <Surface
      tone="card"
      className={`grid gap-3 p-4 ${props.selected ? 'ring-2 ring-[var(--nimi-status-info)]' : ''}`}
      data-testid={`machine-loadout:${props.loadout.loadoutId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">{props.loadout.displayName}</h4>
            {props.selected ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.selected')}</StatusBadge> : null}
            <StatusBadge tone={tone} shape="soft">{t(`runtimeConfig.loadouts.state.${props.loadout.validationState}`)}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">
            {loadoutModelSummary(props.loadout, props.assets, props.verifiedAssets, t('runtimeConfig.loadouts.unresolved'))}
          </p>
          {needsAttention && props.loadout.reasons.length > 0 ? (
            <p className="mt-1 break-all text-xs text-[var(--nimi-status-danger)]">{props.loadout.reasons.join(' · ')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {props.selected ? <Button size="sm" tone="ghost" disabled={props.busy} onClick={props.onClear}>{t('runtimeConfig.loadouts.clear')}</Button> : props.loadout.validationState === 'configured' ? <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onSelect}>{t('runtimeConfig.loadouts.select')}</Button> : canInstallRecommended && props.recipe ? <Button data-testid={`loadout-install-recommended:${props.loadout.loadoutId}`} size="sm" tone="primary" disabled={props.busy} onClick={() => props.onInstallRecommended(props.recipe!)}>{t('runtimeConfig.loadouts.installRecommended')}</Button> : <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onManage}>{t('runtimeConfig.loadouts.chooseModels')}</Button>}
          <Button size="sm" tone="secondary" disabled={props.busy} onClick={props.onManage}>{t('runtimeConfig.loadouts.manage')}</Button>
        </div>
      </div>
    </Surface>
  );
}

function loadoutModelSummary(
  loadout: NimiMachineLoadout,
  assets: readonly NimiRuntimeModelAssetRecord[],
  verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
  unresolvedLabel: string,
): string {
  const multiple = loadout.modelAxes.length > 1;
  return loadout.modelAxes.map((axis) => {
    const asset = assets.find((item) => item.modelAssetId === axis.modelAssetId);
    const label = asset ? loadoutAssetLabel(asset, verifiedAssets) : unresolvedLabel;
    return multiple ? `${axis.displayLabel}: ${label}` : label;
  }).join(' · ');
}

function recommendedMissingDownload(items: readonly RecommendedInstallItem[]): { readonly count: number; readonly totalBytes: number | null } {
  const missing = items.filter((item) => !item.installed);
  if (missing.length === 0) return { count: 0, totalBytes: 0 };
  const totalBytes = missing.every((item) => knownDownloadSize(item.descriptor?.totalSizeBytes) !== null)
    ? missing.reduce((sum, item) => sum + (knownDownloadSize(item.descriptor?.totalSizeBytes) ?? 0), 0)
    : null;
  return { count: missing.length, totalBytes };
}

function recommendedAxisSelections(recipe: NimiLoadoutRecipe | undefined, assets: readonly NimiRuntimeModelAssetRecord[]): Record<string, string> {
  if (!recipe) return {};
  return Object.fromEntries(recipe.slots.map((slot) => {
    const matched = assets.filter((asset) => slot.recommendedContentIds.includes(asset.contentId));
    return [slot.slotId, matched.length === 1 ? matched[0]!.modelAssetId : ''];
  }));
}

export function recommendedInstallItems(
  recipe: NimiLoadoutRecipe,
  assets: readonly NimiRuntimeModelAssetRecord[],
  verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): RecommendedInstallItem[] {
  return recipe.slots.flatMap((slot) => {
    const variantId = slot.recommendedVariantIds[0] ?? '';
    if (!variantId) return [];
    const descriptor = verifiedAssets.find((item) => item.templateId === variantId || item.assetId === variantId);
    const contentId = slot.recommendedContentIds[0] ?? '';
    return [{
      slotId: slot.slotId,
      displayLabel: slot.displayLabel,
      contentId,
      variantId,
      descriptor,
      installed: Boolean(contentId && assets.some((asset) => asset.contentId === contentId)),
    }];
  });
}

function modelAssetIdsForLoadout(loadout: NimiMachineLoadout): Record<string, string> {
  return Object.fromEntries(loadout.modelAxes.map((axis) => [axis.slotId, axis.modelAssetId]));
}

export function runtimeConfigLoadoutUpdateModelAxes(
  loadout: Pick<NimiMachineLoadout, 'modelAxes'>,
  draftModelAssetIds: Readonly<Record<string, string>>,
  assets: readonly NimiRuntimeModelAssetRecord[],
  slotId: string,
  nextModelAssetId: string,
): NimiPrepareLoadoutInput['modelAxes'] {
  return loadout.modelAxes.map((axis) => {
    const modelAssetId = axis.slotId === slotId
      ? nextModelAssetId
      : (draftModelAssetIds[axis.slotId] ?? axis.modelAssetId);
    const asset = assets.find((item) => item.modelAssetId === modelAssetId);
    if (asset) {
      return { slotId: axis.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId };
    }
    return {
      slotId: axis.slotId,
      ...(axis.modelAssetId ? { modelAssetId: axis.modelAssetId } : {}),
      ...(axis.expectedContentId ? { expectedContentId: axis.expectedContentId } : {}),
    };
  });
}

export function runtimeConfigRecommendedLoadoutModelAxes(
  loadout: Pick<NimiMachineLoadout, 'modelAxes'>,
  recipe: Pick<NimiLoadoutRecipe, 'slots'>,
  assets: readonly NimiRuntimeModelAssetRecord[],
): NimiPrepareLoadoutInput['modelAxes'] {
  return recipe.slots.map((slot) => {
    const current = loadout.modelAxes.find((axis) => axis.slotId === slot.slotId);
    if (current?.modelAssetId) {
      const currentAsset = assets.find((asset) => asset.modelAssetId === current.modelAssetId);
      return {
        slotId: slot.slotId,
        modelAssetId: current.modelAssetId,
        ...(currentAsset?.contentId || current.expectedContentId
          ? { expectedContentId: currentAsset?.contentId || current.expectedContentId }
          : {}),
      };
    }
    const recommended = slot.recommendedContentIds
      .map((contentId) => assets.find((asset) => asset.contentId === contentId))
      .find((asset): asset is NimiRuntimeModelAssetRecord => asset !== undefined);
    if (recommended) {
      return {
        slotId: slot.slotId,
        modelAssetId: recommended.modelAssetId,
        expectedContentId: recommended.contentId,
      };
    }
    const expectedContentId = current?.expectedContentId || slot.recommendedContentIds[0];
    return {
      slotId: slot.slotId,
      ...(expectedContentId ? { expectedContentId } : {}),
    };
  });
}

export async function installAndBindRuntimeConfigRecommendedLoadout(input: {
  readonly items: readonly RecommendedInstallItem[];
  readonly recipe: NimiLoadoutRecipe;
  readonly loadout?: NimiMachineLoadout;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly installCatalogAsset: (templateId: string) => Promise<NimiRuntimeModelAssetRecord>;
  readonly updateLoadout: (next: NimiPrepareLoadoutInput) => Promise<unknown>;
}): Promise<void> {
  const installedAssets: NimiRuntimeModelAssetRecord[] = [];
  for (const item of input.items) {
    if (item.installed) {
      const installed = input.assets.find((asset) => asset.contentId === item.contentId);
      if (installed) installedAssets.push(installed);
      continue;
    }
    if (!item.variantId) throw new Error(`${item.displayLabel}: recommended catalog variant is unavailable.`);
    installedAssets.push(await input.installCatalogAsset(item.variantId));
  }
  if (!input.loadout) return;
  const nextAssets = [...input.assets, ...installedAssets.filter((installed) => (
    !input.assets.some((asset) => asset.modelAssetId === installed.modelAssetId)
  ))];
  await input.updateLoadout({
    loadoutId: input.loadout.loadoutId,
    capabilityContract: input.loadout.capabilityContract,
    recipeId: input.loadout.recipeId,
    options: input.loadout.options,
    supportedFeatures: input.loadout.supportedFeatures,
    displayName: input.loadout.displayName,
    modelAxes: runtimeConfigRecommendedLoadoutModelAxes(input.loadout, input.recipe, nextAssets),
    provenance: input.loadout.provenance,
  });
}

type RecommendedInstallMessageLabels = {
  readonly heading: string;
  readonly installed: string;
  readonly download: string;
  readonly total: string;
  readonly unknownSize: string;
};

export function recommendedInstallMessage(
  items: readonly RecommendedInstallItem[],
  labels: RecommendedInstallMessageLabels,
): string {
  const missing = items.filter((item) => !item.installed);
  const total = missing.length === 0
    ? 0
    : missing.every((item) => knownDownloadSize(item.descriptor?.totalSizeBytes) !== null)
      ? missing.reduce((sum, item) => sum + (knownDownloadSize(item.descriptor?.totalSizeBytes) ?? 0), 0)
      : null;
  return [
    labels.heading,
    ...items.map((item) => `${item.displayLabel}: ${item.descriptor?.title ?? item.variantId} · ${formatDownloadBytes(knownDownloadSize(item.descriptor?.totalSizeBytes), labels.unknownSize)} · ${item.installed ? labels.installed : labels.download}`),
    `${labels.total}: ${formatDownloadBytes(total, labels.unknownSize)}`,
  ].join('\n');
}

function knownDownloadSize(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function formatDownloadBytes(value: number | null, unknownSize: string): string {
  if (value === null) return unknownSize;
  if (value === 0) return '0 B';
  return formatBytes(value);
}

export function loadoutCapabilityLabelKey(capabilityContract: string): string {
  switch (capabilityContract) {
    case 'text.generate': return 'runtimeConfig.loadouts.capability.textGenerate';
    case 'text.embed': return 'runtimeConfig.loadouts.capability.textEmbed';
    case 'image.generate': return 'runtimeConfig.loadouts.capability.imageGenerate';
    case 'audio.synthesize': return 'runtimeConfig.loadouts.capability.audioSynthesize';
    case 'audio.transcribe': return 'runtimeConfig.loadouts.capability.audioTranscribe';
    case 'voice.create': return 'runtimeConfig.loadouts.capability.voiceCreate';
    case 'video.generate': return 'runtimeConfig.loadouts.capability.videoGenerate';
    default: return 'runtimeConfig.loadouts.capability.other';
  }
}

export function loadoutAssetLabel(
  asset: NimiRuntimeModelAssetRecord,
  verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): string {
  const catalogTitle = verifiedAssets.find((item) => item.contentId === asset.contentId)?.title?.trim();
  return catalogTitle || asset.displayName.trim() || asset.entry.trim() || asset.modelAssetId;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function runtimeConfigLoadoutErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const reasonCode = isNimiError(error) ? error.reasonCode : '';
  if (!reasonCode || message.includes(reasonCode)) return message;
  return `${reasonCode}: ${message}`;
}

function errorMessage(error: unknown): string {
  return runtimeConfigLoadoutErrorMessage(error);
}

function isSelected(aggregate: NimiMachineLoadouts | null, loadout: NimiMachineLoadout): boolean {
  return aggregate?.selections.some((selection) => selection.capabilityContract === loadout.capabilityContract && selection.loadoutId === loadout.loadoutId) === true;
}
