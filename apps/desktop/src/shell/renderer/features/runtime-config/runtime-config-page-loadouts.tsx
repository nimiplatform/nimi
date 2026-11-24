// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { isNimiError } from '@nimiplatform/sdk/types';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiMachineLoadouts,
  NimiPrepareLoadoutInput,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
  NimiTextBehaviorCapabilityProjection,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  OverlayShell,
  PillTabs,
  ScrollShell,
  SelectField,
  StatusBadge,
  Surface,
  TextField,
} from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { RuntimeConfigurationEnvironment } from './runtime-configuration-environment.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { runtimeConfigLoadoutCatalogBadge } from './runtime-config-loadout-catalog-badge.js';
import {
  createRuntimeConfigLoadoutImpactState,
  type RuntimeConfigLoadoutPendingImpact,
} from './runtime-config-loadout-impact-state.js';
import {
  deriveLoadoutDefaultDisplayName,
  LOADOUT_DISPLAY_NAME_SOURCE_PROVENANCE_KEY,
  loadoutAssetLabel,
  loadoutDisplayNameSource,
  loadoutSlotLabelKey,
  partitionSlotCandidateAssets,
  patchLoadoutTextContextOption,
  resolvePrimaryRecipeSlot,
  runtimeConfigLoadoutCandidateAssets,
  supportsLlamaTextContextSize,
} from './runtime-config-loadout-model-display.js';
import {
  LoadoutSelectedModelCard,
  LoadoutSlotModelPicker,
} from './runtime-config-loadout-model-picker.js';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell.js';
import { localizedAssetUnhealthyReason } from './runtime-config-reason-messages.js';
import {
  checkExistingLoadoutEnvironment,
  commitExistingLoadoutSelection,
  invalidateDesktopLoadoutQueries,
} from './runtime-config-select-loadout.js';
import { RuntimeTextContextSizeField } from './runtime-config-text-context-field.js';
import { loadoutValidationMessages } from './runtime-loadout-validation.js';
import { configurationShortId } from './runtime-local-model-list.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
} from './runtime-config-panel-types.js';

export {
  loadoutAssetLabel,
  runtimeConfigLoadoutCandidateAssets,
} from './runtime-config-loadout-model-display.js';

type EditDraft = {
  readonly baseRevision: string;
  readonly displayName: string;
  readonly contextSize: string;
};

type RecipesLoadState = 'loading' | 'loaded' | 'error';

// SelectField drops empty-valued options (Radix Select reserves '' for the
// cleared state), so the "unresolved" choice uses a sentinel and maps back to
// '' (unset binding) at the change boundary.
const LOADOUT_UNSET_MODEL_OPTION_VALUE = '__loadout_unset_model__';
type RecommendedInstallItem = {
  readonly slotId: string;
  readonly displayLabel: string;
  readonly candidate: NimiLoadoutRecipe['slots'][number]['offers'][number]['candidate'];
  readonly installedModelAssetId?: string;
  readonly installed: boolean;
};
type PendingRecommendedInstall = {
  readonly recipe: NimiLoadoutRecipe;
  readonly items: readonly RecommendedInstallItem[];
  readonly loadout?: NimiMachineLoadout;
};
export function SavedConfigsView(props: {
  readonly contextual?: boolean;
  /** Open this exact saved configuration without selecting or changing it. */
  readonly initialLoadoutId?: string;
  /** Open the create-configuration drawer immediately on mount. */
  readonly initialCreate?: boolean;
  readonly backLabel?: string;
  readonly capabilityContract?: string;
  readonly navigationContext: RuntimeConfigLoadoutNavigationContext | null;
  readonly onBack: () => void;
  readonly environmentWritesDisabled?: boolean;
  readonly onPrepareEnvironment?: (loadout: NimiMachineLoadout) => void;
  readonly onOpenModelMarket: (context: RuntimeConfigModelMarketContext) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  const loadoutsClient = useMemo(() => sdk.machineProduct().local.loadouts, [sdk]);
  const modelAssetsClient = useRuntimeConfigLocalEnvironmentClient();
  const impactState = useMemo(() => createRuntimeConfigLoadoutImpactState(), []);
  const [aggregate, setAggregate] = useState<NimiMachineLoadouts | null>(null);
  const [recipes, setRecipes] = useState<readonly NimiLoadoutRecipe[]>([]);
  const [recipesLoadState, setRecipesLoadState] = useState<RecipesLoadState>('loading');
  const [assets, setAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [verifiedAssets, setVerifiedAssets] = useState<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [technicalError, setTechnicalError] = useState('');
  const [createFormError, setCreateFormError] = useState('');
  const [manageError, setManageError] = useState('');
  const [axisErrors, setAxisErrors] = useState<Record<string, string>>({});
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(Boolean(props.initialCreate));
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(props.initialCreate && props.capabilityContract ? 2 : 1);
  const [createCapability, setCreateCapability] = useState(props.initialCreate && props.capabilityContract ? props.capabilityContract : '');
  const [preselectedAssetId, setPreselectedAssetId] = useState('');
  const [preselectedNeedsManualSlot, setPreselectedNeedsManualSlot] = useState(false);
  const [recipeId, setRecipeId] = useState('');
  const [customDisplayName, setCustomDisplayName] = useState<string>();
  const [createAxes, setCreateAxes] = useState<Record<string, string>>({});
  const [createContextSize, setCreateContextSize] = useState('');
  const [createContextEdited, setCreateContextEdited] = useState(false);
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditDraft>>({});
  const [manageLoadoutId, setManageLoadoutId] = useState<string | null>(props.initialLoadoutId ?? null);
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
    setRecipesLoadState('loading');
    setTechnicalError('');
    try {
      const [aggResult, recipesResult, assetsResult, verifiedResult] = await Promise.allSettled([
        loadoutsClient.get(),
        loadoutsClient.listRecipes(),
        modelAssetsClient.listModelAssets(),
        modelAssetsClient.listVerifiedAssets(),
      ]);
      const errors: string[] = [];
      if (aggResult.status === 'fulfilled') {
        setAggregate(aggResult.value);
      } else {
        errors.push(errorMessage(aggResult.reason));
      }
      if (recipesResult.status === 'fulfilled') {
        setRecipes(recipesResult.value);
        setRecipesLoadState('loaded');
      } else {
        setRecipesLoadState('error');
        errors.push(errorMessage(recipesResult.reason));
      }
      if (assetsResult.status === 'fulfilled') {
        setAssets(assetsResult.value);
      } else {
        errors.push(errorMessage(assetsResult.reason));
      }
      if (verifiedResult.status === 'fulfilled') {
        setVerifiedAssets(verifiedResult.value);
      } else {
        errors.push(errorMessage(verifiedResult.reason));
      }
      if (errors.length > 0) {
        setTechnicalError(errors.join(' · '));
      }
    } finally {
      setLoading(false);
    }
  }, [loadoutsClient, modelAssetsClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshAIConfigProjections = useCallback(() => {
    void invalidateDesktopLoadoutQueries(queryClient);
  }, [queryClient]);

  const capabilities = useMemo(() => {
    const contracts: string[] = [];
    const append = (value: string) => {
      if (props.capabilityContract && value !== props.capabilityContract) return;
      if (value && !contracts.includes(value)) contracts.push(value);
    };
    for (const recipe of recipes) append(recipe.capabilityContract);
    for (const loadout of aggregate?.loadouts ?? []) append(loadout.capabilityContract);
    return contracts;
  }, [aggregate, recipes, props.capabilityContract]);

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
  const handledNavigationKeyRef = useRef('');

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
      const withSaved = capabilities.find((capability) => (
        (loadoutsByCapability.get(capability) ?? []).length > 0
      ));
      return withSelection ?? withSaved ?? capabilities[0] ?? '';
    });
  }, [aggregate, capabilities, loadoutsByCapability]);

  const activeCapabilityLoadouts = loadoutsByCapability.get(activeCapability) ?? [];
  const activeCapabilityRecipes = recipes.filter((recipe) => recipe.capabilityContract === activeCapability);
  const currentLoadouts = activeCapabilityLoadouts.filter((loadout) => isSelected(aggregate, loadout));
  const savedLoadouts = activeCapabilityLoadouts.filter((loadout) => !isSelected(aggregate, loadout));
  const {
    supported: recommendedRecipes,
    unknown: unknownRecipes,
    unsupported: unsupportedRecipes,
  } = partitionRuntimeConfigRecipeTemplates(activeCapabilityRecipes);

  const createCapabilities = useMemo(() => {
    const contracts: string[] = [];
    for (const recipe of recipes) {
      if (!contracts.includes(recipe.capabilityContract)) contracts.push(recipe.capabilityContract);
    }
    return contracts;
  }, [recipes]);

  const createCapabilityRecipes = useMemo(
    () => recipes
      .filter((recipe) => recipe.capabilityContract === createCapability)
      .sort((left, right) => recipeApplicabilityRank(left.applicability) - recipeApplicabilityRank(right.applicability)),
    [createCapability, recipes],
  );

  const selectedRecipe = recipes.find((recipe) => recipe.recipeId === recipeId);
  const recommendations = useMemo(
    () => selectedRecipe ? recommendedInstallItems(selectedRecipe, createAxes) : [],
    [createAxes, selectedRecipe],
  );
  const missingRecommendations = recommendations.filter((item) => !item.installed);
  const missingRequiredSlots = selectedRecipe?.slots.filter((slot) => (
    slot.presence === 'required' && !createAxes[slot.slotId]
  )) ?? [];

  const beginCreate = useCallback((capability?: string, nextPreselectedAssetId = '') => {
    setRecipeId('');
    setCustomDisplayName(undefined);
    setCreateAxes({});
    setCreateContextSize('');
    setCreateContextEdited(false);
    setCreateFormError('');
    setPreselectedAssetId(nextPreselectedAssetId);
    setPreselectedNeedsManualSlot(false);
    setPickerSlotId(null);
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
    setCustomDisplayName(undefined);
    setCreateAxes({});
    setCreateContextSize('');
    setCreateContextEdited(false);
    setCreateFormError('');
    setPreselectedNeedsManualSlot(false);
    setPickerSlotId(null);
    setCreateStep(2);
  }, []);

  const displayName = useMemo(() => {
    if (customDisplayName !== undefined) return customDisplayName;
    if (!selectedRecipe) return '';
    const axes = Object.entries(createAxes)
      .filter(([, assetId]) => Boolean(assetId))
      .map(([slotId, modelAssetId]) => ({ slotId, modelAssetId }));
    return deriveLoadoutDefaultDisplayName(selectedRecipe, axes, verifiedAssets, assets);
  }, [assets, createAxes, customDisplayName, selectedRecipe, verifiedAssets]);

  const selectCreateRecipe = useCallback((recipe: NimiLoadoutRecipe, explicitPreselectedAssetId?: string) => {
    setRecipeId(recipe.recipeId);
    setCreateCapability(recipe.capabilityContract);
    setCreateFormError('');
    const initialAxes = recommendedAxisSelections(recipe, assets);
    const activePreselectedId = explicitPreselectedAssetId ?? preselectedAssetId;
    let needsManualSlot = false;
    if (activePreselectedId) {
      const targetAsset = assets.find((asset) => asset.modelAssetId === activePreselectedId);
      if (targetAsset) {
        // Match exact slot recommendation/offer first so companion assets (e.g. text encoders)
        // never get stuffed into the primary diffusion/LLM slot.
        const exactMatchingSlots = recipe.slots.filter((slot) => (
          slot.recommendedContentIds.includes(targetAsset.contentId)
          || slot.offers.some((offer) => offer.installedModelAssetId === targetAsset.modelAssetId)
        ));
        if (exactMatchingSlots.length === 1) {
          initialAxes[exactMatchingSlots[0]!.slotId] = targetAsset.modelAssetId;
        } else if (exactMatchingSlots.length > 1) {
          needsManualSlot = true;
        } else {
          const primary = resolvePrimaryRecipeSlot(recipe);
          if (primary.kind === 'single') {
            const partitioned = partitionSlotCandidateAssets(primary.slot, [targetAsset], '');
            if (partitioned.recommended.length > 0 || partitioned.formatMatched.length > 0) {
              initialAxes[primary.slot.slotId] = targetAsset.modelAssetId;
            } else {
              needsManualSlot = true;
            }
          } else {
            needsManualSlot = true;
          }
        }
      } else {
        needsManualSlot = true;
        setCreateFormError(t('runtimeConfig.loadouts.missingAssetError'));
      }
    }
    setPreselectedNeedsManualSlot(needsManualSlot);
    setCreateAxes(initialAxes);
    setCustomDisplayName(undefined);
    setCreateContextSize(resolveLoadoutCreateContextOption(recipe, initialAxes));
    setCreateContextEdited(false);
    setPickerSlotId(null);
    setCreateStep(3);
    setShowCreate(true);
  }, [assets, preselectedAssetId, t]);

  useEffect(() => {
    const context = props.navigationContext;
    if (!context) return;
    const key = [
      context.capabilityContract,
      context.recipeId,
      context.recipeRevision,
      context.slotId,
      context.preselectedAssetId,
    ].join(':');
    if (handledNavigationKeyRef.current === key) return;
    if (context.capabilityContract) setActiveCapability(context.capabilityContract);
    if (!context.recipeId) {
      handledNavigationKeyRef.current = key;
      if (context.preselectedAssetId) {
        beginCreate(context.capabilityContract || undefined, context.preselectedAssetId);
      }
      return;
    }
    const recipe = recipes.find((item) => (
      item.recipeId === context.recipeId
      && (!context.recipeRevision || item.revision === context.recipeRevision)
    ));
    if (!recipe) return;
    handledNavigationKeyRef.current = key;
    if (context.draft) {
      setRecipeId(recipe.recipeId);
      setCreateCapability(recipe.capabilityContract);
      setCustomDisplayName(context.draft.customDisplayName);
      const returnedAxes = resolveLoadoutReturnedDraftAxes(recipe, context);
      setCreateAxes(returnedAxes);
      if (context.draft.contextSizeEdited) {
        setCreateContextSize(context.draft.contextSize ?? '');
        setCreateContextEdited(true);
      } else {
        setCreateContextSize(resolveLoadoutCreateContextOption(recipe, returnedAxes));
        setCreateContextEdited(false);
      }
      setCreateFormError('');
      setPickerSlotId(null);
      setCreateStep(3);
      setShowCreate(true);
    } else {
      selectCreateRecipe(recipe, context.preselectedAssetId);
    }
  }, [beginCreate, props.navigationContext, recipes, selectCreateRecipe]);

  const run = useCallback(async (key: string, action: () => Promise<void>, onError?: (message: string, cause: unknown) => void) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      await refresh();
      refreshAIConfigProjections();
      emitFeedbackToast({ kind: 'success', message: t('runtimeConfig.loadouts.saved') });
    } catch (error) {
      const message = errorMessage(error);
      if (onError) onError(message, error);
      else setTechnicalError(message);
    } finally {
      setBusy('');
    }
  }, [busy, refresh, refreshAIConfigProjections, t]);

  const createContextValidation = useMemo(() => (
    selectedRecipe && supportsLlamaTextContextSize(selectedRecipe)
      ? parseLoadoutCreateContextOption(createContextSize)
      : { valid: true as const }
  ), [createContextSize, selectedRecipe]);

  // @nimi-authority: rule.nimi.runtime.model-catalog.r036
  const create = useCallback(() => {
    if (!selectedRecipe || !displayName.trim() || !createContextValidation.valid || preselectedNeedsManualSlot) return;
    const recipe = selectedRecipe;
    const name = displayName.trim();
    const items = recommendations;
    // Validate that every explicitly selected modelAssetId still exists in inventory;
    // never silently skip a missing selected asset.
    for (const slot of recipe.slots) {
      const selectedAssetId = createAxes[slot.slotId];
      if (selectedAssetId && !assets.some((asset) => asset.modelAssetId === selectedAssetId)) {
        setCreateFormError(t('runtimeConfig.loadouts.missingAssetError'));
        return;
      }
    }
    setCreateFormError('');
    void run('create', async () => {
      const modelAxes = recipe.slots.flatMap((slot) => {
        const selectedAssetId = createAxes[slot.slotId];
        if (selectedAssetId) {
          const modelAsset = assets.find((asset) => asset.modelAssetId === selectedAssetId)!;
          return [{ slotId: slot.slotId, modelAssetId: modelAsset.modelAssetId, expectedContentId: modelAsset.contentId }];
        }
        if (slot.presence === 'required') {
          // Send explicit empty axis so Runtime preserves the unresolved choice instead of auto-prefilling.
          return [{ slotId: slot.slotId, modelAssetId: '', expectedContentId: '' }];
        }
        return [];
      });
      const prepared = await loadoutsClient.prepare({
        capabilityContract: recipe.capabilityContract,
        recipeId: recipe.recipeId,
        options: buildLoadoutCreateOptions(recipe, createContextSize),
        displayName: name,
        modelAxes,
        provenance: {
          [LOADOUT_DISPLAY_NAME_SOURCE_PROVENANCE_KEY]: customDisplayName === undefined ? 'auto' : 'user',
        },
      });
      const created = await loadoutsClient.commit(prepared.prepareId, false);
      setShowCreate(false);
      setPreselectedAssetId('');
      setPreselectedNeedsManualSlot(false);
      if (items.some((item) => !item.installed)) {
        setPendingInstall({ recipe, items, loadout: created });
      }
    }, (message, cause) => {
      const explanation = isNimiError(cause) && cause.reasonCode === 'AI_LOADOUT_MODEL_CONTRACT_FAILED'
        ? t('runtimeConfig.localModels.validation.incompatible')
        : t('runtimeConfig.loadouts.createFailed');
      setCreateFormError(`${explanation} (${message})`);
    });
  }, [assets, createAxes, createContextSize, createContextValidation.valid, customDisplayName, displayName, loadoutsClient, preselectedNeedsManualSlot, recommendations, run, selectedRecipe, t]);

  const requestRecommendedInstallForRecipe = useCallback((recipe: NimiLoadoutRecipe, loadout?: NimiMachineLoadout) => {
    const items = recommendedInstallItems(recipe, loadout ? modelAssetIdsForLoadout(loadout) : {});
    if (!items.some((item) => !item.installed)) return;
    setPendingInstall({ recipe, items, ...(loadout ? { loadout } : {}) });
  }, []);

  const confirmRecommendedInstall = useCallback(() => {
    const pending = pendingInstall;
    if (!pending) return;
    setPendingInstall(null);
    void run(`install:${pending.recipe.recipeId}`, async () => {
      await installAndBindRuntimeConfigRecommendedLoadout({
        ...pending,
        assets,
        verifiedAssets,
        installOffer: async (offerRef) => {
          const plan = await modelAssetsClient.resolveOfferInstallPlan(offerRef);
          const result = await modelAssetsClient.install(plan.planId, { caller: 'core' });
          return result.modelAsset;
        },
        updateLoadout: (next) => loadoutsClient.update(next, false),
      });
    });
  }, [assets, loadoutsClient, modelAssetsClient, pendingInstall, run, verifiedAssets]);

  const requestSelect = useCallback(async (loadout: NimiMachineLoadout) => {
    if (busy) return;
    setBusy(`select:${loadout.loadoutId}`);
    try {
      const { ready } = await checkExistingLoadoutEnvironment({
        loadout,
        resolveEnvironmentPlan: input => modelAssetsClient.resolveEnvironmentPlan(input),
      });
      if (!ready) {
        if (props.onPrepareEnvironment) props.onPrepareEnvironment(loadout);
        else setTechnicalError(t('runtimeConfig.setupTask.environmentUnavailable'));
        return;
      }
      requestImpact({
        kind: 'select',
        title: loadout.displayName,
        run: async () => {
          const result = await commitExistingLoadoutSelection({
            loadout,
            aggregate,
            selectLoadout: (cap, id, confirmed, conditions) => loadoutsClient.select(cap, id, confirmed, conditions),
            queryClient,
          });
          if (result.status !== 'selected') throw new Error(t('runtimeConfig.product.selectionConflict'));
        },
      });
    } catch (error) {
      setTechnicalError(errorMessage(error));
    } finally {
      setBusy('');
    }
  }, [aggregate, busy, loadoutsClient, modelAssetsClient, props.onPrepareEnvironment, queryClient, requestImpact, t]);

  const requestClear = useCallback((loadout: NimiMachineLoadout) => {
    requestImpact({
      kind: 'clear', title: loadout.displayName,
      run: async () => {
        const revision = aggregate?.selectionRevisions[loadout.capabilityContract];
        if (!revision) throw new Error(t('runtimeConfig.product.selectionConflict'));
        const result = await loadoutsClient.select(loadout.capabilityContract, null, true, { expectedSelectionRevision: revision });
        if (!result.applied) throw new Error(t('runtimeConfig.product.selectionConflict'));
      },
    });
  }, [aggregate, loadoutsClient, requestImpact, t]);

  const buildInitialEditDraft = useCallback((loadout: NimiMachineLoadout): EditDraft => ({
    baseRevision: loadout.revision,
    displayName: loadout.displayName,
    contextSize: typeof loadout.options?.contextSize === 'number' && Number.isFinite(loadout.options.contextSize)
      ? String(loadout.options.contextSize)
      : '',
  }), []);

  const advanceEditDraftRevision = useCallback((loadoutId: string, updated: NimiMachineLoadout) => {
    setEdits((current) => {
      const existing = current[loadoutId];
      if (!existing) return current;
      return {
        ...current,
        [loadoutId]: {
          ...existing,
          baseRevision: updated.revision,
        },
      };
    });
  }, []);

  const formatManageError = useCallback((message: string) => (
    /revision|conflict|stale|precondition/i.test(message)
      ? t('runtimeConfig.loadouts.revisionConflict')
      : message
  ), [t]);

  const requestUpdate = useCallback((loadout: NimiMachineLoadout, slotId: string, nextModelAssetId: string) => {
    const draft = edits[loadout.loadoutId] ?? buildInitialEditDraft(loadout);
    const committedAxes = modelAssetIdsForLoadout(loadout);
    const modelAxes = runtimeConfigLoadoutUpdateModelAxes(
      loadout,
      committedAxes,
      assets,
      slotId,
      nextModelAssetId,
    );
    const errorKey = `${loadout.loadoutId}:${slotId}`;
    const candidateErrorKey = `${errorKey}:${nextModelAssetId}`;
    const selected = isSelected(aggregate, loadout);
    const recipe = recipes.find((item) => item.recipeId === loadout.recipeId);
    const nextDisplayName = loadoutDisplayNameSource(loadout.provenance) === 'auto' && recipe
      ? deriveLoadoutDefaultDisplayName(
        recipe,
        (modelAxes ?? []).map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId ?? '', expectedContentId: axis.expectedContentId })),
        verifiedAssets,
        assets,
      )
      : loadout.displayName;
    const updateInput: NimiPrepareLoadoutInput = {
      loadoutId: loadout.loadoutId,
      capabilityContract: loadout.capabilityContract,
      recipeId: loadout.recipeId,
      options: loadout.options,
      displayName: nextDisplayName,
      modelAxes,
      provenance: loadout.provenance,
      ...(draft.baseRevision ? { expectedLoadoutRevision: draft.baseRevision } : {}),
    };
    setAxisErrors((current) => ({ ...current, [errorKey]: '' }));
    setManageError('');
    const action = async () => {
      const updated = await loadoutsClient.update(updateInput, selected);
      advanceEditDraftRevision(loadout.loadoutId, updated);
      if (loadoutDisplayNameSource(loadout.provenance) === 'auto') {
        setEdits((current) => {
          const existing = current[loadout.loadoutId];
          if (!existing || existing.displayName !== loadout.displayName) return current;
          return { ...current, [loadout.loadoutId]: { ...existing, baseRevision: updated.revision, displayName: updated.displayName } };
        });
      }
      setCandidateErrors((current) => {
        const next = { ...current };
        delete next[candidateErrorKey];
        return next;
      });
    };
    const onError = (message: string) => {
      const formatted = formatManageError(message);
      setManageError(formatted);
      setAxisErrors((current) => ({ ...current, [errorKey]: formatted }));
      setCandidateErrors((current) => ({ ...current, [candidateErrorKey]: formatted }));
    };
    if (selected) {
      requestImpact({ kind: 'update', title: loadout.displayName, run: action, onError });
    } else {
      void run(`update:${loadout.loadoutId}:${slotId}`, action, onError);
    }
  }, [advanceEditDraftRevision, aggregate, assets, buildInitialEditDraft, edits, formatManageError, loadoutsClient, recipes, requestImpact, run, verifiedAssets]);

  const requestRename = useCallback((loadout: NimiMachineLoadout) => {
    const draft = edits[loadout.loadoutId] ?? buildInitialEditDraft(loadout);
    const nextName = draft.displayName.trim();
    if (!nextName || nextName === loadout.displayName) return;
    const selected = isSelected(aggregate, loadout);
    const updateInput: NimiPrepareLoadoutInput = {
      loadoutId: loadout.loadoutId,
      capabilityContract: loadout.capabilityContract,
      recipeId: loadout.recipeId,
      options: loadout.options,
      displayName: nextName,
      // Always submit committed axes so a cancelled slot change can never leak into Rename.
      modelAxes: runtimeConfigLoadoutUpdateModelAxes(loadout, modelAssetIdsForLoadout(loadout), assets, '', ''),
      provenance: {
        ...loadout.provenance,
        [LOADOUT_DISPLAY_NAME_SOURCE_PROVENANCE_KEY]: 'user',
      },
      ...(draft.baseRevision ? { expectedLoadoutRevision: draft.baseRevision } : {}),
    };
    setManageError('');
    const action = async () => {
      const updated = await loadoutsClient.update(updateInput, selected);
      advanceEditDraftRevision(loadout.loadoutId, updated);
    };
    const onError = (message: string) => {
      setManageError(formatManageError(message));
    };
    if (selected) {
      requestImpact({ kind: 'update', title: loadout.displayName, run: action, onError });
    } else {
      void run(`rename:${loadout.loadoutId}`, action, onError);
    }
  }, [advanceEditDraftRevision, aggregate, assets, buildInitialEditDraft, edits, formatManageError, loadoutsClient, requestImpact, run]);

  const requestOptionsUpdate = useCallback((loadout: NimiMachineLoadout) => {
    const draft = edits[loadout.loadoutId] ?? buildInitialEditDraft(loadout);
    const patched = patchLoadoutTextContextOption(
      (loadout.options ?? {}) as NimiJsonObject,
      draft.contextSize,
    );
    if (!patched.valid) return;
    const selected = isSelected(aggregate, loadout);
    const updateInput: NimiPrepareLoadoutInput = {
      loadoutId: loadout.loadoutId,
      capabilityContract: loadout.capabilityContract,
      recipeId: loadout.recipeId,
      options: patched.options,
      displayName: loadout.displayName,
      modelAxes: runtimeConfigLoadoutUpdateModelAxes(loadout, modelAssetIdsForLoadout(loadout), assets, '', ''),
      provenance: loadout.provenance,
      ...(draft.baseRevision ? { expectedLoadoutRevision: draft.baseRevision } : {}),
    };
    setManageError('');
    const action = async () => {
      const updated = await loadoutsClient.update(updateInput, selected);
      advanceEditDraftRevision(loadout.loadoutId, updated);
    };
    const onError = (message: string) => {
      setManageError(formatManageError(message));
    };
    if (selected) {
      requestImpact({ kind: 'update', title: loadout.displayName, run: action, onError });
    } else {
      void run(`options:${loadout.loadoutId}`, action, onError);
    }
  }, [advanceEditDraftRevision, aggregate, assets, buildInitialEditDraft, edits, formatManageError, loadoutsClient, requestImpact, run]);

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
    ? edits[manageLoadout.loadoutId] ?? buildInitialEditDraft(manageLoadout)
    : null;
  const manageIsRetiredRecipe = Boolean(
    manageLoadout && recipesLoadState === 'loaded' && !manageRecipe && manageLoadout.validationState === 'blocked',
  );
  const manageSupportsContextSize = Boolean(manageRecipe && supportsLlamaTextContextSize(manageRecipe));
  const manageContextValidation = manageDraft && manageSupportsContextSize
    ? patchLoadoutTextContextOption({}, manageDraft.contextSize)
    : { valid: true as const };
  const manageContextChanged = Boolean(
    manageLoadout
    && manageDraft
    && manageSupportsContextSize
    && manageDraft.contextSize.trim() !== (
      typeof manageLoadout.options?.contextSize === 'number' && Number.isFinite(manageLoadout.options.contextSize)
        ? String(manageLoadout.options.contextSize)
        : ''
    ),
  );

  const capabilityLabel = useCallback((capabilityContract: string) => (
    t(loadoutCapabilityLabelKey(capabilityContract), { defaultValue: capabilityContract })
  ), [t]);
  const contextualCapabilityLabel = props.contextual && props.capabilityContract
    ? capabilityLabel(props.capabilityContract)
    : '';
  const contextualEmptyState = (targetCapability: string) => (
    <EmptyState
      data-testid={`loadout-capability-empty:${targetCapability}`}
      title={t('runtimeConfig.loadouts.contextualEmpty', {
        capability: capabilityLabel(targetCapability),
        defaultValue: 'No saved setups for {{capability}} yet',
      })}
      description={t('runtimeConfig.loadouts.contextualEmptyBody', {
        defaultValue: 'Return to on-device models to pick a ready-made model, or create a custom model setup here.',
      })}
      action={(
        <Button size="sm" tone="secondary" onClick={props.onBack}>
          {props.backLabel ?? t('runtimeConfig.product.backToCustomization')}
        </Button>
      )}
    />
  );

  return (
    <RuntimePageShell>
      <RuntimePageHeader
        title={contextualCapabilityLabel
          ? t('runtimeConfig.loadouts.contextualTitle', {
            capability: contextualCapabilityLabel,
            defaultValue: '{{capability}} · Saved configurations',
          })
          : t('runtimeConfig.aiSettings.savedConfigsTitle', { defaultValue: 'Saved configurations' })}
        description={contextualCapabilityLabel
          ? t('runtimeConfig.loadouts.contextualDescription', {
            capability: contextualCapabilityLabel,
            defaultValue: 'Create and manage local model setups for {{capability}}, and choose which setup is currently used.',
          })
          : t('runtimeConfig.loadouts.description')}
        actions={(
          <>
            <Button size="sm" tone="ghost" data-testid="saved-configs-back" onClick={props.onBack}>
              {props.backLabel ?? (props.contextual ? t('runtimeConfig.product.backToCustomization') : t('runtimeConfig.aiSettings.savedConfigsBack', { defaultValue: 'Back to AI Settings' }))}
            </Button>
            <Button size="sm" tone="primary" onClick={() => beginCreate(activeCapability || props.capabilityContract || undefined)}>{t('runtimeConfig.loadouts.create')}</Button>
          </>
        )}
      />
      {recipesLoadState === 'error' ? (
        <InlineAlert tone="warning" data-testid="loadouts-recipes-load-failed">
          <p>{t('runtimeConfig.loadouts.recipesLoadFailedHint')}</p>
          <Button size="sm" className="mt-2" loading={loading} disabled={Boolean(busy)} onClick={() => { void refresh(); }}>
            {t('Common.retry', { defaultValue: 'Retry' })}
          </Button>
        </InlineAlert>
      ) : null}
      {technicalError ? (
        <InlineAlert tone="danger">
          <p>{t('runtimeConfig.loadouts.loadFailed')}</p>
          <Button size="sm" className="mt-2" loading={loading} disabled={Boolean(busy)} onClick={() => { void refresh(); }}>
            {t('Common.retry', { defaultValue: 'Retry' })}
          </Button>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
            <p className="mt-2 break-all">{technicalError}</p>
          </details>
        </InlineAlert>
      ) : null}
      {!loading && !technicalError && props.initialLoadoutId && !aggregate?.loadouts.some((item) => item.loadoutId === props.initialLoadoutId) ? (
        <InlineAlert tone="warning">{t('runtimeConfig.localModels.configurationMissing')}</InlineAlert>
      ) : null}
      {loading ? <LoadingSkeleton lines={5} label={t('Common.loading', { defaultValue: 'Loading…' })} /> : capabilities.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-4" data-testid="machine-loadouts-list">
          {!props.contextual ? <div className="min-w-0 overflow-x-auto py-1" data-testid="loadout-capability-tabs-scroll">
            <PillTabs
              className="w-max"
              size="sm"
              ariaLabel={t('runtimeConfig.aiSettings.savedConfigsTitle', { defaultValue: 'Saved configurations' })}
              items={capabilities.map((capability) => ({
                value: capability,
                label: `${capabilityLabel(capability)} (${(loadoutsByCapability.get(capability) ?? []).length})`,
              }))}
              value={activeCapability}
              onValueChange={(value) => setActiveCapability(value)}
            />
          </div> : null}
          {activeCapability ? (
            <section className="grid min-w-0 grid-cols-1 gap-3" data-testid={`loadout-capability:${activeCapability}`}>
              <LoadoutGroup
                title={t('runtimeConfig.loadouts.currentTitle', { defaultValue: 'Current' })}
                loadouts={currentLoadouts}
                aggregate={aggregate}
                recipes={recipes}
                recipesLoadState={recipesLoadState}
                assets={assets}
                verifiedAssets={verifiedAssets}
                busy={Boolean(busy)}
                onSelect={requestSelect}
                onClear={requestClear}
                onInstallRecommended={requestRecommendedInstallForRecipe}
                onCreateReplacement={(loadout) => beginCreate(loadout.capabilityContract)}
                onDelete={requestDelete}
                onManage={(loadout) => {
                  setManageError('');
                  setManageLoadoutId(loadout.loadoutId);
                }}
              />
              {!props.contextual ? <RecipeTemplateGroup
                title={t('runtimeConfig.loadouts.recommendedTemplates', { defaultValue: 'Recommended plans' })}
                recipes={recommendedRecipes}
                emptyLabel={t('runtimeConfig.loadouts.noRecommendedTemplates', { defaultValue: 'No supported plan is currently recommended.' })}
                onOpen={selectCreateRecipe}
              /> : null}
              {!props.contextual && unknownRecipes.length > 0 ? (
                <CollapsibleRecipeSection
                  title={t('runtimeConfig.loadouts.unknownTemplates', { defaultValue: 'Needs host information' })}
                  count={unknownRecipes.length}
                >
                  <RecipeTemplateGroup
                    recipes={unknownRecipes}
                    onOpen={selectCreateRecipe}
                  />
                </CollapsibleRecipeSection>
              ) : null}
              {!props.contextual && unsupportedRecipes.length > 0 ? (
                <CollapsibleRecipeSection
                  title={t('runtimeConfig.loadouts.unsupportedTemplates', { defaultValue: "Plans this device can't run" })}
                  count={unsupportedRecipes.length}
                >
                  <RecipeTemplateGroup
                    recipes={unsupportedRecipes}
                    onOpen={selectCreateRecipe}
                  />
                </CollapsibleRecipeSection>
              ) : null}
              <LoadoutGroup
                title={t('runtimeConfig.loadouts.savedTitle', { defaultValue: 'Saved Loadouts' })}
                loadouts={savedLoadouts}
                aggregate={aggregate}
                recipes={recipes}
                recipesLoadState={recipesLoadState}
                assets={assets}
                verifiedAssets={verifiedAssets}
                busy={Boolean(busy)}
                onSelect={requestSelect}
                onClear={requestClear}
                onInstallRecommended={requestRecommendedInstallForRecipe}
                onCreateReplacement={(loadout) => beginCreate(loadout.capabilityContract)}
                onDelete={requestDelete}
                onManage={(loadout) => {
                  setManageError('');
                  setManageLoadoutId(loadout.loadoutId);
                }}
              />
              {activeCapabilityLoadouts.length === 0 && props.contextual ? (
                contextualEmptyState(activeCapability)
              ) : activeCapabilityLoadouts.length === 0 && activeCapabilityRecipes.length === 0 ? (
                <Surface tone="card" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid={`loadout-capability-empty:${activeCapability}`}>
                  <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.sectionEmpty')}</span>
                </Surface>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : props.contextual && props.capabilityContract ? (
        contextualEmptyState(props.capabilityContract)
      ) : (
        <EmptyState title={t('runtimeConfig.loadouts.empty')} description={t('runtimeConfig.loadouts.emptyBody')} action={<Button size="sm" tone="primary" onClick={() => beginCreate()}>{t('runtimeConfig.loadouts.create')}</Button>} />
      )}

      <OverlayShell
        open={showCreate}
        kind="drawer"
        size="M"
        title={t('runtimeConfig.loadouts.create')}
        onClose={() => setShowCreate(false)}
        panelClassName="flex max-h-screen flex-col overflow-hidden"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-0 py-0"
        footer={(
          <div className="flex items-center justify-between gap-2">
            <div>{createStep > 1 ? <Button size="sm" tone="ghost" onClick={() => setCreateStep((current) => (current === 3 ? 2 : 1))}>{t('runtimeConfig.loadouts.back')}</Button> : null}</div>
            <div className="flex gap-2">
              <Button size="sm" tone="ghost" onClick={() => setShowCreate(false)}>{t('runtimeConfig.loadouts.cancel')}</Button>
              {createStep === 3 ? (
                <Button
                  size="sm"
                  tone="primary"
                  loading={busy === 'create'}
                  disabled={!selectedRecipe || !displayName.trim() || !createContextValidation.valid || preselectedNeedsManualSlot}
                  onClick={create}
                >
                  {missingRecommendations.length > 0 ? t('runtimeConfig.loadouts.commitDownload') : t('runtimeConfig.loadouts.commit')}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      >
        <ScrollShell className="flex-1 px-6 py-2">
          <div className="grid gap-4 py-2" data-testid="create-loadout-form">
            <CreateLoadoutStepIndicator step={createStep} />

            {createStep === 1 ? (
              <div className="grid gap-2">
                <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.createCapabilityHint')}</p>
                {createCapabilities.map((capability) => {
                  const recipeCount = recipes.filter((recipe) => recipe.capabilityContract === capability).length;
                  return (
                    <button
                      key={capability}
                      type="button"
                      data-testid={`create-capability:${capability}`}
                      onClick={() => selectCreateCapability(capability)}
                      className="group flex items-center gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-left transition hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)]"
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{capabilityLabel(capability)}</span>
                        <span className="text-xs text-[var(--nimi-text-muted)]">{t(loadoutCapabilityDescriptionKey(capability))}</span>
                      </span>
                      <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.capabilityTemplates', { count: recipeCount })}</span>
                      <span aria-hidden="true" className="shrink-0 text-[var(--nimi-text-muted)] transition group-hover:text-[var(--nimi-action-primary-bg)]">›</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {createStep === 2 ? (
              <div className="grid gap-2">
                <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.loadouts.createRecipeHint', { capability: capabilityLabel(createCapability) })}</p>
                {createCapabilityRecipes.map((recipe) => {
                  const installedCount = recipe.slots.filter((slot) => (
                    slot.offers.some((offer) => Boolean(offer.installedModelAssetId))
                  )).length;
                  const estimate = summarizeRuntimeConfigRecipeDownloads(recipe);
                  const supported = recipe.applicability === 'supported';
                  return (
                    <button
                      key={recipe.recipeId}
                      type="button"
                      data-testid={`create-recipe:${recipe.recipeId}`}
                      onClick={() => selectCreateRecipe(recipe)}
                      className="group grid gap-1.5 rounded-xl border border-[var(--nimi-border-subtle)] px-4 py-3 text-left transition hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)]"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{recipe.title}</span>
                          <StatusBadge tone={supported ? 'success' : 'warning'} shape="soft">
                            {t(`runtimeConfig.loadouts.hostFit.${recipe.applicability}`, { defaultValue: recipe.applicability })}
                          </StatusBadge>
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-[var(--nimi-text-muted)] transition group-hover:text-[var(--nimi-action-primary-bg)]">›</span>
                      </span>
                      <span className="text-xs text-[var(--nimi-text-muted)]">
                        {!recipe.slots.some((slot) => slot.offers.length > 0)
                          ? t('runtimeConfig.loadouts.recipeManualModels')
                          : (
                            <>
                              {t('runtimeConfig.loadouts.recipeSummary', { slots: recipe.slots.length, installed: installedCount })}
                              {' · '}
                              {estimate.count === 0
                                ? t('runtimeConfig.loadouts.recipeReady', { defaultValue: 'All required models are installed' })
                                : estimate.totalSizeBytes === null
                                  ? t('runtimeConfig.loadouts.recommendedDownloadUnknown', { count: estimate.count, defaultValue: '{{count}} model(s) to download · size unknown' })
                                  : t('runtimeConfig.loadouts.recommendedDownloadKnown', { count: estimate.count, size: formatBytes(estimate.totalSizeBytes), defaultValue: '{{count}} model(s) to download · ~{{size}}' })}
                            </>
                          )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {createStep === 3 && selectedRecipe ? (
              <>
                {preselectedNeedsManualSlot ? (
                  <InlineAlert tone="info" data-testid="create-loadout-preselected-hint">
                    <p>{t('runtimeConfig.loadouts.preselectedSlotHint')}</p>
                  </InlineAlert>
                ) : null}
                {createFormError ? (
                  <InlineAlert tone="danger" data-testid="create-loadout-form-error">
                    <p>{createFormError}</p>
                  </InlineAlert>
                ) : null}
                <label className="grid gap-1 text-sm">
                  <span>{t('runtimeConfig.loadouts.name')}</span>
                  <TextField
                    value={displayName}
                    onChange={(event) => setCustomDisplayName(event.currentTarget.value)}
                  />
                </label>
                {selectedRecipe.slots.map((slot) => (
                  <div
                    key={slot.slotId}
                    data-testid={`recipe-slot:${selectedRecipe.recipeId}:${slot.slotId}`}
                    className={`grid gap-2 rounded-lg p-2 text-sm ${props.navigationContext?.slotId === slot.slotId
                      ? 'ring-2 ring-[var(--nimi-action-primary-bg)]'
                      : ''}`}
                  >
                    <LoadoutSlotLabel slot={slot} />
                    <LoadoutSelectedModelCard
                      slot={slot}
                      asset={assets.find((asset) => asset.modelAssetId === createAxes[slot.slotId]) ?? null}
                      verifiedAssets={verifiedAssets}
                      onOpenPicker={() => setPickerSlotId(slot.slotId)}
                    />
                  </div>
                ))}
                <LoadoutSlotModelPicker
                  key={pickerSlotId ?? 'closed'}
                  slot={selectedRecipe.slots.find((slot) => slot.slotId === pickerSlotId) ?? null}
                  assets={assets}
                  verifiedAssets={verifiedAssets}
                  selectedAssetId={pickerSlotId ? createAxes[pickerSlotId] ?? '' : ''}
                  onSelect={(modelAssetId) => {
                    if (!pickerSlotId) return;
                    setCreateFormError('');
                    setPreselectedNeedsManualSlot(false);
                    setCreateAxes((current) => {
                      const next = { ...current, [pickerSlotId]: modelAssetId };
                      if (!createContextEdited && selectedRecipe) {
                        setCreateContextSize(resolveLoadoutCreateContextOption(selectedRecipe, next));
                      }
                      return next;
                    });
                  }}
                  onOpenOffer={(offer) => {
                    const slot = selectedRecipe.slots.find((item) => item.slotId === pickerSlotId);
                    if (!slot) return;
                    props.onOpenModelMarket({
                      kind: 'slot',
                      capabilityContract: selectedRecipe.capabilityContract,
                      recipeId: selectedRecipe.recipeId,
                      recipeRevision: selectedRecipe.revision,
                      slotId: slot.slotId,
                      candidate: offer.candidate,
                      draft: {
                        customDisplayName,
                        modelAssetIds: { ...createAxes },
                        contextSize: createContextSize,
                        contextSizeEdited: createContextEdited,
                      },
                    });
                  }}
                  onClose={() => setPickerSlotId(null)}
                />
                {supportsLlamaTextContextSize(selectedRecipe) ? (
                  <label className="grid gap-1 text-sm">
                    <span>{t('runtimeConfig.loadouts.contextSize')}</span>
                    <TextField
                      data-testid="create-loadout-context-size"
                      inputMode="numeric"
                      placeholder={t('runtimeConfig.loadouts.contextSizeAuto')}
                      value={createContextSize}
                      onChange={(event) => {
                        setCreateContextEdited(true);
                        setCreateContextSize(event.currentTarget.value);
                      }}
                    />
                    {!createContextValidation.valid ? (
                      <span
                        data-testid="create-loadout-context-size-error"
                        className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger)]"
                      >
                        {t('runtimeConfig.loadouts.contextSizeInvalid')}
                      </span>
                    ) : (
                      <span className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                        {t('runtimeConfig.loadouts.contextSizeHint')}
                      </span>
                    )}
                  </label>
                ) : null}
                {missingRequiredSlots.length > 0 ? (
                  <InlineAlert tone="warning">
                    <p>{t('runtimeConfig.loadouts.missingSlots', {
                      count: missingRequiredSlots.length,
                      defaultValue: '{{count}} required model(s) still need to be selected. Choose installed models, or download or import them.',
                    })}</p>
                  </InlineAlert>
                ) : !createFormError ? (
                  <InlineAlert tone="success">
                    <p>{t('runtimeConfig.loadouts.readySummary')}</p>
                  </InlineAlert>
                ) : null}
                {recommendations.length > 0 ? (
                  <p className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.loadouts.downloadEstimateDisclaimer')}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </ScrollShell>
      </OverlayShell>

      <OverlayShell
        open={manageLoadout !== null}
        kind="drawer"
        size="M"
        title={manageLoadout?.displayName ?? ''}
        onClose={() => props.initialLoadoutId ? props.onBack() : setManageLoadoutId(null)}
        footer={props.initialLoadoutId ? (
          <Button tone="secondary" onClick={props.onBack} data-testid="model-configuration-back">
            {props.backLabel ?? t('runtimeConfig.localModels.backToModels')}
          </Button>
        ) : undefined}
        panelClassName="flex max-h-screen flex-col overflow-hidden"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-0 py-0"
      >
        <ScrollShell className="flex-1 px-6 py-2">
          {manageLoadout && manageDraft ? (
            <div className="grid gap-5 py-2" data-testid={`loadout-manage:${manageLoadout.loadoutId}`}>
              <p className="text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.localModels.configurationId', { id: configurationShortId(manageLoadout, aggregate?.loadouts ?? []) })}</p>
              {manageError ? (
                <InlineAlert tone="warning" data-testid="loadout-manage-error">
                  <p>{manageError}</p>
                  <Button
                    size="sm"
                    tone="secondary"
                    className="mt-2"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setManageError('');
                      setEdits((current) => {
                        const next = { ...current };
                        delete next[manageLoadout.loadoutId];
                        return next;
                      });
                      void refresh();
                    }}
                  >
                    {t('Common.retry', { defaultValue: 'Retry' })}
                  </Button>
                </InlineAlert>
              ) : null}
              {manageIsRetiredRecipe ? (
                <InlineAlert tone="warning" data-testid="loadout-manage-retired-recipe">
                  <p>{t('runtimeConfig.loadouts.retiredRecipeHint')}</p>
                  <Button
                    size="sm"
                    tone="primary"
                    className="mt-2"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setManageLoadoutId(null);
                      beginCreate(manageLoadout.capabilityContract);
                    }}
                  >
                    {t('runtimeConfig.loadouts.createReplacement')}
                  </Button>
                </InlineAlert>
              ) : null}
              <div className="grid gap-1 text-sm">
                <span>{t('runtimeConfig.loadouts.name')}</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <TextField
                      value={manageDraft.displayName}
                      onChange={(event) => {
                        const nextDisplayName = event.currentTarget.value;
                        setEdits((current) => ({
                          ...current,
                          [manageLoadout.loadoutId]: {
                            ...(current[manageLoadout.loadoutId] ?? manageDraft),
                            displayName: nextDisplayName,
                          },
                        }));
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    tone="secondary"
                    disabled={Boolean(busy) || manageIsRetiredRecipe || !manageDraft.displayName.trim() || manageDraft.displayName.trim() === manageLoadout.displayName}
                    onClick={() => requestRename(manageLoadout)}
                  >
                    {t('runtimeConfig.loadouts.renameSave')}
                  </Button>
                </div>
              </div>

              {manageSupportsContextSize ? (
                <div className="grid gap-2" data-testid="loadout-manage-options-section">
                  <RuntimeTextContextSizeField
                    value={manageDraft.contextSize}
                    onChange={(nextValue) => setEdits((current) => ({
                      ...current,
                      [manageLoadout.loadoutId]: {
                        ...(current[manageLoadout.loadoutId] ?? manageDraft),
                        contextSize: nextValue,
                      },
                    }))}
                    disabled={Boolean(busy) || manageIsRetiredRecipe}
                    testId="loadout-manage-context-size"
                  />
                  <div>
                    <Button
                      size="sm"
                      tone="secondary"
                      data-testid="loadout-manage-save-options"
                      disabled={Boolean(busy) || manageIsRetiredRecipe || !manageContextChanged || !manageContextValidation.valid}
                      onClick={() => requestOptionsUpdate(manageLoadout)}
                    >
                      {t('runtimeConfig.loadouts.saveOptions')}
                    </Button>
                  </div>
                </div>
              ) : null}

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
                  const healthy = Boolean(axis.modelAssetId) && Boolean(asset?.contentVerified) && axis.recipeCompatible;
                  return (
                    <div key={axis.slotId} className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <LoadoutSlotLabel slot={axis} />
                          {axis.modelAssetId ? (
                            <StatusBadge tone={healthy ? 'success' : 'warning'} shape="soft">
                              {t(healthy ? 'runtimeConfig.loadouts.axisStatus.verified' : 'runtimeConfig.loadouts.axisStatus.attention')}
                            </StatusBadge>
                          ) : null}
                          {custom ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.customModel')}</StatusBadge> : null}
                        </div>
                        {error ? <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{t('runtimeConfig.loadouts.incompatibleSummary')}</p> : null}
                      </div>
                      <SelectField
                        value={axis.modelAssetId || (axis.presence === 'optional-conditional' ? LOADOUT_UNSET_MODEL_OPTION_VALUE : '')}
                        placeholder={t('runtimeConfig.loadouts.chooseModels')}
                        options={[
                          ...(axis.presence === 'optional-conditional'
                            ? [{ value: LOADOUT_UNSET_MODEL_OPTION_VALUE, label: t('runtimeConfig.loadouts.unresolved') }]
                            : []),
                          ...runtimeConfigLoadoutCandidateAssets(slot, assets, axis).map((item) => {
                            const incompatibility = candidateErrors[`${manageLoadout.loadoutId}:${axis.slotId}:${item.modelAssetId}`];
                            const label = loadoutAssetLabel(item, verifiedAssets);
                            return { value: item.modelAssetId, label: incompatibility ? `${label} · ${t('runtimeConfig.loadouts.incompatibleOption')}` : label };
                          }),
                        ]}
                        onValueChange={(value) => {
                          const modelAssetId = value === LOADOUT_UNSET_MODEL_OPTION_VALUE ? '' : value;
                          requestUpdate(manageLoadout, axis.slotId, modelAssetId);
                        }}
                        disabled={Boolean(busy) || manageIsRetiredRecipe}
                        contentLayer="dialog"
                      />
                    </div>
                  );
                })}
              </section>

              <RuntimeConfigLoadoutTextBehaviors
                loadoutId={manageLoadout.loadoutId}
                behaviors={manageLoadout.textBehaviors}
                hasBoundMainModel={loadoutHasBoundMainModel(manageLoadout, manageRecipe)}
                compact
              />

              {loadoutValidationMessages(manageLoadout, t).map((message) => (
                <p key={message} className="text-sm text-[var(--nimi-status-warning)]">{message}</p>
              ))}

              <details className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-3 text-xs text-[var(--nimi-text-muted)]" data-testid="loadout-execution-supply">
                <summary className="cursor-pointer font-medium text-[var(--nimi-text-secondary)]">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
                <div className="mt-3 grid gap-3">
                  <p>{t('runtimeConfig.localModels.configurationId', { id: manageLoadout.loadoutId })}</p>
                  {manageLoadout.reasons.length > 0 ? <p className="break-all">{manageLoadout.reasons.join(', ')}</p> : null}
                  <p>{manageLoadout.capabilityContract} · {manageLoadout.recipeId}@{manageLoadout.recipeRevision} · {manageLoadout.implementation.driverDialect}</p>
                  <p>{t('runtimeConfig.loadouts.implementationSupportedFeatures')}: {manageLoadout.implementationSupportedFeatures.length > 0 ? manageLoadout.implementationSupportedFeatures.join(', ') : t('runtimeConfig.loadouts.recipeCustodyEmpty')}</p>
                  <p>{t('runtimeConfig.loadouts.configuredFeatures')}: {manageLoadout.configuredFeatures.length > 0 ? manageLoadout.configuredFeatures.join(', ') : t('runtimeConfig.loadouts.recipeCustodyEmpty')}</p>
                  {manageLoadout.modelAxes.map((axis) => {
                    const asset = assets.find((item) => item.modelAssetId === axis.modelAssetId);
                    const catalogBadge = runtimeConfigLoadoutCatalogBadge(asset?.catalogVerification);
                    const error = axisErrors[`${manageLoadout.loadoutId}:${axis.slotId}`];
                    return (
                      <div key={axis.slotId} className="grid gap-1">
                        <p>{axis.displayLabel}: {axis.modelAssetId || axis.expectedContentId || t('runtimeConfig.loadouts.unresolved')}</p>
                        <div className="flex flex-wrap gap-1"><StatusBadge tone={asset?.contentVerified ? 'success' : 'warning'} shape="soft">{t('runtimeConfig.loadouts.contentVerified')}</StatusBadge><StatusBadge tone={catalogBadge.tone} shape="soft">{t(`runtimeConfig.loadouts.catalogBadge.${catalogBadge.label}`)}</StatusBadge><StatusBadge tone={axis.recipeCompatible ? 'success' : 'warning'} shape="soft">{t('runtimeConfig.loadouts.recipeCompatible')}</StatusBadge></div>
                        <p className="font-mono">{catalogBadge.label}</p>
                        {error ? <p className="break-all text-[var(--nimi-status-danger)]">{error}</p> : null}
                      </div>
                    );
                  })}
                  <p>{t('runtimeConfig.loadouts.recipeCustody')}: {manageLoadout.recipeCustody.length > 0 ? manageLoadout.recipeCustody.map((item) => item.custodyId).join(', ') : t('runtimeConfig.loadouts.recipeCustodyEmpty')}</p>
                  <p>{t('runtimeConfig.loadouts.executionSupply')}</p>
                </div>
              </details>

              <RuntimeConfigurationEnvironment
                key={manageLoadout.loadoutId}
                capability={manageLoadout.capabilityContract}
                loadoutId={manageLoadout.loadoutId}
                revision={manageLoadout.revision}
                disabled={Boolean(busy) || props.environmentWritesDisabled === true}
                onPrepare={props.onPrepareEnvironment ? () => props.onPrepareEnvironment!(manageLoadout) : undefined}
              />

              <div className="flex justify-end border-t border-[var(--nimi-border-subtle)] pt-4">
                <Button size="sm" tone="danger" disabled={Boolean(busy)} onClick={() => requestDelete(manageLoadout)}>{t('runtimeConfig.loadouts.delete')}</Button>
              </div>
            </div>
          ) : null}
        </ScrollShell>
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

function CreateLoadoutStepIndicator(props: { readonly step: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  const steps = [
    { id: 'capability', title: t('runtimeConfig.loadouts.createStepCapability') },
    { id: 'recipe', title: t('runtimeConfig.loadouts.createStepRecipe') },
    { id: 'configure', title: t('runtimeConfig.loadouts.createStepConfigure') },
  ];
  return (
    <ol className="flex items-center gap-2" aria-label={t('runtimeConfig.loadouts.create')} data-testid="create-loadout-steps">
      {steps.map((item, index) => {
        const number = index + 1;
        const complete = number < props.step;
        const current = number === props.step;
        return (
          <li key={item.id} className="flex min-w-0 items-center gap-2" aria-current={current ? 'step' : undefined}>
            {index > 0 ? (
              <span aria-hidden="true" className={`h-px w-5 shrink-0 ${complete || current ? 'bg-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-border-subtle)]'}`} />
            ) : null}
            <span
              aria-hidden="true"
              className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${complete
                ? 'bg-[var(--nimi-status-success)] text-[var(--nimi-text-inverse)]'
                : current
                  ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                  : 'border border-[var(--nimi-border-strong)] text-[var(--nimi-text-muted)]'}`}
            >
              {complete ? '✓' : number}
            </span>
            <span className={`truncate text-xs ${current ? 'font-semibold text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)]'}`}>{item.title}</span>
          </li>
        );
      })}
    </ol>
  );
}

function recipeApplicabilityRank(applicability: NimiLoadoutRecipe['applicability']): number {
  if (applicability === 'supported') return 0;
  if (applicability === 'unknown') return 1;
  return 2;
}

function CollapsibleRecipeSection(props: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="grid gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-fit items-center gap-1.5 text-left text-sm font-medium text-[var(--nimi-text-muted)] transition hover:text-[var(--nimi-text-primary)]"
        data-testid="recipe-group-collapse-toggle"
      >
        <span aria-hidden="true" className={`inline-block text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        {props.title} ({props.count})
      </button>
      {open ? props.children : null}
    </section>
  );
}

function RecipeTemplateGroup(props: {
  readonly title?: string;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly emptyLabel?: string;
  readonly onOpen: (recipe: NimiLoadoutRecipe) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-2">
      {props.title ? <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3> : null}
      {props.recipes.length === 0 ? (
        props.emptyLabel ? <p className="text-xs text-[var(--nimi-text-muted)]">{props.emptyLabel}</p> : null
      ) : props.recipes.map((recipe) => {
        const estimate = summarizeRuntimeConfigRecipeDownloads(recipe);
        const supported = recipe.applicability === 'supported';
        return (
        <Surface key={`${recipe.recipeId}@${recipe.revision}`} tone="card" className="grid gap-3 p-4" data-testid={`recipe-template:${recipe.recipeId}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{recipe.title}</h4>
                <StatusBadge tone={supported ? 'success' : 'warning'} shape="soft">
                  {t(`runtimeConfig.loadouts.hostFit.${recipe.applicability}`, { defaultValue: recipe.applicability })}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                {!recipe.slots.some((slot) => slot.offers.length > 0)
                  ? t('runtimeConfig.loadouts.recipeManualModels')
                  : estimate.count === 0
                  ? t('runtimeConfig.loadouts.noRecommendedDownload', { defaultValue: 'Required models are installed; the final setup still needs validation.' })
                  : estimate.totalSizeBytes === null
                    ? t('runtimeConfig.loadouts.recommendedDownloadUnknown', { count: estimate.count, defaultValue: '{{count}} model(s) to download · size unknown' })
                    : t('runtimeConfig.loadouts.recommendedDownloadKnown', { count: estimate.count, size: formatBytes(estimate.totalSizeBytes), defaultValue: '{{count}} model(s) to download · ~{{size}}' })}
              </p>
              {supported ? null : (
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {t(recipe.applicability === 'unsupported'
                    ? 'runtimeConfig.loadouts.unsupportedReason'
                    : 'runtimeConfig.loadouts.unknownReason')}
                </p>
              )}
              {recipe.reasons.length > 0 ? (
                <details className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  <summary className="cursor-pointer">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
                  <p className="mt-1 break-all font-mono">{recipe.reasons.join(' · ')}</p>
                </details>
              ) : null}
            </div>
            <Button size="sm" tone={supported ? 'primary' : 'secondary'} onClick={() => props.onOpen(recipe)}>
              {t(supported ? 'runtimeConfig.loadouts.useTemplate' : 'runtimeConfig.loadouts.openTemplate', { defaultValue: supported ? 'Use this plan' : 'View plan' })}
            </Button>
          </div>
          <div className="grid gap-1.5">
            {recipe.slots.map((slot) => {
              const installed = slot.offers.some((offer) => Boolean(offer.installedModelAssetId));
              const supportedOffers = slot.offers.filter((offer) => offer.applicability === 'supported').length;
              const firstOffer = slot.offers.find((offer) => offer.applicability !== 'unsupported');
              const modelText = firstOffer
                ? `${firstOffer.candidate.title} · ${firstOffer.candidate.totalSizeBytes
                  ? formatBytes(firstOffer.candidate.totalSizeBytes)
                  : t('runtimeConfig.loadouts.downloadSizeUnknown', { defaultValue: 'size unknown' })}`
                : t('runtimeConfig.loadouts.noAdmittedOffer', { defaultValue: 'No compatible model candidate is currently available' });
              return (
                <div key={slot.slotId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <LoadoutSlotLabel slot={slot} />
                  <span className="min-w-0 flex-1 truncate text-[var(--nimi-text-muted)]" title={modelText}>{modelText}</span>
                  {installed || supportedOffers > 0 || slot.applicability === 'unsupported' ? (
                    <StatusBadge tone={installed ? 'success' : supportedOffers > 0 ? 'info' : 'warning'} shape="soft">
                      {installed
                        ? t('runtimeConfig.loadouts.installed', { defaultValue: 'Installed' })
                        : supportedOffers > 0
                          ? t('runtimeConfig.loadouts.downloadRequired', { defaultValue: 'Download required' })
                          : t('runtimeConfig.loadouts.slotUnavailable', { defaultValue: 'Unavailable here' })}
                    </StatusBadge>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Surface>
      );})}
    </section>
  );
}

function loadoutHasBoundMainModel(
  loadout: Pick<NimiMachineLoadout, 'modelAxes'>,
  recipe?: Pick<NimiLoadoutRecipe, 'slots'>,
): boolean {
  if (recipe) {
    const primary = resolvePrimaryRecipeSlot(recipe);
    if (primary.kind === 'single') {
      return loadout.modelAxes.some((axis) => axis.slotId === primary.slot.slotId && Boolean(axis.modelAssetId));
    }
  }
  const requiredAxes = loadout.modelAxes.filter((axis) => axis.presence === 'required');
  return requiredAxes.length > 0
    ? requiredAxes.some((axis) => Boolean(axis.modelAssetId))
    : loadout.modelAxes.some((axis) => Boolean(axis.modelAssetId));
}

function LoadoutGroup(props: {
  readonly title: string;
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly aggregate: NimiMachineLoadouts | null;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly recipesLoadState: RecipesLoadState;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly busy: boolean;
  readonly onSelect: (loadout: NimiMachineLoadout) => void;
  readonly onClear: (loadout: NimiMachineLoadout) => void;
  readonly onInstallRecommended: (recipe: NimiLoadoutRecipe, loadout?: NimiMachineLoadout) => void;
  readonly onCreateReplacement: (loadout: NimiMachineLoadout) => void;
  readonly onDelete: (loadout: NimiMachineLoadout) => void;
  readonly onManage: (loadout: NimiMachineLoadout) => void;
}) {
  if (props.loadouts.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
      {props.loadouts.map((loadout) => (
        <LoadoutCard
          key={loadout.loadoutId}
          loadout={loadout}
          recipe={props.recipes.find((recipe) => recipe.recipeId === loadout.recipeId)}
          recipesLoadState={props.recipesLoadState}
          assets={props.assets}
          verifiedAssets={props.verifiedAssets}
          selected={isSelected(props.aggregate, loadout)}
          busy={props.busy}
          onSelect={() => props.onSelect(loadout)}
          onClear={() => props.onClear(loadout)}
          onInstallRecommended={(recipe) => props.onInstallRecommended(recipe, loadout)}
          onCreateReplacement={() => props.onCreateReplacement(loadout)}
          onDelete={() => props.onDelete(loadout)}
          onManage={() => props.onManage(loadout)}
        />
      ))}
    </section>
  );
}

function LoadoutCard(props: {
  readonly loadout: NimiMachineLoadout;
  readonly recipe?: NimiLoadoutRecipe;
  readonly recipesLoadState: RecipesLoadState;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onClear: () => void;
  readonly onInstallRecommended: (recipe: NimiLoadoutRecipe) => void;
  readonly onCreateReplacement: () => void;
  readonly onDelete: () => void;
  readonly onManage: () => void;
}) {
  const { t } = useTranslation();
  const tone = props.loadout.validationState === 'configured' ? 'success' : props.loadout.validationState === 'blocked' ? 'danger' : 'warning';
  const isRetiredRecipe = props.recipesLoadState === 'loaded' && !props.recipe && props.loadout.validationState === 'blocked';
  const recoveryRecommendations = props.recipe
    ? recommendedInstallItems(props.recipe, modelAssetIdsForLoadout(props.loadout))
    : [];
  const canInstallRecommended = props.loadout.validationState !== 'configured'
    && recoveryRecommendations.some((item) => !item.installed);
  const needsAttention = props.loadout.validationState !== 'configured';
  const attentionReasons = needsAttention
    ? props.loadout.reasons.map((reason) => localizedAssetUnhealthyReason(reason, t)).filter((message) => message !== '')
    : [];
  return (
    <Surface
      tone="card"
      className={`grid gap-3 p-4 ${props.selected ? 'ring-2 ring-[var(--nimi-status-info)]' : ''}`}
      data-testid={`machine-loadout:${props.loadout.loadoutId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-base font-semibold text-[var(--nimi-text-primary)]">{props.loadout.displayName}</h4>
          {props.selected ? <StatusBadge tone="info" shape="soft">{t('runtimeConfig.loadouts.selected')}</StatusBadge> : null}
          {props.loadout.validationState === 'configured' ? null : (
            <StatusBadge tone={tone} shape="soft">{t(`runtimeConfig.loadouts.state.${props.loadout.validationState}`)}</StatusBadge>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {isRetiredRecipe ? (
            <>
              <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onCreateReplacement} data-testid={`loadout-create-replacement:${props.loadout.loadoutId}`}>
                {t('runtimeConfig.loadouts.createReplacement')}
              </Button>
              <Button size="sm" tone="danger" disabled={props.busy} onClick={props.onDelete} data-testid={`loadout-delete-retired:${props.loadout.loadoutId}`}>
                {t('runtimeConfig.loadouts.delete')}
              </Button>
            </>
          ) : (
            <>
              {props.selected ? <Button size="sm" tone="ghost" disabled={props.busy} onClick={props.onClear}>{t('runtimeConfig.loadouts.clear')}</Button> : props.loadout.validationState === 'configured' ? <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onSelect}>{t('runtimeConfig.loadouts.select')}</Button> : canInstallRecommended && props.recipe ? <Button data-testid={`loadout-install-recommended:${props.loadout.loadoutId}`} size="sm" tone="primary" disabled={props.busy} onClick={() => props.onInstallRecommended(props.recipe!)}>{t('runtimeConfig.loadouts.installRecommended')}</Button> : <Button size="sm" tone="primary" disabled={props.busy} onClick={props.onManage}>{t('runtimeConfig.loadouts.chooseModels')}</Button>}
              <Button size="sm" tone="secondary" disabled={props.busy} onClick={props.onManage}>{t('runtimeConfig.loadouts.manage')}</Button>
            </>
          )}
        </div>
      </div>
      {isRetiredRecipe ? (
        <p className="text-xs text-[var(--nimi-status-warning)]" data-testid={`loadout-retired-hint:${props.loadout.loadoutId}`}>
          {t('runtimeConfig.loadouts.retiredRecipeHint')}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {props.loadout.modelAxes.map((axis) => {
          const asset = props.assets.find((item) => item.modelAssetId === axis.modelAssetId);
          const label = axis.resolution === 'not-configured'
            ? t('runtimeConfig.loadouts.optionalNotConfigured')
            : asset
            ? loadoutAssetLabel(asset, props.verifiedAssets)
            : t('runtimeConfig.loadouts.unresolved');
          return (
            <div key={axis.slotId} className="min-w-0 rounded-lg bg-[var(--nimi-surface-subtle)] px-3 py-2">
              <LoadoutSlotLabel slot={axis} />
              <div className="mt-0.5 truncate text-xs font-medium text-[var(--nimi-text-primary)]" title={label}>{label}</div>
            </div>
          );
        })}
      </div>
      {attentionReasons.length > 0 ? (
        <p className="text-xs text-[var(--nimi-status-danger)]">{attentionReasons.join(' · ')}</p>
      ) : null}
      {needsAttention && props.loadout.reasons.length > 0 ? (
        <details className="text-xs text-[var(--nimi-text-muted)]">
          <summary className="cursor-pointer">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
          <p className="mt-1 break-all font-mono">{props.loadout.reasons.join(' · ')}</p>
        </details>
      ) : null}
      <RuntimeConfigLoadoutTextBehaviors
        loadoutId={props.loadout.loadoutId}
        behaviors={props.loadout.textBehaviors}
        hasBoundMainModel={loadoutHasBoundMainModel(props.loadout, props.recipe)}
      />
    </Surface>
  );
}

export type RuntimeConfigTextBehaviorPresentationState =
  | 'implementation-supported'
  | 'configured'
  | 'model-unsupported'
  | 'unavailable';

export function runtimeConfigTextBehaviorPresentationState(
  behavior: Pick<
    NimiTextBehaviorCapabilityProjection,
    'implementationSupported' | 'configurationState'
  >,
  options?: { readonly hasBoundMainModel?: boolean },
): RuntimeConfigTextBehaviorPresentationState {
  if (behavior.implementationSupported && behavior.configurationState === 'configured') {
    return 'configured';
  }
  if (behavior.implementationSupported && behavior.configurationState === 'unavailable') {
    return options?.hasBoundMainModel ? 'model-unsupported' : 'implementation-supported';
  }
  return 'unavailable';
}

function runtimeConfigTextBehaviorTone(
  behavior: Pick<
    NimiTextBehaviorCapabilityProjection,
    'implementationSupported' | 'configurationState'
  >,
  options?: { readonly hasBoundMainModel?: boolean },
): 'success' | 'info' | 'warning' | 'danger' {
  const state = runtimeConfigTextBehaviorPresentationState(behavior, options);
  if (state === 'configured') return 'success';
  if (state === 'implementation-supported') return 'info';
  if (state === 'model-unsupported') return 'warning';
  return behavior.configurationState === 'ambiguous' ? 'danger' : 'warning';
}

export function RuntimeConfigLoadoutTextBehaviors(props: {
  readonly loadoutId: string;
  readonly behaviors: readonly NimiTextBehaviorCapabilityProjection[];
  readonly hasBoundMainModel?: boolean;
  readonly compact?: boolean;
}) {
  const { t } = useTranslation();
  if (props.behaviors.length === 0) return null;
  const behaviorOptions = { hasBoundMainModel: props.hasBoundMainModel };
  return (
    <div
      className={props.compact ? 'grid gap-2' : 'grid gap-2 border-t border-[var(--nimi-border-subtle)] pt-3'}
      data-testid={`loadout-text-behaviors:${props.loadoutId}`}
    >
      <h5 className="text-xs font-medium text-[var(--nimi-text-secondary)]">
        {t('runtimeConfig.loadouts.textBehaviors.title')}
      </h5>
      <div className="grid gap-2 sm:grid-cols-3">
        {props.behaviors.map((behavior) => {
          const state = runtimeConfigTextBehaviorPresentationState(behavior, behaviorOptions);
          return (
            <div
              key={behavior.kind}
              className="min-w-0 rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-2"
              data-testid={`loadout-text-behavior:${props.loadoutId}:${behavior.kind}`}
              data-state={state}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--nimi-text-primary)]">
                  {t(`runtimeConfig.loadouts.textBehaviors.kind.${behavior.kind}`)}
                </span>
                <StatusBadge tone={runtimeConfigTextBehaviorTone(behavior, behaviorOptions)} shape="soft">
                  {t(`runtimeConfig.loadouts.textBehaviors.state.${state}`)}
                </StatusBadge>
              </div>
              {behavior.reasons.length > 0 ? (
                <details className="mt-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                  <summary className="cursor-pointer">{t('runtimeConfig.loadouts.technicalDetails')}</summary>
                  <p className="mt-1 break-all">{t('runtimeConfig.loadouts.textBehaviors.typedReasons')}: <span className="font-mono">{behavior.reasons.join(' · ')}</span></p>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LoadoutSlotLabel({ slot }: {
  readonly slot: Pick<NimiLoadoutRecipe['slots'][number], 'displayLabel' | 'presence' | 'conditionalFeatures'>
    & Partial<Pick<NimiLoadoutRecipe['slots'][number], 'slotId'>>;
}) {
  const { t, i18n } = useTranslation();
  const optional = slot.presence === 'optional-conditional';
  const slotLabelKey = slot.slotId ? loadoutSlotLabelKey(slot.slotId) : null;
  const displayLabel = slotLabelKey ? t(slotLabelKey, { defaultValue: slot.displayLabel }) : slot.displayLabel;
  const features = new Intl.ListFormat(i18n.resolvedLanguage || i18n.language || 'en').format(
    slot.conditionalFeatures.map((feature) => (
      feature === 'input.image'
        ? t(slot.slotId === 'companion.controlnet'
          ? 'runtimeConfig.loadouts.controlnetInput'
          : 'runtimeConfig.loadouts.imageInput')
        : feature
    )),
  );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs" data-requirement-presence={slot.presence}>
      <span className="font-medium text-[var(--nimi-text-primary)]" title={displayLabel !== slot.displayLabel ? slot.displayLabel : undefined}>{displayLabel}</span>
      <span className="text-[var(--nimi-text-muted)]">
        {optional
          ? features ? t('runtimeConfig.loadouts.optionalFor', { features }) : t('runtimeConfig.loadouts.optional')
          : t('runtimeConfig.loadouts.required')}
      </span>
    </span>
  );
}

function recommendedAxisSelections(recipe: NimiLoadoutRecipe | undefined, assets: readonly NimiRuntimeModelAssetRecord[]): Record<string, string> {
  if (!recipe) return {};
  return Object.fromEntries(recipe.slots.map((slot) => {
    if (slot.presence === 'optional-conditional') return [slot.slotId, ''];
    const installedOfferIds = new Set(slot.offers
      .filter((offer) => offer.applicability !== 'unsupported' && offer.installedModelAssetId)
      .map((offer) => offer.installedModelAssetId));
    const matched = assets.filter((asset) => (
      slot.recommendedContentIds.includes(asset.contentId) || installedOfferIds.has(asset.modelAssetId)
    ));
    return [slot.slotId, matched.length === 1 ? matched[0]!.modelAssetId : ''];
  }));
}

/**
 * Restores the create-draft axes after a Model Market detour. When the detour
 * installed the exact offer the user picked for a slot, that fresh
 * ModelAsset becomes the slot selection; otherwise the draft is kept as-is.
 */
export function resolveLoadoutReturnedDraftAxes(
  recipe: NimiLoadoutRecipe,
  context: Pick<RuntimeConfigLoadoutNavigationContext, 'slotId' | 'autoSelectOfferRef' | 'draft'>,
): Record<string, string> {
  const axes: Record<string, string> = { ...context.draft?.modelAssetIds };
  if (!context.slotId || !context.autoSelectOfferRef) return axes;
  const slot = recipe.slots.find((item) => item.slotId === context.slotId);
  const offer = slot?.offers.find((item) => item.candidate.offerRef === context.autoSelectOfferRef);
  if (offer?.installedModelAssetId) axes[context.slotId] = offer.installedModelAssetId;
  return axes;
}

export function recommendedInstallItems(
  recipe: NimiLoadoutRecipe,
  selectedModelAssetIds: Readonly<Record<string, string>> = {},
): RecommendedInstallItem[] {
  return recipe.slots.flatMap((slot) => {
    if (slot.presence === 'optional-conditional' || selectedModelAssetIds[slot.slotId]) return [];
    const offer = slot.offers.find((item) => (
      item.applicability !== 'unsupported' && item.candidate.installable
    ));
    if (!offer) return [];
    return [{
      slotId: slot.slotId,
      displayLabel: slot.displayLabel,
      candidate: offer.candidate,
      ...(offer.installedModelAssetId ? { installedModelAssetId: offer.installedModelAssetId } : {}),
      installed: Boolean(offer.installedModelAssetId),
    }];
  });
}

export function resolveLoadoutCreateContextOption(
  recipe: Pick<NimiLoadoutRecipe, 'capabilityContract' | 'defaultOptions' | 'slots'> & {
    readonly implementation?: NimiLoadoutRecipe['implementation'];
    readonly recommendedOptions?: NimiLoadoutRecipe['recommendedOptions'];
  },
  selectedAxes: Readonly<Record<string, string>>,
): string {
  const supportsContext = recipe.implementation
    ? supportsLlamaTextContextSize(recipe as Pick<NimiLoadoutRecipe, 'capabilityContract' | 'implementation'>)
    : (recipe.capabilityContract === 'text.generate' && recipe.defaultOptions.contextSize === undefined);
  if (!supportsContext) {
    return '';
  }
  const mainSlot = recipe.slots.find((slot) => slot.presence === 'required');
  const selectedAssetId = mainSlot ? selectedAxes[mainSlot.slotId] : '';
  if (mainSlot && selectedAssetId) {
    const fit = mainSlot.offers.find((offer) => offer.installedModelAssetId === selectedAssetId)?.contextFit;
    return fit && fit.recommendedContextSize < fit.authoredContextSize ? String(fit.recommendedContextSize) : '';
  }
  const recommendedFit = mainSlot?.recommendedContextFit;
  if (recommendedFit) {
    return recommendedFit.recommendedContextSize < recommendedFit.authoredContextSize
      ? String(recommendedFit.recommendedContextSize)
      : '';
  }
  const recommendedContextSize = recipe.recommendedOptions?.contextSize;
  if (typeof recommendedContextSize === 'number' && Number.isSafeInteger(recommendedContextSize) && recommendedContextSize >= 1) {
    return String(recommendedContextSize);
  }
  return '';
}

export function parseLoadoutCreateContextOption(
  contextSizeDraft: string,
): { readonly valid: true; readonly contextSize?: number } | { readonly valid: false } {
  const trimmed = contextSizeDraft.trim();
  if (!trimmed) {
    return { valid: true };
  }
  if (!/^[1-9]\d*$/u.test(trimmed)) {
    return { valid: false };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { valid: false };
  }
  return { valid: true, contextSize: parsed };
}

export function buildLoadoutCreateOptions(
  recipe: Pick<NimiLoadoutRecipe, 'capabilityContract' | 'defaultOptions'> & {
    readonly implementation?: NimiLoadoutRecipe['implementation'];
  },
  contextSizeDraft: string,
): NimiPrepareLoadoutInput['options'] {
  const base = { ...recipe.defaultOptions } as NimiJsonObject;
  const supportsContext = recipe.implementation
    ? supportsLlamaTextContextSize(recipe as Pick<NimiLoadoutRecipe, 'capabilityContract' | 'implementation'>)
    : (recipe.capabilityContract === 'text.generate' && base.contextSize === undefined);
  if (!supportsContext) {
    return base;
  }
  const patched = patchLoadoutTextContextOption(base, contextSizeDraft);
  if (!patched.valid) {
    throw new Error('Context window must be empty or a positive integer.');
  }
  return patched.options;
}

export function runtimeConfigRecommendedLoadoutModelAxes(
  loadout: Pick<NimiMachineLoadout, 'modelAxes'>,
  recipe: Pick<NimiLoadoutRecipe, 'slots'>,
  assets: readonly NimiRuntimeModelAssetRecord[],
  resolvedBySlot: ReadonlyMap<string, NimiRuntimeModelAssetRecord> = new Map(),
): NimiPrepareLoadoutInput['modelAxes'] {
  const assetsById = new Map(assets.map((asset) => [asset.modelAssetId, asset]));
  const modelAxes: Array<{ slotId: string; modelAssetId?: string; expectedContentId?: string }> = [];
  for (const slot of recipe.slots) {
    const current = loadout.modelAxes.find((axis) => axis.slotId === slot.slotId);
    if (current?.modelAssetId) {
      const asset = assetsById.get(current.modelAssetId);
      const expectedContentId = asset?.contentId || current.expectedContentId;
      if (expectedContentId) {
        modelAxes.push({ slotId: slot.slotId, modelAssetId: current.modelAssetId, expectedContentId });
      }
      continue;
    }
    const resolved = resolvedBySlot.get(slot.slotId);
    // Optional-conditional slots are never confirmed by recommendedInstallItems,
    // so never auto-bind an already-installed static recommendation into them.
    const recommended = slot.presence === 'optional-conditional'
      ? undefined
      : slot.recommendedContentIds
        .map((contentId) => assets.find((asset) => asset.contentId === contentId))
        .find((asset): asset is NimiRuntimeModelAssetRecord => asset !== undefined);
    const asset = resolved ?? recommended;
    if (asset) {
      modelAxes.push({ slotId: slot.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId });
    }
  }
  return modelAxes;
}

export async function installAndBindRuntimeConfigRecommendedLoadout(input: {
  readonly items: readonly RecommendedInstallItem[];
  readonly recipe: NimiLoadoutRecipe;
  readonly loadout?: NimiMachineLoadout;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly installOffer: (offerRef: string) => Promise<NimiRuntimeModelAssetRecord>;
  readonly updateLoadout: (next: NimiPrepareLoadoutInput) => Promise<unknown>;
}): Promise<void> {
  const resolvedBySlot = new Map<string, NimiRuntimeModelAssetRecord>();
  for (const item of input.items) {
    if (item.installedModelAssetId) {
      const installed = input.assets.find((asset) => asset.modelAssetId === item.installedModelAssetId);
      if (installed) resolvedBySlot.set(item.slotId, installed);
      continue;
    }
    resolvedBySlot.set(item.slotId, await input.installOffer(item.candidate.offerRef));
  }
  if (!input.loadout) return;
  const installedAssets = [...resolvedBySlot.values()];
  const nextAssets = [...input.assets, ...installedAssets.filter((installed) => (
    !input.assets.some((asset) => asset.modelAssetId === installed.modelAssetId)
  ))];
  const nextModelAxes = runtimeConfigRecommendedLoadoutModelAxes(input.loadout, input.recipe, nextAssets, resolvedBySlot);
  const nextDisplayName = loadoutDisplayNameSource(input.loadout.provenance) === 'auto'
    ? deriveLoadoutDefaultDisplayName(
      input.recipe,
      (nextModelAxes ?? []).map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId ?? '', expectedContentId: axis.expectedContentId })),
      input.verifiedAssets ?? [],
      nextAssets,
    )
    : input.loadout.displayName;
  await input.updateLoadout({
    loadoutId: input.loadout.loadoutId,
    capabilityContract: input.loadout.capabilityContract,
    recipeId: input.loadout.recipeId,
    options: input.loadout.options,
    displayName: nextDisplayName,
    modelAxes: nextModelAxes,
    provenance: input.loadout.provenance,
    ...(input.loadout.revision ? { expectedLoadoutRevision: input.loadout.revision } : {}),
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
  // Download figures are the offers' source transfer sizes, never installed totals.
  const total = missing.length === 0
    ? 0
    : missing.every((item) => knownDownloadSize(item.candidate.downloadSizeBytes) !== null)
      ? missing.reduce((sum, item) => sum + (knownDownloadSize(item.candidate.downloadSizeBytes) ?? 0), 0)
      : null;
  return [
    labels.heading,
    ...items.map((item) => `${item.displayLabel}: ${item.candidate.title} · ${item.candidate.variantLabel} · ${formatDownloadBytes(knownDownloadSize(item.candidate.downloadSizeBytes), labels.unknownSize)} · ${item.installed ? labels.installed : labels.download}`),
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

export function partitionRuntimeConfigRecipeTemplates(recipes: readonly NimiLoadoutRecipe[]): {
  readonly supported: readonly NimiLoadoutRecipe[];
  readonly unknown: readonly NimiLoadoutRecipe[];
  readonly unsupported: readonly NimiLoadoutRecipe[];
} {
  return {
    supported: recipes.filter((recipe) => recipe.applicability === 'supported'),
    unknown: recipes.filter((recipe) => recipe.applicability === 'unknown'),
    unsupported: recipes.filter((recipe) => recipe.applicability === 'unsupported'),
  };
}

export function summarizeRuntimeConfigRecipeDownloads(recipe: NimiLoadoutRecipe): {
  readonly count: number;
  readonly totalSizeBytes: number | null;
} {
  const missingRequiredSlots = recipe.slots.filter((slot) => (
    slot.presence === 'required' && !slot.offers.some((offer) => Boolean(offer.installedModelAssetId))
  ));
  if (missingRequiredSlots.length === 0) return { count: 0, totalSizeBytes: 0 };
  let totalSizeBytes = 0;
  for (const slot of missingRequiredSlots) {
    const offer = slot.offers.find((item) => (
      item.applicability !== 'unsupported' && item.candidate.installable
    ));
    const size = offer?.candidate.downloadSizeBytes;
    if (!size) return { count: missingRequiredSlots.length, totalSizeBytes: null };
    totalSizeBytes += size;
  }
  return { count: missingRequiredSlots.length, totalSizeBytes };
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
  return loadout.modelAxes.flatMap((axis) => {
    const modelAssetId = axis.slotId === slotId
      ? nextModelAssetId
      : (draftModelAssetIds[axis.slotId] ?? axis.modelAssetId);
    if (!modelAssetId) {
      if (axis.presence === 'optional-conditional') return [];
      // Cannot unbind an already-bound required slot through Manage; keep the existing binding.
      if (axis.slotId === slotId && axis.modelAssetId && axis.expectedContentId) {
        return { slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId };
      }
      // Explicitly preserve an already-unresolved required axis so Runtime does not silently auto-prefill.
      return { slotId: axis.slotId, modelAssetId: '', expectedContentId: '' };
    }
    const asset = assets.find((item) => item.modelAssetId === modelAssetId);
    if (asset) {
      return { slotId: axis.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId };
    }
    if (axis.slotId === slotId && nextModelAssetId) {
      throw new Error(`Selected model asset ${nextModelAssetId} is no longer available on this device.`);
    }
    if (axis.modelAssetId && axis.expectedContentId) {
      return { slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId };
    }
    return axis.presence === 'required'
      ? { slotId: axis.slotId, modelAssetId: '', expectedContentId: '' }
      : [];
  });
}

export function loadoutCapabilityLabelKey(capabilityContract: string): string {
  switch (capabilityContract) {
    case 'image.face_swap': return 'runtimeConfig.loadouts.capability.imageFaceSwap';
    case 'video.face_swap': return 'runtimeConfig.loadouts.capability.videoFaceSwap';
    case 'image.upscale': return 'runtimeConfig.loadouts.capability.imageUpscale';
    case 'video.upscale': return 'runtimeConfig.loadouts.capability.videoUpscale';
    case 'vision.locate': return 'runtimeConfig.loadouts.capability.visionLocate';
    case 'text.generate': return 'runtimeConfig.loadouts.capability.textGenerate';
    case 'text.embed': return 'runtimeConfig.loadouts.capability.textEmbed';
    case 'image.generate': return 'runtimeConfig.loadouts.capability.imageGenerate';
    case 'audio.synthesize': return 'runtimeConfig.loadouts.capability.audioSynthesize';
    case 'audio.transcribe': return 'runtimeConfig.loadouts.capability.audioTranscribe';
    case 'text.annotate': return 'runtimeConfig.loadouts.capability.textAnnotate';
    case 'text.decide': return 'runtimeConfig.loadouts.capability.textDecide';
    case 'audio.speaker.embed': return 'runtimeConfig.loadouts.capability.audioSpeakerEmbed';
    case 'audio.separate': return 'runtimeConfig.loadouts.capability.audioSeparate';
    case 'voice.create': return 'runtimeConfig.loadouts.capability.voiceCreate';
    case 'video.generate': return 'runtimeConfig.loadouts.capability.videoGenerate';
    case 'music.generate': return 'runtimeConfig.loadouts.capability.musicGenerate';
    case 'music.transcribe': return 'runtimeConfig.loadouts.capability.musicTranscribe';
    case 'audio.voice.convert': return 'runtimeConfig.loadouts.capability.audioVoiceConvert';
    default: return 'runtimeConfig.loadouts.capability.other';
  }
}

export function loadoutCapabilityDescriptionKey(capabilityContract: string): string {
  return loadoutCapabilityLabelKey(capabilityContract).replace('.capability.', '.capabilityDescription.');
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
