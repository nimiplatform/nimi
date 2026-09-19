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
  LoadoutSelectedModelCard,
  LoadoutSlotModelPicker,
} from './runtime-config-loadout-model-picker.js';
import {
  loadoutSlotLabelKey,
  type NimiLoadoutRecipeSlot,
  type NimiLoadoutRecipeSlotOffer,
} from './runtime-config-loadout-model-display.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { updateRuntimeSetupCandidate } from './runtime-setup-task-runner.js';
import type {
  RuntimeSetupTask,
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

/**
 * Advanced editing inside the setup task: exact variant picks per slot,
 * optional-slot enable/disable, and typed implementation options on top of
 * the recipe defaults. Every edit is written to the task draft so switching
 * views or restoring after a restart never drops it. A legal unresolved
 * intent (a slot left unbound) remains saveable.
 */
export function SetupTaskAdvancedSection(props: {
  readonly task: RuntimeSetupTask;
  readonly store: RuntimeSetupTaskStore;
  readonly ports: RuntimeSetupRunnerPorts;
  readonly recipe: NimiLoadoutRecipe;
  readonly candidate: NimiMachineLoadout | null;
  readonly onCandidateUpdated: () => void;
}) {
  const { t } = useTranslation();
  const { task, recipe, candidate } = props;
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const [assets, setAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [verifiedAssets, setVerifiedAssets] = useState<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);
  const [offerHint, setOfferHint] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([localEnvironment.listModelAssets(), localEnvironment.listVerifiedAssets()])
      .then(([nextAssets, nextVerified]) => {
        if (!active) return;
        setAssets(nextAssets);
        setVerifiedAssets(nextVerified);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [localEnvironment]);

  const draft = task.draft;
  const baseOptions: JsonObject = useMemo(() => (
    (draft?.options as JsonObject | undefined)
    ?? (candidate?.options as JsonObject | undefined)
    ?? (recipe.defaultOptions as JsonObject | undefined)
    ?? {}
  ), [candidate?.options, draft?.options, recipe.defaultOptions]);

  const boundAxes: readonly RuntimeSetupTaskDraftAxis[] = draft?.axes
    ?? (candidate?.modelAxes ?? [])
      .filter((axis) => axis.modelAssetId && axis.expectedContentId)
      .map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId }));
  const disabledOptionalSlots = useMemo(
    () => new Set(draft?.disabledOptionalSlots ?? []),
    [draft?.disabledOptionalSlots],
  );

  const writeDraft = useCallback((patch: Partial<NonNullable<RuntimeSetupTask['draft']>>) => {
    props.store.updateTask(task.taskId, (current) => ({
      draft: { ...(current.draft ?? {}), ...patch },
    }));
  }, [props.store, task.taskId]);

  const onOptionChange = useCallback((key: string, value: NimiJsonValue) => {
    writeDraft({ options: { ...baseOptions, [key]: value } });
  }, [baseOptions, writeDraft]);

  const onResetOptions = useCallback(() => {
    writeDraft({ options: { ...(recipe.defaultOptions as JsonObject | undefined) ?? {} } });
  }, [recipe.defaultOptions, writeDraft]);

  const onSelectAxis = useCallback((slotId: string, modelAssetId: string) => {
    const asset = assets.find((entry) => entry.modelAssetId === modelAssetId);
    const nextAxes = boundAxes.filter((axis) => axis.slotId !== slotId);
    if (asset) {
      nextAxes.push({ slotId, modelAssetId: asset.modelAssetId, expectedContentId: asset.contentId });
    }
    writeDraft({
      axes: nextAxes,
      pendingAxes: (draft?.pendingAxes ?? []).filter((axis) => axis.slotId !== slotId),
      preferredOffers: Object.fromEntries(Object.entries(draft?.preferredOffers ?? {}).filter(([id]) => id !== slotId)),
    });
  }, [assets, boundAxes, draft?.pendingAxes, draft?.preferredOffers, writeDraft]);

  const onToggleOptionalSlot = useCallback((slot: NimiLoadoutRecipeSlot, enabled: boolean) => {
    if (enabled) {
      const nextDisabled = [...disabledOptionalSlots].filter((slotId) => slotId !== slot.slotId);
      writeDraft({ disabledOptionalSlots: nextDisabled });
      setPickerSlotId(slot.slotId);
      return;
    }
    const nextAxes = boundAxes.filter((axis) => axis.slotId !== slot.slotId);
    writeDraft({
      axes: nextAxes,
      disabledOptionalSlots: [...disabledOptionalSlots, slot.slotId],
    });
  }, [boundAxes, disabledOptionalSlots, writeDraft]);

  const onOpenOffer = useCallback((slot: NimiLoadoutRecipeSlot, offer: NimiLoadoutRecipeSlotOffer) => {
    // Acquisition is reviewed in the preparation list; an advanced offer pick
    // is recorded as the preferred choice for that review.
    writeDraft({
      preferredOffers: { ...(draft?.preferredOffers ?? {}), [slot.slotId]: offer.candidate.offerRef },
      pendingAxes: (draft?.pendingAxes ?? []).filter((axis) => axis.slotId !== slot.slotId),
    });
    setPickerSlotId(null);
    setOfferHint(t('runtimeConfig.setupTask.advanced.offerQueued', {
      defaultValue: 'This variant is queued as the preferred choice and will be downloaded during the reviewed preparation.',
    }));
  }, [draft?.pendingAxes, draft?.preferredOffers, t, writeDraft]);

  const onApply = useCallback(() => {
    if (!candidate) return;
    setApplying(true);
    setApplyError('');
    void updateRuntimeSetupCandidate(props.store, task.taskId, props.ports, {
      options: baseOptions,
      axes: boundAxes,
    }).then((result) => {
      if (result.status === 'ok') {
        props.onCandidateUpdated();
        return;
      }
      if (result.status === 'blocked') {
        setApplyError(result.failure.message);
      }
      // needs-attention/failed are projected from the task status by the view.
    }).finally(() => setApplying(false));
  }, [baseOptions, boundAxes, candidate, props, task.taskId]);

  const optionKeys = Object.keys(baseOptions);
  const pickerSlot = pickerSlotId ? recipe.slots.find((slot) => slot.slotId === pickerSlotId) ?? null : null;

  return (
    <div className="space-y-3" data-testid="runtime-setup-task-advanced">
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
          const asset = bound ? assets.find((entry) => entry.modelAssetId === bound.modelAssetId) ?? null : null;
          const optionalEnabled = !isOptional || (!disabledOptionalSlots.has(slot.slotId) && bound !== null);
          const slotLabel = slotDisplayLabel(slot, t);
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
                  verifiedAssets={verifiedAssets}
                  onOpenPicker={() => setPickerSlotId(slot.slotId)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {optionKeys.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.setupTask.advanced.optionsTitle', { defaultValue: 'Implementation options' })}
            </div>
            <Button tone="ghost" size="sm" onClick={onResetOptions}>
              {t('runtimeConfig.setupTask.advanced.resetOptions', { defaultValue: 'Reset to recipe defaults' })}
            </Button>
          </div>
          {optionKeys.map((key) => {
            const value = baseOptions[key];
            const valueType = optionValueType(value);
            return (
              <div key={key} className="flex items-center justify-between gap-3" data-testid={`runtime-setup-advanced-option:${key}`}>
                <span className="min-w-0 truncate text-xs font-semibold text-[var(--nimi-text-secondary)]">{key}</span>
                {valueType === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) => onOptionChange(key, event.currentTarget.checked)}
                  />
                ) : valueType === 'number' ? (
                  <input
                    type="number"
                    className="w-32 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 text-sm text-[var(--nimi-text-primary)]"
                    value={typeof value === 'number' && Number.isFinite(value) ? value : 0}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      if (Number.isFinite(next)) onOptionChange(key, next);
                    }}
                  />
                ) : valueType === 'string' ? (
                  <input
                    type="text"
                    className="w-56 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 text-sm text-[var(--nimi-text-primary)]"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => onOptionChange(key, event.currentTarget.value)}
                  />
                ) : (
                  <input
                    type="text"
                    key={JSON.stringify(value)}
                    className="w-56 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 font-mono text-xs text-[var(--nimi-text-primary)]"
                    defaultValue={JSON.stringify(value)}
                    onBlur={(event) => {
                      try {
                        onOptionChange(key, JSON.parse(event.currentTarget.value));
                      } catch {
                        // Keep the last valid value while the JSON is incomplete.
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {candidate ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="secondary" size="sm" disabled={applying} onClick={onApply} data-testid="runtime-setup-advanced-apply">
            {applying
              ? t('runtimeConfig.setupTask.advanced.applying', { defaultValue: 'Applying…' })
              : t('runtimeConfig.setupTask.advanced.apply', { defaultValue: 'Apply changes to the saved configuration' })}
          </Button>
          {applyError ? <InlineAlert tone="warning">{applyError}</InlineAlert> : null}
        </div>
      ) : null}
      {pickerSlot ? (
        <LoadoutSlotModelPicker
          slot={pickerSlot}
          assets={assets}
          verifiedAssets={verifiedAssets}
          selectedAssetId={boundAxes.find((axis) => axis.slotId === pickerSlot.slotId)?.modelAssetId ?? ''}
          onSelect={(modelAssetId) => onSelectAxis(pickerSlot.slotId, modelAssetId)}
          onOpenOffer={(offer) => onOpenOffer(pickerSlot, offer)}
          onClose={() => setPickerSlotId(null)}
        />
      ) : null}
    </div>
  );
}
