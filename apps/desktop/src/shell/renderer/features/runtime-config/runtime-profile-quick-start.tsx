import { Button, InlineAlert, SelectField } from '@nimiplatform/kit/ui';
import { parseNimiPortableAIProfile, type NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type { NimiLoadoutRecipe, NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Download, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { modelDisplayTitle, recipeResourceSummary } from './runtime-capability-presentation.js';
import { useRuntimeModelLibrary } from './use-runtime-model-library.js';

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
 * The on-device conversation starter card. It answers three questions before
 * any click: what you get, why this model fits this device, and what it
 * costs to prepare. The button says what will actually happen.
 */
export function RuntimeProfileQuickStart(props: {
  readonly disabled: boolean;
  readonly onUse: (profile: NimiPortableAIProfile) => void;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const library = useRuntimeModelLibrary();
  const available = useQuery({
    queryKey: ['runtime', 'conversation-starter-recipes'],
    queryFn: () => sdk.machineProduct().local.loadouts.listRecipes('text.generate'),
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
    <section
      className="rounded-2xl bg-[var(--nimi-surface-active)] p-5 lg:p-6"
      data-testid="ai-profile-quick-start"
    >
      <div className="flex flex-wrap items-start gap-5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)]">
          <MessageSquare size={28} strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{t('runtimeConfig.quickStart.title')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.quickStart.description')}
            </p>
          </div>
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
              <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
                <Check size={14} className="text-[var(--nimi-status-success)]" />
                {t('runtimeConfig.product.deviceRecommendation')}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
                {summary && summary.missing > 0 ? (
                  <Download size={14} className="text-[var(--nimi-status-warning)]" />
                ) : (
                  <Check size={14} className="text-[var(--nimi-status-success)]" />
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
        </div>
      </div>
    </section>
  );
}
