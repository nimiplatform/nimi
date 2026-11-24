// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace

import { Button, InlineAlert, StatusBadge, TextareaField } from '@nimiplatform/kit/ui';
import type { NimiJsonObject, NimiJsonValue } from '@nimiplatform/sdk/contracts';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { ArrowLeft, Braces, Check, CircleAlert, Download, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../components/download-format.js';
import {
  loadoutSlotLabelKey,
  patchLoadoutTextContextOption,
  parseLoadoutOptionsJson,
  resolvePrimaryRecipeSlot,
  supportsLlamaTextContextSize,
  type NimiLoadoutRecipeSlot,
} from './runtime-config-loadout-model-display.js';
import {
  LoadoutSelectedModelCard,
  LoadoutSlotModelPickerBody,
} from './runtime-config-loadout-model-picker.js';
import {
  buildLoadoutCreateOptions,
  resolveLoadoutCreateContextOption,
  RuntimeConfigLoadoutTextBehaviors,
} from './runtime-config-page-loadouts.js';
import { RuntimeTextContextSizeField } from './runtime-config-text-context-field.js';
import type { RuntimeSetupTaskDraft } from './runtime-setup-task-store.js';

const NOT_USED = '__not-used__';

type SlotStatus = { readonly tone: 'ready' | 'download' | 'attention'; readonly text: string };

function slotLabel(slot: Pick<NimiLoadoutRecipeSlot, 'slotId' | 'displayLabel'>, t: TFunction): string {
  const key = loadoutSlotLabelKey(slot.slotId);
  return key ? t(key, { defaultValue: slot.displayLabel }) : slot.displayLabel;
}

function optionValueType(value: unknown): 'boolean' | 'number' | 'string' | 'json' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

function contextSizeDraftFromOptions(options: NimiJsonObject | undefined): string {
  const value = options?.contextSize;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
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

function StatusLine({ status }: { readonly status: SlotStatus }) {
  const Icon = status.tone === 'ready' ? Check : status.tone === 'download' ? Download : CircleAlert;
  const color = status.tone === 'ready'
    ? 'text-[var(--nimi-status-success)]'
    : status.tone === 'download'
      ? 'text-[var(--nimi-status-info)]'
      : 'text-[var(--nimi-status-warning)]';
  return (
    <p className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
      <Icon size={13} strokeWidth={2.2} className={`shrink-0 ${color}`} aria-hidden="true" />
      {status.text}
    </p>
  );
}

/** Groups the versions and runtime options of one configuration. */
function CustomizeCard({ children }: { readonly children: ReactNode }) {
  return <section className="rounded-2xl bg-[var(--nimi-surface-card)]" data-testid="capability-customize-card">{children}</section>;
}

/** One settings section. */
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
 * Versions and runtime options of the chosen configuration. Opening or
 * editing this form creates no task and never changes the selected Loadout;
 * only the explicit apply submits the draft, whose preparation is checked
 * before anything is downloaded or selected.
 */
export function RuntimeCapabilityCustomize(props: {
  readonly selected?: NimiMachineLoadout;
  readonly recipe: NimiLoadoutRecipe;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly disabled: boolean;
  readonly onApply: (draft: RuntimeSetupTaskDraft) => Promise<void>;
  readonly onStateChange?: (dirty: boolean, applying: boolean) => void;
  readonly onCancel?: () => void;
  readonly applyLabel?: string;
}) {
  const { t } = useTranslation();
  const { recipe } = props;
  const hasLlamaContextField = supportsLlamaTextContextSize(recipe);
  const initial = useMemo<RuntimeSetupTaskDraft>(() => {
    const initialAxes = (props.selected?.modelAxes ?? []).filter((axis) => axis.modelAssetId && axis.expectedContentId)
      .map(({ slotId, modelAssetId, expectedContentId }) => ({ slotId, modelAssetId, expectedContentId }));
    const initialOptions = props.selected
      ? (props.selected.options ?? {})
      : (buildLoadoutCreateOptions(
        recipe,
        resolveLoadoutCreateContextOption(
          recipe,
          Object.fromEntries(initialAxes.map((axis) => [axis.slotId, axis.modelAssetId])),
        ),
      ) ?? recipe.recommendedOptions ?? recipe.defaultOptions ?? {});
    return {
      recipeId: recipe.recipeId,
      options: initialOptions as RuntimeSetupTaskDraft['options'],
      axes: initialAxes,
      disabledOptionalSlots: recipe.slots.filter((slot) => props.selected && slot.presence === 'optional-conditional'
        && !props.selected?.modelAxes.some((axis) => axis.slotId === slot.slotId && axis.modelAssetId))
        .map((slot) => slot.slotId),
      preferredOffers: {},
      pendingAxes: [],
    };
  }, [props.selected, recipe]);
  const initialText = useMemo(() => JSON.stringify(initial.options ?? {}, null, 2), [initial]);
  const initialContextDraft = useMemo(
    () => contextSizeDraftFromOptions(initial.options as NimiJsonObject | undefined),
    [initial],
  );
  const [draft, setDraft] = useState(initial);
  const [optionsText, setOptionsText] = useState(initialText);
  const [contextSizeDraft, setContextSizeDraft] = useState(initialContextDraft);
  const [optionsEdited, setOptionsEdited] = useState(false);
  const [pickingSlotId, setPickingSlotId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const parsedOptions = parseLoadoutOptionsJson(optionsText);
  const optionsInvalid = parsedOptions === null;
  const contextValidation = hasLlamaContextField
    ? patchLoadoutTextContextOption({}, contextSizeDraft)
    : { valid: true as const };
  const contextInvalid = !contextValidation.valid;
  const formInvalid = optionsInvalid || contextInvalid;
  const changed = formInvalid || draftIdentity(draft) !== draftIdentity(initial);
  const disabled = props.disabled || applying;
  useEffect(() => { props.onStateChange?.(changed, applying); }, [changed, applying, props.onStateChange]);
  const options = draft.options ?? {};
  const disabledSlots = new Set(draft.disabledOptionalSlots ?? []);

  const writeOptions = (next: NimiJsonObject) => {
    setOptionsEdited(true);
    setDraft((current) => ({ ...current, options: next }));
    setOptionsText(JSON.stringify(next, null, 2));
    setContextSizeDraft(contextSizeDraftFromOptions(next));
  };
  const onOptionsText = (text: string) => {
    setOptionsEdited(true);
    setOptionsText(text);
    const next = parseLoadoutOptionsJson(text);
    if (next) {
      setDraft((current) => ({ ...current, options: next }));
      setContextSizeDraft(contextSizeDraftFromOptions(next));
    }
  };
  const onContextSizeChange = (nextText: string) => {
    setOptionsEdited(true);
    setContextSizeDraft(nextText);
    const base = parsedOptions ?? options;
    const patched = patchLoadoutTextContextOption(base, nextText);
    if (patched.valid) {
      setDraft((current) => ({ ...current, options: patched.options }));
      setOptionsText(JSON.stringify(patched.options, null, 2));
    }
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
    const syncUneditedContextOptions = (nextOptions: NimiJsonObject | undefined) => {
      if (props.selected || optionsEdited || !nextOptions) return;
      setOptionsText(JSON.stringify(nextOptions, null, 2));
      setContextSizeDraft(contextSizeDraftFromOptions(nextOptions));
    };
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
      const syncedOptions = (!props.selected && !optionsEdited && slot.presence === 'required' && hasLlamaContextField
        ? (offer.contextFit
          ? buildLoadoutCreateOptions(
            recipe,
            offer.contextFit.recommendedContextSize < offer.contextFit.authoredContextSize
              ? String(offer.contextFit.recommendedContextSize)
              : '',
          )
          : buildLoadoutCreateOptions(recipe, ''))
        : undefined) as RuntimeSetupTaskDraft['options'];
      syncUneditedContextOptions(syncedOptions);
      setDraft((current) => {
        const rest = others(current);
        return {
          ...current,
          ...rest,
          ...(syncedOptions ? { options: syncedOptions } : {}),
          disabledOptionalSlots: enabledSlots(current),
          preferredOffers: { ...rest.preferredOffers, [slot.slotId]: offer.candidate.offerRef },
        };
      });
      return;
    }
    if (next.startsWith('asset:')) {
      const asset = props.assets.find((entry) => entry.modelAssetId === next.slice('asset:'.length));
      if (!asset) return;
      const syncedOptions = (!props.selected && !optionsEdited && slot.presence === 'required' && hasLlamaContextField
        ? buildLoadoutCreateOptions(recipe, resolveLoadoutCreateContextOption(recipe, { [slot.slotId]: asset.modelAssetId }))
        : undefined) as RuntimeSetupTaskDraft['options'];
      syncUneditedContextOptions(syncedOptions);
      setDraft((current) => {
        const rest = others(current);
        return {
          ...current,
          ...rest,
          ...(syncedOptions ? { options: syncedOptions } : {}),
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
    const notUsed = optional && disabledSlots.has(slot.slotId);
    const asset = !notUsed && !preferred && bound
      ? props.assets.find((entry) => entry.modelAssetId === bound.modelAssetId) ?? null
      : null;
    const queuedOffer = !notUsed && preferred
      ? slot.offers.find((item) => item.candidate.offerRef === preferred) ?? null
      : null;
    const status: SlotStatus | undefined = notUsed
      ? undefined
      : queuedOffer
        ? {
          tone: 'download',
          text: queuedOffer.candidate.downloadSizeBytes
            ? t('runtimeConfig.product.downloadSize', { size: formatBytes(queuedOffer.candidate.downloadSizeBytes) })
            : t('runtimeConfig.product.downloadSizeUnknown'),
        }
        : asset
          ? {
            tone: 'ready',
            text: [t('runtimeConfig.loadouts.installed'), asset.totalSizeBytes ? formatBytes(asset.totalSizeBytes) : ''].filter(Boolean).join(' · '),
          }
          : { tone: 'attention', text: t('runtimeConfig.loadouts.unresolved') };
    const help = optional && slot.conditionalFeatures?.length
      ? t('runtimeConfig.product.customization.slotHelp.inputMedia', {
        features: slot.conditionalFeatures.map((feature) => (
          slot.slotId === 'companion.controlnet' && feature === 'input.image'
            ? t('runtimeConfig.loadouts.controlnetInput')
            : t(`runtimeConfig.product.customization.slotHelp.${feature.replace('.', '_')}`, { defaultValue: feature })
        )).join(' · '),
      })
      : '';
    return { slot, label, optional, notUsed, asset, queuedOffer, bound, preferred, status, help };
  });

  const pickingRow = pickingSlotId ? rows.find((row) => row.slot.slotId === pickingSlotId) ?? null : null;

  let downloadBytes = 0;
  let downloadUnknown = false;
  for (const [slotId, offerRef] of Object.entries(draft.preferredOffers ?? {})) {
    const offer = recipe.slots.find((slot) => slot.slotId === slotId)?.offers.find((item) => item.candidate.offerRef === offerRef);
    if (!offer || offer.installedModelAssetId) continue;
    if (offer.candidate.downloadSizeBytes) downloadBytes += offer.candidate.downloadSizeBytes;
    else downloadUnknown = true;
  }
  const applyHint = contextInvalid
    ? t('runtimeConfig.loadouts.contextSizeInvalid')
    : optionsInvalid
      ? t('runtimeConfig.product.customization.applyInvalid')
      : downloadUnknown
        ? t('runtimeConfig.product.customization.applyHintDownloadUnknown')
        : downloadBytes
          ? t('runtimeConfig.product.customization.applyHintDownload', { size: formatBytes(downloadBytes) })
          : t('runtimeConfig.product.customization.applyHint');

  const scalarKeys = Object.keys(options).filter((key) => (
    optionValueType(options[key]) !== 'json'
    && !(hasLlamaContextField && key === 'contextSize')
  ));
  const optionCount = parsedOptions ? Object.keys(parsedOptions).length : 0;
  const optionsSummary = optionsInvalid
    ? t('runtimeConfig.setupTask.advanced.optionsInvalid')
    : optionCount
      ? t('runtimeConfig.product.customization.optionsCustomized', { count: optionCount })
      : t('runtimeConfig.product.customization.optionsDefault');

  const primarySlot = resolvePrimaryRecipeSlot(recipe);
  const selectedHasBoundMainModel = props.selected
    ? (primarySlot.kind === 'single'
      ? props.selected.modelAxes.some((axis) => axis.slotId === primarySlot.slot.slotId && Boolean(axis.modelAssetId))
      : props.selected.modelAxes.some((axis) => Boolean(axis.modelAssetId)))
    : false;

  const discard = () => {
    setDraft(initial);
    setOptionsText(initialText);
    setContextSizeDraft(initialContextDraft);
    setOptionsEdited(false);
    setPickingSlotId(null);
    setApplyError('');
  };
  const apply = async () => {
    if (disabled || !parsedOptions || contextInvalid || !changed) return;
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

  if (pickingRow) {
    return (
      <div className="space-y-4" data-testid="capability-customize-picker-subview">
        <div className="flex items-center justify-between gap-3">
          <Button
            tone="ghost"
            size="sm"
            onClick={() => setPickingSlotId(null)}
            data-testid="capability-customize-picker-back"
          >
            <ArrowLeft size={14} />
            {t('runtimeConfig.loadouts.picker.backToSettings')}
          </Button>
          <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.loadouts.picker.title', { slot: pickingRow.label })}
          </span>
        </div>
        <LoadoutSlotModelPickerBody
          slot={pickingRow.slot}
          assets={props.assets}
          verifiedAssets={props.catalog}
          selectedAssetId={pickingRow.notUsed ? '' : (pickingRow.bound?.modelAssetId ?? '')}
          selectedOfferRef={pickingRow.preferred ?? ''}
          allowClear={pickingRow.optional}
          clearLabel={pickingRow.optional ? t('runtimeConfig.product.customization.notUsed') : undefined}
          offerActionMode="queue-offer"
          onSelectAsset={(assetId) => {
            choose(pickingRow.slot, assetId ? `asset:${assetId}` : NOT_USED);
            setPickingSlotId(null);
          }}
          onSelectOffer={(offer) => {
            choose(pickingRow.slot, `offer:${offer.candidate.offerRef}`);
            setPickingSlotId(null);
          }}
        />
      </div>
    );
  }

  const fieldClass = 'rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-2.5 py-1.5 text-sm text-[var(--nimi-text-primary)]';
  return (
    <div className="space-y-4" data-testid="capability-customize-editor">
      <CustomizeCard>
        <fieldset disabled={disabled} className="min-w-0">
          <Band title={t('runtimeConfig.setupTask.advanced.slotsTitle')}>
            {rows.map((row) => (
              <div
                key={row.slot.slotId}
                className="grid gap-y-2 py-3.5"
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
                  <div className="mt-0.5 min-h-4" data-testid={`capability-customize-slot-status:${row.slot.slotId}`}>
                    {row.status ? <StatusLine status={row.status} /> : null}
                  </div>
                </div>
                <LoadoutSelectedModelCard
                  slot={row.slot}
                  asset={row.asset}
                  queuedOffer={row.queuedOffer}
                  notUsed={row.notUsed}
                  disabled={disabled}
                  verifiedAssets={props.catalog}
                  onOpenPicker={() => setPickingSlotId(row.slot.slotId)}
                />
              </div>
            ))}
          </Band>
          {props.selected && (props.selected.textBehaviors ?? []).length > 0 ? (
            <div className="border-t border-[var(--nimi-border-subtle)] px-5 py-4 lg:px-6">
              <RuntimeConfigLoadoutTextBehaviors
                loadoutId={props.selected.loadoutId}
                behaviors={props.selected.textBehaviors ?? []}
                hasBoundMainModel={selectedHasBoundMainModel}
                compact
              />
            </div>
          ) : null}
          <Band title={t('runtimeConfig.setupTask.advanced.optionsTitle')}>
            {hasLlamaContextField ? (
              <div className="py-3">
                <RuntimeTextContextSizeField
                  value={contextSizeDraft}
                  onChange={onContextSizeChange}
                  disabled={disabled}
                  testId="capability-customize-context-size"
                />
              </div>
            ) : null}
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

      {props.onCancel || changed || applyError ? (
        <div
          className="sticky bottom-0 z-10 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] py-2.5 pl-4 pr-2.5 shadow-[var(--nimi-elevation-raised)]"
          data-testid="capability-customize-apply-bar"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div role="status" className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t(changed ? 'runtimeConfig.product.customization.pending' : 'runtimeConfig.product.settings.review')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{applyHint}</p>
            </div>
            <Button tone="ghost" disabled={disabled} onClick={props.onCancel ?? discard} data-testid="capability-customize-discard">
              {t(props.onCancel ? 'Common.cancel' : 'runtimeConfig.product.customization.discard')}
            </Button>
            <Button tone="primary" disabled={disabled || formInvalid || !changed} onClick={() => { void apply(); }} data-testid="capability-customize-apply">
              {applying ? t('runtimeConfig.setupTask.advanced.applying') : (props.applyLabel ?? t('runtimeConfig.product.customization.apply'))}
            </Button>
          </div>
          {applyError ? <div className="mt-2.5"><InlineAlert tone="warning">{applyError}</InlineAlert></div> : null}
        </div>
      ) : null}
    </div>
  );
}
