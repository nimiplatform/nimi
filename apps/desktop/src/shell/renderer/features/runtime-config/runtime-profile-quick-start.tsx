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
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { findDesktopNimiTextIntent, useDesktopNimiAppAIConfig } from '../chat/chat-nimi-app-ai-config.js';
import type { capabilityPreparationState } from './runtime-capability-inventory.js';
import { modelDisplayTitle, recipeResourceSummary } from './runtime-capability-presentation.js';
import { runtimeSetupFailureText } from './runtime-setup-failure-message.js';
import { useRuntimeModelLibrary } from './use-runtime-model-library.js';

/** The capability the on-device conversation quick start is about. */
export const CONVERSATION_CAPABILITY = 'text.generate';

/**
 * What the quick start knows about the current on-device conversation
 * preparation, read from the same inventory as the capability rail, plus
 * the actions it may take. Whether Nimi Chat already routes to Local is a
 * separate owner fact and is read inside the card.
 */
export type RuntimeProfileQuickStartConversation = {
  readonly pending: boolean;
  readonly preparation: ReturnType<typeof capabilityPreparationState>;
  /** Short title of the current default model for text generation, when prepared. */
  readonly model: string;
  readonly onOpenChat: () => void;
  /** Reuses the current machine configuration for Nimi Chat: no machine write, only the owner route. */
  readonly onUseInChat: () => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
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
          loadout: { recipeId: recipe.recipeId, axes, options: recipe.defaultOptions },
        },
      },
    }),
  );
}

/**
 * The on-device conversation quick start is a state component, not a fixed
 * recommendation. It answers three questions: can I chat on this device,
 * with which model, and where do I start. Readiness comes from the same
 * machine preparation facts as the capability rail; whether Nimi Chat
 * already uses that preparation is read from the Nimi Chat owner AIConfig.
 * Recommended files on the device are only ever "files on device".
 */
export function RuntimeProfileQuickStart(props: {
  readonly disabled: boolean;
  readonly conversation: RuntimeProfileQuickStartConversation;
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
  if (state === 'ready') return <ReadyQuickStart conversation={conversation} disabled={props.disabled} />;
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
  const iconClass =
    props.state === 'attention'
      ? 'text-[var(--nimi-status-warning)]'
      : props.state === 'unknown'
        ? 'text-[var(--nimi-text-muted)]'
        : 'text-[var(--nimi-action-primary-bg)]';
  return (
    <section
      className="rounded-2xl bg-[var(--nimi-surface-active)] p-5 lg:p-6"
      data-testid="ai-profile-quick-start"
      data-quick-start-state={props.state}
    >
      <div className="flex flex-wrap items-start gap-5">
        <span
          className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-surface-card)] ${iconClass}`}
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
  return <h2 className="text-lg font-semibold">{props.children}</h2>;
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
 * Machine preparation is ready. The remaining question is whether Nimi Chat
 * already routes text generation to Local; if not, the action is the no-write
 * reuse of the current machine configuration, which saves only that route.
 */
function ReadyQuickStart(props: {
  readonly conversation: RuntimeProfileQuickStartConversation;
  readonly disabled: boolean;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const { conversation } = props;
  const appConfig = useDesktopNimiAppAIConfig(sdk.appId());
  const chatLocal = findDesktopNimiTextIntent(appConfig.data?.config)?.route.oneofKind === 'local';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const useInChat = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await conversation.onUseInChat();
      if (!result.ok) setError(result.message);
      else await appConfig.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const replacement = conversation.preparation.replacement ? conversation.preparation.task : undefined;
  const model = conversation.model;
  return (
    <QuickStartShell icon={MessageSquare} state="ready">
      <QuickStartTitle>{t('runtimeConfig.quickStart.readyTitle')}</QuickStartTitle>
      {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {model ? (
          <span className="flex items-center gap-2 font-medium text-[var(--nimi-text-primary)]">
            <IdentityTile seed={model.split(/\s+/u)[0] ?? model} label={model} size="sm" />
            {model}
          </span>
        ) : null}
        <Fact tone="good">{t('runtimeConfig.quickStart.readyDefault')}</Fact>
        {appConfig.isPending ? (
          <Fact tone="pending">{t('Common.loading')}</Fact>
        ) : appConfig.isError ? (
          <Fact tone="muted">{t('runtimeConfig.quickStart.chatUnknown')}</Fact>
        ) : chatLocal ? (
          <Fact tone="good">{t('runtimeConfig.quickStart.chatUsesLocal')}</Fact>
        ) : (
          <Fact tone="muted">{t('runtimeConfig.quickStart.chatNotLocal')}</Fact>
        )}
        {replacement ? (
          <Fact tone="pending">
            {t('runtimeConfig.capabilities.replacement')} · {t(`runtimeConfig.setupTask.status.${replacement.status}`)}
          </Fact>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chatLocal || appConfig.isError ? (
          <Button tone="primary" onClick={conversation.onOpenChat} data-testid="ai-profile-quick-start-open-chat">
            {t('runtimeConfig.quickStart.openChat')}
            <ArrowRight size={15} />
          </Button>
        ) : (
          <Button
            tone="primary"
            disabled={busy || props.disabled || appConfig.isPending}
            onClick={() => {
              void useInChat();
            }}
            data-testid="ai-profile-quick-start-use-in-chat"
          >
            {busy ? t('Common.loading') : t('runtimeConfig.quickStart.useInChat')}
            <ArrowRight size={15} />
          </Button>
        )}
        <Button tone="ghost" size="sm" onClick={conversation.onOpenDetail} data-testid="ai-profile-quick-start-detail">
          {t('runtimeConfig.quickStart.viewDetail')}
        </Button>
      </div>
    </QuickStartShell>
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
