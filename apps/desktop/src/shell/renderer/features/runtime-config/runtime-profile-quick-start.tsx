import { capabilityIcon, Button, InlineAlert, LoadingSkeleton, PillTabs, SelectField, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { parseNimiPortableAIProfile, type NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type {
  NimiLoadoutRecipe,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Cloud,
  Compass,
  Download,
  FileUp,
  LoaderCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import type { capabilityPreparationState } from './runtime-capability-inventory.js';
import type { RuntimeConfigLoadoutNavigationContext } from './runtime-config-panel-types.js';
import {
  capabilityGroup,
  contextFitReduced,
  exactRecommendedSlotOffer,
  formatContextTokens,
  groupCapabilities,
  modelDisplayTitle,
  recipeRecommendedContextFit,
  type CapabilityGroup,
} from './runtime-capability-presentation.js';
import {
  loadoutModelPresentation,
  resolvePrimaryRecipeSlot,
} from './runtime-config-loadout-model-display.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { runtimeSetupFailureText } from './runtime-setup-failure-message.js';

export type RuntimeOverviewCapability = {
  readonly id: string;
  readonly model: string;
  readonly taskModel?: string;
  readonly downloaded?: boolean;
  readonly state: ReturnType<typeof capabilityPreparationState>;
};

const MODALITY_ANCHOR_PREFERENCES: Readonly<Record<Exclude<CapabilityGroup, 'other'>, readonly string[]>> = Object.freeze({
  text: ['text.generate'],
  visual: ['image.generate', 'video.generate'],
  audio: ['audio.synthesize', 'audio.transcribe'],
});

/**
 * Selects up to one representative capability per core modality group
 * (text, visual, audio) for the cold-start overview grid, preferring core
 * anchor contracts and otherwise the first capability in that group that has
 * a Runtime-supported recipe on this device.
 */
export function selectStarterCapabilities(
  capabilities: readonly RuntimeOverviewCapability[],
  recipes: readonly NimiLoadoutRecipe[],
): readonly RuntimeOverviewCapability[] {
  const supportedCapabilities = new Set(
    recipes.filter((recipe) => recipe.applicability === 'supported').map((recipe) => recipe.capabilityContract),
  );
  const picked: RuntimeOverviewCapability[] = [];
  for (const group of ['text', 'visual', 'audio'] as const) {
    const inGroup = capabilities.filter((entry) => capabilityGroup(entry.id) === group);
    if (inGroup.length === 0) continue;
    const preferred = MODALITY_ANCHOR_PREFERENCES[group]
      .map((id) => inGroup.find((entry) => entry.id === id))
      .find((entry): entry is RuntimeOverviewCapability => entry !== undefined);
    const chosen =
      (preferred && supportedCapabilities.has(preferred.id) ? preferred : undefined)
      ?? inGroup.find((entry) => supportedCapabilities.has(entry.id))
      ?? preferred
      ?? inGroup[0]!;
    picked.push(chosen);
  }
  if (picked.length > 0) return picked;
  return capabilities.slice(0, 3);
}

export function canBuildRecommendedPortableProfile(
  recipe: NimiLoadoutRecipe,
  assets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): boolean {
  const requiredSlots = recipe.slots.filter((slot) => slot.presence !== 'optional-conditional');
  if (requiredSlots.length === 0) return false;
  return requiredSlots.every((slot) => {
    if (slot.recommendedVariantIds.length !== 1 || slot.recommendedContentIds.length !== 1) return false;
    const asset = assets.find(
      (item) =>
        item.templateId === slot.recommendedVariantIds[0]
        && item.contentId === slot.recommendedContentIds[0],
    );
    return Boolean(asset && /^(?:sha256:)?[a-f0-9]{64}$/iu.test(asset.hashes[asset.entry] ?? ''));
  });
}

function starterModelTitle(recipe: NimiLoadoutRecipe, catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[]): string {
  const primary = resolvePrimaryRecipeSlot(recipe);
  if (primary.kind === 'single') {
    const descriptor = exactRecommendedSlotOffer(primary.slot, catalog)?.descriptor;
    if (descriptor) return loadoutModelPresentation({ title: descriptor.title, variantLabel: descriptor.entry }).headline;
  }
  return modelDisplayTitle(recipe.title);
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function recommendedPortableProfile(
  recipe: NimiLoadoutRecipe,
  assets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[],
): NimiPortableAIProfile {
  const axes = recipe.slots
    .filter((slot) => slot.presence !== 'optional-conditional')
    .map((slot) => {
      if (slot.recommendedVariantIds.length !== 1 || slot.recommendedContentIds.length !== 1)
        throw new Error(`No exact device recommendation for ${slot.displayLabel || slot.slotId}`);
      const asset = assets.find(
        (asset) =>
          asset.templateId === slot.recommendedVariantIds[0]
          && asset.contentId === slot.recommendedContentIds[0],
      );
      const hash = asset?.hashes[asset.entry];
      if (!asset || !hash)
        throw new Error(`The recommended resource is unavailable: ${slot.displayLabel || slot.slotId}`);
      return {
        slotId: slot.slotId,
        contentId: asset.contentId,
        expectedHash: hash.startsWith('sha256:') ? hash : `sha256:${hash}`,
        source: {
          repo: asset.repo,
          revision: asset.revision,
          file: asset.entry,
          sizeBytes: asset.totalSizeBytes,
        },
      };
    });
  return parseNimiPortableAIProfile(
    JSON.stringify({
      profileId: `nimi.recommended.${recipe.recipeId}`,
      title: recipe.title,
      capabilities: {
        [recipe.capabilityContract]: {
          route: 'local',
          requiredFeatures: [],
          implementation: {
            ...recipe.implementation,
            supportedFeatures: [...recipe.implementationSupportedFeatures],
          },
          // Runtime's options for this device recommendation: its default
          // options, with an explicit context size only when the automatic
          // capacity does not fit this device.
          loadout: { recipeId: recipe.recipeId, axes, options: recipe.recommendedOptions },
        },
      },
    }),
  );
}

/**
 * State-driven overview across all local AI capabilities. Any capability
 * currently preparing or needing attention is surfaced directly regardless of
 * other capabilities' state. When one or more capabilities are prepared it
 * renders the grouped ready board; when none are prepared it renders
 * multi-modal starter recommendations derived from Runtime-reported supported
 * recipes, defaulting to machine-wide setup without binding an App owner.
 */
export function RuntimeProfileQuickStart(props: {
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly unavailable?: boolean;
  readonly capabilities: readonly RuntimeOverviewCapability[];
  readonly recipes?: readonly NimiLoadoutRecipe[];
  readonly catalog?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly assets?: readonly NimiRuntimeModelAssetRecord[];
  readonly libraryLoading?: boolean;
  readonly libraryError?: boolean;
  readonly onRetry: () => void;
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenTask: (taskId: string) => void;
  readonly onOpenSavedConfigs?: (context: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenCloudServices?: () => void;
  readonly onOpenRecommendations?: () => void;
  readonly onImportProfile?: () => void;
  readonly readyAction?: ReactNode;
  readonly onUse: (profile: NimiPortableAIProfile) => void;
}) {
  const { t } = useTranslation();

  if (props.pending) {
    return (
      <Surface
        as="section"
        tone="card"
        padding="none"
        className="desktop-module-card space-y-3"
        data-testid="ai-profile-quick-start"
        data-quick-start-state="pending"
      >
        <LoadingSkeleton className="h-5 w-40" />
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
          <LoadingSkeleton className="h-36 w-full" />
          <LoadingSkeleton className="h-36 w-full" />
          <LoadingSkeleton className="h-36 w-full" />
        </div>
      </Surface>
    );
  }

  const allUnknown =
    props.unavailable
    || props.capabilities.length === 0
    || props.capabilities.every((entry) => entry.state.state === 'unknown');

  if (allUnknown) {
    return (
      <Surface
        as="section"
        tone="card"
        padding="none"
        className="desktop-module-card"
        data-testid="ai-profile-quick-start"
        data-quick-start-state="unknown"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--nimi-surface-subtle)] text-[var(--nimi-text-muted)]">
              <CircleDashed size={18} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="desktop-module-section-title">{t('runtimeConfig.quickStart.unknownTitle')}</h2>
              <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.preparationUnknown')}</p>
            </div>
          </div>
          <Button tone="secondary" size="sm" onClick={props.onRetry}>
            {t('Common.retry')}
          </Button>
        </div>
      </Surface>
    );
  }

  const ready = props.capabilities.filter((entry) => entry.state.state === 'ready');
  const activeEntries = props.capabilities.filter(
    (entry) => entry.state.state === 'preparing' || entry.state.state === 'attention',
  );

  if (ready.length > 0) {
    return (
      <div className="space-y-3" data-testid="ai-profile-quick-start" data-quick-start-state="ready">
        {activeEntries.length > 0 ? (
          <OverviewActivityStrip
            entries={activeEntries}
            onOpenCapability={props.onOpenCapability}
            onOpenTask={props.onOpenTask}
          />
        ) : null}
        <ReadyCapabilitiesOverview
          ready={ready}
          readyAction={props.readyAction}
          onOpenCapability={props.onOpenCapability}
        />
      </div>
    );
  }

  const hasPreparing = activeEntries.some((entry) => entry.state.state === 'preparing');
  const hasAttention = activeEntries.some((entry) => entry.state.state === 'attention');
  const coldState = hasPreparing ? 'preparing' : hasAttention ? 'attention' : 'unset';

  return (
    <div className="space-y-4" data-testid="ai-profile-quick-start" data-quick-start-state={coldState}>
      {activeEntries.length > 0 ? (
        <OverviewActivityStrip
          entries={activeEntries}
          onOpenCapability={props.onOpenCapability}
          onOpenTask={props.onOpenTask}
        />
      ) : null}
      <MultiModalStarterSection
        disabled={props.disabled}
        capabilities={props.capabilities}
        recipes={props.recipes ?? []}
        catalog={props.catalog ?? []}
        assets={props.assets ?? []}
        libraryLoading={props.libraryLoading ?? false}
        libraryError={props.libraryError ?? false}
        onRetry={props.onRetry}
        onOpenCapability={props.onOpenCapability}
        onOpenSavedConfigs={props.onOpenSavedConfigs}
        onOpenCloudServices={props.onOpenCloudServices}
        onOpenRecommendations={props.onOpenRecommendations}
        onImportProfile={props.onImportProfile}
        onUse={props.onUse}
      />
    </div>
  );
}

function OverviewActivityStrip(props: {
  readonly entries: readonly RuntimeOverviewCapability[];
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="space-y-2"
      aria-label={t('runtimeConfig.quickStart.activityTitle')}
      data-testid="ai-overview-activity"
    >
      {props.entries.map((entry) => {
        const Icon = capabilityIcon(entry.id);
        const capLabel = displayRuntimeConfigCapabilityLabel(entry.id, t);
        const isPreparing = entry.state.state === 'preparing';
        const task = entry.state.task;
        const modelName = entry.taskModel || entry.model;
        const detailText = isPreparing
          ? task
            ? t(`runtimeConfig.setupTask.status.${task.status}`)
            : t('runtimeConfig.capabilities.state.preparing')
          : task?.failure
            ? runtimeSetupFailureText(task.failure, t)
            : entry.state.reason
              ? t(`runtimeConfig.capabilities.attentionReason.${entry.state.reason}`)
              : t('runtimeConfig.capabilities.state.attention');
        const onOpen = () => {
          if (task) props.onOpenTask(task.taskId);
          else props.onOpenCapability(entry.id);
        };
        return (
          <div
            key={entry.id}
            data-activity-capability={entry.id}
            data-activity-state={entry.state.state}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--nimi-radius-md)] border px-4 py-3 ${
              isPreparing
                ? 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,var(--nimi-border-subtle))] bg-[var(--nimi-status-info-soft-bg)]'
                : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_32%,var(--nimi-border-subtle))] bg-[var(--nimi-status-warning-soft-bg)]'
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--nimi-surface-card)] ${
                  isPreparing ? 'text-[var(--nimi-status-info)]' : 'text-[var(--nimi-status-warning)]'
                }`}
              >
                {isPreparing ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <CircleAlert size={16} aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--nimi-text-primary)]">
                  <Icon size={14} className="shrink-0 text-[var(--nimi-text-secondary)]" aria-hidden="true" />
                  <span>
                    {isPreparing
                      ? t('runtimeConfig.quickStart.preparingCapabilityTitle', { capability: capLabel })
                      : t('runtimeConfig.quickStart.attentionCapabilityTitle', { capability: capLabel })}
                  </span>
                  {modelName ? (
                    <span className="font-normal text-[var(--nimi-text-secondary)]">· {modelName}</span>
                  ) : null}
                </div>
                {detailText ? (
                  <p className="mt-0.5 truncate text-xs text-[var(--nimi-text-secondary)]">{detailText}</p>
                ) : null}
              </div>
            </div>
            <Button
              tone="secondary"
              size="sm"
              className="shrink-0"
              onClick={onOpen}
              data-testid={`ai-overview-activity-action:${entry.id}`}
            >
              {isPreparing ? t('runtimeConfig.quickStart.viewProgress') : t('runtimeConfig.quickStart.viewDetail')}
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </section>
  );
}

function MultiModalStarterSection(props: {
  readonly disabled: boolean;
  readonly capabilities: readonly RuntimeOverviewCapability[];
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly libraryLoading: boolean;
  readonly libraryError: boolean;
  readonly onRetry: () => void;
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenSavedConfigs?: (context: RuntimeConfigLoadoutNavigationContext) => void;
  readonly onOpenCloudServices?: () => void;
  readonly onOpenRecommendations?: () => void;
  readonly onImportProfile?: () => void;
  readonly onUse: (profile: NimiPortableAIProfile) => void;
}) {
  const { t } = useTranslation();
  const starters = selectStarterCapabilities(props.capabilities, props.recipes);
  const [selectedByCapability, setSelectedByCapability] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState('');

  return (
    <section
      className="space-y-3"
      aria-labelledby="ai-starter-section-title"
      data-testid="ai-starter-section"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ai-starter-section-title" className="desktop-module-section-title">
          {t('runtimeConfig.quickStart.starterSectionTitle')}
        </h2>
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('runtimeConfig.quickStart.starterSectionHint')}
        </p>
      </div>

      {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
      {props.libraryError ? (
        <InlineAlert tone="warning">
          {t('runtimeConfig.product.preparationUnknown')}
          <Button tone="ghost" size="sm" onClick={props.onRetry}>
            {t('Common.retry')}
          </Button>
        </InlineAlert>
      ) : null}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
        {starters.map((entry) => {
          const supportedRecipes = props.recipes.filter(
            (recipe) => recipe.capabilityContract === entry.id && recipe.applicability === 'supported',
          );
          const selected =
            supportedRecipes.find((recipe) => recipe.recipeId === selectedByCapability[entry.id])
            ?? supportedRecipes[0];
          return (
            <StarterCapabilityCard
              key={entry.id}
              capability={entry.id}
              disabled={props.disabled}
              supportedRecipes={supportedRecipes}
              selected={selected}
              onSelectRecipe={(recipeId) => {
                setError('');
                setSelectedByCapability((prev) => ({ ...prev, [entry.id]: recipeId }));
              }}
              catalog={props.catalog}
              assets={props.assets}
              libraryLoading={props.libraryLoading}
              onOpenCapability={props.onOpenCapability}
              onOpenCloudServices={props.onOpenCloudServices}
              onPrepare={(recipe) => {
                setError('');
                try {
                  if (canBuildRecommendedPortableProfile(recipe, props.catalog)) {
                    const capLabel = displayRuntimeConfigCapabilityLabel(recipe.capabilityContract, t);
                    props.onUse({
                      ...recommendedPortableProfile(recipe, props.catalog),
                      title: `${capLabel} · ${starterModelTitle(recipe, props.catalog)}`,
                    });
                    return;
                  }
                  if (props.onOpenSavedConfigs) {
                    props.onOpenSavedConfigs({ capabilityContract: recipe.capabilityContract, recipeId: recipe.recipeId, recipeRevision: recipe.revision });
                    return;
                  }
                  props.onOpenCapability(recipe.capabilityContract);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : String(caught));
                }
              }}
            />
          );
        })}
      </div>

      {props.onOpenRecommendations || props.onImportProfile || props.onOpenCloudServices ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] px-3.5 py-2.5 text-xs text-[var(--nimi-text-secondary)]"
          data-testid="ai-starter-footer"
        >
          <span>{t('runtimeConfig.quickStart.starterFooterNote')}</span>
          <div className="flex flex-wrap items-center gap-1">
            {props.onOpenRecommendations ? (
              <Button tone="ghost" size="sm" onClick={props.onOpenRecommendations} data-testid="ai-starter-recommendations">
                <Compass size={13} aria-hidden="true" />
                {t('runtimeConfig.quickStart.compatibility')}
              </Button>
            ) : null}
            {props.onImportProfile ? (
              <Button tone="ghost" size="sm" onClick={props.onImportProfile} data-testid="ai-starter-import">
                <FileUp size={13} aria-hidden="true" />
                {t('runtimeConfig.quickStart.loadShared')}
              </Button>
            ) : null}
            {props.onOpenCloudServices ? (
              <Button tone="ghost" size="sm" onClick={props.onOpenCloudServices} data-testid="ai-starter-cloud">
                <Cloud size={13} aria-hidden="true" />
                {t('runtimeConfig.quickStart.openCloudServices')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StarterCapabilityCard(props: {
  readonly capability: string;
  readonly disabled: boolean;
  readonly supportedRecipes: readonly NimiLoadoutRecipe[];
  readonly selected: NimiLoadoutRecipe | undefined;
  readonly onSelectRecipe: (recipeId: string) => void;
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly libraryLoading: boolean;
  readonly onOpenCapability: (capability: string) => void;
  readonly onOpenCloudServices?: () => void;
  readonly onPrepare: (recipe: NimiLoadoutRecipe) => void;
}) {
  const { t } = useTranslation();
  const Icon = capabilityIcon(props.capability);
  const capLabel = displayRuntimeConfigCapabilityLabel(props.capability, t);
  const group = capabilityGroup(props.capability);
  const { selected } = props;

  const exactRequiredSlots = selected
    ? selected.slots.filter((slot) => slot.presence === 'required')
    : [];
  const exactSlotOffers = exactRequiredSlots.map((slot) => ({
    slot,
    exact: exactRecommendedSlotOffer(slot, props.catalog, props.assets),
  }));
  const hasExactRecommendation = selected ? canBuildRecommendedPortableProfile(selected, props.catalog) : false;
  const filesOnDevice = hasExactRecommendation && exactSlotOffers.every(({ exact }) => Boolean(exact?.installedAsset));

  const exactDownloadBytes = (() => {
    if (!hasExactRecommendation) return null;
    if (filesOnDevice) return 0;
    let total = 0;
    for (const { exact } of exactSlotOffers) {
      if (exact?.installedAsset) continue;
      const size = exact?.offer?.candidate.downloadSizeBytes ?? exact?.descriptor?.totalSizeBytes;
      if (!size || size <= 0) return null;
      total += size;
    }
    return total;
  })();
  const downloadBytes = filesOnDevice ? 0 : exactDownloadBytes;

  const modelTitle = selected && hasExactRecommendation
    ? starterModelTitle(selected, props.catalog)
    : t('runtimeConfig.quickStart.modelPending');
  const contextFit = selected && hasExactRecommendation ? recipeRecommendedContextFit(selected) : undefined;

  const actionLabel = !selected
    ? t('runtimeConfig.quickStart.exploreModels')
    : !hasExactRecommendation ? t('runtimeConfig.loadouts.chooseModels')
    : filesOnDevice
      ? t('runtimeConfig.quickStart.configureOnDevice')
      : downloadBytes !== null && downloadBytes > 0
        ? t('runtimeConfig.quickStart.reviewDownload', { size: formatBytes(downloadBytes) })
        : t('runtimeConfig.quickStart.use');

  return (
    <Surface
      as="article"
      tone="card"
      padding="none"
      className="desktop-module-card flex flex-col justify-between gap-3.5 border border-[var(--nimi-border-subtle)] transition-colors hover:border-[var(--nimi-border-strong)]"
      data-starter-capability={props.capability}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{capLabel}</h3>
              <p className="truncate text-xs text-[var(--nimi-text-muted)]">
                {t(`runtimeConfig.capabilities.group.${group}`)}
              </p>
            </div>
          </div>
          <Tooltip content={t('runtimeConfig.quickStart.viewCapability', { capability: capLabel })} placement="top">
            <Button
              tone="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 px-0 text-[var(--nimi-text-muted)]"
              aria-label={t('runtimeConfig.quickStart.viewCapability', { capability: capLabel })}
              onClick={() => props.onOpenCapability(props.capability)}
              data-testid={`ai-starter-detail:${props.capability}`}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>

        {selected ? (
          <div className="space-y-2.5">
            {props.supportedRecipes.length > 1 ? (
              <SelectField
                aria-label={t('runtimeConfig.quickStart.chooseModelFor', { capability: capLabel })}
                value={selected.recipeId}
                onValueChange={props.onSelectRecipe}
                selectClassName="min-h-9 text-sm"
                data-testid={`ai-starter-select:${props.capability}`}
                options={props.supportedRecipes.map((recipe) => ({
                  value: recipe.recipeId,
                  label: canBuildRecommendedPortableProfile(recipe, props.catalog)
                    ? starterModelTitle(recipe, props.catalog)
                    : `${modelDisplayTitle(recipe.title)} · ${t('runtimeConfig.quickStart.modelPending')}`,
                }))}
              />
            ) : (
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--nimi-text-primary)]">
                <IdentityTile seed={modelTitle.split(/\s+/u)[0] ?? modelTitle} label={modelTitle} size="sm" />
                <span className="truncate" title={modelTitle}>{modelTitle}</span>
              </div>
            )}

            {hasExactRecommendation && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--nimi-text-secondary)]">
              <span className="inline-flex items-center gap-1">
                <Check size={13} className="shrink-0 text-[var(--nimi-status-success)]" aria-hidden="true" />
                {t('runtimeConfig.product.deviceRecommendation')}
              </span>
              <span className="inline-flex items-center gap-1">
                {filesOnDevice ? (
                  <Check size={13} className="shrink-0 text-[var(--nimi-status-success)]" aria-hidden="true" />
                ) : (
                  <Download size={13} className="shrink-0 text-[var(--nimi-status-warning)]" aria-hidden="true" />
                )}
                {filesOnDevice
                  ? t('runtimeConfig.product.modelsOnDevice')
                  : downloadBytes !== null && downloadBytes > 0
                    ? t('runtimeConfig.product.downloadSize', { size: formatBytes(downloadBytes) })
                    : props.libraryLoading
                      ? t('Common.loading')
                      : t('runtimeConfig.product.downloadSizeUnknown')}
              </span>
            </div>}

            {contextFit ? (
              <p
                className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]"
                data-testid={`ai-starter-context:${props.capability}`}
              >
                {contextFitReduced(contextFit)
                  ? `${t('runtimeConfig.product.contextReduced', { size: formatContextTokens(contextFit.recommendedContextSize) })} · ${t('runtimeConfig.product.contextReducedReason', { full: formatContextTokens(contextFit.authoredContextSize) })}`
                  : t('runtimeConfig.product.contextAutomatic', { size: formatContextTokens(contextFit.recommendedContextSize) })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.quickStart.capabilityUnsupported')}
          </p>
        )}
      </div>

      {selected ? (
        <Button
          tone="secondary"
          size="sm"
          className="w-full justify-center border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)] hover:bg-[color-mix(in_srgb,var(--nimi-status-info)_22%,transparent)]"
          disabled={props.disabled}
          onClick={() => props.onPrepare(selected)}
          data-testid={`ai-starter-use:${props.capability}`}
        >
          {actionLabel}
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            tone="secondary"
            size="sm"
            className="flex-1 justify-center"
            onClick={() => props.onOpenCapability(props.capability)}
            data-testid={`ai-starter-explore:${props.capability}`}
          >
            {t('runtimeConfig.quickStart.exploreModels')}
          </Button>
          {props.onOpenCloudServices ? (
            <Button
              tone="ghost"
              size="sm"
              onClick={props.onOpenCloudServices}
              data-testid={`ai-starter-cloud:${props.capability}`}
            >
              <Cloud size={13} aria-hidden="true" />
              {t('runtimeConfig.quickStart.openCloudServices')}
            </Button>
          ) : null}
        </div>
      )}
    </Surface>
  );
}

function ReadyCapabilitiesOverview(props: {
  readonly ready: readonly RuntimeOverviewCapability[];
  readonly readyAction?: ReactNode;
  readonly onOpenCapability: (capability: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedGroup, setSelectedGroup] = useState<'all' | CapabilityGroup>('all');
  const readyById = new Map(props.ready.map((entry) => [entry.id, entry]));
  const groups = groupCapabilities(props.ready.map((entry) => entry.id)).map(({ group, items }) => ({
    group,
    entries: items.map((id) => readyById.get(id)!),
  }));
  const activeGroup = selectedGroup !== 'all' && groups.some((entry) => entry.group === selectedGroup)
    ? selectedGroup
    : 'all';
  const visibleGroups = activeGroup === 'all'
    ? groups
    : groups.filter((entry) => entry.group === activeGroup);
  const showGroupFilter = groups.length > 1;
  const showGroupHeaders = activeGroup === 'all' && groups.length > 1;

  return (
    <Surface
      as="section"
      tone="card"
      padding="none"
      className="desktop-module-card space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="desktop-module-section-title">
          <span className="flex items-center gap-2.5">
            <span
              className="size-2.5 shrink-0 rounded-full bg-[var(--nimi-status-success)] shadow-[0_0_0_4px_var(--nimi-status-success-soft-bg),0_0_12px_color-mix(in_srgb,var(--nimi-status-success)_45%,transparent)]"
              aria-hidden="true"
            />
            {t('runtimeConfig.quickStart.readyTitle', { count: props.ready.length })}
          </span>
        </h2>
        {props.readyAction}
      </div>
      {showGroupFilter ? (
        <div className="min-w-0 overflow-x-auto py-0.5" data-testid="ai-ready-capability-groups">
          <PillTabs
            className="w-max"
            size="sm"
            ariaLabel={t('runtimeConfig.quickStart.filterCategory')}
            value={activeGroup}
            onValueChange={(value) => setSelectedGroup(value as 'all' | CapabilityGroup)}
            items={[
              {
                value: 'all',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span>{t('runtimeConfig.quickStart.allGroups')}</span>
                    <span className="text-[length:var(--nimi-type-caption-size)] tabular-nums opacity-75">{props.ready.length}</span>
                  </span>
                ),
              },
              ...groups.map(({ group, entries }) => ({
                value: group,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span>{t(`runtimeConfig.capabilities.group.${group}`)}</span>
                    <span className="text-[length:var(--nimi-type-caption-size)] tabular-nums opacity-75">{entries.length}</span>
                  </span>
                ),
              })),
            ]}
          />
        </div>
      ) : null}
      <div className="space-y-4">
        {visibleGroups.map(({ group, entries }, groupIndex) => (
          <div
            key={group}
            data-ready-capability-group={group}
            className={showGroupHeaders && groupIndex > 0 ? 'space-y-2 border-t border-[var(--nimi-border-subtle)] pt-3.5' : 'space-y-2'}
          >
            {showGroupHeaders ? (
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-medium text-[var(--nimi-text-muted)]">
                  {t(`runtimeConfig.capabilities.group.${group}`)}
                </h3>
                <span className="text-[length:var(--nimi-type-caption-size)] tabular-nums text-[var(--nimi-text-muted)] opacity-75">
                  {entries.length}
                </span>
              </div>
            ) : null}
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
              {entries.map((entry) => (
                <ReadyCapabilityItem
                  key={entry.id}
                  entry={entry}
                  onOpenCapability={props.onOpenCapability}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function ReadyCapabilityItem(props: {
  readonly entry: RuntimeOverviewCapability;
  readonly onOpenCapability: (capability: string) => void;
}) {
  const { t } = useTranslation();
  const { entry } = props;
  const Icon = capabilityIcon(entry.id);
  const label = displayRuntimeConfigCapabilityLabel(entry.id, t);
  const candidateTask = entry.state.replacement ? entry.state.task : undefined;
  const candidateActive = candidateTask?.status === 'preparing' || candidateTask?.status === 'committing';
  return (
    <button
      type="button"
      className="group flex min-w-0 flex-col justify-center rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2.5 text-left transition-colors hover:border-[var(--nimi-border-strong)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_35%,var(--nimi-surface-panel))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-action-primary-bg)]"
      data-ready-capability={entry.id}
      aria-label={t('runtimeConfig.quickStart.viewCapability', { capability: label })}
      onClick={() => props.onOpenCapability(entry.id)}
    >
      <span className="flex w-full min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-5 text-[var(--nimi-text-primary)]">
            {label}
          </span>
          {entry.model ? (
            <span
              data-current-model=""
              title={entry.model}
              className="mt-0.5 block truncate text-xs leading-4 text-[var(--nimi-text-secondary)]"
            >
              {entry.model}
            </span>
          ) : null}
        </span>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-[var(--nimi-text-muted)] transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--nimi-action-primary-bg)] group-focus-visible:translate-x-0.5 group-focus-visible:text-[var(--nimi-action-primary-bg)]"
        />
      </span>
      {candidateTask && candidateActive ? (
        <span data-candidate-configuration={candidateTask.status} className="mt-2 block w-full space-y-1 border-t border-[var(--nimi-border-subtle)] pt-2 text-xs text-[var(--nimi-text-secondary)]">
          <span className="block truncate" title={entry.taskModel || undefined}>
            {entry.taskModel
              ? t('runtimeConfig.quickStart.otherConfigurationModel', { model: entry.taskModel })
              : t('runtimeConfig.quickStart.otherConfiguration')}
          </span>
          <span className="flex items-start gap-1.5">
            <LoaderCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin text-[var(--nimi-status-info)]" />
            <span>{t(`runtimeConfig.setupTask.status.${candidateTask.status}`)}</span>
          </span>
        </span>
      ) : null}
    </button>
  );
}
