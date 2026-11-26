// @nimi-authority: rule.nimi.desktop.ai-consumption.r023

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import type { NimiJsonObject, NimiJsonValue } from '@nimiplatform/sdk/contracts';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import {
  loadoutSlotLabelKey,
  patchLoadoutTextContextOption,
  parseLoadoutOptionsJson,
  supportsLlamaTextContextSize,
  type NimiLoadoutRecipeSlot,
  type NimiLoadoutRecipeSlotOffer,
} from './runtime-config-loadout-model-display.js';
import {
  LoadoutSelectedModelCard,
  LoadoutSlotModelPicker,
} from './runtime-config-loadout-model-picker.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { RuntimeTextContextSizeField } from './runtime-config-text-context-field.js';
import { runtimeSetupFailureText } from './runtime-setup-failure-message.js';
import { updateRuntimeSetupCandidate } from './runtime-setup-task-runner.js';
import type {
  RuntimeSetupTask,
  RuntimeSetupTaskDraft,
  RuntimeSetupTaskDraftAxis,
  RuntimeSetupTaskStore,
} from './runtime-setup-task-store.js';
import type { RuntimeSetupRunnerPorts } from './runtime-setup-task-runner.js';

type JsonObject = Readonly<NimiJsonObject>;

function slotDisplayLabel(slot: Pick<NimiLoadoutRecipeSlot, 'slotId' | 'displayLabel'>, t: TFunction): string {
  const key = loadoutSlotLabelKey(slot.slotId);
  return key ? t(key, { defaultValue: slot.displayLabel }) : slot.displayLabel;
}

function optionValueType(value: unknown): 'boolean' | 'number' | 'string' | 'json' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

/** The same editable fields serve capability customization and preparation drafts. */
export function RuntimeLoadoutOptionsEditor(props: {
  readonly recipe: NimiLoadoutRecipe;
  readonly candidate: NimiMachineLoadout | null;
  readonly draft?: RuntimeSetupTaskDraft;
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly verifiedAssets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly onChange: (patch: Partial<RuntimeSetupTaskDraft>) => void;
  readonly onApply?: (draft: RuntimeSetupTaskDraft) => Promise<void>;
  readonly disabled?: boolean;
  readonly changed?: boolean;
  readonly applyLabel?: string;
  readonly onDiscard?: () => void;
}) {
  const { t } = useTranslation();
  const { recipe, candidate, assets, verifiedAssets, draft, onChange: writeDraft } = props;
  const hasLlamaContextField = supportsLlamaTextContextSize(recipe);
  const [offerHint, setOfferHint] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);

  const baseOptions: JsonObject = useMemo(() => (
    (draft?.options as JsonObject | undefined)
    ?? (candidate?.options as JsonObject | undefined)
    ?? (recipe.defaultOptions as JsonObject | undefined)
    ?? {}
  ), [candidate?.options, draft?.options, recipe.defaultOptions]);
  const [optionsJson, setOptionsJson] = useState(() => JSON.stringify(baseOptions, null, 2));
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const parsedOptions = useMemo(() => parseLoadoutOptionsJson(optionsJson), [optionsJson]);
  const [contextSizeDraft, setContextSizeDraft] = useState(() => (
    typeof baseOptions.contextSize === 'number' && Number.isFinite(baseOptions.contextSize)
      ? String(baseOptions.contextSize)
      : ''
  ));
  useEffect(() => {
    setOptionsJson(JSON.stringify(baseOptions, null, 2));
    setNumericDrafts({});
    setContextSizeDraft(
      typeof baseOptions.contextSize === 'number' && Number.isFinite(baseOptions.contextSize)
        ? String(baseOptions.contextSize)
        : '',
    );
  }, [baseOptions]);

  const contextInvalid = hasLlamaContextField && !patchLoadoutTextContextOption({}, contextSizeDraft).valid;

  const boundAxes: readonly RuntimeSetupTaskDraftAxis[] = draft?.axes
    ?? (candidate?.modelAxes ?? [])
      .filter((axis) => axis.modelAssetId && axis.expectedContentId)
      .map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId }));
  const disabledOptionalSlots = useMemo(
    () => new Set(draft?.disabledOptionalSlots ?? recipe.slots
      .filter((slot) => slot.presence === 'optional-conditional' && !boundAxes.some((axis) => axis.slotId === slot.slotId)
        && !draft?.preferredOffers?.[slot.slotId] && !draft?.pendingAxes?.some((axis) => axis.slotId === slot.slotId))
      .map((slot) => slot.slotId)),
    [draft, recipe.slots, boundAxes],
  );

  const onOptionChange = useCallback((key: string, value: NimiJsonValue) => {
    if (parsedOptions) writeDraft({ options: { ...parsedOptions, [key]: value } });
  }, [parsedOptions, writeDraft]);

  const onContextSizeChange = useCallback((nextText: string) => {
    setContextSizeDraft(nextText);
    if (!parsedOptions) return;
    const patched = patchLoadoutTextContextOption(parsedOptions, nextText);
    if (patched.valid) {
      writeDraft({ options: patched.options });
    }
  }, [parsedOptions, writeDraft]);

  const onResetOptions = useCallback(() => {
    writeDraft({ options: { ...(recipe.defaultOptions as JsonObject | undefined) ?? {} } });
  }, [recipe.defaultOptions, writeDraft]);

  const onSelectAxis = useCallback((slot: NimiLoadoutRecipeSlot, modelAssetId: string) => {
    const isOptional = slot.presence === 'optional-conditional';
    const asset = assets.find((entry) => entry.modelAssetId === modelAssetId);
    const nextAxes = boundAxes.filter((axis) => axis.slotId !== slot.slotId);
    if (asset) {
      nextAxes.push({ slotId: slot.slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId });
    }
    const nextDisabled = isOptional
      ? (asset
        ? [...disabledOptionalSlots].filter((id) => id !== slot.slotId)
        : [...new Set([...disabledOptionalSlots, slot.slotId])])
      : [...disabledOptionalSlots];
    writeDraft({
      axes: nextAxes,
      disabledOptionalSlots: nextDisabled,
      pendingAxes: (draft?.pendingAxes ?? []).filter((axis) => axis.slotId !== slot.slotId),
      preferredOffers: Object.fromEntries(Object.entries(draft?.preferredOffers ?? {}).filter(([id]) => id !== slot.slotId)),
    });
  }, [assets, boundAxes, disabledOptionalSlots, draft?.pendingAxes, draft?.preferredOffers, writeDraft]);

  const onToggleOptionalSlot = useCallback((slot: NimiLoadoutRecipeSlot, enabled: boolean) => {
    if (enabled) {
      const nextDisabled = [...disabledOptionalSlots].filter((slotId) => slotId !== slot.slotId);
      writeDraft({ disabledOptionalSlots: nextDisabled });
      return;
    }
    const nextAxes = boundAxes.filter((axis) => axis.slotId !== slot.slotId);
    writeDraft({
      axes: nextAxes,
      disabledOptionalSlots: [...disabledOptionalSlots, slot.slotId],
      preferredOffers: Object.fromEntries(Object.entries(draft?.preferredOffers ?? {}).filter(([id]) => id !== slot.slotId)),
      pendingAxes: (draft?.pendingAxes ?? []).filter((axis) => axis.slotId !== slot.slotId),
    });
  }, [boundAxes, disabledOptionalSlots, draft, writeDraft]);

  const onOpenOffer = useCallback((slot: NimiLoadoutRecipeSlot, offer: NimiLoadoutRecipeSlotOffer) => {
    // Acquisition is reviewed in the preparation list; an advanced offer pick
    // is recorded as the preferred choice and clears stale axes / disabled flags.
    writeDraft({
      axes: boundAxes.filter((axis) => axis.slotId !== slot.slotId),
      preferredOffers: { ...(draft?.preferredOffers ?? {}), [slot.slotId]: offer.candidate.offerRef },
      pendingAxes: (draft?.pendingAxes ?? []).filter((axis) => axis.slotId !== slot.slotId),
      disabledOptionalSlots: [...disabledOptionalSlots].filter((slotId) => slotId !== slot.slotId),
    });
    setOfferHint(offer.installedModelAssetId ? '' : t('runtimeConfig.setupTask.advanced.offerQueued', {
      defaultValue: 'This variant is queued as the preferred choice and will be downloaded during the reviewed preparation.',
    }));
  }, [boundAxes, disabledOptionalSlots, draft?.pendingAxes, draft?.preferredOffers, t, writeDraft]);

  const onApply = useCallback(async () => {
    if (!props.onApply || props.disabled || applying || contextInvalid) return;
    if (!parsedOptions) {
      setApplyError(t('runtimeConfig.setupTask.advanced.optionsInvalid'));
      return;
    }
    setApplying(true);
    setApplyError('');
    try {
      await props.onApply({ ...draft, options: parsedOptions, axes: boundAxes });
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  }, [parsedOptions, boundAxes, contextInvalid, draft, props, applying, t]);

  const optionKeys = Object.keys(parsedOptions ?? {}).filter((key) => (
    (!candidate || optionValueType(parsedOptions?.[key]) !== 'json')
    && !(hasLlamaContextField && key === 'contextSize')
  ));
  const changed = props.changed || contextInvalid || optionsJson !== JSON.stringify(baseOptions, null, 2);
  const disabled = props.disabled || applying;
  const pickerSlot = pickerSlotId ? recipe.slots.find((slot) => slot.slotId === pickerSlotId) ?? null : null;
  const pickerIsOptional = pickerSlot?.presence === 'optional-conditional';

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5" data-testid="runtime-setup-task-advanced">
      {offerHint ? (
        <InlineAlert tone="info">{offerHint}</InlineAlert>
      ) : null}
      <div className="space-y-2">
        <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.setupTask.advanced.slotsTitle', { defaultValue: 'Model variants' })}
        </div>
        {recipe.slots.map((slot) => {
          const isOptional = slot.presence === 'optional-conditional';
          const bound = boundAxes.find((axis) => axis.slotId === slot.slotId) ?? null;
          const preferredOfferRef = draft?.preferredOffers?.[slot.slotId];
          const optionalEnabled = !isOptional || !disabledOptionalSlots.has(slot.slotId);
          const slotLabel = slotDisplayLabel(slot, t);
          const preferredOffer = optionalEnabled && preferredOfferRef
            ? slot.offers.find((item) => item.candidate.offerRef === preferredOfferRef) ?? null
            : null;
          const preferredInstalledAsset = preferredOffer?.installedModelAssetId
            ? assets.find((entry) => entry.modelAssetId === preferredOffer.installedModelAssetId) ?? null
            : null;
          const asset = preferredInstalledAsset
            ?? (optionalEnabled && !preferredOfferRef && bound
              ? assets.find((entry) => entry.modelAssetId === bound.modelAssetId) ?? null
              : null);
          const queuedOffer = preferredInstalledAsset ? null : preferredOffer;
          return (
            <div key={slot.slotId} data-testid={`runtime-setup-advanced-slot:${slot.slotId}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
                  {slotLabel}
                  {isOptional ? (
                    <span className="ml-2 text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.setupTask.advanced.optionalTag', { defaultValue: 'Optional' })}
                    </span>
                  ) : null}
                </span>
                {isOptional ? (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={optionalEnabled}
                      onChange={(event) => onToggleOptionalSlot(slot, event.currentTarget.checked)}
                      data-testid={`runtime-setup-advanced-optional:${slot.slotId}`}
                    />
                    {t('runtimeConfig.setupTask.advanced.enableSlot', { defaultValue: 'Enabled' })}
                  </label>
                ) : null}
              </div>
              {!isOptional || optionalEnabled ? (
                <LoadoutSelectedModelCard
                  slot={slot}
                  asset={asset}
                  queuedOffer={queuedOffer}
                  disabled={disabled}
                  verifiedAssets={verifiedAssets}
                  onOpenPicker={() => setPickerSlotId(slot.slotId)}
                />
              ) : null}
            </div>
          );
        })}
        <LoadoutSlotModelPicker
          key={pickerSlotId ?? 'closed'}
          slot={pickerSlot}
          assets={assets}
          verifiedAssets={verifiedAssets}
          selectedAssetId={pickerSlot ? (boundAxes.find((axis) => axis.slotId === pickerSlot.slotId)?.modelAssetId ?? '') : ''}
          selectedOfferRef={pickerSlot ? (draft?.preferredOffers?.[pickerSlot.slotId] ?? '') : ''}
          allowClear
          clearLabel={pickerIsOptional ? t('runtimeConfig.product.customization.notUsed') : undefined}
          offerActionMode="queue-offer"
          onSelect={(modelAssetId) => {
            if (!pickerSlot) return;
            setOfferHint('');
            onSelectAxis(pickerSlot, modelAssetId);
          }}
          onOpenOffer={(offer) => {
            if (!pickerSlot) return;
            if (offer.applicability !== 'unsupported' && (offer.installedModelAssetId || offer.candidate.installable)) {
              onOpenOffer(pickerSlot, offer);
            }
          }}
          onClose={() => setPickerSlotId(null)}
        />
      </div>
      {hasLlamaContextField || optionKeys.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.setupTask.advanced.optionsTitle', { defaultValue: 'Implementation options' })}
            </div>
            <Button tone="ghost" size="sm" onClick={onResetOptions}>
              {t('runtimeConfig.setupTask.advanced.resetOptions', { defaultValue: 'Reset to recipe defaults' })}
            </Button>
          </div>
          {hasLlamaContextField ? (
            <RuntimeTextContextSizeField
              value={contextSizeDraft}
              onChange={onContextSizeChange}
              disabled={disabled || !parsedOptions}
              testId="runtime-setup-advanced-context-size"
            />
          ) : null}
          {optionKeys.map((key) => {
            const value = parsedOptions?.[key];
            const valueType = optionValueType(value);
            return (
              <div key={key} className="flex items-center justify-between gap-3" data-testid={`runtime-setup-advanced-option:${key}`}>
                <span className="min-w-0 truncate text-xs font-semibold text-[var(--nimi-text-secondary)]">{key}</span>
                {valueType === 'boolean' ? (
                  <input
                    type="checkbox"
                    aria-label={key}
                    checked={value === true}
                    onChange={(event) => onOptionChange(key, event.currentTarget.checked)}
                  />
                ) : valueType === 'number' ? (
                  <input
                    type="number"
                    aria-label={key}
                    step="any"
                    className="w-32 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 text-sm text-[var(--nimi-text-primary)] outline-none focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                    value={numericDrafts[key] ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : '')}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      setNumericDrafts((current) => ({ ...current, [key]: raw }));
                      if (raw.trim() !== '') {
                        const next = Number(raw);
                        if (Number.isFinite(next)) onOptionChange(key, next);
                      }
                    }}
                    onBlur={() => {
                      setNumericDrafts((current) => {
                        if (!(key in current)) return current;
                        const { [key]: _removed, ...rest } = current;
                        return rest;
                      });
                    }}
                  />
                ) : valueType === 'string' ? (
                  <input
                    type="text"
                    aria-label={key}
                    className="w-56 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 text-sm text-[var(--nimi-text-primary)] outline-none focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => onOptionChange(key, event.currentTarget.value)}
                  />
                ) : (
                  <input
                    type="text"
                    aria-label={key}
                    key={JSON.stringify(value)}
                    className="w-56 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 font-mono text-xs text-[var(--nimi-text-primary)] outline-none focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
                    defaultValue={JSON.stringify(value)}
                    onBlur={(event) => {
                      try { onOptionChange(key, JSON.parse(event.currentTarget.value)); }
                      catch { /* Keep the last valid draft while the JSON is incomplete. */ }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.product.customization.noOptions')}</p>}
      {candidate ? (
        <details className="space-y-2 text-sm" data-testid="runtime-setup-options-json">
          <summary className="cursor-pointer font-medium">{t('runtimeConfig.setupTask.advanced.optionsJson')}</summary>
          <p className="text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.setupTask.advanced.optionsJsonHelp')}</p>
          <textarea aria-label={t('runtimeConfig.setupTask.advanced.optionsJson')} className="min-h-32 w-full rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)]" value={optionsJson} onChange={event => {
            const text = event.currentTarget.value;
            setOptionsJson(text);
            const options = parseLoadoutOptionsJson(text);
            if (options) setContextSizeDraft(options.contextSize === undefined ? '' : String(options.contextSize));
          }} />
        </details>
      ) : null}
      {props.onApply ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--nimi-border-subtle)] pt-4">
          <Button tone={props.applyLabel ? 'primary' : 'secondary'} disabled={disabled || contextInvalid || (props.changed !== undefined && !changed)} onClick={() => { void onApply(); }} data-testid="runtime-setup-advanced-apply">
            {applying
              ? t('runtimeConfig.setupTask.advanced.applying', { defaultValue: 'Applying…' })
              : props.applyLabel ?? t('runtimeConfig.setupTask.advanced.apply', { defaultValue: 'Apply changes to the saved configuration' })}
          </Button>
          {props.onDiscard && changed ? <Button tone="ghost" disabled={disabled} onClick={props.onDiscard}>{t('runtimeConfig.product.customization.discard')}</Button> : null}
          {props.changed !== undefined ? <span role="status" className="text-xs text-[var(--nimi-text-secondary)]">{t(changed ? 'runtimeConfig.product.customization.pending' : 'runtimeConfig.product.customization.current')}</span> : null}
          {applyError ? <InlineAlert tone="warning">{applyError}</InlineAlert> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Preparation edits persist in the task; the current machine selection is never edited in place. */
export function SetupTaskAdvancedSection(props: {
  readonly task: RuntimeSetupTask;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly recipe: NimiLoadoutRecipe;
  readonly candidate: NimiMachineLoadout | null;
  readonly onCandidateUpdated: () => void;
  readonly disabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly reviewChoices?: Readonly<Record<string, string>>;
}) {
  const { t } = useTranslation();
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const [assets, setAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [verifiedAssets, setVerifiedAssets] = useState<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void Promise.all([localEnvironment.listModelAssets(), localEnvironment.listVerifiedAssets()])
      .then(([nextAssets, nextVerified]) => {
        if (active) { setAssets(nextAssets); setVerifiedAssets(nextVerified); }
      }).catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [localEnvironment, retry]);
  if (loading) return <p role="status" className="text-sm text-[var(--nimi-text-secondary)]">{t('Common.loading')}</p>;
  if (loadError) return <InlineAlert tone="warning">
    <p>{t('runtimeConfig.setupTask.settingsLoadFailed', { defaultValue: 'Model versions and settings could not be loaded. Your selection is kept.' })}</p>
    <Button tone="secondary" size="sm" onClick={() => setRetry(value => value + 1)}>{t('Common.retry', { defaultValue: 'Retry' })}</Button>
    <details className="mt-2 text-xs"><summary>{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary><span className="break-all">{loadError}</span></details>
  </InlineAlert>;
  return <RuntimeLoadoutOptionsEditor
    disabled={props.disabled}
    recipe={props.recipe}
    candidate={props.candidate}
    draft={{ ...props.task.draft, preferredOffers: { ...props.reviewChoices, ...props.task.draft?.preferredOffers } }}
    assets={assets}
    verifiedAssets={verifiedAssets}
    onChange={(patch) => props.store.updateTask(props.task.taskId, (current) => ({ draft: { ...current.draft, ...patch } }))}
    onApply={props.candidate ? async (draft) => {
      props.onBusyChange?.(true);
      try {
        props.store.updateTask(props.task.taskId, () => ({ draft }));
        const result = await updateRuntimeSetupCandidate(props.store, props.task.taskId, props.ports, { options: draft.options, axes: draft.axes });
        if (result.status !== 'ok') throw new Error(runtimeSetupFailureText(result.failure, t));
        props.onCandidateUpdated();
      } finally {
        props.onBusyChange?.(false);
      }
    } : undefined}
  />;
}
