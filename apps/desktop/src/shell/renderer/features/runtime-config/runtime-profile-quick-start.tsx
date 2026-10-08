import { Button, InlineAlert, LoadingSkeleton, SelectField } from '@nimiplatform/kit/ui';
import { parseNimiPortableAIProfile, type NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type { NimiLoadoutRecipe, NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleDashed,
  Download,
  LoaderCircle,
  MessageSquare,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { capabilityPreparationState } from './runtime-capability-inventory.js';
import {
  capabilityIcon,
  contextFitReduced,
  formatContextTokens,
  modelDisplayTitle,
  recipeRecommendedContextFit,
  recipeResourceSummary,
} from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { runtimeSetupFailureText } from './runtime-setup-failure-message.js';
import { useRuntimeModelLibrary } from './use-runtime-model-library.js';

/** The capability the on-device conversation quick start is about. */
export const CONVERSATION_CAPABILITY = 'text.generate';

// Mirrors the kit AmbientBackground mesh recipe through the shared ambient
// tokens. AmbientBackground itself is not importable here: the desktop
// node:test pipeline compiles kit/ui source with classic JSX, which that
// component does not survive (same constraint as the first-run chrome).
const QUICK_START_MESH_STYLE: CSSProperties = {
  background: [
    'radial-gradient(ellipse at 0% 0%, var(--nimi-ambient-mesh-color-1) 0%, transparent 50%)',
    'radial-gradient(ellipse at 100% 0%, var(--nimi-ambient-mesh-color-2) 0%, transparent 50%)',
    'radial-gradient(ellipse at 100% 100%, var(--nimi-ambient-mesh-color-3) 0%, transparent 50%)',
    'radial-gradient(ellipse at 0% 100%, var(--nimi-ambient-mesh-color-4) 0%, transparent 50%)',
    'linear-gradient(135deg, var(--nimi-ambient-mesh-base-start) 0%, var(--nimi-ambient-mesh-base-end) 100%)',
  ].join(', '),
};

const PRIMARY_ICON_TILE_STYLE: CSSProperties = {
  background:
    'linear-gradient(135deg, color-mix(in srgb, var(--nimi-action-primary-bg) 72%, #ffffff) 0%, var(--nimi-action-primary-bg) 100%)',
  boxShadow: '0 10px 24px color-mix(in srgb, var(--nimi-action-primary-bg) 32%, transparent)',
};

export type RuntimeOverviewCapability = {
  readonly id: string;
  readonly model: string;
  readonly state: ReturnType<typeof capabilityPreparationState>;
};

/**
 * What the quick start knows about the current on-device conversation
 * preparation, read from the same inventory as the capability rail, plus
 * the actions it may take when no capability is prepared yet.
 */
export type RuntimeProfileQuickStartConversation = {
  readonly pending: boolean;
  readonly preparation: ReturnType<typeof capabilityPreparationState>;
  readonly onOpenDetail: () => void;
  readonly onOpenTask: (taskId: string) => void;
  readonly onRetry: () => void;
};

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
          asset.templateId === slot.recommendedVariantIds[0] &&
          asset.contentId === slot.recommendedContentIds[0],
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
 * Overview readiness uses the same entries as the capability rail. Each
 * prepared capability gets its model and entry point; when none are ready,
 * the conversation quick start guides the first setup. Ready entries all
 * open their capability details, without projecting app-specific usage.
 */
export function RuntimeProfileQuickStart(props: {
  readonly disabled: boolean;
  readonly conversation: RuntimeProfileQuickStartConversation;
  readonly capabilities: readonly RuntimeOverviewCapability[];
  readonly onOpenCapability: (capability: string) => void;
  readonly onUse: (profile: NimiPortableAIProfile) => void;
}) {
  const { t } = useTranslation();
  const { conversation } = props;
  const state = conversation.preparation.state;
  if (conversation.pending) {
    return (
      <QuickStartShell icon={MessageSquare} state="pending">
        <LoadingSkeleton className="h-16 w-full" />
      </QuickStartShell>
    );
  }
  const ready = props.capabilities.filter((entry) => entry.state.state === 'ready');
  if (ready.length > 0) {
    return (
      <QuickStartShell icon={Sparkles} state="ready">
        <div className="space-y-1">
          <QuickStartTitle>{t('runtimeConfig.quickStart.readyTitle')}</QuickStartTitle>
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
          {ready.map((entry) => {
            const Icon = capabilityIcon(entry.id);
            const label = displayRuntimeConfigCapabilityLabel(entry.id, t);
            return (
              <button
                key={entry.id}
                type="button"
                className="group flex items-center gap-3 rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3.5 text-left shadow-[var(--nimi-elevation-base)] transition-[box-shadow,transform] duration-200 hover:shadow-[var(--nimi-elevation-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-action-primary-bg)] motion-safe:hover:-translate-y-0.5"
                data-ready-capability={entry.id}
                aria-label={t('runtimeConfig.quickStart.viewCapability', { capability: label })}
                onClick={() => props.onOpenCapability(entry.id)}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
                  <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{label}</span>
                  {entry.model ? (
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--nimi-status-success-soft-bg)] px-2 py-0.5 text-xs font-medium text-[var(--nimi-status-success-soft-text)]">
                      <Check size={12} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">{entry.model}</span>
                    </span>
                  ) : null}
                  {entry.state.replacement && entry.state.task ? (
                    <Fact tone="pending">
                      {t('runtimeConfig.capabilities.replacement')} · {t(`runtimeConfig.setupTask.status.${entry.state.task.status}`)}
                    </Fact>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--nimi-text-muted)] transition-colors duration-200 group-hover:text-[var(--nimi-action-primary-bg)]">
                  {t('runtimeConfig.quickStart.view')}
                  <ArrowRight
                    size={14}
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </span>
              </button>
            );
          })}
        </div>
      </QuickStartShell>
    );
  }
  if (state === 'preparing') {
    const task = conversation.preparation.task;
    return (
      <QuickStartShell icon={LoaderCircle} state={state}>
        <QuickStartTitle>{t('runtimeConfig.quickStart.preparingTitle')}</QuickStartTitle>
        {task ? (
          <p className="text-sm text-[var(--nimi-text-secondary)]">
            {t(`runtimeConfig.setupTask.status.${task.status}`)}
          </p>
        ) : null}
        <Button
          tone="secondary"
          onClick={() => (task ? conversation.onOpenTask(task.taskId) : conversation.onOpenDetail())}
          data-testid="ai-profile-quick-start-progress"
        >
          {t('runtimeConfig.quickStart.viewProgress')}
          <ArrowRight size={15} />
        </Button>
      </QuickStartShell>
    );
  }
  if (state === 'attention') {
    const task = conversation.preparation.task;
    const failureText = task?.failure ? runtimeSetupFailureText(task.failure, t) : '';
    return (
      <QuickStartShell icon={CircleAlert} state={state}>
        <QuickStartTitle>{t('runtimeConfig.quickStart.attentionTitle')}</QuickStartTitle>
        {failureText ? (
          <p className="text-sm text-[var(--nimi-text-secondary)]">{failureText}</p>
        ) : null}
        <Button
          tone="secondary"
          onClick={() => (task ? conversation.onOpenTask(task.taskId) : conversation.onOpenDetail())}
          data-testid="ai-profile-quick-start-detail"
        >
          {t('runtimeConfig.quickStart.viewDetail')}
          <ArrowRight size={15} />
        </Button>
      </QuickStartShell>
    );
  }
  if (state === 'unknown') {
    return (
      <QuickStartShell icon={CircleDashed} state={state}>
        <QuickStartTitle>{t('runtimeConfig.quickStart.unknownTitle')}</QuickStartTitle>
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.preparationUnknown')}</p>
        <Button tone="secondary" onClick={conversation.onRetry}>
          {t('Common.retry')}
        </Button>
      </QuickStartShell>
    );
  }
  return <RecommendationQuickStart disabled={props.disabled} onUse={props.onUse} />;
}


function QuickStartShell(props: {
  readonly icon: LucideIcon;
  readonly state: 'pending' | 'ready' | 'preparing' | 'attention' | 'unknown' | 'unset';
  readonly children: ReactNode;
}) {
  const Icon = props.icon;
  const attention = props.state === 'attention';
  const muted = props.state === 'unknown';
  const iconTileClass = attention
    ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning)]'
    : muted
      ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)] shadow-[var(--nimi-elevation-base)]'
      : 'text-[var(--nimi-action-primary-text)]';
  return (
    <section
      className="rounded-[var(--nimi-radius-xl)] border border-[var(--nimi-border-subtle)] p-5 shadow-[var(--nimi-elevation-base)] lg:p-6"
      style={QUICK_START_MESH_STYLE}
      data-testid="ai-profile-quick-start"
      data-quick-start-state={props.state}
    >
      <div className="flex flex-wrap items-start gap-5">
        <span
          className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${iconTileClass}`}
          style={attention || muted ? undefined : PRIMARY_ICON_TILE_STYLE}
        >
          <Icon
            size={28}
            strokeWidth={1.6}
            className={props.state === 'preparing' ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1 space-y-3">{props.children}</div>
      </div>
    </section>
  );
}

function QuickStartTitle(props: { readonly children: ReactNode }) {
  return <h2 className="text-xl font-bold text-[var(--nimi-text-primary)]">{props.children}</h2>;
}

function Fact(props: { readonly tone: 'good' | 'muted' | 'pending'; readonly children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
      {props.tone === 'good' ? (
        <Check size={14} className="text-[var(--nimi-status-success)]" aria-hidden="true" />
      ) : props.tone === 'pending' ? (
        <LoaderCircle size={14} className="animate-spin text-[var(--nimi-text-muted)]" aria-hidden="true" />
      ) : (
        <CircleDashed size={14} className="text-[var(--nimi-text-muted)]" aria-hidden="true" />
      )}
      {props.children}
    </span>
  );
}

/**
 * Nothing is prepared yet: offer the exact device recommendation and say
 * what it costs to prepare. The button says what will actually happen.
 */
function RecommendationQuickStart(props: {
  readonly disabled: boolean;
  readonly onUse: (profile: NimiPortableAIProfile) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const library = useRuntimeModelLibrary();
  const available = useQuery({
    queryKey: ['runtime', 'conversation-starter-recipes'],
    queryFn: () => sdk.machineProduct().local.loadouts.listRecipes(CONVERSATION_CAPABILITY),
    staleTime: 60_000,
  });
  const recipes = available.data?.filter((item) => item.applicability === 'supported') ?? [];
  const [recipeId, setRecipeId] = useState('');
  const selected = recipes.length === 1 ? recipes[0] : recipes.find((item) => item.recipeId === recipeId);
  const summary =
    selected && library.data
      ? recipeResourceSummary(selected, library.data.catalog, library.data.assets)
      : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prepare = async (recipe?: NimiLoadoutRecipe) => {
    setBusy(true);
    setError('');
    try {
      if (!recipe || !library.data) throw new Error(t('runtimeConfig.quickStart.unavailable'));
      props.onUse({
        ...recommendedPortableProfile(recipe, library.data.catalog),
        title: t('runtimeConfig.quickStart.title'),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const actionLabel = busy
    ? t('Common.loading')
    : !summary
      ? t('runtimeConfig.quickStart.use')
      : summary.missing === 0
        ? t('runtimeConfig.quickStart.useReady')
        : summary.bytes === null
          ? t('runtimeConfig.quickStart.use')
          : t('runtimeConfig.quickStart.useDownload', { size: formatBytes(summary.bytes) });
  const modelTitle = selected ? modelDisplayTitle(selected.title) : '';
  const contextFit = selected ? recipeRecommendedContextFit(selected) : undefined;
  return (
    <QuickStartShell icon={MessageSquare} state="unset">
      <QuickStartTitle>{t('runtimeConfig.quickStart.setupTitle')}</QuickStartTitle>
      {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
      {available.isError || library.isError ? (
        <InlineAlert tone="warning">
          {t('runtimeConfig.product.preparationUnknown')}
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              void available.refetch();
              void library.refetch();
            }}
          >
            {t('Common.retry')}
          </Button>
        </InlineAlert>
      ) : null}
      {!available.isPending && !available.isError && recipes.length === 0 ? (
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.quickStart.unavailable')}</p>
      ) : null}
      {recipes.length > 1 ? (
        <SelectField
          aria-label={t('runtimeConfig.quickStart.choose')}
          value={recipeId}
          onValueChange={setRecipeId}
          options={[
            { value: '', label: t('runtimeConfig.quickStart.choose') },
            ...recipes.map((recipe) => ({ value: recipe.recipeId, label: modelDisplayTitle(recipe.title) })),
          ]}
        />
      ) : null}
      {selected ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-2 font-medium text-[var(--nimi-text-primary)]">
            <IdentityTile seed={modelTitle.split(/\s+/u)[0] ?? modelTitle} label={modelTitle} size="sm" />
            {modelTitle}
          </span>
          <Fact tone="good">{t('runtimeConfig.product.deviceRecommendation')}</Fact>
          <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
            {summary && summary.missing > 0 ? (
              <Download size={14} className="text-[var(--nimi-status-warning)]" aria-hidden="true" />
            ) : (
              <Check size={14} className="text-[var(--nimi-status-success)]" aria-hidden="true" />
            )}
            {summary
              ? summary.missing === 0
                ? t('runtimeConfig.product.modelsOnDevice')
                : summary.bytes === null
                  ? t('runtimeConfig.product.downloadSizeUnknown')
                  : t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.bytes) })
              : t('Common.loading')}
          </span>
        </div>
      ) : null}
      {contextFit ? (
        <p className="text-xs text-[var(--nimi-text-secondary)]" data-testid="ai-profile-quick-start-context">
          {contextFitReduced(contextFit)
            ? `${t('runtimeConfig.product.contextReduced', { size: formatContextTokens(contextFit.recommendedContextSize) })} · ${t('runtimeConfig.product.contextReducedReason', { full: formatContextTokens(contextFit.authoredContextSize) })}`
            : t('runtimeConfig.product.contextAutomatic', { size: formatContextTokens(contextFit.recommendedContextSize) })}
        </p>
      ) : null}
      <Button
        tone="primary"
        disabled={busy || props.disabled || !selected || !library.data}
        onClick={() => {
          void prepare(selected);
        }}
        data-testid="ai-profile-quick-start-use"
      >
        {actionLabel}
        <ArrowRight size={15} />
      </Button>
    </QuickStartShell>
  );
}
