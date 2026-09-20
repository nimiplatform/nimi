import { Button, InlineAlert, LoadingSkeleton, NimiTabs, StatusBadge, TextField, Tooltip } from '@nimiplatform/kit/ui';
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
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Info,
  LoaderCircle,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
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
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { loadoutAssetLabel, loadoutSlotLabelKey } from './runtime-config-loadout-model-display.js';
import { SavedConfigsView } from './runtime-config-page-loadouts.js';
import type {
  RuntimeConfigLoadoutNavigationContext,
  RuntimeConfigModelMarketContext,
} from './runtime-config-panel-types.js';

type Props = {
  capability: string;
  selected?: NimiMachineLoadout;
  loadouts: readonly NimiMachineLoadout[];
  recipes: readonly NimiLoadoutRecipe[];
  catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  assets: readonly NimiRuntimeModelAssetRecord[];
  libraryLoading: boolean;
  libraryError: boolean;
  environment?: NimiRuntimeLocalEnvironmentPlan;
  status: ReturnType<typeof capabilityPreparationState>;
  section: string;
  onSection: (section: string) => void;
  busy: boolean;
  disabled: boolean;
  navigationContext: RuntimeConfigLoadoutNavigationContext | null;
  onHome: () => void;
  onStart: (recipe: string, previous?: NimiMachineLoadout, customize?: boolean) => Promise<void>;
  onTask: (taskId: string) => void;
  onModelFiles?: () => void;
  onDiagnostics: () => void;
  onModelMarket: (context: RuntimeConfigModelMarketContext) => void;
};

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
  const usage = t(`runtimeConfig.capabilities.uses.${capabilityKey}`, {
    defaultValue: t('runtimeConfig.capabilities.description', { capability: label }),
  });
  const shortUse = t(`runtimeConfig.product.shortUse.${capabilityKey}`, { defaultValue: label });
  const featureKeys = modelFeatureLocaleKeys(identity.recipe?.implementationSupportedFeatures ?? []);
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
  const versionChip = [identity.versionShort, identity.sizeBytes ? t('runtimeConfig.product.aboutSize', { size: formatBytes(identity.sizeBytes) }) : '']
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
        value={props.section}
        onValueChange={props.onSection}
        items={['overview', 'models', 'advanced'].map((value) => ({
          value,
          label: t(`runtimeConfig.capabilities.tabs.${value}`),
        }))}
      />

      {props.status.task ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--nimi-surface-active)] px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            {props.status.task.status === 'preparing' || props.status.task.status === 'committing' ? (
              <LoaderCircle size={15} className="animate-spin text-[var(--nimi-status-info)]" />
            ) : (
              <CircleAlert size={15} className="text-[var(--nimi-status-warning)]" />
            )}
            {t('runtimeConfig.product.pendingSetup')} ·{' '}
            {t(`runtimeConfig.setupTask.status.${props.status.task.status}`)}
          </span>
          <Button tone="secondary" size="sm" onClick={() => props.onTask(props.status.task!.taskId)}>
            {t('runtimeConfig.product.viewSetup')}
            <ArrowRight size={14} />
          </Button>
        </div>
      ) : null}

      {props.section === 'overview' ? (
        <div className="space-y-6">
          <section className="grid gap-6 rounded-2xl bg-[var(--nimi-surface-card)] p-5 lg:grid-cols-[minmax(0,1fr)_240px] lg:p-6">
            <div className="flex items-start gap-4">
              {identity.shortTitle ? (
                <IdentityTile seed={modelFamilySeed(identity.title)} label={identity.shortTitle} size="lg" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.product.currentOnDevice')}
                  <ScopeHint text={t('runtimeConfig.product.localScopeHelp')} />
                </p>
                <h2 className="mt-1.5 text-xl font-semibold leading-snug">
                  {identity.shortTitle || t('runtimeConfig.aiSettings.notConfigured')}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {versionChip ? (
                    <span className="rounded-md bg-[var(--nimi-surface-panel)] px-2 py-1 text-[var(--nimi-text-secondary)]">
                      {versionChip}
                    </span>
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
                    {t('runtimeConfig.product.chooseModelLead')}
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

      {props.section === 'models' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t('runtimeConfig.product.chooseYourModel')}</h2>
              <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.product.modelChoiceHelp')}
              </p>
            </div>
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
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            {matched.map((recipe) => {
              const saved = props.loadouts.filter(
                (item) => item.recipeId === recipe.recipeId && item.validationState === 'configured',
              );
              const current = props.selected?.recipeId === recipe.recipeId;
              const title = modelDisplayTitle(recipe.title);
              const recipeFeatures = modelFeatureLocaleKeys(recipe.implementationSupportedFeatures);
              const cost = costOf(recipe);
              const costClass = cost.tone === 'download'
                ? 'text-[var(--nimi-status-warning)]'
                : cost.tone === 'ready'
                  ? 'text-[var(--nimi-text-secondary)]'
                  : 'text-[var(--nimi-text-muted)]';
              const costIcon = cost.tone === 'download'
                ? <Download size={13} />
                : cost.tone === 'ready'
                  ? <Check size={13} />
                  : null;
              const unsupported = recipe.applicability === 'unsupported';
              return (
                <section
                  key={recipe.recipeId}
                  className="py-4"
                  data-testid={`capability-model:${recipe.recipeId}`}
                >
                  <div className="flex items-start gap-4">
                    <IdentityTile seed={modelFamilySeed(recipe.title)} label={title} size="md" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{title}</h3>
                        {current ? (
                          <StatusBadge tone="info" shape="outline">
                            <Check size={12} />
                            {t('runtimeConfig.product.currentModel')}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
                        {recipeFeatures.length
                          ? recipeFeatures.map((key) => t(key)).join(' · ')
                          : shortUse}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        {recipe.applicability !== 'supported' ? (
                          <span className={`flex items-center gap-1 ${unsupported ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
                            <CircleAlert size={13} />
                            {t(`runtimeConfig.loadouts.hostFit.${recipe.applicability}`)}
                          </span>
                        ) : null}
                        <span className={`flex items-center gap-1.5 ${costClass}`}>
                          {costIcon}
                          {cost.text}
                        </span>
                      </div>
                    </div>
                    {current ? null : (
                      <Button
                        tone="secondary"
                        size="sm"
                        disabled={props.busy || props.disabled || unsupported}
                        onClick={() => {
                          void props.onStart(recipe.recipeId);
                        }}
                      >
                        {t('runtimeConfig.product.selectModel')}
                        <ArrowRight size={14} />
                      </Button>
                    )}
                  </div>
                  {saved.length ? (
                    <details className="mt-3 pl-14 text-sm">
                      <summary className="cursor-pointer text-[var(--nimi-text-secondary)]">
                        {t('runtimeConfig.product.savedVersions', { count: saved.length })}
                      </summary>
                      <div className="mt-2 divide-y divide-[var(--nimi-border-subtle)]">
                        {saved.map((item) => {
                          const model = capabilityModelIdentity(item, props.recipes, props.catalog);
                          return (
                            <div
                              key={item.loadoutId}
                              className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <p className="font-medium">{item.displayName}</p>
                                <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">
                                  {model.versionShort || t('runtimeConfig.product.savedConfiguration')}
                                </p>
                              </div>
                              {item.loadoutId === props.selected?.loadoutId ? (
                                <span className="text-xs text-[var(--nimi-text-secondary)]">
                                  {t('runtimeConfig.product.currentModel')}
                                </span>
                              ) : (
                                <Button
                                  tone="ghost"
                                  size="sm"
                                  disabled={props.busy || props.disabled}
                                  onClick={() => {
                                    void props.onStart(item.recipeId, item);
                                  }}
                                >
                                  {t('runtimeConfig.product.useSavedVersion')}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
          {!matched.length ? (
            <p className="py-5 text-sm text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.product.noModelsMatch')}
            </p>
          ) : null}
          <Button tone="ghost" size="sm" onClick={props.onModelFiles}>
            {t('runtimeConfig.product.importModel')}
            <ArrowRight size={14} />
          </Button>
        </div>
      ) : null}

      {props.section === 'advanced' ? (
        <div className="space-y-6">
          <section>
            <h2 className="text-base font-semibold">{t('runtimeConfig.product.customize')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.product.customizeHelp')}
            </p>
            {props.selected ? (
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
            ) : (
              <Button className="mt-4" tone="primary" onClick={() => props.onSection('models')}>
                {t('runtimeConfig.capabilities.chooseModel')}
              </Button>
            )}
          </section>
          {props.selected ? (
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
          ) : null}
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
