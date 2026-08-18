// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractNimiRuntimeReasonCodeFromError } from '@nimiplatform/sdk/runtime';
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
import { RuntimePageShell } from './runtime-config-page-shell.js';

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
};

export function LoadoutsPage() {
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
  const [recipeId, setRecipeId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [createAxes, setCreateAxes] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, EditDraft>>({});
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
      setRecipeId((current) => current || nextRecipes[0]?.recipeId || '');
    } catch (error) {
      setTechnicalError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadoutsClient, modelAssetsClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedRecipe = recipes.find((recipe) => recipe.recipeId === recipeId);
  const recommendations = useMemo(
    () => selectedRecipe ? recommendedInstallItems(selectedRecipe, assets, verifiedAssets) : [],
    [assets, selectedRecipe, verifiedAssets],
  );
  const missingRecommendations = recommendations.filter((item) => !item.installed);

  const selectCreateRecipe = useCallback((recipe: NimiLoadoutRecipe | undefined) => {
    setRecipeId(recipe?.recipeId ?? '');
    setDisplayName(recipe?.title ?? '');
    setCreateAxes(recommendedAxisSelections(recipe, assets));
  }, [assets]);

  const beginCreate = useCallback(() => {
    selectCreateRecipe(recipes[0]);
    setShowCreate(true);
  }, [recipes, selectCreateRecipe]);

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
    void run('create', async () => {
      const modelAxes = selectedRecipe.slots.flatMap((slot) => {
        const modelAsset = assets.find((asset) => asset.modelAssetId === createAxes[slot.slotId]);
        return modelAsset ? [{ slotId: slot.slotId, modelAssetId: modelAsset.modelAssetId, expectedContentId: modelAsset.contentId }] : [];
      });
      const prepared = await loadoutsClient.prepare({
        capabilityContract: selectedRecipe.capabilityContract,
        recipeId: selectedRecipe.recipeId,
        options: selectedRecipe.defaultOptions,
        supportedFeatures: selectedRecipe.supportedFeatures,
        displayName: displayName.trim(),
        modelAxes,
      });
      await loadoutsClient.commit(prepared.prepareId, false);
      setShowCreate(false);
    });
  }, [assets, createAxes, displayName, loadoutsClient, run, selectedRecipe]);

  const requestRecommendedInstallForRecipe = useCallback((recipe: NimiLoadoutRecipe) => {
    const items = recommendedInstallItems(recipe, assets, verifiedAssets);
    if (!items.some((item) => !item.installed)) return;
    setPendingInstall({ recipe, items });
  }, [assets, verifiedAssets]);

  const requestRecommendedInstall = useCallback(() => {
    if (!selectedRecipe || missingRecommendations.length === 0) return;
    requestRecommendedInstallForRecipe(selectedRecipe);
  }, [missingRecommendations.length, requestRecommendedInstallForRecipe, selectedRecipe]);

  const confirmRecommendedInstall = useCallback(() => {
    const pending = pendingInstall;
    if (!pending) return;
    setPendingInstall(null);
    void run(`install:${pending.recipe.recipeId}`, async () => {
      for (const item of pending.items) {
        if (item.installed) continue;
        if (!item.variantId) throw new Error(`${item.displayLabel}: recommended catalog variant is unavailable.`);
        await installRuntimeConfigCatalogAsset(modelAssetsClient, item.variantId);
      }
    });
  }, [modelAssetsClient, pendingInstall, run]);

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

  return (
    <RuntimePageShell>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold">{t('runtimeConfig.loadouts.title')}</h2><p className="mt-1 max-w-3xl text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.description')}</p></div>
        <Button size="sm" tone="primary" onClick={beginCreate}>{t('runtimeConfig.loadouts.create')}</Button>
      </header>
      {technicalError ? <InlineAlert tone="danger">{technicalError}</InlineAlert> : null}
      {loading ? <LoadingSkeleton lines={5} /> : aggregate && aggregate.loadouts.length > 0 ? (
        <div className="grid gap-4" data-testid="machine-loadouts-list">
          {aggregate.loadouts.map((loadout) => (
            <LoadoutCard
              key={loadout.loadoutId}
              loadout={loadout}
              recipe={recipes.find((recipe) => recipe.recipeId === loadout.recipeId)}
              assets={assets}
              verifiedAssets={verifiedAssets}
              selected={isSelected(aggregate, loadout)}
              busy={Boolean(busy)}
              draft={edits[loadout.loadoutId] ?? { modelAssetIds: modelAssetIdsForLoadout(loadout), displayName: loadout.displayName }}
              axisErrors={axisErrors}
              candidateErrors={candidateErrors}
              onDraft={(draft) => setEdits((current) => ({ ...current, [loadout.loadoutId]: draft }))}
              onSelect={() => requestSelect(loadout)}
              onClear={() => requestClear(loadout)}
              onUpdate={(slotId, modelAssetId) => requestUpdate(loadout, slotId, modelAssetId)}
              onInstallRecommended={(recipe) => requestRecommendedInstallForRecipe(recipe)}
              onDelete={() => requestDelete(loadout)}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={t('runtimeConfig.loadouts.empty')} description={t('runtimeConfig.loadouts.emptyBody')} action={<Button size="sm" tone="primary" onClick={beginCreate}>{t('runtimeConfig.loadouts.create')}</Button>} />
      )}

      <OverlayShell open={showCreate} kind="drawer" size="M" title={t('runtimeConfig.loadouts.create')} onClose={() => setShowCreate(false)}>
        <div className="grid gap-4 py-2" data-testid="create-loadout-form">
          <label className="grid gap-1 text-sm"><span>{t('runtimeConfig.loadouts.name')}</span><TextField value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label>
          <div className="grid gap-1 text-sm"><span>{t('runtimeConfig.loadouts.recipe')}</span><SelectField value={recipeId} options={recipes.map((recipe) => ({ value: recipe.recipeId, label: `${recipe.title} · ${recipe.capabilityContract}` }))} onValueChange={(value) => selectCreateRecipe(recipes.find((recipe) => recipe.recipeId === value))} contentLayer="dialog" /></div>
          {selectedRecipe?.slots.map((slot) => (
            <div key={slot.slotId} className="grid gap-1 text-sm">
              <span>{slot.displayLabel}</span>
              <SelectField
                value={createAxes[slot.slotId] ?? ''}
                options={[{ value: '', label: t('runtimeConfig.loadouts.unresolved') }, ...assets.map((asset) => ({ value: asset.modelAssetId, label: asset.displayName }))]}
                onValueChange={(modelAssetId) => setCreateAxes((current) => ({ ...current, [slot.slotId]: modelAssetId }))}
                contentLayer="dialog"
              />
            </div>
          ))}
          {selectedRecipe && recommendations.length > 0 ? (
            <Surface tone="card" className="grid gap-2 p-3" data-testid="recommended-loadout-combination">
              <div className="text-sm font-medium">{t('runtimeConfig.loadouts.recommendedCombination')}</div>
              {recommendations.map((item) => (
                <div key={item.slotId} className="flex items-center justify-between gap-3 text-xs">
                  <span>{item.displayLabel} · {item.descriptor?.title ?? item.variantId}</span>
                  <span>{formatBytes(item.descriptor?.totalSizeBytes ?? 0)} · {item.installed ? t('runtimeConfig.loadouts.installed') : t('runtimeConfig.loadouts.downloadRequired')}</span>
                </div>
              ))}
              {missingRecommendations.length > 0 ? <Button size="sm" tone="secondary" disabled={Boolean(busy)} onClick={requestRecommendedInstall}>{t('runtimeConfig.loadouts.installRecommended')}</Button> : null}
            </Surface>
          ) : null}
          <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.noAutoDownload')}</p>
          <div className="flex justify-end gap-2"><Button size="sm" tone="ghost" onClick={() => setShowCreate(false)}>{t('runtimeConfig.loadouts.cancel')}</Button><Button size="sm" tone="primary" loading={busy === 'create'} disabled={!selectedRecipe || !displayName.trim()} onClick={create}>{t('runtimeConfig.loadouts.commit')}</Button></div>
        </div>
      </OverlayShell>

      <ConfirmDialog
        open={pendingInstall !== null}
        title={t('runtimeConfig.loadouts.installRecommendedTitle')}
        message={recommendedInstallMessage(pendingInstall?.items ?? [], t('runtimeConfig.loadouts.installRecommendedBody'))}
        confirmLabel={t('runtimeConfig.loadouts.installRecommendedConfirm')}
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
  readonly draft: EditDraft;
  readonly axisErrors: Readonly<Record<string, string>>;
  readonly candidateErrors: Readonly<Record<string, string>>;
  readonly onDraft: (draft: EditDraft) => void;
  readonly onSelect: () => void;
  readonly onClear: () => void;
  readonly onUpdate: (slotId: string, modelAssetId: string) => void;
  readonly onInstallRecommended: (recipe: NimiLoadoutRecipe) => void;
  readonly onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tone = props.loadout.validationState === 'configured' ? 'success' : props.loadout.validationState === 'blocked' ? 'danger' : 'warning';
  const recoveryRecommendations = props.recipe
    ? recommendedInstallItems(props.recipe, props.assets, props.verifiedAssets)
    : [];
  const canInstallRecommended = props.loadout.validationState !== 'configured'
    && recoveryRecommendations.some((item) => !item.installed);
  return (
    <Surface tone="card" className="grid gap-4 p-5" data-testid={`machine-loadout:${props.loadout.loadoutId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap gap-2"><h4 className="font-semibold">{props.loadout.displayName}</h4><StatusBadge tone={tone} shape="soft">{t(`runtimeConfig.loadouts.state.${props.loadout.validationState}`)}</StatusBadge>{props.selected ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.selected')}</StatusBadge> : null}</div><p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{props.loadout.capabilityContract} · {props.loadout.recipeId}@{props.loadout.recipeRevision} · {props.loadout.implementation.driverDialect}</p></div>
        <div className="flex gap-2">
          {props.selected ? <Button size="sm" tone="ghost" disabled={props.busy} onClick={props.onClear}>{t('runtimeConfig.loadouts.clear')}</Button> : <Button size="sm" tone="primary" disabled={props.busy || props.loadout.validationState !== 'configured'} onClick={props.onSelect}>{t('runtimeConfig.loadouts.select')}</Button>}
          {canInstallRecommended && props.recipe ? <Button data-testid={`loadout-install-recommended:${props.loadout.loadoutId}`} size="sm" tone="secondary" disabled={props.busy} onClick={() => props.onInstallRecommended(props.recipe!)}>{t('runtimeConfig.loadouts.installRecommended')}</Button> : null}
          <Button size="sm" tone="danger" disabled={props.busy} onClick={props.onDelete}>{t('runtimeConfig.loadouts.delete')}</Button>
        </div>
      </div>
      <div className="grid gap-3">
        {props.loadout.modelAxes.map((axis) => {
          const asset = props.assets.find((item) => item.modelAssetId === axis.modelAssetId);
          const slot = props.recipe?.slots.find((item) => item.slotId === axis.slotId);
          const custom = Boolean(asset && slot && !slot.recommendedContentIds.includes(asset.contentId));
          const catalogBadge = runtimeConfigLoadoutCatalogBadge(asset?.catalogVerification);
          const error = props.axisErrors[`${props.loadout.loadoutId}:${axis.slotId}`];
          return (
            <div key={axis.slotId} className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3 md:grid-cols-[1fr_1.5fr] md:items-end">
              <div><div className="flex items-center gap-2 text-sm font-medium"><span>{axis.displayLabel}</span>{custom ? <StatusBadge tone="info" shape="soft">custom</StatusBadge> : null}</div><div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{asset?.displayName || axis.modelAssetId || t('runtimeConfig.loadouts.unresolved')}</div><div className="mt-2 flex flex-wrap gap-1"><StatusBadge tone={asset?.contentVerified ? 'success' : 'warning'} shape="soft">content_verified</StatusBadge><StatusBadge tone={catalogBadge.tone} shape="soft">{t(`runtimeConfig.loadouts.catalogBadge.${catalogBadge.label}`)}</StatusBadge><StatusBadge tone={axis.recipeCompatible ? 'success' : 'warning'} shape="soft">recipe_compatible</StatusBadge></div>{error ? <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{t('runtimeConfig.loadouts.incompatibleReason')}: {error}</p> : null}</div>
              <SelectField value={props.draft.modelAssetIds[axis.slotId] ?? ''} options={props.assets.map((item) => { const incompatibility = props.candidateErrors[`${props.loadout.loadoutId}:${axis.slotId}:${item.modelAssetId}`]; return { value: item.modelAssetId, label: incompatibility ? `${item.displayName} · ${t('runtimeConfig.loadouts.incompatibleReason')}: ${incompatibility}` : item.displayName }; })} onValueChange={(modelAssetId) => { props.onDraft({ ...props.draft, modelAssetIds: { ...props.draft.modelAssetIds, [axis.slotId]: modelAssetId } }); props.onUpdate(axis.slotId, modelAssetId); }} disabled={props.busy} />
            </div>
          );
        })}
      </div>
      <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] px-3 py-2 text-xs text-[var(--nimi-text-muted)]" data-testid="loadout-execution-supply">
        <p>{t('runtimeConfig.loadouts.recipeCustody')}: {props.loadout.recipeCustody.length > 0 ? props.loadout.recipeCustody.map((item) => item.custodyId).join(', ') : t('runtimeConfig.loadouts.recipeCustodyEmpty')}</p>
        <p className="mt-1">{t('runtimeConfig.loadouts.executionSupply')}</p>
      </div>
      {props.loadout.reasons.length > 0 ? <p className="text-xs text-[var(--nimi-status-danger)]">{props.loadout.reasons.join(', ')}</p> : null}
    </Surface>
  );
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

export function recommendedInstallMessage(items: readonly RecommendedInstallItem[], heading: string): string {
  const missing = items.filter((item) => !item.installed);
  const total = missing.length === 0
    ? 0
    : missing.every((item) => knownDownloadSize(item.descriptor?.totalSizeBytes) !== null)
      ? missing.reduce((sum, item) => sum + (knownDownloadSize(item.descriptor?.totalSizeBytes) ?? 0), 0)
      : null;
  return [
    heading,
    ...items.map((item) => `${item.displayLabel}: ${item.descriptor?.title ?? item.variantId} · ${formatDownloadBytes(knownDownloadSize(item.descriptor?.totalSizeBytes))} · ${item.installed ? 'installed' : 'download'}`),
    `Total download: ${formatDownloadBytes(total)}`,
  ].join('\n');
}

function knownDownloadSize(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function formatDownloadBytes(value: number | null): string {
  if (value === null) return 'unknown size';
  if (value === 0) return '0 B';
  return formatBytes(value);
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
  const reasonCode = extractNimiRuntimeReasonCodeFromError(error);
  if (!reasonCode || message.includes(reasonCode)) return message;
  return `${reasonCode}: ${message}`;
}

function errorMessage(error: unknown): string {
  return runtimeConfigLoadoutErrorMessage(error);
}

function isSelected(aggregate: NimiMachineLoadouts | null, loadout: NimiMachineLoadout): boolean {
  return aggregate?.selections.some((selection) => selection.capabilityContract === loadout.capabilityContract && selection.loadoutId === loadout.loadoutId) === true;
}
