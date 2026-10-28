import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  type StatusTone,
  TextField,
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
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Download,
  FolderOpen,
  LoaderCircle,
  MonitorCheck,
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
  capabilityIcon,
  capabilityModelIdentity,
  modelDisplayTitle,
  modelFamilySeed,
  modelFeatureLocaleKeys,
  recipeOfferSummary,
} from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel, displayRuntimeConfigCapabilityUsage } from './runtime-config-capability-labels.js';
import { RuntimeEnvironmentCheck, RuntimeEnvironmentDependencies, type RuntimeEnvironmentActions } from './runtime-environment-details.js';
import { SavedConfigsView } from './runtime-config-page-loadouts.js';
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
  /** Uses the exact saved configuration or recipe recommendation after checking its preparation plan. */
  onEnable: (recipe: string, previous?: NimiMachineLoadout) => Promise<void>;
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
    ? 'animate-spin text-[var(--nimi-status-info)]'
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
        <Icon size={15} className={`shrink-0 ${iconClass}`} />
        <span className="min-w-0">
          {props.model
            ? t(`runtimeConfig.product.pendingSetup.${kind}`, { model: props.model })
            : t(`runtimeConfig.product.pendingSetup.${kind}Unnamed`)}
        </span>
      </span>
      <Button tone="secondary" size="sm" onClick={props.onOpen}>
        {t(`runtimeConfig.product.pendingSetup.${action}`)}
        <ArrowRight size={14} />
      </Button>
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeCapabilityDetail(props: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ recipeId: string; loadoutId?: string; chooseConfiguration?: boolean } | null>(null);
  const label = displayRuntimeConfigCapabilityLabel(props.capability, t);
  const Icon = capabilityIcon(props.capability);
  const currentIdentity = capabilityModelIdentity(props.selected, props.recipes, props.catalog);
  const loadouts = props.selected && !props.loadouts.some(item => item.loadoutId === props.selected!.loadoutId)
    ? [props.selected, ...props.loadouts] : props.loadouts;
  const matched = props.recipes.filter(recipe => `${recipe.title} ${loadouts.filter(item => item.recipeId === recipe.recipeId).map(item => item.displayName).join(' ')}`
    .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // Only the current selection moves to the front. Owner recommendation order remains intact otherwise.
  const ordered = [...matched.filter(recipe => recipe.recipeId === props.selected?.recipeId), ...matched.filter(recipe => recipe.recipeId !== props.selected?.recipeId)];
  const editingLoadout = editing?.loadoutId ? loadouts.find(item => item.loadoutId === editing.loadoutId) : undefined;
  const editingRecipe = props.recipes.find(recipe => recipe.recipeId === editing?.recipeId);
  const unboundImports = props.assets.some(asset => !asset.catalogVerified
    && !loadouts.some(loadout => loadout.modelAxes.some(axis => axis.modelAssetId === asset.modelAssetId)));
  const costOf = (recipe: NimiLoadoutRecipe, saved: readonly NimiMachineLoadout[]): ModelCost => {
    if (props.modelsLoading || props.libraryLoading) return { text: t('Common.loading'), tone: 'muted' };
    if (props.modelsError || props.libraryError) return { text: t('runtimeConfig.product.preparationUnknown'), tone: 'muted' };
    if (saved.length > 0) return { text: t('runtimeConfig.product.savedConfiguration'), tone: 'muted' };
    const summary = recipeOfferSummary(recipe);
    if (summary.withoutOffer > 0) return { text: t('runtimeConfig.product.noDirectDownload'), tone: 'muted' };
    if (summary.missing === 0) return { text: t('runtimeConfig.product.modelsOnDevice'), tone: 'ready' };
    if (summary.downloadBytes === null) return { text: t('runtimeConfig.product.downloadSizeUnknown'), tone: 'muted' };
    return { text: t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.downloadBytes) }), tone: 'download' };
  };
  if (props.section === 'saved') return <SavedConfigsView contextual capabilityContract={props.capability}
    backLabel={t('runtimeConfig.localModels.backToModels')}
    navigationContext={props.navigationContext ?? { capabilityContract: props.capability }} onBack={() => props.onSection('models')}
    environmentWritesDisabled={props.disabled} onPrepareEnvironment={loadout => { void props.onStart(loadout.recipeId, loadout); }} onOpenModelMarket={props.onModelMarket} />;
  const controlsDisabled = props.busy || props.disabled || Boolean(props.modelsLoading || props.modelsError || props.libraryLoading || props.libraryError);
  return (
    <div className="desktop-module-stack" data-testid={`ai-capability-detail:${props.capability}`}>
      <header className="flex items-start gap-3">
        <span className="desktop-module-header-icon flex items-center justify-center bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]"><Icon size={24} strokeWidth={1.6} /></span>
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
              {props.recipes.length > 6 ? <TextField aria-label={t('runtimeConfig.product.searchModels')} placeholder={t('runtimeConfig.product.searchModels')} value={query} onChange={event => setQuery(event.currentTarget.value)} /> : null}
              <Button tone="secondary" size="sm" onClick={() => props.onModelMarket({ kind: 'browse', capabilityContract: props.capability })}><Store size={14} />{t('runtimeConfig.product.modelPicker.browse')}</Button>
              {props.onImportModelFiles || props.onModelFiles ? <Button tone="secondary" size="sm" onClick={props.onImportModelFiles ?? props.onModelFiles} data-testid="capability-models-import"><FolderOpen size={14} />{t('runtimeConfig.product.importModel')}</Button> : null}
            </div>
          </div>
          {props.modelsError || props.libraryError ? <InlineAlert tone="warning">{t('runtimeConfig.product.preparationUnknown')}<Button tone="ghost" size="sm" onClick={props.onRetryCustomization}>{t('Common.retry')}</Button></InlineAlert> : null}
          {props.selected && !props.recipes.some(recipe => recipe.recipeId === props.selected!.recipeId) ? (
            <div className="rounded-xl bg-[var(--nimi-surface-card)] p-4" data-testid="capability-current-model" data-loadout-id={props.selected.loadoutId}>
              <p className="font-semibold">{currentIdentity.shortTitle || props.selected.displayName}</p>
              <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.currentOnDevice')}</p>
              <InlineAlert tone="warning">{t('runtimeConfig.product.preparationUnknown')}</InlineAlert>
              <CurrentModelDetails {...props} />
            </div>
          ) : null}
          {props.modelsLoading && !ordered.length ? <LoadingSkeleton lines={4} /> : ordered.length ? (
            <div className="space-y-3" data-testid="capability-model-list">
              {ordered.map(recipe => {
                const saved = loadouts.filter(item => item.recipeId === recipe.recipeId && item.validationState === 'configured');
                const current = props.selected?.recipeId === recipe.recipeId;
                const noDirectDownload = !props.modelsLoading && !props.modelsError && recipeOfferSummary(recipe).withoutOffer > 0;
                const features = modelFeatureLocaleKeys(recipe.implementationSupportedFeatures);
                const settings = (loadout?: NimiMachineLoadout) => {
                  const target = loadout ?? (current ? props.selected : undefined);
                  setEditing({ recipeId: recipe.recipeId, loadoutId: target?.loadoutId, chooseConfiguration: !target && saved.length > 1 });
                };
                return <ModelChoiceCard key={recipe.recipeId} recipe={recipe} title={modelDisplayTitle(recipe.title)}
                  description={features.map(key => t(key)).join(' · ')} cost={costOf(recipe, saved)} current={current}
                  enableable={!props.selected && props.downloadedRecipe?.recipeId === recipe.recipeId} saved={saved}
                  noDirectDownload={!noDirectDownload ? null : unboundImports && props.onChooseImportedFiles ? 'choose-imported' : 'import'}
                  selectedLoadoutId={props.selected?.loadoutId} recipes={props.recipes} catalog={props.catalog} busy={controlsDisabled}
                  onSelect={() => { void props.onEnable(recipe.recipeId); }} onEnable={() => { void props.onEnable(recipe.recipeId); }}
                  onUseSaved={item => { void props.onEnable(item.recipeId, item); }}
                  onChooseImported={() => props.onChooseImportedFiles?.(recipe.recipeId)} onImport={props.onImportModelFiles ?? props.onModelFiles}
                  onCustomize={settings}
                  currentContent={current ? <div className="space-y-3" data-testid="capability-current-model" data-loadout-id={props.selected?.loadoutId}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
                        <span>{[currentIdentity.versionShort, currentIdentity.sizeBytes ? t('runtimeConfig.product.aboutSize', { size: formatBytes(currentIdentity.sizeBytes) }) : ''].filter(Boolean).join(' · ')}</span>
                        <StatusBadge tone={props.status.state === 'ready' ? 'success' : props.status.state === 'attention' ? 'warning' : 'neutral'} shape="soft" data-testid="capability-state-badge">{t(`runtimeConfig.capabilities.state.${props.status.state}`)}</StatusBadge>
                      </div>
                      {props.status.state !== 'ready' && !props.preparation ? <Button tone="secondary" size="sm" disabled={controlsDisabled} onClick={() => { if (props.status.task) props.onTask(props.status.task.taskId); else void props.onStart(recipe.recipeId, props.selected); }}>{t(props.status.state === 'unknown' ? 'runtimeConfig.setupTask.checkPreparation' : 'runtimeConfig.setupTask.repairSetup')}</Button> : null}
                    </div>
                    <CurrentModelDetails {...props} />
                  </div> : undefined} />;
              })}
            </div>
          ) : !props.modelsError ? <p className="py-6 text-sm text-[var(--nimi-text-secondary)]">{t(query ? 'runtimeConfig.product.noModelsMatch' : 'runtimeConfig.product.settings.empty')}</p> : null}
          {ordered.length ? <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.switchNote')}</p> : null}
          {loadouts.length ? <Button tone="ghost" size="sm" onClick={() => props.onSection('saved')}><Bookmark size={14} />{t('runtimeConfig.product.manageSaved')}</Button> : null}
        </div>
        {props.apps ? <aside className="min-w-0">{props.apps}</aside> : null}
      </div>
      {editing ? <RuntimeCapabilitySettingsDialog key={editing.recipeId}
        recipe={editingRecipe} selected={editingLoadout} missingConfiguration={Boolean(editing.loadoutId && !editingLoadout)}
        configurations={editing.chooseConfiguration ? loadouts.filter(item => item.recipeId === editing.recipeId && item.validationState === 'configured') : undefined}
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
  const identity = capabilityModelIdentity(props.selected, props.recipes, props.catalog);
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
                        <dd className="break-words text-[var(--nimi-text-primary)]">{identity.title}</dd>
                        {identity.alias && identity.alias !== identity.title ? (
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
                        {identity.descriptor?.entry ? (
                          <>
                            <dt className="text-[var(--nimi-text-muted)]">{t('runtimeConfig.product.technicalFile')}</dt>
                            <dd className="break-all font-mono text-[var(--nimi-text-primary)]">{identity.descriptor.entry}</dd>
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
 * One model choice. The card answers the three questions a person has before
 * choosing: what this model adds, whether it runs here, and what it costs to
 * get (already on this device, or how much to download). The current model
 * is framed in the accent colour and offers customization instead of a
 * second "select"; saved configurations stay one tap away inside the card.
 */
function ModelChoiceCard(props: {
  readonly recipe: NimiLoadoutRecipe;
  readonly title: string;
  readonly description: string;
  readonly cost: ModelCost;
  readonly current: boolean;
  /** Files are on this device and nothing is selected yet: offer one-click enable. */
  readonly enableable: boolean;
  readonly saved: readonly NimiMachineLoadout[];
  /** No offer can be downloaded: lead to imported files when some exist, otherwise to import. */
  readonly noDirectDownload: 'choose-imported' | 'import' | null;
  readonly selectedLoadoutId?: string;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onEnable: () => void;
  readonly onUseSaved: (item: NimiMachineLoadout) => void;
  readonly onChooseImported: () => void;
  readonly onImport?: () => void;
  readonly onCustomize: (loadout?: NimiMachineLoadout) => void;
  readonly currentContent?: ReactNode;
}) {
  const { t } = useTranslation();
  const [savedOpen, setSavedOpen] = useState(false);
  const onlySaved = props.saved.length === 1 ? props.saved[0] : undefined;
  const settingsTarget = props.saved.find(item => item.loadoutId === props.selectedLoadoutId) ?? onlySaved;
  const unsupported = props.recipe.applicability === 'unsupported';
  const fitTone: StatusTone = unsupported ? 'danger' : 'neutral';
  const FitIcon = props.recipe.applicability === 'supported'
    ? MonitorCheck
    : unsupported
      ? CircleAlert
      : CircleHelp;
  const costTone: StatusTone = props.cost.tone === 'ready' ? 'success' : props.cost.tone === 'download' ? 'info' : 'neutral';
  const CostIcon = props.cost.tone === 'ready' ? Check : props.cost.tone === 'download' ? Download : null;
  const frame = props.current
    ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_7%,var(--nimi-surface-card))] ring-1 ring-inset ring-[var(--nimi-action-primary-bg)]'
    : unsupported
      ? 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]';
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${frame}`}
      aria-current={props.current ? 'true' : undefined}
      data-testid={`capability-model:${props.recipe.recipeId}`}
    >
      <div className="flex items-start gap-3">
        <IdentityTile seed={modelFamilySeed(props.recipe.title)} label={props.title} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-semibold leading-snug text-[var(--nimi-text-primary)]">{props.title}</h3>
            {props.current ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-action-primary-text)]">
                <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                {t('runtimeConfig.product.currentOnDevice')}
              </span>
            ) : null}
          </div>
          {props.description ? <p className={`mt-1 text-sm leading-relaxed ${unsupported ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-secondary)]'}`}>
            {props.description}
          </p> : null}
        </div>
      </div>
      {props.currentContent}
      {!props.current ? <ul className="flex flex-wrap gap-1.5">
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
      </ul> : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3">
        {props.saved.length ? (
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[var(--nimi-radius-sm)] px-1 text-sm text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]"
            aria-expanded={savedOpen}
            onClick={() => setSavedOpen((value) => !value)}
          >
            <Bookmark size={14} aria-hidden="true" />
            {t('runtimeConfig.product.savedVersions', { count: props.saved.length })}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform ${savedOpen ? 'rotate-180' : ''}`}
            />
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
        <Button tone="ghost" size="sm" disabled={props.busy || unsupported} data-testid={`capability-model-settings:${props.recipe.recipeId}`} onClick={() => props.onCustomize(settingsTarget)}><SlidersHorizontal size={14} />{t('runtimeConfig.product.settings.open')}</Button>
        {props.current ? null : props.enableable ? (
          <Button tone="primary" size="sm" disabled={props.busy} onClick={props.onEnable} data-testid="capability-enable-downloaded">
            {t('runtimeConfig.product.enableModel')}
            <ArrowRight size={14} />
          </Button>
        ) : onlySaved ? (
          // Selecting a recipe that already has one saved configuration reuses
          // that exact configuration instead of starting an empty candidate.
          <Button tone="secondary" size="sm" disabled={props.busy || unsupported} onClick={() => props.onUseSaved(onlySaved)}>
            {t('runtimeConfig.product.selectModel')}
            <ArrowRight size={14} />
          </Button>
        ) : props.saved.length > 1 ? (
          <Button tone="secondary" size="sm" disabled={props.busy} aria-expanded={savedOpen} onClick={() => setSavedOpen(true)}>
            {t('runtimeConfig.product.selectModel')}
            <ChevronDown size={14} />
          </Button>
        ) : props.noDirectDownload === 'choose-imported' ? (
          <Button tone="secondary" size="sm" disabled={props.busy || unsupported} onClick={props.onChooseImported}>
            {t('runtimeConfig.product.chooseImportedFiles')}
            <ArrowRight size={14} />
          </Button>
        ) : props.noDirectDownload === 'import' ? (
          <Button tone="secondary" size="sm" disabled={props.busy || !props.onImport} onClick={props.onImport}>
            <FolderOpen size={14} />
            {t('runtimeConfig.product.importModel')}
          </Button>
        ) : (
          <Button tone="secondary" size="sm" disabled={props.busy || unsupported} onClick={props.onSelect}>
            {t('runtimeConfig.product.selectModel')}
            <ArrowRight size={14} />
          </Button>
        )}
        </div>
      </div>
      {savedOpen && props.saved.length ? (
        <ul className="divide-y divide-[var(--nimi-border-subtle)] rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] px-3">
          {props.saved.map((item) => {
            const model = capabilityModelIdentity(item, props.recipes, props.catalog);
            const isSelected = item.loadoutId === props.selectedLoadoutId;
            return (
              <li key={item.loadoutId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.displayName}</p>
                  <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">
                    {model.versionShort || t('runtimeConfig.product.savedConfiguration')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                <Button tone="ghost" size="sm" disabled={props.busy || unsupported} data-testid={`capability-config-settings:${item.loadoutId}`} onClick={() => props.onCustomize(item)}>{t('runtimeConfig.product.settings.open')}</Button>
                {isSelected ? (
                  <StatusBadge tone="success" shape="soft">
                    <Check size={12} aria-hidden="true" />
                    {t('runtimeConfig.product.currentOnDevice')}
                  </StatusBadge>
                ) : (
                  <Button tone="ghost" size="sm" disabled={props.busy} onClick={() => props.onUseSaved(item)}>
                    {t('runtimeConfig.product.useSavedVersion')}
                  </Button>
                )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
