import {
  capabilityIcon,
  Button,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  type StatusTone,
  SearchField,
} from '@nimiplatform/kit/ui';
import {
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiLoadoutRecipe,
  type NimiMachineLoadout,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalVerifiedAssetDescriptor,
  type NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Download,
  FolderOpen,
  LoaderCircle,
  MonitorCheck,
  Plus,
  Store,
  SlidersHorizontal,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import type { capabilityPreparationState } from './runtime-capability-inventory.js';
import { RuntimeCapabilitySettingsDialog } from './runtime-capability-settings-dialog.js';
import {
  capabilityModelIdentity,
  modelDisplayTitle,
  modelFamilySeed,
  modelSetupUnavailable,
  modelFeatureLocaleKeys,
  recipeOfferSummary,
  type RecipeOfferSummary,
} from './runtime-capability-presentation.js';
import {
  loadoutAssetLabel,
  loadoutSlotLabelKey,
  resolvePrimaryRecipeSlot,
} from './runtime-config-loadout-model-display.js';
import { displayRuntimeConfigCapabilityLabel, displayRuntimeConfigCapabilityUsage } from './runtime-config-capability-labels.js';
import { RuntimeEnvironmentCheck, RuntimeEnvironmentDependencies, type RuntimeEnvironmentActions } from './runtime-environment-details.js';
import { configurationShortId } from './runtime-local-model-list.js';
import { RuntimeConfigLoadoutTextBehaviors, SavedConfigsView } from './runtime-config-page-loadouts.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
} from './runtime-config-panel-types.js';
import type { RuntimeSetupTask, RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';

type Props = {
  capability: string;
  selected?: NimiMachineLoadout;
  /** Supported recipe whose files are already on this device while nothing is selected. */
  downloadedRecipe?: NimiLoadoutRecipe;
  loadouts: readonly NimiMachineLoadout[];
  /** True when the capability has any Loadout (including blocked/unresolved) so Manage Saved stays reachable. */
  hasAnyLoadouts?: boolean;
  recipes: readonly NimiLoadoutRecipe[];
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  assets: readonly NimiRuntimeModelAssetRecord[];
  libraryLoading: boolean;
  libraryError: boolean;
  modelsLoading?: boolean;
  modelsError?: boolean;
  environment?: NimiRuntimeLocalEnvironmentPlan;
  environmentJobs?: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  environmentActions?: RuntimeEnvironmentActions;
  status: ReturnType<typeof capabilityPreparationState>;
  /** Model the in-flight setup works on; '' when its candidate is not known. */
  taskModel: string;
  /** Preparation and recovery remain visible alongside the model list. */
  preparation?: ReactNode;
  /** Apps that use this capability, shown beside the models. */
  apps?: ReactNode;
  section: string;
  onSection: (section: string) => void;
  busy: boolean;
  disabled: boolean;
  navigationContext: RuntimeConfigLoadoutNavigationContext | null;
  onStart: (recipe: string, previous?: NimiMachineLoadout) => Promise<void>;
  /** Uses the exact recipe recommendation after checking its preparation plan. */
  onEnable: (recipe: string, previous?: NimiMachineLoadout) => Promise<void>;
  /** Directly selects an existing configured Loadout (checking environment, impact confirmation, and CAS). */
  onSelectLoadout: (loadout: NimiMachineLoadout) => Promise<void>;
  /** Opens creation of a new Loadout for this capability. */
  onCreate?: () => void;
  /** Opens SavedConfigsView with the create drawer already open. */
  initialCreateOnSaved?: boolean;
  onApplyCustomization: (draft: RuntimeSetupTaskDraft, previous?: NimiMachineLoadout) => Promise<void>;
  onRetryCustomization?: () => void;
  onTask: (taskId: string) => void;
  onModelFiles?: () => void;
  /** Direct import entry: the Model Library's local files with the import menu open. */
  onImportModelFiles?: () => void;
  /** Opens a draft for the recipe so imported files can be chosen and validated by Runtime. */
  onChooseImportedFiles?: (recipe: string) => void;
  onDiagnostics: () => void;
  onModelMarket: (context: RuntimeConfigModelMarketContext) => void;
};

/**
 * The confirmed setup still in flight for this capability, named by its
 * model: preparation to follow, a problem to resolve, or a prepared model
 * that is not in use yet. Unconfirmed setups never reach this banner.
 */
export function PendingSetupBanner(props: {
  readonly task: RuntimeSetupTask;
  readonly model: string;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation();
  const kind = props.task.status === 'preparing' || props.task.status === 'committing'
    ? 'preparing'
    : props.task.status === 'prepared'
      ? 'prepared'
      : 'attention';
  const Icon = kind === 'preparing' ? LoaderCircle : kind === 'prepared' ? CheckCircle2 : CircleAlert;
  const iconClass = kind === 'preparing'
    ? 'animate-spin motion-reduce:animate-none text-[var(--nimi-status-info)]'
    : kind === 'prepared'
      ? 'text-[var(--nimi-status-success)]'
      : 'text-[var(--nimi-status-warning)]';
  const action = kind === 'preparing' ? 'viewProgress' : kind === 'prepared' ? 'enable' : 'resolve';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--nimi-surface-active)] px-4 py-3 text-sm"
      data-testid="capability-pending-setup"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={15} className={`shrink-0 ${iconClass}`} aria-hidden="true" />
        <span className="min-w-0">
          {props.model
            ? t(`runtimeConfig.product.pendingSetup.${kind}`, { model: props.model })
            : t(`runtimeConfig.product.pendingSetup.${kind}Unnamed`)}
        </span>
      </span>
      <Button tone="secondary" size="sm" onClick={props.onOpen}>
        {t(`runtimeConfig.product.pendingSetup.${action}`)}
        <ArrowRight size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeCapabilityDetail(props: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ recipeId: string; loadoutId?: string } | null>(null);
  const label = displayRuntimeConfigCapabilityLabel(props.capability, t);
  const Icon = capabilityIcon(props.capability);
  const loadouts = props.selected && !props.loadouts.some(item => item.loadoutId === props.selected!.loadoutId)
    ? [props.selected, ...props.loadouts] : props.loadouts;
  const search = query.trim().toLocaleLowerCase();

  // Plan 3A: Every configured Loadout is a first-class top-level card (current selection pinned first).
  const orderedLoadouts = [
    ...loadouts.filter(item => item.loadoutId === props.selected?.loadoutId),
    ...loadouts.filter(item => item.loadoutId !== props.selected?.loadoutId),
  ].filter(item => {
    if (!search) return true;
    const identity = capabilityModelIdentity(item, props.recipes, props.catalog, props.assets);
    const recipe = props.recipes.find(r => r.recipeId === item.recipeId);
    return `${item.displayName} ${identity.shortTitle} ${identity.versionShort} ${identity.recipeShortTitle} ${recipe?.title ?? ''}`
      .toLocaleLowerCase().includes(search);
  });

  const configuredRecipes = new Set(loadouts.filter(item => item.validationState === 'configured').map(item => item.recipeId));
  const orderedRecipes = props.recipes.filter(recipe => !configuredRecipes.has(recipe.recipeId)
    && (!search || `${recipe.title} ${modelDisplayTitle(recipe.title)} ${recipe.recipeId}`.toLocaleLowerCase().includes(search)));

  const editingLoadout = editing?.loadoutId ? loadouts.find(item => item.loadoutId === editing.loadoutId) : undefined;
  const editingRecipe = props.recipes.find(recipe => recipe.recipeId === editing?.recipeId);
  const unboundImports = props.assets.some(asset => !asset.catalogVerified
    && !loadouts.some(loadout => loadout.modelAxes.some(axis => axis.modelAssetId === asset.modelAssetId)));
  const costOf = (summary: RecipeOfferSummary): ModelCost => {
    if (props.modelsLoading || props.libraryLoading) return { text: t('Common.loading'), tone: 'muted' };
    if (props.modelsError || props.libraryError) return { text: t('runtimeConfig.product.preparationUnknown'), tone: 'muted' };
    if (summary.withoutOffer > 0) return { text: t('runtimeConfig.product.noDirectDownload'), tone: 'muted' };
    if (summary.missing === 0) return { text: t('runtimeConfig.product.modelsOnDevice'), tone: 'ready' };
    if (summary.downloadVariesByVersion) return { text: t('runtimeConfig.product.downloadSizeInReview'), tone: 'muted' };
    if (summary.downloadBytes === null) return { text: t('runtimeConfig.product.downloadSizeUnknown'), tone: 'muted' };
    return { text: t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.downloadBytes) }), tone: 'download' };
  };
  if (props.section === 'saved') return <SavedConfigsView contextual capabilityContract={props.capability}
    initialCreate={props.initialCreateOnSaved}
    backLabel={t('runtimeConfig.localModels.backToModels')}
    navigationContext={props.navigationContext ?? { capabilityContract: props.capability }}
    onBack={() => props.onSection('models')}
    environmentWritesDisabled={props.disabled} onPrepareEnvironment={loadout => { void props.onStart(loadout.recipeId, loadout); }} onOpenModelMarket={props.onModelMarket} />;
  const controlsDisabled = props.busy || props.disabled || Boolean(props.modelsLoading || props.modelsError || props.libraryLoading || props.libraryError);
  const showSearch = loadouts.length + props.recipes.length > 6;
  return (
    <div className="desktop-module-stack" data-testid={`ai-capability-detail:${props.capability}`}>
      <header className="flex items-start gap-3">
        <span className="desktop-module-header-icon flex items-center justify-center bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]" aria-hidden="true"><Icon size={24} strokeWidth={1.6} aria-hidden="true" /></span>
        <div className="min-w-0"><h1 className="desktop-module-title">{label}</h1>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{displayRuntimeConfigCapabilityUsage(props.capability, t)}</p></div>
      </header>
      <div className={props.apps ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]' : undefined}>
        <div className="min-w-0 space-y-4">
          {props.status.task && !props.preparation ? <PendingSetupBanner task={props.status.task} model={props.taskModel} onOpen={() => props.onTask(props.status.task!.taskId)} /> : null}
          {props.preparation ? <div className="rounded-xl bg-[var(--nimi-surface-card)] p-4" data-testid="capability-preparation">{props.preparation}</div> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('runtimeConfig.product.settings.models')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {showSearch ? <SearchField aria-label={t('runtimeConfig.product.searchModels')} placeholder={t('runtimeConfig.product.searchModels')} value={query}
                onChange={event => setQuery(event.currentTarget.value)} onClear={() => setQuery('')} clearLabel={t('Common.clear')} /> : null}
              {props.onCreate ? <Button tone="secondary" size="sm" disabled={props.busy || props.disabled} onClick={props.onCreate} data-testid="capability-new-configuration"><Plus size={14} aria-hidden="true" />{t('runtimeConfig.product.newConfiguration')}</Button> : null}
              <Button tone="secondary" size="sm" onClick={() => props.onModelMarket({ kind: 'browse', capabilityContract: props.capability })}><Store size={14} aria-hidden="true" />{t('runtimeConfig.product.modelPicker.browse')}</Button>
              {props.onImportModelFiles || props.onModelFiles ? <Button tone="secondary" size="sm" onClick={props.onImportModelFiles ?? props.onModelFiles} data-testid="capability-models-import"><FolderOpen size={14} aria-hidden="true" />{t('runtimeConfig.product.importModel')}</Button> : null}
            </div>
          </div>
          {props.modelsError || props.libraryError ? <InlineAlert tone="warning">{t('runtimeConfig.product.preparationUnknown')}<Button tone="ghost" size="sm" onClick={props.onRetryCustomization}>{t('Common.retry')}</Button></InlineAlert> : null}

          {orderedLoadouts.length > 0 ? (
            <section className="space-y-3" data-testid="capability-saved-loadout-list">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.product.savedConfigurationsTitle')}
              </h3>
              {orderedLoadouts.map((loadout) => {
                const recipe = props.recipes.find(item => item.recipeId === loadout.recipeId);
                const identity = capabilityModelIdentity(loadout, props.recipes, props.catalog, props.assets);
                const isSelected = loadout.loadoutId === props.selected?.loadoutId;
                const similar = loadouts.filter(other => other.loadoutId !== loadout.loadoutId
                  && other.recipeId === loadout.recipeId && other.displayName === loadout.displayName);
                const differences: string[] = [];
                if (similar.length) {
                  for (const [key, value] of Object.entries(loadout.options)) {
                    if (key !== 'contextSize' && similar.some(other => JSON.stringify(other.options[key]) !== JSON.stringify(value))) {
                      differences.push(`${key} ${JSON.stringify(value)}`);
                    }
                  }
                  for (const axis of loadout.modelAxes) {
                    if (!axis.modelAssetId || !similar.some(other =>
                      other.modelAxes.find(item => item.slotId === axis.slotId)?.modelAssetId !== axis.modelAssetId)) continue;
                    const asset = props.assets.find(item => item.modelAssetId === axis.modelAssetId);
                    if (asset) differences.push(loadoutAssetLabel(asset, props.catalog));
                  }
                  differences.push(configurationShortId(loadout, loadouts));
                }
                const primarySlot = recipe ? resolvePrimaryRecipeSlot(recipe) : { kind: 'none' as const };
                const hasBoundMainModel = primarySlot.kind === 'single'
                  ? loadout.modelAxes.some((axis) => axis.slotId === primarySlot.slot.slotId && Boolean(axis.modelAssetId))
                  : loadout.modelAxes.some((axis) => axis.presence === 'required' && Boolean(axis.modelAssetId));
                return (
                  <SavedLoadoutCard
                    key={loadout.loadoutId}
                    loadout={loadout}
                    recipe={recipe}
                    identity={identity}
                    differences={differences}
                    current={isSelected}
                    busy={controlsDisabled}
                    onSelect={() => { void props.onSelectLoadout(loadout); }}
                    onCustomize={recipe ? () => setEditing({ recipeId: recipe.recipeId, loadoutId: loadout.loadoutId }) : undefined}
                    currentContent={isSelected ? (
                      <div className="space-y-3" data-testid="capability-current-model" data-loadout-id={loadout.loadoutId}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
                            <span>{[identity.versionShort, identity.sizeBytes ? t('runtimeConfig.product.aboutSize', { size: formatBytes(identity.sizeBytes) }) : ''].filter(Boolean).join(' · ')}</span>
                            <StatusBadge tone={props.status.state === 'ready' ? 'success' : props.status.state === 'attention' ? 'warning' : 'neutral'} shape="soft" data-testid="capability-state-badge">{t(`runtimeConfig.capabilities.state.${props.status.state}`)}</StatusBadge>
                          </div>
                          {props.status.state !== 'ready' && !props.preparation ? (
                            <Button tone="secondary" size="sm" disabled={controlsDisabled} onClick={() => { if (props.status.task) props.onTask(props.status.task.taskId); else void props.onStart(loadout.recipeId, loadout); }}>
                              {t(props.status.state === 'unknown' ? 'runtimeConfig.setupTask.checkPreparation' : 'runtimeConfig.setupTask.repairSetup')}
                            </Button>
                          ) : null}
                        </div>
                        {(loadout.textBehaviors ?? []).length > 0 ? (
                          <RuntimeConfigLoadoutTextBehaviors
                            loadoutId={loadout.loadoutId}
                            behaviors={loadout.textBehaviors ?? []}
                            hasBoundMainModel={hasBoundMainModel}
                            compact
                          />
                        ) : null}
                        <CurrentModelDetails {...props} />
                      </div>
                    ) : undefined}
                  />
                );
              })}
            </section>
          ) : null}

          {props.modelsLoading && !orderedRecipes.length && !orderedLoadouts.length ? <LoadingSkeleton lines={4} /> : orderedRecipes.length > 0 ? (
            <section className="space-y-3" data-testid="capability-model-list">
              {orderedLoadouts.length > 0 ? (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.product.availableModelsToSetup')}
                </h3>
              ) : null}
              {orderedRecipes.map(recipe => {
                const summary = recipeOfferSummary(recipe, props.catalog, props.assets);
                const noDirectDownload = !props.modelsLoading && !props.modelsError && summary.withoutOffer > 0;
                const features = modelFeatureLocaleKeys(recipe.implementationSupportedFeatures);
                return (
                  <RecipePlanCard
                    key={recipe.recipeId}
                    recipe={recipe}
                    title={modelDisplayTitle(recipe.title)}
                    description={features.map(key => t(key)).join(' · ')}
                    cost={costOf(summary)}
                    enableable={!props.selected && props.downloadedRecipe?.recipeId === recipe.recipeId}
                    noDirectDownload={!noDirectDownload ? null : unboundImports && props.onChooseImportedFiles ? 'choose-imported' : 'import'}
                    busy={controlsDisabled}
                    onSelect={() => { void props.onEnable(recipe.recipeId); }}
                    onEnable={() => { void props.onEnable(recipe.recipeId); }}
                    onChooseImported={() => props.onChooseImportedFiles?.(recipe.recipeId)}
                    onImport={props.onImportModelFiles ?? props.onModelFiles}
                    onCustomize={() => setEditing({ recipeId: recipe.recipeId })}
                  />
                );
              })}
            </section>
          ) : !orderedLoadouts.length && !props.modelsError ? (
            <p className="py-6 text-sm text-[var(--nimi-text-secondary)]">{t(query ? 'runtimeConfig.product.noModelsMatch' : 'runtimeConfig.product.settings.empty')}</p>
          ) : null}
          {orderedRecipes.length || orderedLoadouts.length ? <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.switchNote')}</p> : null}
          {props.hasAnyLoadouts || loadouts.length > 0 ? (
            <Button tone="ghost" size="sm" onClick={() => props.onSection('saved')} data-testid="capability-manage-saved">
              <Bookmark size={14} aria-hidden="true" />
              {t('runtimeConfig.product.manageSaved')}
            </Button>
          ) : null}
        </div>
        {props.apps ? <aside className="min-w-0">{props.apps}</aside> : null}
      </div>
      {editing ? <RuntimeCapabilitySettingsDialog key={`${editing.recipeId}:${editing.loadoutId ?? 'new'}`}
        recipe={editingRecipe} selected={editingLoadout} missingConfiguration={Boolean(editing.loadoutId && !editingLoadout)}
        onChooseConfiguration={loadout => setEditing({ recipeId: editing.recipeId, loadoutId: loadout?.loadoutId })}
        current={Boolean(editing.loadoutId && editing.loadoutId === props.selected?.loadoutId)} catalog={props.catalog} assets={props.assets}
        loading={props.libraryLoading || Boolean(props.modelsLoading)} readFailed={props.libraryError || Boolean(props.modelsError)} disabled={props.busy || props.disabled}
        onRetry={props.onRetryCustomization} onClose={() => setEditing(null)}
        onApply={async draft => { await props.onApplyCustomization(draft, editingLoadout); setEditing(null); }} /> : null}
    </div>
  );
}

function CurrentModelDetails(props: Props) {
  const { t } = useTranslation();
  const identity = capabilityModelIdentity(props.selected, props.recipes, props.catalog, props.assets);
  const needsAttention = props.status.state === 'attention';
  const environmentReady = !!props.environment && props.environment.state !== 'unsupported'
    && props.environment.dependencies.every(d => !d.required || isNimiRuntimeLocalEnvironmentDependencyReadyState(d.state));
  const readyDependencies = props.environment?.dependencies.filter(d => d.required && isNimiRuntimeLocalEnvironmentDependencyReadyState(d.state)).length ?? 0;
  return <>
              {/* Components that still need preparing stay on the card; once all are ready they move into the technical details. */}
              {props.environment && !environmentReady ? (
                <div className="flex gap-4 pt-2">
                  {identity.shortTitle ? <span className="hidden" aria-hidden="true" /> : null}
                  <div
                    className={`min-w-0 flex-1 rounded-[var(--nimi-radius-md)] px-4 py-3 ring-1 ring-inset ${
                      needsAttention
                        ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_7%,transparent)] ring-[var(--nimi-status-warning-soft-border)]'
                        : 'bg-[var(--nimi-surface-panel)] ring-[var(--nimi-border-subtle)]'
                    }`}
                    data-testid="capability-environment-status"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        {needsAttention ? (
                          <CircleAlert size={15} className="shrink-0 text-[var(--nimi-status-warning)]" aria-hidden="true" />
                        ) : null}
                        <span className="font-semibold text-[var(--nimi-text-primary)]">
                          {t('runtimeConfig.capabilities.environment')}
                        </span>
                        <span className="text-[var(--nimi-text-secondary)]">
                          {props.environment.state === 'unsupported'
                            ? t('runtimeConfig.environment.localCapabilityStateUnsupported')
                            : t('runtimeConfig.capabilities.environmentSummary', {
                              ready: readyDependencies,
                              count: props.environment.dependencies.filter(d => d.required).length,
                            })}
                        </span>
                      </p>
                      <RuntimeEnvironmentCheck actions={props.environmentActions} />
                    </div>
                    <RuntimeEnvironmentDependencies
                      environment={props.environment}
                      jobs={props.environmentJobs}
                      actions={props.environmentActions}
                      disabled={props.disabled}
                      className={needsAttention ? 'mt-2 pl-[calc(15px+0.5rem)]' : 'mt-2'}
                    />
                  </div>
                </div>
              ) : null}

              {props.selected ? (
                <details className="group border-t border-[var(--nimi-border-subtle)]" data-testid="capability-technical-details">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)] [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                    {t('runtimeConfig.product.modelDetails')}
                  </summary>
                  {/* Indented to the summary text: card padding plus the 14px chevron and its gap. */}
                  <div className="grid gap-4 pb-3 md:grid-cols-2">
                    <div className="min-w-0">
                      <h3 className="text-xs font-semibold text-[var(--nimi-text-primary)]">
                        {t('runtimeConfig.product.technicalModel')}
                      </h3>
                      <dl className="mt-2.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                        <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.technicalRecipe')}</dt>
                        <dd className="break-words text-[var(--nimi-text-primary)]">{identity.recipeShortTitle || identity.title}</dd>
                        {identity.alias && identity.alias !== identity.shortTitle ? (
                          <>
                            <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.technicalAlias')}</dt>
                            <dd className="break-words text-[var(--nimi-text-primary)]">{identity.alias}</dd>
                          </>
                        ) : null}
                        {identity.version ? (
                          <>
                            <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.technicalVariant')}</dt>
                            <dd className="break-words text-[var(--nimi-text-primary)]">{identity.version}</dd>
                          </>
                        ) : null}
                        {identity.entryPath || identity.descriptor?.entry ? (
                          <>
                            <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.technicalFile')}</dt>
                            <dd className="break-all font-mono text-[var(--nimi-text-primary)]">{identity.entryPath || identity.descriptor?.entry}</dd>
                          </>
                        ) : null}
                      </dl>
                    </div>
                    {props.environment && !environmentReady ? null : (
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-[var(--nimi-text-primary)]">
                          {t('runtimeConfig.product.technicalEnvironment')}
                        </h3>
                        {props.environment ? (
                          <RuntimeEnvironmentDependencies environment={props.environment} jobs={props.environmentJobs} actions={props.environmentActions} disabled={props.disabled} className="mt-2.5" />
                        ) : (
                          <p className="mt-2.5 text-xs text-[var(--nimi-text-secondary)]">
                            {t('runtimeConfig.capabilities.state.unknown')}
                          </p>
                        )}
                        <RuntimeEnvironmentCheck actions={props.environmentActions} />
                      </div>
                    )}
                  </div>
                </details>
              ) : null}

  </>;
}

type ModelCost = { readonly text: string; readonly tone: 'ready' | 'download' | 'muted' };

/**
 * First-class top-level card for a saved Machine Loadout (Plan 3A).
 * Model identity takes center stage while Engine Recipe stays secondary.
 */
function SavedLoadoutCard(props: {
  readonly loadout: NimiMachineLoadout;
  readonly recipe?: NimiLoadoutRecipe;
  readonly identity: ReturnType<typeof capabilityModelIdentity>;
  readonly differences: readonly string[];
  readonly current: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onCustomize?: () => void;
  readonly currentContent?: ReactNode;
}) {
  const { t } = useTranslation();
  const title = props.identity.shortTitle || props.loadout.displayName;
  const aliasDifferent = Boolean(props.loadout.displayName && props.loadout.displayName !== title);
  const aliasAlreadyShowsVersion = Boolean(
    aliasDifferent
    && props.identity.versionShort
    && props.loadout.displayName.endsWith(`· ${props.identity.versionShort}`),
  );
  const contextSize = typeof props.loadout.options?.contextSize === 'number' && Number.isFinite(props.loadout.options.contextSize)
    ? props.loadout.options.contextSize
    : null;
  const metaParts = [
    aliasDifferent ? props.loadout.displayName : '',
    !props.current && !aliasAlreadyShowsVersion ? props.identity.versionShort : '',
    props.identity.recipeShortTitle && props.identity.recipeShortTitle !== title ? props.identity.recipeShortTitle : '',
    contextSize ? t('runtimeConfig.product.contextReduced', { size: contextSize.toLocaleString() }) : '',
    ...props.differences,
  ].filter(Boolean);
  const configuredFeatureKeys = modelFeatureLocaleKeys(props.loadout.configuredFeatures);
  const unboundOptionalSlots = props.loadout.modelAxes.filter(
    (axis) => axis.presence === 'optional-conditional' && !axis.modelAssetId,
  );
  const unsupported = modelSetupUnavailable(props.recipe, props.loadout);
  const frame = props.current
    ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_7%,var(--nimi-surface-card))] ring-1 ring-inset ring-[var(--nimi-action-primary-bg)]'
    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]';
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${frame}`}
      aria-current={props.current ? 'true' : undefined}
      data-testid={`capability-loadout:${props.loadout.loadoutId}`}
    >
      <div className="flex items-start gap-3">
        <IdentityTile seed={props.identity.seed || modelFamilySeed(title)} label={title} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-semibold leading-snug text-[var(--nimi-text-primary)]">{title}</h4>
            {props.current ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-action-primary-text)]">
                <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                {t('runtimeConfig.product.currentOnDevice')}
              </span>
            ) : null}
          </div>
          {metaParts.length > 0 ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              {metaParts.join(' · ')}
            </p>
          ) : null}
        </div>
      </div>

      {configuredFeatureKeys.length > 0 || unboundOptionalSlots.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {configuredFeatureKeys.map((key) => (
            <li key={key}>
              <StatusBadge tone="success" shape="soft">{t(key)}</StatusBadge>
            </li>
          ))}
          {unboundOptionalSlots.map((axis) => {
            const slotKey = loadoutSlotLabelKey(axis.slotId);
            const slotText = slotKey ? t(slotKey, { defaultValue: axis.displayLabel }) : axis.displayLabel;
            return (
              <li key={axis.slotId}>
                <StatusBadge tone="neutral" shape="soft">
                  {t('runtimeConfig.product.optionalFeatureHint', { slot: slotText })}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      ) : null}

      {props.currentContent}

      {props.onCustomize || !props.current ? (
        <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-[var(--nimi-border-subtle)] pt-3">
          {props.onCustomize ? (
            <Button
              tone="ghost"
              size="sm"
              disabled={props.busy || unsupported}
              data-testid={`capability-config-settings:${props.loadout.loadoutId}`}
              onClick={props.onCustomize}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              {t('runtimeConfig.product.settings.open')}
            </Button>
          ) : null}
          {!props.current ? (
            <Button
              tone="secondary"
              size="sm"
              disabled={props.busy || unsupported}
              data-testid={`capability-loadout-select:${props.loadout.loadoutId}`}
              onClick={props.onSelect}
            >
              {t('runtimeConfig.product.selectModel')}
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Available Engine Recipe plan card below saved Loadout cards.
 */
function RecipePlanCard(props: {
  readonly recipe: NimiLoadoutRecipe;
  readonly title: string;
  readonly description: string;
  readonly cost: ModelCost;
  /** Files are on this device and nothing is selected yet: offer one-click enable. */
  readonly enableable: boolean;
  /** No offer can be downloaded: lead to imported files when some exist, otherwise to import. */
  readonly noDirectDownload: 'choose-imported' | 'import' | null;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onEnable: () => void;
  readonly onChooseImported: () => void;
  readonly onImport?: () => void;
  readonly onCustomize: () => void;
}) {
  const { t } = useTranslation();
  const unsupported = props.recipe.applicability === 'unsupported';
  const fitTone: StatusTone = unsupported ? 'danger' : 'neutral';
  const FitIcon = props.recipe.applicability === 'supported'
    ? MonitorCheck
    : unsupported
      ? CircleAlert
      : CircleHelp;
  const costTone: StatusTone = props.cost.tone === 'ready' ? 'success' : props.cost.tone === 'download' ? 'info' : 'neutral';
  const CostIcon = props.cost.tone === 'ready' ? Check : props.cost.tone === 'download' ? Download : null;
  const frame = unsupported
    ? 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]';
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${frame}`}
      data-testid={`capability-model:${props.recipe.recipeId}`}
    >
      <div className="flex items-start gap-3">
        <IdentityTile seed={modelFamilySeed(props.recipe.title)} label={props.title} size="lg" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold leading-snug text-[var(--nimi-text-primary)]">{props.title}</h4>
          {props.description ? <p className={`mt-1 text-sm leading-relaxed ${unsupported ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-secondary)]'}`}>
            {props.description}
          </p> : null}
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        <li>
          <StatusBadge tone={costTone} shape="soft">
            {CostIcon ? <CostIcon size={12} aria-hidden="true" /> : null}
            {props.cost.text}
          </StatusBadge>
        </li>
        <li>
          <StatusBadge tone={fitTone} shape="soft">
            <FitIcon size={12} aria-hidden="true" />
            {t(`runtimeConfig.product.modelFit.${props.recipe.applicability}`)}
          </StatusBadge>
        </li>
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-[var(--nimi-border-subtle)] pt-3">
        <Button tone="ghost" size="sm" disabled={props.busy || unsupported} data-testid={`capability-model-settings:${props.recipe.recipeId}`} onClick={props.onCustomize}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          {t('runtimeConfig.product.settings.open')}
        </Button>
        {props.enableable ? (
          <Button tone="primary" size="sm" disabled={props.busy} onClick={props.onEnable} data-testid="capability-enable-downloaded">
            {t('runtimeConfig.product.enableModel')}
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        ) : props.noDirectDownload === 'choose-imported' ? (
          <Button tone="secondary" size="sm" disabled={props.busy || unsupported} onClick={props.onChooseImported}>
            {t('runtimeConfig.product.chooseImportedFiles')}
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        ) : props.noDirectDownload === 'import' ? (
          <Button tone="secondary" size="sm" disabled={props.busy || !props.onImport} onClick={props.onImport}>
            <FolderOpen size={14} aria-hidden="true" />
            {t('runtimeConfig.product.importModel')}
          </Button>
        ) : (
          <Button tone="secondary" size="sm" disabled={props.busy || unsupported} onClick={props.onSelect}>
            {t('runtimeConfig.product.selectModel')}
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  );
}
