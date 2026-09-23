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
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
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
import {
  capabilityIcon,
  capabilityModelIdentity,
  modelDisplayTitle,
  modelFeatureLocaleKeys,
  recipeResourceSummary,
} from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel, displayRuntimeConfigCapabilityUsage } from './runtime-config-capability-labels.js';
import { loadoutAssetLabel, loadoutSlotLabelKey } from './runtime-config-loadout-model-display.js';
import { SavedConfigsView } from './runtime-config-page-loadouts.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
} from './runtime-config-panel-types.js';
import type { RuntimeSetupTask } from './runtime-setup-task-store.js';

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
  onStart: (recipe: string, previous?: NimiMachineLoadout, customize?: boolean) => Promise<void>;
  /** Enables a downloaded recipe directly; falls back to the review task when preparation is needed. */
  onEnable: (recipe: string) => Promise<void>;
  onTask: (taskId: string) => void;
  onModelFiles?: () => void;
  /** Direct import entry: the Model Library's local files with the import menu open. */
  onImportModelFiles?: () => void;
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
  const downloadedSummary = downloaded ? recipeResourceSummary(downloaded, props.catalog, props.assets) : null;
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
  const partName = (slotId: string, fallback: string) => {
    const key = loadoutSlotLabelKey(slotId);
    return key ? t(key) : fallback;
  };
  const isReady = props.status.state === 'ready';
  const environmentReady =
    !!props.environment &&
    props.environment.dependencies.every(
      (d) => !d.required || d.state === 'ready_managed' || d.state === 'ready_system',
    );
  const chipSize = identity.sizeBytes ?? downloadedSummary?.totalBytes ?? null;
  const versionChip = [identity.versionShort, chipSize ? t('runtimeConfig.product.aboutSize', { size: formatBytes(chipSize) }) : '']
    .filter(Boolean)
    .join(' · ');
  const openUse = () => setActiveTab(props.capability === 'text.generate' ? 'chat' : 'apps');
  const costOf = (recipe: NimiLoadoutRecipe) => {
    if (props.libraryLoading) return { text: t('Common.loading'), tone: 'muted' as const };
    if (props.libraryError) return { text: t('runtimeConfig.product.preparationUnknown'), tone: 'muted' as const };
    const summary = recipeResourceSummary(recipe, props.catalog, props.assets);
    if (summary.missing === 0)
      return {
        text: summary.totalBytes !== null
          ? t('runtimeConfig.product.onDeviceWithSize', { size: formatBytes(summary.totalBytes) })
          : t('runtimeConfig.product.modelsOnDevice'),
        tone: 'ready' as const,
      };
    if (summary.bytes === null) return { text: t('runtimeConfig.product.downloadSizeUnknown'), tone: 'muted' as const };
    return { text: t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.bytes) }), tone: 'download' as const };
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
  return (
    <div className="space-y-6" data-testid={`ai-capability-detail:${props.capability}`}>
      <Button tone="ghost" size="sm" onClick={props.onHome}>
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
        <div className="space-y-6">
          <section className="grid gap-6 rounded-2xl bg-[var(--nimi-surface-card)] p-5 lg:grid-cols-[minmax(0,1fr)_240px] lg:p-6">
            <div className="flex items-start gap-4">
              {cardTitle ? (
                <IdentityTile seed={modelFamilySeed(cardSeed)} label={cardTitle} size="lg" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.product.currentOnDevice')}
                  <ScopeHint text={t('runtimeConfig.product.localScopeHelp')} />
                </p>
                <h2 className="mt-1.5 text-xl font-semibold leading-snug">
                  {cardTitle || t('runtimeConfig.aiSettings.notConfigured')}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {versionChip ? (
                    <span className="rounded-md bg-[var(--nimi-surface-panel)] px-2 py-1 text-[var(--nimi-text-secondary)]">
                      {versionChip}
                    </span>
                  ) : null}
                  {downloaded ? (
                    <StatusBadge tone="neutral" shape="soft" data-testid="capability-downloaded-badge">
                      {t('runtimeConfig.capabilities.state.downloaded')}
                    </StatusBadge>
                  ) : null}
                  {!isReady && props.status.state !== 'unset' ? (
                    <StatusBadge
                      tone={props.status.state === 'attention' ? 'warning' : props.status.state === 'preparing' ? 'info' : 'neutral'}
                      shape="soft"
                    >
                      {t(`runtimeConfig.capabilities.state.${props.status.state}`)}
                    </StatusBadge>
                  ) : null}
                </div>
                {!props.selected ? (
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--nimi-text-secondary)]">
                    {t(downloaded ? 'runtimeConfig.product.downloadedLead' : 'runtimeConfig.product.chooseModelLead')}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                  {props.selected ? (
                    <>
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
                      <Button tone="secondary" onClick={() => props.onSection('models')}>
                        {t('runtimeConfig.product.changeModel')}
                      </Button>
                    </>
                  ) : downloaded ? (
                    <>
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
                      <Button tone="secondary" onClick={() => props.onSection('models')}>
                        {t('runtimeConfig.product.changeModel')}
                      </Button>
                    </>
                  ) : (
                    <Button tone="primary" onClick={() => props.onSection('models')}>
                      {t('runtimeConfig.capabilities.chooseModel')}
                      <ArrowRight size={15} />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t border-[var(--nimi-border-subtle)] pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <h3 className="text-sm font-semibold">{t('runtimeConfig.product.whatItDoes')}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--nimi-text-secondary)]">
                <li className="flex items-start gap-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-[var(--nimi-status-success)]" />
                  {shortUse}
                </li>
                {featureKeys.map((key) => (
                  <li key={key} className="flex items-start gap-2">
                    <Check size={14} className="mt-0.5 shrink-0 text-[var(--nimi-status-success)]" />
                    {t(key)}
                  </li>
                ))}
              </ul>
              {props.selected ? (
                <Button tone="ghost" size="sm" className="mt-3" onClick={() => props.onSection('advanced')}>
                  <SlidersHorizontal size={14} />
                  {t('runtimeConfig.product.customize')}
                </Button>
              ) : null}
            </div>
          </section>

          <section className="space-y-2 border-b border-[var(--nimi-border-subtle)] pb-5">
            {props.environment && environmentReady ? (
              <details className="text-sm text-[var(--nimi-text-secondary)]">
                <summary className="flex cursor-pointer items-center gap-2">
                  <Check size={14} className="text-[var(--nimi-status-success)]" />
                  {t('runtimeConfig.product.environmentReady')}
                  <span className="text-[var(--nimi-text-muted)]">· {t('runtimeConfig.product.environmentDetails')}</span>
                </summary>
                <EnvironmentList environment={props.environment} onDiagnostics={props.onDiagnostics} />
              </details>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-semibold">{t('runtimeConfig.capabilities.environment')}</h3>
                  <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
                    {props.environment
                      ? t('runtimeConfig.capabilities.environmentSummary', {
                          ready: props.environment.dependencies.filter(
                            (d) => d.state === 'ready_managed' || d.state === 'ready_system',
                          ).length,
                          count: props.environment.dependencies.length,
                        })
                      : t('runtimeConfig.capabilities.environmentUnknown')}
                  </p>
                </div>
                {props.environment ? (
                  <EnvironmentList environment={props.environment} onDiagnostics={props.onDiagnostics} />
                ) : null}
              </>
            )}
          </section>
          {props.selected ? (
            <details className="text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails')}</summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[140px_minmax(0,1fr)]">
                <dt>{t('runtimeConfig.product.technicalRecipe')}</dt>
                <dd className="break-words">{identity.title}</dd>
                {identity.alias && identity.alias !== identity.title ? (
                  <>
                    <dt>{t('runtimeConfig.product.technicalAlias')}</dt>
                    <dd className="break-words">{identity.alias}</dd>
                  </>
                ) : null}
                {identity.version ? (
                  <>
                    <dt>{t('runtimeConfig.product.technicalVariant')}</dt>
                    <dd className="break-words">{identity.version}</dd>
                  </>
                ) : null}
                {identity.descriptor?.entry ? (
                  <>
                    <dt>{t('runtimeConfig.product.technicalFile')}</dt>
                    <dd className="break-all">{identity.descriptor.entry}</dd>
                  </>
                ) : null}
              </dl>
            </details>
          ) : null}
        </div>
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
                return (
                  <ModelChoiceCard
                    key={recipe.recipeId}
                    recipe={recipe}
                    title={modelDisplayTitle(recipe.title)}
                    description={
                      recipeFeatures.length ? recipeFeatures.map((key) => t(key)).join(' · ') : shortUse
                    }
                    cost={costOf(recipe)}
                    current={props.selected?.recipeId === recipe.recipeId}
                    enableable={!props.selected && props.downloadedRecipe?.recipeId === recipe.recipeId}
                    saved={props.loadouts.filter(
                      (item) => item.recipeId === recipe.recipeId && item.validationState === 'configured',
                    )}
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
          <section>
            <h2 className="text-base font-semibold">{t('runtimeConfig.product.customize')}</h2>
            <Button
              className="mt-4"
              tone="primary"
              disabled={props.busy || props.disabled}
              onClick={() => {
                void props.onStart(props.selected!.recipeId, props.selected, true);
              }}
            >
              <SlidersHorizontal size={15} />
              {t('runtimeConfig.product.editModelAndOptions')}
            </Button>
          </section>
          <section className="divide-y divide-[var(--nimi-border-subtle)] rounded-xl bg-[var(--nimi-surface-card)] px-4">
            <h3 className="py-3 text-sm font-semibold">{t('runtimeConfig.product.currentComposition')}</h3>
            {props.libraryLoading ? (
              <LoadingSkeleton lines={3} />
            ) : (
              props.selected.modelAxes.map((axis) => {
                const asset = props.assets.find((item) => item.modelAssetId === axis.modelAssetId);
                return (
                  <div key={axis.slotId} className="grid gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <span className="text-xs text-[var(--nimi-text-secondary)]">
                      {partName(axis.slotId, axis.displayLabel)}
                    </span>
                    <span className="break-words text-sm">
                      {asset
                        ? loadoutAssetLabel(asset, props.catalog)
                        : axis.modelAssetId
                          ? axis.displayLabel
                          : t('runtimeConfig.product.notEnabled')}
                    </span>
                  </div>
                );
              })
            )}
          </section>
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
  readonly selectedLoadoutId?: string;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onEnable: () => void;
  readonly onUseSaved: (item: NimiMachineLoadout) => void;
  readonly onCustomize: () => void;
}) {
  const { t } = useTranslation();
  const [savedOpen, setSavedOpen] = useState(false);
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
            {t(`runtimeConfig.loadouts.hostFit.${props.recipe.applicability}`)}
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

function EnvironmentList(props: {
  readonly environment: NimiRuntimeLocalEnvironmentPlan;
  readonly onDiagnostics: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-2 text-xs text-[var(--nimi-text-secondary)]">
      {props.environment.dependencies.map((item) => (
        <p key={`${item.dependencyFamily}:${item.dependencyId}`} className="flex flex-wrap justify-between gap-2">
          <span className="break-all">{item.dependencyId}</span>
          <span>{t(`runtimeConfig.downloads.environment.${item.state}`, { defaultValue: item.state })}</span>
        </p>
      ))}
      <Button tone="ghost" size="sm" onClick={props.onDiagnostics}>
        {t('runtimeConfig.nav.advancedDiagnostics')}
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}
