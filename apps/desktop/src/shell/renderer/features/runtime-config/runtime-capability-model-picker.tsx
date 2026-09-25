import { Button, IconButton, InlineAlert, LoadingSkeleton, OverlayShell, ScrollArea, StatusBadge, TextField } from '@nimiplatform/kit/ui';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { ArrowRight, FolderOpen, Info, SlidersHorizontal, Store, X, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import {
  capabilityModelIdentity,
  configurationVariantLabel,
  modelDisplayTitle,
  modelFamilySeed,
  recipeOfferSummary,
} from './runtime-capability-presentation.js';

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

/** One way to add a model. With nothing else to choose, these cards are the dialog's main content. */
function AddModelCard(props: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly testId: string;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
      className="flex min-h-[8.5rem] flex-col items-start rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 text-left text-[var(--nimi-text-muted)] transition-[background-color,border-color,color,transform] duration-[var(--nimi-motion-fast)] enabled:hover:border-[var(--nimi-action-primary-bg)] enabled:hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))] enabled:hover:text-[var(--nimi-action-primary-bg)] enabled:active:scale-[var(--nimi-motion-pressed-scale)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]"
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-[var(--nimi-radius-sm)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]">
          <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </span>
      <span className="mt-auto pt-5 text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</span>
      <span className="mt-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{props.description}</span>
    </button>
  );
}

function ModelChoiceRow(props: {
  readonly seed: string;
  readonly name: string;
  readonly detail: string;
  readonly action: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <IdentityTile seed={props.seed} label={props.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-[var(--nimi-text-primary)]">{props.name}</p>
        <p className="mt-0.5 break-words text-xs text-[var(--nimi-text-secondary)]">{props.detail}</p>
      </div>
      {props.action}
    </li>
  );
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function RuntimeCapabilityModelPicker(props: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const [query, setQuery] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const busy = props.busy || choosing !== null;
  const current = capabilityModelIdentity(props.selected, props.recipes, props.catalog);
  const currentVariant = props.selected
    ? configurationVariantLabel(props.selected.displayName, current.recipe?.title ?? '', current.shortTitle) || current.versionShort
    : '';
  const saved = props.loadouts.filter((item) => item.validationState === 'configured' && item.loadoutId !== props.selected?.loadoutId);
  // Saved versions remain individual choices, including versions of the
  // current recipe. A recipe without a saved configuration starts from its
  // owner-provided recommendation, with the real preparation plan checked
  // before anything is selected or downloaded.
  const recipes = props.recipes.filter((recipe) => recipe.recipeId !== props.selected?.recipeId
    && !saved.some((item) => item.recipeId === recipe.recipeId));
  // Only a confirmed empty inventory makes adding a model the main content;
  // while loading or after a failed query the ways to add stay secondary.
  const empty = !props.loading && !props.error && saved.length + recipes.length === 0;
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
    const summary = recipeOfferSummary(recipe);
    if (summary.withoutOffer > 0) return t('runtimeConfig.product.noDirectDownload');
    if (summary.missing === 0) return t('runtimeConfig.product.modelsOnDevice');
    return summary.downloadBytes === null
      ? t('runtimeConfig.product.downloadSizeUnknown')
      : t('runtimeConfig.product.downloadSize', { size: formatBytes(summary.downloadBytes) });
  };
  const browseLabel = t('runtimeConfig.product.modelPicker.browse');
  const importLabel = t('runtimeConfig.product.importModel');
  const importDisabled = busy || props.disabled;
  const footer = empty || props.loading ? undefined : (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-[var(--nimi-border-subtle)] pt-4">
      {props.error ? null : (
        <span className="mr-1 text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.moreLead')}</span>
      )}
      <Button tone="ghost" size="sm" disabled={busy} onClick={props.onBrowse} data-testid="capability-model-picker-market">
        <Store size={14} />
        {browseLabel}
      </Button>
      {props.onImport ? (
        <Button tone="ghost" size="sm" disabled={importDisabled} onClick={props.onImport} data-testid="capability-model-picker-import">
          <FolderOpen size={14} />
          {importLabel}
        </Button>
      ) : null}
    </div>
  );
  return (
    <OverlayShell
      open
      kind="dialog"
      size="sm"
      onClose={busy ? undefined : props.onClose}
      closeOnBackdrop={!busy}
      title={<span className="block pr-10">{t('runtimeConfig.product.modelPicker.title', { capability: props.label })}</span>}
      contentClassName={footer ? undefined : 'pb-6'}
      data-testid="capability-model-picker"
      footer={footer}
    >
      <div className="space-y-5 pt-2">
        {props.selected ? (
          <div className="flex items-center gap-3 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] py-3 pl-3 pr-2" data-testid="capability-model-picker-current">
            <IdentityTile seed={modelFamilySeed(current.title)} label={current.shortTitle} size="md" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-words text-sm font-semibold text-[var(--nimi-text-primary)]">{current.shortTitle}</span>
                <StatusBadge tone="neutral" shape="soft">{t('runtimeConfig.product.modelPicker.current')}</StatusBadge>
              </p>
              {currentVariant ? (
                <p className="mt-0.5 truncate text-xs text-[var(--nimi-text-secondary)]" title={currentVariant}>{currentVariant}</p>
              ) : null}
            </div>
            <Button tone="ghost" size="sm" className="shrink-0" disabled={busy || props.disabled || props.error} onClick={props.onCustomize}>
              <SlidersHorizontal size={14} />
              {t('runtimeConfig.product.editModelAndOptions')}
            </Button>
          </div>
        ) : null}
        {props.loading ? <LoadingSkeleton lines={3} /> : props.error ? (
          <InlineAlert tone="warning">{t('runtimeConfig.product.preparationUnknown')}</InlineAlert>
        ) : empty ? (
          <section aria-labelledby={headingId} data-testid="capability-model-picker-empty">
            <h3 id={headingId} className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.product.modelPicker.addTitle')}
            </h3>
            <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.addLead')}</p>
            <div className={`mt-4 grid gap-3 ${props.onImport ? 'grid-cols-2' : ''}`}>
              <AddModelCard
                icon={Store}
                title={browseLabel}
                description={t('runtimeConfig.product.modelPicker.browseLead')}
                disabled={busy}
                onClick={props.onBrowse}
                testId="capability-model-picker-market"
              />
              {props.onImport ? (
                <AddModelCard
                  icon={FolderOpen}
                  title={importLabel}
                  description={t('runtimeConfig.product.modelPicker.importLead')}
                  disabled={importDisabled}
                  onClick={props.onImport}
                  testId="capability-model-picker-import"
                />
              ) : null}
            </div>
          </section>
        ) : (
          <section aria-labelledby={headingId} className="space-y-3">
            <h3 id={headingId} className="text-xs font-semibold text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.others')}</h3>
            {saved.length + recipes.length > 6 ? (
              <TextField value={query} onChange={(event) => setQuery(event.currentTarget.value)} aria-label={t('runtimeConfig.product.searchModels')} placeholder={t('runtimeConfig.product.searchModels')} />
            ) : null}
            {savedMatches.length || recipeMatches.length ? (
              <div className="overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)]">
                <ScrollArea className="max-h-[40vh]">
                  <ul className="divide-y divide-[var(--nimi-border-subtle)]">
                    {savedMatches.map((item) => {
                      const model = capabilityModelIdentity(item, props.recipes, props.catalog);
                      const unavailable = !model.recipe || model.recipe.applicability === 'unsupported';
                      const variant = configurationVariantLabel(item.displayName, model.recipe?.title ?? '', model.shortTitle) || model.versionShort;
                      const state = t(!model.recipe ? 'runtimeConfig.product.preparationUnknown' : unavailable ? 'runtimeConfig.loadouts.hostFit.unsupported' : 'runtimeConfig.product.savedConfiguration');
                      return (
                        <ModelChoiceRow
                          key={item.loadoutId}
                          seed={modelFamilySeed(model.title)}
                          name={model.shortTitle}
                          detail={[variant, state].filter(Boolean).join(' · ')}
                          action={(
                            <Button tone="secondary" size="sm" disabled={busy || props.disabled || unavailable} loading={choosing === item.loadoutId} onClick={() => void choose(item.loadoutId, item.recipeId, item)} data-testid={`capability-model-picker-saved:${item.loadoutId}`}>
                              {t('runtimeConfig.product.modelPicker.switch')}
                            </Button>
                          )}
                        />
                      );
                    })}
                    {recipeMatches.map((recipe) => (
                      <ModelChoiceRow
                        key={recipe.recipeId}
                        seed={modelFamilySeed(recipe.title)}
                        name={modelDisplayTitle(recipe.title)}
                        detail={`${downloadLabel(recipe)} · ${t(`runtimeConfig.product.modelFit.${recipe.applicability}`)}`}
                        action={(
                          <Button tone="secondary" size="sm" disabled={busy || props.disabled || recipe.applicability === 'unsupported'} loading={choosing === recipe.recipeId} onClick={() => void choose(recipe.recipeId, recipe.recipeId)} data-testid={`capability-model-picker-recipe:${recipe.recipeId}`}>
                            {t('runtimeConfig.product.modelPicker.switch')}
                          </Button>
                        )}
                      />
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.noModelsMatch')}</p>
            )}
            <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t('runtimeConfig.product.modelPicker.switchNote')}
            </p>
          </section>
        )}
        {busy ? <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.modelPicker.switching')}</p> : null}
      </div>
      <IconButton
        size="sm"
        aria-label={t('Common.close')}
        icon={<X size={16} aria-hidden="true" />}
        disabled={busy}
        onClick={props.onClose}
        className="absolute right-5 top-5"
        data-testid="capability-model-picker-close"
      />
    </OverlayShell>
  );
}
