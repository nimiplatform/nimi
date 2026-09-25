// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace

import { Button, InlineAlert, LoadingSkeleton, SelectField, StatusBadge, TextareaField, Tooltip } from '@nimiplatform/kit/ui';
import type { NimiJsonObject, NimiJsonValue } from '@nimiplatform/sdk/contracts';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { Bookmark, Braces, Check, CircleAlert, Download, Info, RotateCcw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import { IdentityTile } from '../../components/identity-tile.js';
import { capabilityModelIdentity, modelFamilySeed } from './runtime-capability-presentation.js';
import {
  loadoutAssetLabel,
  loadoutCandidatePresentation,
  loadoutModelPresentation,
  loadoutSlotLabelKey,
  runtimeConfigLoadoutCandidateAssets,
  type LoadoutModelPresentation,
  type NimiLoadoutRecipeSlot,
} from './runtime-config-loadout-model-display.js';
import type { RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';

const NOT_USED = '__not-used__';
const UNRESOLVED = '__unresolved__';

type SlotStatus = { readonly tone: 'ready' | 'download' | 'attention'; readonly text: string };
type SlotChoice = {
  readonly value: string;
  readonly name: string;
  readonly file: string;
  readonly status?: SlotStatus;
  readonly disabled?: boolean;
};

function slotLabel(slot: Pick<NimiLoadoutRecipeSlot, 'slotId' | 'displayLabel'>, t: TFunction): string {
  const key = loadoutSlotLabelKey(slot.slotId);
  return key ? t(key, { defaultValue: slot.displayLabel }) : slot.displayLabel;
}

/** "Gemma 4 2B · Q8_0". The quantization stays exact so Q4_K_M and Q4_0 remain distinct choices. */
function exactVersionName(presentation: LoadoutModelPresentation): string {
  const model = presentation.sizeLabel ? `${presentation.family} ${presentation.sizeLabel}` : presentation.family;
  return [model, presentation.quant.technical].filter(Boolean).join(' · ') || presentation.rawLabel;
}

function optionValueType(value: unknown): 'boolean' | 'number' | 'string' | 'json' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

function parseOptions(text: string): NimiJsonObject | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as NimiJsonObject : null;
  } catch {
    return null;
  }
}

/** Order-insensitive identity of what an apply would submit. */
function draftIdentity(draft: RuntimeSetupTaskDraft): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
    }
    return value;
  };
  return JSON.stringify(sorted({
    options: draft.options ?? {},
    axes: [...(draft.axes ?? [])].sort((a, b) => a.slotId.localeCompare(b.slotId)),
    disabledOptionalSlots: [...(draft.disabledOptionalSlots ?? [])].sort(),
    preferredOffers: draft.preferredOffers ?? {},
  }));
}

function withoutSlot(record: Readonly<Record<string, string>> | undefined, slotId: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record ?? {}).filter(([id]) => id !== slotId));
}

function ChoiceLabel(props: { readonly name: string; readonly meta?: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{props.name}</span>
      {/* Hidden in the closed field: the row shows the chosen version's state beside its name. */}
      {props.meta ? <span data-choice-meta className="shrink-0 text-xs text-[var(--nimi-text-secondary)]">{props.meta}</span> : null}
    </span>
  );
}

function StatusLine({ status }: { readonly status: SlotStatus }) {
  const Icon = status.tone === 'ready' ? Check : status.tone === 'download' ? Download : CircleAlert;
  const color = status.tone === 'ready'
    ? 'text-[var(--nimi-status-success)]'
    : status.tone === 'download'
      ? 'text-[var(--nimi-status-info)]'
      : 'text-[var(--nimi-status-warning)]';
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
      <Icon size={13} strokeWidth={2.2} className={`shrink-0 ${color}`} aria-hidden="true" />
      {status.text}
    </p>
  );
}

/** The scope of the device's current model, one hover away beside its name. */
export function ScopeHint({ text }: { readonly text: string }) {
  return (
    <Tooltip content={text} placement="top">
      <span className="inline-flex cursor-help items-center text-[var(--nimi-text-muted)]" aria-label={text}>
        <Info size={14} />
      </span>
    </Tooltip>
  );
}

/** The same card as the capability overview, so both tabs read as one model. */
function CustomizeCard({ children }: { readonly children: ReactNode }) {
  return <section className="rounded-2xl bg-[var(--nimi-surface-card)]" data-testid="capability-customize-card">{children}</section>;
}

/** A band of the card below the model, divided like the overview's technical details. */
function Band(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="border-t border-[var(--nimi-border-subtle)] px-5 pb-2 pt-5 lg:px-6">
      <h3 className="text-xs font-semibold text-[var(--nimi-text-muted)]">{props.title}</h3>
      {/* Pulled up so the title sits with its first row rather than midway from the divider. */}
      <div className="-mt-1.5 divide-y divide-[var(--nimi-border-subtle)]">{props.children}</div>
    </div>
  );
}

/**
 * The top of the card, laid out like the overview's: the model this device
 * currently uses for the capability and, indented under its name, why its
 * versions and options cannot be read right now.
 */
function CapabilityCustomizeCurrent(props: {
  readonly selected: NimiMachineLoadout;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly unavailable: boolean;
  readonly onRetry?: () => void;
  readonly onManageSaved: () => void;
}) {
  const { t } = useTranslation();
  const identity = capabilityModelIdentity(props.selected, props.recipes, props.catalog);
  const title = identity.shortTitle || props.selected.displayName || '';
  const version = [
    identity.versionShort,
    identity.sizeBytes ? t('runtimeConfig.product.aboutSize', { size: formatBytes(identity.sizeBytes) }) : '',
  ].filter(Boolean).join(' · ');
  return (
    <div data-testid="capability-customize-current">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 p-5 lg:p-6">
        <div className="flex min-w-[16rem] flex-1 items-start gap-4">
          {title ? <IdentityTile seed={modelFamilySeed(identity.title || title)} label={title} size="lg" /> : null}
          <div className="min-w-0 flex-1">
            {title ? <h2 className="break-words text-xl font-semibold leading-7">{title}</h2> : null}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.product.currentOnDevice')}
              <ScopeHint text={t('runtimeConfig.product.customization.sharedScope')} />
              {version ? <><span aria-hidden="true">·</span><span>{version}</span></> : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-[7px]">
          <Button tone="secondary" onClick={props.onManageSaved} data-testid="capability-customize-manage-saved">
            <Bookmark size={15} />
            {t('runtimeConfig.product.manageSaved')}
          </Button>
        </div>
      </div>
      {props.unavailable ? (
        <div className="flex gap-4 px-5 pb-5 lg:px-6 lg:pb-6">
          {title ? <span className="w-12 shrink-0" aria-hidden="true" /> : null}
          <div
            role="status"
            className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_7%,transparent)] px-4 py-2.5 ring-1 ring-inset ring-[var(--nimi-status-warning-soft-border)]"
            data-testid="capability-customize-unavailable"
          >
            <p className="flex min-w-0 items-center gap-2 text-sm text-[var(--nimi-text-primary)]">
              <CircleAlert size={15} className="shrink-0 text-[var(--nimi-status-warning)]" aria-hidden="true" />
              {t('runtimeConfig.product.customization.unavailable')}
            </p>
            {props.onRetry ? (
              <Button tone="secondary" size="sm" onClick={props.onRetry}>{t('Common.retry')}</Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Customize tab as one card, like the overview: the current model on top
 * and, once its recipe is read, its versions and runtime options in bands.
 */
export function RuntimeCapabilityCustomizeTab(props: {
  readonly selected: NimiMachineLoadout;
  /** Recipe of the selected configuration; absent while loading or when it cannot be read. */
  readonly recipe?: NimiLoadoutRecipe;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly loading: boolean;
  /** The model library or inventory could not be read; editing waits for a retry. */
  readonly readFailed: boolean;
  readonly disabled: boolean;
  readonly onRetry?: () => void;
  readonly onManageSaved: () => void;
  readonly onApply: (draft: RuntimeSetupTaskDraft) => Promise<void>;
}) {
  const header = (
    <CapabilityCustomizeCurrent
      selected={props.selected}
      recipes={props.recipes}
      catalog={props.catalog}
      unavailable={!props.loading && (props.readFailed || !props.recipe)}
      onRetry={props.onRetry}
      onManageSaved={props.onManageSaved}
    />
  );
  if (props.loading || !props.recipe) {
    return (
      <CustomizeCard>
        {header}
        {props.loading ? (
          <div className="border-t border-[var(--nimi-border-subtle)] px-5 py-5 lg:px-6">
            <LoadingSkeleton lines={4} />
          </div>
        ) : null}
      </CustomizeCard>
    );
  }
  return (
    <RuntimeCapabilityCustomize
      key={`${props.selected.loadoutId}:${props.selected.revision}`}
      header={header}
      selected={props.selected}
      recipe={props.recipe}
      assets={props.assets}
      catalog={props.catalog}
      disabled={props.disabled || props.readFailed}
      onApply={props.onApply}
    />
  );
}

/**
 * Versions and runtime options of the current configuration. Opening or
 * editing this form creates no task and never changes the selected Loadout;
 * only the explicit apply submits the draft, whose preparation is checked
 * before anything is downloaded or selected.
 */
export function RuntimeCapabilityCustomize(props: {
  /** Top of the card, above the versions and runtime options. */
  readonly header?: ReactNode;
  readonly selected: NimiMachineLoadout;
  readonly recipe: NimiLoadoutRecipe;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly disabled: boolean;
  readonly onApply: (draft: RuntimeSetupTaskDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { recipe } = props;
  const initial = useMemo<RuntimeSetupTaskDraft>(() => ({
    recipeId: recipe.recipeId,
    options: (props.selected.options ?? recipe.defaultOptions ?? {}) as RuntimeSetupTaskDraft['options'],
    axes: props.selected.modelAxes.filter((axis) => axis.modelAssetId && axis.expectedContentId)
      .map(({ slotId, modelAssetId, expectedContentId }) => ({ slotId, modelAssetId, expectedContentId })),
    disabledOptionalSlots: recipe.slots.filter((slot) => slot.presence === 'optional-conditional'
      && !props.selected.modelAxes.some((axis) => axis.slotId === slot.slotId && axis.modelAssetId))
      .map((slot) => slot.slotId),
    preferredOffers: {},
    pendingAxes: [],
  }), [props.selected, recipe]);
  const initialText = useMemo(() => JSON.stringify(initial.options ?? {}, null, 2), [initial]);
  const [draft, setDraft] = useState(initial);
  const [optionsText, setOptionsText] = useState(initialText);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const parsedOptions = parseOptions(optionsText);
  const optionsInvalid = parsedOptions === null;
  const changed = optionsInvalid || draftIdentity(draft) !== draftIdentity(initial);
  const disabled = props.disabled || applying;
  const options = draft.options ?? {};
  const disabledSlots = new Set(draft.disabledOptionalSlots ?? []);

  const writeOptions = (next: NimiJsonObject) => {
    setDraft((current) => ({ ...current, options: next }));
    setOptionsText(JSON.stringify(next, null, 2));
  };
  const onOptionsText = (text: string) => {
    setOptionsText(text);
    const next = parseOptions(text);
    if (next) setDraft((current) => ({ ...current, options: next }));
  };
  const onOption = (key: string, value: NimiJsonValue) => writeOptions({ ...options, [key]: value });

  const choose = (slot: NimiLoadoutRecipeSlot, next: string) => {
    const optional = slot.presence === 'optional-conditional';
    const enabledSlots = (current: RuntimeSetupTaskDraft) => (current.disabledOptionalSlots ?? []).filter((id) => !optional || id !== slot.slotId);
    const others = (current: RuntimeSetupTaskDraft) => ({
      axes: (current.axes ?? []).filter((axis) => axis.slotId !== slot.slotId),
      preferredOffers: withoutSlot(current.preferredOffers, slot.slotId),
      pendingAxes: (current.pendingAxes ?? []).filter((axis) => axis.slotId !== slot.slotId),
    });
    if (next === NOT_USED) {
      setDraft((current) => ({
        ...current,
        ...others(current),
        disabledOptionalSlots: [...enabledSlots(current), slot.slotId],
      }));
      return;
    }
    if (next.startsWith('offer:')) {
      const offer = slot.offers.find((item) => item.candidate.offerRef === next.slice('offer:'.length));
      if (!offer || offer.applicability === 'unsupported' || (!offer.installedModelAssetId && !offer.candidate.installable)) return;
      // Acquisition is reviewed in the preparation list; the pick is recorded as its preferred choice.
      setDraft((current) => {
        const rest = others(current);
        return {
          ...current,
          ...rest,
          disabledOptionalSlots: enabledSlots(current),
          preferredOffers: { ...rest.preferredOffers, [slot.slotId]: offer.candidate.offerRef },
        };
      });
      return;
    }
    if (next.startsWith('asset:')) {
      const asset = props.assets.find((entry) => entry.modelAssetId === next.slice('asset:'.length));
      if (!asset) return;
      setDraft((current) => {
        const rest = others(current);
        return {
          ...current,
          ...rest,
          disabledOptionalSlots: enabledSlots(current),
          axes: [...rest.axes, { slotId: slot.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId }],
        };
      });
    }
  };

  const rows = recipe.slots.map((slot) => {
    const optional = slot.presence === 'optional-conditional';
    const label = slotLabel(slot, t);
    const bound = (draft.axes ?? []).find((axis) => axis.slotId === slot.slotId);
    const preferred = draft.preferredOffers?.[slot.slotId];
    const value = optional && disabledSlots.has(slot.slotId)
      ? NOT_USED
      : preferred ? `offer:${preferred}` : bound ? `asset:${bound.modelAssetId}` : UNRESOLVED;
    const installed = runtimeConfigLoadoutCandidateAssets(slot, props.assets);
    const offers = slot.offers.filter((offer) => !offer.installedModelAssetId
      || !installed.some((asset) => asset.modelAssetId === offer.installedModelAssetId));
    const choices: SlotChoice[] = [
      ...installed.map((asset) => ({
        value: `asset:${asset.modelAssetId}`,
        name: exactVersionName(loadoutModelPresentation({ title: loadoutAssetLabel(asset, props.catalog), variantLabel: asset.entry })),
        file: asset.entry,
        status: {
          tone: 'ready' as const,
          text: [t('runtimeConfig.loadouts.installed'), asset.totalSizeBytes ? formatBytes(asset.totalSizeBytes) : ''].filter(Boolean).join(' · '),
        },
      })),
      ...offers.map((offer) => {
        const unavailable = !offer.installedModelAssetId && !offer.candidate.installable;
        const acquisition: SlotStatus = offer.installedModelAssetId
          ? { tone: 'ready', text: t('runtimeConfig.loadouts.installed') }
          : unavailable
            ? { tone: 'attention', text: t('runtimeConfig.recommend.notInstallable') }
            : {
              tone: 'download',
              text: offer.candidate.downloadSizeBytes
                ? t('runtimeConfig.product.downloadSize', { size: formatBytes(offer.candidate.downloadSizeBytes) })
                : t('runtimeConfig.product.downloadSizeUnknown'),
            };
        return {
          value: `offer:${offer.candidate.offerRef}`,
          name: exactVersionName(loadoutCandidatePresentation(offer.candidate)),
          file: offer.candidate.variantLabel,
          // Host fit is only worth a word when it is not a plain "runs here".
          status: offer.applicability === 'supported' ? acquisition : {
            ...acquisition,
            text: `${acquisition.text} · ${t(`runtimeConfig.loadouts.hostFit.${offer.applicability}`)}`,
          },
          disabled: offer.applicability === 'unsupported' || unavailable,
        };
      }),
    ];
    // Two files can read as the same version; their file names tell them apart.
    const named = choices.map((choice) => (
      choices.filter((other) => other.name === choice.name).length > 1 && choice.file
        ? { ...choice, name: `${choice.name} · ${choice.file}` }
        : choice
    ));
    const current = named.find((choice) => choice.value === value);
    const selectOptions = [
      ...(optional ? [{
        value: NOT_USED,
        label: <span className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.customization.notUsed')}</span>,
      }] : []),
      ...named.map((choice) => ({
        value: choice.value,
        label: <ChoiceLabel name={choice.name} meta={choice.status?.text} />,
        disabled: choice.disabled,
      })),
      ...(value === UNRESOLVED ? [{ value: UNRESOLVED, label: t('runtimeConfig.loadouts.unresolved') }] : []),
      // Keep a missing current binding visible rather than silently showing another version.
      ...(value !== NOT_USED && value !== UNRESOLVED && !current ? [{
        value,
        label: props.selected.modelAxes.find((axis) => axis.slotId === slot.slotId)?.displayLabel || label,
      }] : []),
    ];
    const status: SlotStatus | undefined = value === UNRESOLVED
      ? { tone: 'attention', text: t('runtimeConfig.loadouts.unresolved') }
      : current?.status;
    const help = optional && recipe.capabilityContract === 'text.generate' && slot.conditionalFeatures?.includes('input.image')
      ? t('runtimeConfig.product.customization.slotHelp.inputImage')
      : '';
    return { slot, label, optional, value, selectOptions, status: value === NOT_USED ? undefined : status, help };
  });

  let downloadBytes = 0;
  let downloadUnknown = false;
  for (const [slotId, offerRef] of Object.entries(draft.preferredOffers ?? {})) {
    const offer = recipe.slots.find((slot) => slot.slotId === slotId)?.offers.find((item) => item.candidate.offerRef === offerRef);
    if (!offer || offer.installedModelAssetId) continue;
    if (offer.candidate.downloadSizeBytes) downloadBytes += offer.candidate.downloadSizeBytes;
    else downloadUnknown = true;
  }
  const applyHint = optionsInvalid
    ? t('runtimeConfig.product.customization.applyInvalid')
    : downloadUnknown
      ? t('runtimeConfig.product.customization.applyHintDownloadUnknown')
      : downloadBytes
        ? t('runtimeConfig.product.customization.applyHintDownload', { size: formatBytes(downloadBytes) })
        : t('runtimeConfig.product.customization.applyHint');

  const scalarKeys = Object.keys(options).filter((key) => optionValueType(options[key]) !== 'json');
  const optionCount = parsedOptions ? Object.keys(parsedOptions).length : 0;
  const optionsSummary = optionsInvalid
    ? t('runtimeConfig.setupTask.advanced.optionsInvalid')
    : optionCount
      ? t('runtimeConfig.product.customization.optionsCustomized', { count: optionCount })
      : t('runtimeConfig.product.customization.optionsDefault');

  const discard = () => {
    setDraft(initial);
    setOptionsText(initialText);
    setApplyError('');
  };
  const apply = async () => {
    if (disabled || !parsedOptions) return;
    setApplying(true);
    setApplyError('');
    try {
      await props.onApply({ ...draft, options: parsedOptions });
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  };

  const fieldClass = 'rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-2.5 py-1.5 text-sm text-[var(--nimi-text-primary)]';
  return (
    <div className="space-y-4" data-testid="capability-customize-editor">
      <CustomizeCard>
        {props.header}
        <fieldset disabled={disabled} className="min-w-0">
          <Band title={t('runtimeConfig.setupTask.advanced.slotsTitle')}>
            {rows.map((row) => (
              <div
                key={row.slot.slotId}
                className="grid gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,18.75rem)] sm:items-center"
                data-testid={`capability-customize-slot:${row.slot.slotId}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">{row.label}</span>
                    {row.optional ? (
                      <StatusBadge tone="neutral" shape="soft">{t('runtimeConfig.setupTask.advanced.optionalTag')}</StatusBadge>
                    ) : null}
                  </div>
                  {row.help ? <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">{row.help}</p> : null}
                  {row.status ? <StatusLine status={row.status} /> : null}
                </div>
                <SelectField
                  aria-label={row.label}
                  data-testid={`capability-customize-version:${row.slot.slotId}`}
                  value={row.value}
                  options={row.selectOptions}
                  disabled={disabled}
                  // The Kit value span drops its own type class, so the field carries the body size.
                  selectClassName="text-[length:var(--nimi-type-body-size)] [&_[data-choice-meta]]:hidden"
                  onValueChange={(next) => choose(row.slot, next)}
                />
              </div>
            ))}
          </Band>
          <Band title={t('runtimeConfig.setupTask.advanced.optionsTitle')}>
            {scalarKeys.map((key) => {
              const value = options[key];
              const valueType = optionValueType(value);
              return (
                <label key={key} className="flex items-center justify-between gap-4 py-3" data-testid={`capability-customize-option:${key}`}>
                  <span className="min-w-0 truncate font-mono text-xs text-[var(--nimi-text-primary)]">{key}</span>
                  {valueType === 'boolean' ? (
                    <input
                      type="checkbox"
                      aria-label={key}
                      className="size-4 accent-[var(--nimi-action-primary-bg)]"
                      checked={value === true}
                      onChange={(event) => onOption(key, event.currentTarget.checked)}
                    />
                  ) : valueType === 'number' ? (
                    <input
                      type="number"
                      aria-label={key}
                      step="any"
                      className={`w-32 ${fieldClass}`}
                      value={typeof value === 'number' && Number.isFinite(value) ? value : 0}
                      onChange={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (Number.isFinite(next)) onOption(key, next);
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      aria-label={key}
                      className={`w-56 ${fieldClass}`}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) => onOption(key, event.currentTarget.value)}
                    />
                  )}
                </label>
              );
            })}
            <details className="group" data-testid="capability-customize-options-json">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.setupTask.advanced.optionsJson')}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
                    {optionsInvalid ? <CircleAlert size={13} className="shrink-0 text-[var(--nimi-status-warning)]" aria-hidden="true" /> : null}
                    {optionsSummary}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-sm font-medium text-[var(--nimi-text-primary)]"
                >
                  <Braces size={14} />
                  <span className="group-open:hidden">{t('runtimeConfig.product.customization.editOptions')}</span>
                  <span className="hidden group-open:inline">{t('runtimeConfig.product.customization.hideOptions')}</span>
                </span>
              </summary>
              <div className="pb-4">
                <TextareaField
                  aria-label={t('runtimeConfig.setupTask.advanced.optionsJson')}
                  tone={optionsInvalid ? 'danger' : 'default'}
                  spellCheck={false}
                  value={optionsText}
                  onChange={(event) => onOptionsText(event.currentTarget.value)}
                  textareaClassName="min-h-28 font-mono text-xs leading-relaxed"
                />
                <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.advanced.optionsJsonHelp')}</p>
                  <Button tone="ghost" size="sm" className="-mr-2 -mt-1" onClick={() => writeOptions({ ...(recipe.defaultOptions as NimiJsonObject | undefined) })}>
                    <RotateCcw size={13} />
                    {t('runtimeConfig.setupTask.advanced.resetOptions')}
                  </Button>
                </div>
              </div>
            </details>
          </Band>
        </fieldset>
      </CustomizeCard>

      {changed || applyError ? (
        <div
          className="sticky bottom-4 z-10 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] py-2.5 pl-4 pr-2.5 shadow-[var(--nimi-elevation-raised)]"
          data-testid="capability-customize-apply-bar"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--nimi-action-primary-bg)]" />
            <div role="status" className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.product.customization.pending')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{applyHint}</p>
            </div>
            <Button tone="ghost" disabled={disabled} onClick={discard} data-testid="capability-customize-discard">
              {t('runtimeConfig.product.customization.discard')}
            </Button>
            <Button tone="primary" disabled={disabled || optionsInvalid} onClick={() => { void apply(); }} data-testid="capability-customize-apply">
              {applying ? t('runtimeConfig.setupTask.advanced.applying') : t('runtimeConfig.product.customization.apply')}
            </Button>
          </div>
          {applyError ? <div className="mt-2.5"><InlineAlert tone="warning">{applyError}</InlineAlert></div> : null}
        </div>
      ) : null}
    </div>
  );
}
