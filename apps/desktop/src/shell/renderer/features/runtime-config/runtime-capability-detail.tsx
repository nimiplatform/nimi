import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  NimiTabs,
  StatusBadge,
  type StatusTone,
  TextField,
  Tooltip,
} from '@nimiplatform/kit/ui';
import {
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiLoadoutRecipe,
  type NimiMachineLoadout,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalVerifiedAssetDescriptor,
  type NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  ArrowLeft,
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
  Info,
  LoaderCircle,
  MonitorCheck,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import type { capabilityPreparationState } from './runtime-capability-inventory.js';
import { RuntimeCapabilityModelPicker } from './runtime-capability-model-picker.js';
import { RuntimeCapabilityCustomize } from './runtime-capability-customize.js';
import {
  capabilityIcon,
  capabilityModelIdentity,
  modelDisplayTitle,
  modelFeatureLocaleKeys,
  recipeOfferSummary,
} from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel, displayRuntimeConfigCapabilityUsage } from './runtime-config-capability-labels.js';
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
  status: ReturnType<typeof capabilityPreparationState>;
  /** Model the in-flight setup works on; '' when its candidate is not known. */
  taskModel: string;
  section: string;
  onSection: (section: string) => void;
  busy: boolean;
  disabled: boolean;
  navigationContext: RuntimeConfigLoadoutNavigationContext | null;
  onHome: () => void;
  onStart: (recipe: string, previous?: NimiMachineLoadout) => Promise<void>;
  /** Uses the exact saved configuration or recipe recommendation after checking its preparation plan. */
  onEnable: (recipe: string, previous?: NimiMachineLoadout) => Promise<void>;
  onApplyCustomization: (draft: RuntimeSetupTaskDraft) => Promise<void>;
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

function modelFamilySeed(title: string): string {
  return modelDisplayTitle(title).split(/[\s\-_/]+/u)[0]?.toLowerCase() ?? title;
}

function ScopeHint({ text }: { readonly text: string }) {
  return (
    <Tooltip content={text} placement="top">
      <span className="inline-flex cursor-help items-center text-[var(--nimi-text-muted)]" aria-label={text}>
        <Info size={14} />
      </span>
    </Tooltip>
  );
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeCapabilityDetail(props: Props) {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [query, setQuery] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const label = displayRuntimeConfigCapabilityLabel(props.capability, t);
  const Icon = capabilityIcon(props.capability);
  const identity = capabilityModelIdentity(props.selected, props.recipes, props.catalog);
  const capabilityKey = props.capability.replace(/[._]/g, '-');
  const usage = displayRuntimeConfigCapabilityUsage(props.capability, t);
  const shortUse = t(`runtimeConfig.product.shortUse.${capabilityKey}`, { defaultValue: label });
  // Without a selection the card describes the downloaded recipe instead, so
  // the person sees what they would enable rather than an empty "not set".
  const downloaded = !props.selected ? props.downloadedRecipe : undefined;
  const shownRecipe = identity.recipe ?? downloaded;
  const featureKeys = modelFeatureLocaleKeys(shownRecipe?.implementationSupportedFeatures ?? []);
  const downloadedSummary = downloaded ? recipeOfferSummary(downloaded) : null;
  const cardTitle = identity.shortTitle || (downloaded ? modelDisplayTitle(downloaded.title) : '');
  const cardSeed = identity.title || downloaded?.title || '';
  const matched = props.recipes.filter((recipe) =>
    `${recipe.title} ${props.loadouts
      .filter((item) => item.recipeId === recipe.recipeId)
      .map((item) => item.displayName)
      .join(' ')}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const isReady = props.status.state === 'ready';
  // The same dependency reading as the capability list, so the card and the rail agree.
  const environmentReady =
    !!props.environment &&
    props.environment.dependencies.every(
      (d) => !d.required || isNimiRuntimeLocalEnvironmentDependencyReadyState(d.state),
    );
  const readyDependencies =
    props.environment?.dependencies.filter((d) => isNimiRuntimeLocalEnvironmentDependencyReadyState(d.state)).length ?? 0;
  const chipSize = identity.sizeBytes ?? downloadedSummary?.installedBytes ?? null;
  const versionChip = [identity.versionShort, chipSize ? t('runtimeConfig.product.aboutSize', { size: formatBytes(chipSize) }) : '']
    .filter(Boolean)
    .join(' · ');
  const openUse = () => setActiveTab(props.capability === 'text.generate' ? 'chat' : 'apps');
  // Imported files that no saved configuration of this capability uses yet;
  // Runtime validates any of them only when they are chosen for a recipe.
  const unboundImports = props.assets.some((asset) => !asset.catalogVerified
    && !props.loadouts.some((loadout) => loadout.modelAxes.some((axis) => axis.modelAssetId === asset.modelAssetId)));
  // The card reads Runtime's offers: a saved configuration is reused first,
  // an exact installed offer counts as on this device, and a download names
  // the source transfer size only when Runtime knows it.
  const costOf = (recipe: NimiLoadoutRecipe, saved: readonly NimiMachineLoadout[]): ModelCost => {
    if (props.modelsLoading) return { text: t('Common.loading'), tone: 'muted' };
    if (props.modelsError) return { text: t('runtimeConfig.product.preparationUnknown'), tone: 'muted' };
    if (saved.length > 0) return { text: t('runtimeConfig.product.modelsOnDevice'), tone: 'ready' };
    const summary = recipeOfferSummary(recipe);
    if (summary.withoutOffer > 0) return { text: t('runtimeConfig.product.noDirectDownload'), tone: 'muted' };
    if (summary.missing === 0)
      return {
        text: summary.installedBytes !== null
          ? t('runtimeConfig.product.onDeviceWithSize', { size: formatBytes(summary.installedBytes) })
          : t('runtimeConfig.product.modelsOnDevice'),
        tone: 'ready',
      };
    if (summary.downloadBytes === null) return { text: t('runtimeConfig.product.downloadSizeUnknown'), tone: 'muted' };
    return { text: t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.downloadBytes) }), tone: 'download' };
  };
  // Customizing works on the current model, so its tab exists only with one; a
  // section left on it after the selection is gone falls back to the overview.
  const sections = props.selected ? ['overview', 'models', 'advanced'] : ['overview', 'models'];
  const section = props.section === 'advanced' && !props.selected ? 'overview' : props.section;
  const { onSection } = props;
  useEffect(() => {
    if (section !== props.section) onSection(section);
  }, [onSection, props.section, section]);
  if (props.section === 'saved')
    return (
      <SavedConfigsView
        contextual
        capabilityContract={props.capability}
        navigationContext={props.navigationContext ?? { capabilityContract: props.capability }}
        onBack={() => props.onSection('advanced')}
        onOpenAdvancedDiagnostics={props.onDiagnostics}
        onOpenModelMarket={props.onModelMarket}
      />
    );
  const needsAttention = props.status.state === 'attention';
  const stateBadge = isReady ? (
    <StatusBadge tone="success" shape="dot" data-testid="capability-state-badge">
      {t('runtimeConfig.capabilities.state.ready')}
    </StatusBadge>
  ) : downloaded ? (
    <StatusBadge tone="neutral" shape="soft" data-testid="capability-downloaded-badge">
      {t('runtimeConfig.capabilities.state.downloaded')}
    </StatusBadge>
  ) : props.status.state !== 'unset' ? (
    <StatusBadge
      tone={needsAttention ? 'warning' : props.status.state === 'preparing' ? 'info' : 'neutral'}
      shape="soft"
      data-testid="capability-state-badge"
    >
      {props.status.state === 'preparing' ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : null}
      {needsAttention ? <CircleAlert size={12} aria-hidden="true" /> : null}
      {t(`runtimeConfig.capabilities.state.${props.status.state}`)}
    </StatusBadge>
  ) : null;
  return (
    <div className="space-y-6" data-testid={`ai-capability-detail:${props.capability}`}>
      <Button tone="ghost" size="sm" className="-ml-3" onClick={props.onHome}>
        <ArrowLeft size={15} />
        {t('runtimeConfig.product.backToSetups')}
      </Button>
      <header className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
          <Icon size={25} strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
            {usage}
          </p>
        </div>
      </header>
      <NimiTabs
        ariaLabel={t('runtimeConfig.capabilities.details')}
        value={section}
        onValueChange={props.onSection}
        items={sections.map((value) => ({
          value,
          label: t(`runtimeConfig.capabilities.tabs.${value}`),
        }))}
      />

      {props.status.task ? (
        <PendingSetupBanner
          task={props.status.task}
          model={props.taskModel}
          onOpen={() => props.onTask(props.status.task!.taskId)}
        />
      ) : null}

      {section === 'overview' ? (
        <section
          className="overflow-hidden rounded-2xl bg-[var(--nimi-surface-card)]"
          data-testid="capability-current-model"
        >
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4 p-5 lg:p-6">
            <div className="flex min-w-[16rem] flex-1 items-start gap-4">
              {cardTitle ? (
                <IdentityTile seed={modelFamilySeed(cardSeed)} label={cardTitle} size="lg" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h2 className="text-xl font-semibold leading-7">
                    {cardTitle || t('runtimeConfig.aiSettings.notConfigured')}
                  </h2>
                  {stateBadge}
                </div>
                {/* A downloaded recipe is not selected yet, so it is never labeled as the current model. */}
                {!downloaded || versionChip ? (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-muted)]">
                    {!downloaded ? (
                      <>
                        {t('runtimeConfig.product.currentOnDevice')}
                        <ScopeHint text={t('runtimeConfig.product.localScopeHelp')} />
                      </>
                    ) : null}
                    {!downloaded && versionChip ? <span aria-hidden="true">·</span> : null}
                    {versionChip ? <span>{versionChip}</span> : null}
                  </p>
                ) : null}
                {!props.selected ? (
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
                    {t(downloaded ? 'runtimeConfig.product.downloadedLead' : 'runtimeConfig.product.chooseModelLead')}
                  </p>
                ) : null}
                {cardTitle ? (
                  <ul className="mt-4 flex flex-wrap gap-2" aria-label={t('runtimeConfig.product.whatItDoes')}>
                    {[shortUse, ...featureKeys.map((key) => t(key))].map((text, index) => (
                      <li
                        key={`${index}:${text}`}
                        className="rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] px-2.5 py-1 text-xs text-[var(--nimi-text-secondary)]"
                      >
                        {text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-[7px]">
              {props.selected || downloaded ? (
                <Button tone="secondary" disabled={props.busy} onClick={() => setModelPickerOpen(true)} data-testid="capability-change-model">
                  {t('runtimeConfig.product.changeModel')}
                </Button>
              ) : null}
              {props.selected ? (
                <Button
                  tone="primary"
                  disabled={props.busy || props.disabled}
                  onClick={() => {
                    if (isReady) openUse();
                    else if (props.status.task) props.onTask(props.status.task.taskId);
                    else void props.onStart(props.selected!.recipeId, props.selected);
                  }}
                >
                  {t(
                    !isReady
                      ? 'runtimeConfig.product.viewPreparation'
                      : props.capability === 'text.generate'
                        ? 'runtimeConfig.overview.openChat'
                        : 'runtimeConfig.product.openApps',
                  )}
                  <ArrowRight size={15} />
                </Button>
              ) : downloaded ? (
                <Button
                  tone="primary"
                  disabled={props.busy || props.disabled}
                  data-testid="capability-enable-downloaded"
                  onClick={() => {
                    void props.onEnable(downloaded.recipeId);
                  }}
                >
                  {t('runtimeConfig.product.enableModel')}
                  <ArrowRight size={15} />
                </Button>
              ) : (
                <Button tone="primary" onClick={() => props.onSection('models')}>
                  {t('runtimeConfig.capabilities.chooseModel')}
                  <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </div>

          {/* Components that still need preparing stay on the card; once all are ready they move into the technical details. */}
          {props.environment && !environmentReady ? (
            <div className="flex gap-4 px-5 pb-5 lg:px-6 lg:pb-6">
              {cardTitle ? <span className="w-12 shrink-0" aria-hidden="true" /> : null}
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
                      {t('runtimeConfig.capabilities.environmentSummary', {
                        ready: readyDependencies,
                        count: props.environment.dependencies.length,
                      })}
                    </span>
                  </p>
                  <Button tone="ghost" size="sm" className="-mr-2" onClick={props.onDiagnostics}>
                    {t('runtimeConfig.nav.advancedDiagnostics')}
                    <ChevronRight size={14} />
                  </Button>
                </div>
                <EnvironmentDependencies
                  environment={props.environment}
                  className={needsAttention ? 'mt-2 pl-[calc(15px+0.5rem)]' : 'mt-2'}
                />
              </div>
            </div>
          ) : null}

          {props.selected ? (
            <details className="group border-t border-[var(--nimi-border-subtle)]" data-testid="capability-technical-details">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)] lg:px-6 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                {t('runtimeConfig.profiles.technicalDetails')}
              </summary>
              {/* Indented to the summary text: card padding plus the 14px chevron and its gap. */}
              <div className="grid gap-x-12 gap-y-5 pb-5 pl-[calc(1.25rem+14px+0.5rem)] pr-5 md:grid-cols-2 lg:pb-6 lg:pl-[calc(1.5rem+14px+0.5rem)] lg:pr-6">
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
                      <EnvironmentDependencies environment={props.environment} className="mt-2.5" />
                    ) : (
                      <p className="mt-2.5 text-xs text-[var(--nimi-text-secondary)]">
                        {t('runtimeConfig.capabilities.state.unknown')}
                      </p>
                    )}
                    <Button tone="ghost" size="sm" className="-ml-3 mt-2" onClick={props.onDiagnostics}>
                      {t('runtimeConfig.nav.advancedDiagnostics')}
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                )}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {modelPickerOpen ? (
        <RuntimeCapabilityModelPicker
          label={label}
          selected={props.selected}
          loadouts={props.loadouts}
          recipes={props.recipes}
          catalog={props.catalog}
          assets={props.assets}
          libraryLoading={props.libraryLoading}
          libraryError={props.libraryError}
          loading={props.modelsLoading ?? false}
          error={props.modelsError ?? false}
          busy={props.busy}
          disabled={props.disabled}
          onChoose={async (recipe, previous) => {
            await props.onEnable(recipe, previous);
            setModelPickerOpen(false);
          }}
          onCustomize={() => {
            setModelPickerOpen(false);
            props.onSection('advanced');
          }}
          onBrowse={() => {
            setModelPickerOpen(false);
            props.onModelMarket({ kind: 'browse', capabilityContract: props.capability });
          }}
          onImport={props.onImportModelFiles || props.onModelFiles ? () => {
            setModelPickerOpen(false);
            (props.onImportModelFiles ?? props.onModelFiles)?.();
          } : undefined}
          onClose={() => setModelPickerOpen(false)}
        />
      ) : null}

      {section === 'models' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t('runtimeConfig.product.chooseYourModel')}</h2>
            {props.recipes.length > 6 ? (
              <div className="relative w-full sm:w-60">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-3 text-[var(--nimi-text-secondary)]"
                />
                <TextField
                  aria-label={t('runtimeConfig.product.searchModels')}
                  placeholder={t('runtimeConfig.product.searchModels')}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  className="pl-9"
                />
              </div>
            ) : null}
          </div>
          {props.libraryError ? (
            <InlineAlert tone="warning">{t('runtimeConfig.product.preparationUnknown')}</InlineAlert>
          ) : null}
          {matched.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {matched.map((recipe) => {
                const recipeFeatures = modelFeatureLocaleKeys(recipe.implementationSupportedFeatures);
                const saved = props.loadouts.filter(
                  (item) => item.recipeId === recipe.recipeId && item.validationState === 'configured',
                );
                const noDirectDownload = !props.modelsLoading && !props.modelsError && recipeOfferSummary(recipe).withoutOffer > 0;
                return (
                  <ModelChoiceCard
                    key={recipe.recipeId}
                    recipe={recipe}
                    title={modelDisplayTitle(recipe.title)}
                    description={
                      recipeFeatures.length ? recipeFeatures.map((key) => t(key)).join(' · ') : shortUse
                    }
                    cost={costOf(recipe, saved)}
                    current={props.selected?.recipeId === recipe.recipeId}
                    enableable={!props.selected && props.downloadedRecipe?.recipeId === recipe.recipeId}
                    saved={saved}
                    noDirectDownload={!noDirectDownload ? null
                      : unboundImports && props.onChooseImportedFiles ? 'choose-imported' : 'import'}
                    selectedLoadoutId={props.selected?.loadoutId}
                    recipes={props.recipes}
                    catalog={props.catalog}
                    busy={props.busy || props.disabled}
                    onSelect={() => {
                      void props.onStart(recipe.recipeId);
                    }}
                    onEnable={() => {
                      void props.onEnable(recipe.recipeId);
                    }}
                    onUseSaved={(item) => {
                      void props.onStart(item.recipeId, item);
                    }}
                    onChooseImported={() => props.onChooseImportedFiles?.(recipe.recipeId)}
                    onImport={props.onImportModelFiles ?? props.onModelFiles}
                    onCustomize={() => props.onSection('advanced')}
                  />
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl bg-[var(--nimi-surface-card)] px-4 py-6 text-center text-sm text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.product.noModelsMatch')}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--nimi-border-strong)] px-4 py-3">
            <p className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
              <FolderOpen size={16} strokeWidth={1.7} aria-hidden="true" />
              {t('runtimeConfig.product.importModelLead')}
            </p>
            <Button tone="ghost" size="sm" onClick={props.onImportModelFiles ?? props.onModelFiles}>
              {t('runtimeConfig.product.importModel')}
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      ) : null}

      {section === 'advanced' && props.selected ? (
        <div className="space-y-6">
          {props.libraryLoading || props.modelsLoading ? <LoadingSkeleton lines={4} /> : (
            <>
              {props.libraryError || props.modelsError || !identity.recipe ? (
                <InlineAlert tone="warning">
                  <p>{t('runtimeConfig.product.customization.unavailable')}</p>
                  {props.onRetryCustomization ? <Button tone="secondary" size="sm" onClick={props.onRetryCustomization}>{t('Common.retry')}</Button> : null}
                </InlineAlert>
              ) : null}
              {identity.recipe ? <RuntimeCapabilityCustomize
                key={`${props.selected.loadoutId}:${props.selected.revision}`}
                selected={props.selected}
                recipe={identity.recipe}
                assets={props.assets}
                catalog={props.catalog}
                disabled={props.busy || props.disabled || props.libraryError || Boolean(props.modelsError)}
                onApply={props.onApplyCustomization}
              /> : null}
            </>
          )}
          <div className="flex flex-wrap gap-2 border-t border-[var(--nimi-border-subtle)] pt-4">
            <Button tone="secondary" size="sm" onClick={() => props.onSection('saved')}>
              <Settings2 size={14} />
              {t('runtimeConfig.product.manageSaved')}
            </Button>
            <Button tone="ghost" size="sm" onClick={props.onModelFiles}>
              {t('runtimeConfig.capabilities.manageFiles')}
            </Button>
            <Button tone="ghost" size="sm" onClick={props.onDiagnostics}>
              {t('runtimeConfig.nav.advancedDiagnostics')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
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
  readonly onCustomize: () => void;
}) {
  const { t } = useTranslation();
  const [savedOpen, setSavedOpen] = useState(false);
  const onlySaved = props.saved.length === 1 ? props.saved[0] : undefined;
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
                {t('runtimeConfig.product.currentModel')}
              </span>
            ) : null}
          </div>
          <p className={`mt-1 text-sm leading-relaxed ${unsupported ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-secondary)]'}`}>
            {props.description}
          </p>
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
        {props.current ? (
          <Button tone="ghost" size="sm" onClick={props.onCustomize}>
            <SlidersHorizontal size={14} />
            {t('runtimeConfig.product.customize')}
          </Button>
        ) : props.enableable ? (
          <Button tone="primary" size="sm" disabled={props.busy} onClick={props.onEnable}>
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
                {isSelected ? (
                  <StatusBadge tone="success" shape="soft">
                    <Check size={12} aria-hidden="true" />
                    {t('runtimeConfig.product.currentModel')}
                  </StatusBadge>
                ) : (
                  <Button tone="ghost" size="sm" disabled={props.busy} onClick={() => props.onUseSaved(item)}>
                    {t('runtimeConfig.product.useSavedVersion')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}

/** Each runtime component of the capability's environment with its own state. */
function EnvironmentDependencies(props: {
  readonly environment: NimiRuntimeLocalEnvironmentPlan;
  readonly className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className={`space-y-1.5 text-xs ${props.className ?? ''}`}>
      {props.environment.dependencies.map((item) => {
        const ready = isNimiRuntimeLocalEnvironmentDependencyReadyState(item.state);
        return (
          <li
            key={`${item.dependencyFamily}:${item.dependencyId}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
          >
            <span className="min-w-0 break-all font-mono text-[var(--nimi-text-primary)]">{item.dependencyId}</span>
            <span
              className={`inline-flex shrink-0 items-center gap-1 ${ready ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-text-secondary)]'}`}
            >
              {ready ? <Check size={12} aria-hidden="true" /> : null}
              {t(`runtimeConfig.downloads.environment.${item.state}`, { defaultValue: item.state })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
