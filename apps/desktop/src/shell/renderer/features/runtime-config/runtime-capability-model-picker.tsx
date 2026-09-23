import { Button, InlineAlert, LoadingSkeleton, OverlayShell, ScrollArea, StatusBadge, TextField } from '@nimiplatform/kit/ui';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { ArrowRight, Check, FolderOpen, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { capabilityModelIdentity, modelDisplayTitle, recipeResourceSummary } from './runtime-capability-presentation.js';

type Props = {
  readonly label: string;
  readonly selected?: NimiMachineLoadout;
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly libraryLoading: boolean;
  readonly libraryError: boolean;
  readonly loading: boolean;
  readonly error: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onChoose: (recipe: string, previous?: NimiMachineLoadout) => Promise<void>;
  readonly onCustomize: () => void;
  readonly onBrowse: () => void;
  readonly onImport?: () => void;
  readonly onClose: () => void;
};

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeCapabilityModelPicker(props: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const busy = props.busy || choosing !== null;
  const current = capabilityModelIdentity(props.selected, props.recipes, props.catalog);
  const saved = props.loadouts.filter((item) => item.validationState === 'configured' && item.loadoutId !== props.selected?.loadoutId);
  // Saved versions remain individual choices, including versions of the
  // current recipe. A recipe without a saved configuration starts from its
  // owner-provided recommendation, with the real preparation plan checked
  // before anything is selected or downloaded.
  const recipes = props.recipes.filter((recipe) => recipe.recipeId !== props.selected?.recipeId
    && !saved.some((item) => item.recipeId === recipe.recipeId));
  const matches = (text: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const savedMatches = saved.filter((item) => {
    const model = capabilityModelIdentity(item, props.recipes, props.catalog);
    return matches(`${model.shortTitle} ${item.displayName} ${model.version}`);
  });
  const recipeMatches = recipes.filter((recipe) => matches(recipe.title));
  const choose = async (key: string, recipeId: string, previous?: NimiMachineLoadout) => {
    setChoosing(key);
    try {
      await props.onChoose(recipeId, previous);
    } finally {
      setChoosing(null);
    }
  };
  const downloadLabel = (recipe: NimiLoadoutRecipe) => {
    if (props.libraryLoading) return t('Common.loading');
    if (props.libraryError) return t('runtimeConfig.product.preparationUnknown');
    const summary = recipeResourceSummary(recipe, props.catalog, props.assets);
    if (summary.missing === 0) return t('runtimeConfig.product.modelsOnDevice');
    return summary.bytes === null
      ? t('runtimeConfig.product.downloadSizeUnknown')
      : t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.bytes) });
  };
  return (
    <OverlayShell
      open
      kind="dialog"
      size="md"
      onClose={busy ? undefined : props.onClose}
      closeOnBackdrop={!busy}
      title={t('runtimeConfig.product.modelPicker.title', { capability: props.label })}
      description={<p className="mt-2 text-sm font-normal leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.localScopeHelp')}</p>}
      data-testid="capability-model-picker"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" disabled={busy} onClick={props.onBrowse} data-testid="capability-model-picker-market">
              {t('runtimeConfig.product.modelPicker.browse')}
              <ArrowRight size={14} />
            </Button>
            {props.onImport ? (
              <Button tone="ghost" size="sm" disabled={busy || props.disabled} onClick={props.onImport}>
                <FolderOpen size={14} />
                {t('runtimeConfig.product.importModel')}
              </Button>
            ) : null}
          </div>
          <Button tone="secondary" disabled={busy} onClick={props.onClose} data-testid="capability-model-picker-cancel">
            {t('Common.cancel')}
          </Button>
        </div>
      )}
    >
      <ScrollArea className="max-h-[55vh]" viewportClassName="py-3" contentClassName="space-y-4">
        {props.selected ? (
          <div className="rounded-xl border border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)] p-4" data-testid="capability-model-picker-current">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words font-semibold">{current.shortTitle}</p>
              <StatusBadge tone="neutral" shape="soft"><Check size={12} />{t('runtimeConfig.product.currentOnDevice')}</StatusBadge>
            </div>
            <p className="mt-1 break-words text-sm text-[var(--nimi-text-secondary)]">{[current.version, current.alias !== current.title ? current.alias : ''].filter(Boolean).join(' · ')}</p>
            <Button tone="ghost" size="sm" className="-ml-2 mt-2" disabled={busy || props.disabled || props.error} onClick={props.onCustomize}>
              <SlidersHorizontal size={14} />
              {t('runtimeConfig.product.editModelAndOptions')}
            </Button>
          </div>
        ) : null}
        {props.loading ? <LoadingSkeleton lines={3} /> : props.error ? (
          <InlineAlert tone="warning">{t('runtimeConfig.product.preparationUnknown')}</InlineAlert>
        ) : (
          <>
            {saved.length + recipes.length > 6 ? (
              <TextField value={query} onChange={(event) => setQuery(event.currentTarget.value)} aria-label={t('runtimeConfig.product.searchModels')} placeholder={t('runtimeConfig.product.searchModels')} />
            ) : null}
            {savedMatches.length || recipeMatches.length ? (
              <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.preparationHint')}</p>
            ) : (
              <p className="py-2 text-sm leading-relaxed text-[var(--nimi-text-secondary)]" data-testid="capability-model-picker-empty">
                {t(query.trim() ? 'runtimeConfig.product.noModelsMatch' : 'runtimeConfig.product.modelPicker.noAlternatives')}
              </p>
            )}
            {savedMatches.map((item) => {
              const model = capabilityModelIdentity(item, props.recipes, props.catalog);
              const unavailable = !model.recipe || model.recipe.applicability === 'unsupported';
              return (
                <div key={item.loadoutId} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--nimi-border-subtle)] p-4">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{model.shortTitle}</p>
                    <p className="mt-1 break-words text-xs text-[var(--nimi-text-secondary)]">{[model.version, item.displayName].filter(Boolean).join(' · ')}</p>
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t(!model.recipe ? 'runtimeConfig.product.preparationUnknown' : unavailable ? 'runtimeConfig.loadouts.hostFit.unsupported' : 'runtimeConfig.product.savedConfiguration')}</p>
                  </div>
                  <Button tone="primary" size="sm" disabled={busy || props.disabled || unavailable} loading={choosing === item.loadoutId} onClick={() => void choose(item.loadoutId, item.recipeId, item)} data-testid={`capability-model-picker-saved:${item.loadoutId}`}>
                    {t('runtimeConfig.product.modelPicker.use')}
                  </Button>
                </div>
              );
            })}
            {recipeMatches.map((recipe) => (
              <div key={recipe.recipeId} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--nimi-border-subtle)] p-4">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{modelDisplayTitle(recipe.title)}</p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{downloadLabel(recipe)}</p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t(`runtimeConfig.loadouts.hostFit.${recipe.applicability}`)}</p>
                </div>
                <Button tone="primary" size="sm" disabled={busy || props.disabled || recipe.applicability === 'unsupported'} loading={choosing === recipe.recipeId} onClick={() => void choose(recipe.recipeId, recipe.recipeId)} data-testid={`capability-model-picker-recipe:${recipe.recipeId}`}>
                  {t('runtimeConfig.product.modelPicker.use')}
                </Button>
              </div>
            ))}
          </>
        )}
        {busy ? <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.switching')}</p> : null}
      </ScrollArea>
    </OverlayShell>
  );
}
