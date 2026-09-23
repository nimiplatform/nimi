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
import { Button, InlineAlert, SelectField } from '@nimiplatform/kit/ui';
import { formatBytes } from '../../components/download-format.js';
import {
  loadoutAssetLabel,
  loadoutCandidatePresentation,
  loadoutSlotLabelKey,
  runtimeConfigLoadoutCandidateAssets,
  type NimiLoadoutRecipeSlot,
  type NimiLoadoutRecipeSlotOffer,
} from './runtime-config-loadout-model-display.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
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
  const [offerHint, setOfferHint] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);

  const baseOptions: JsonObject = useMemo(() => (
    (draft?.options as JsonObject | undefined)
    ?? (candidate?.options as JsonObject | undefined)
    ?? (recipe.defaultOptions as JsonObject | undefined)
    ?? {}
  ), [candidate?.options, draft?.options, recipe.defaultOptions]);
  const [optionsJson, setOptionsJson] = useState(() => JSON.stringify(baseOptions, null, 2));
  useEffect(() => setOptionsJson(JSON.stringify(baseOptions, null, 2)), [baseOptions]);

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
    // is recorded as the preferred choice for that review.
    writeDraft({
      preferredOffers: { ...(draft?.preferredOffers ?? {}), [slot.slotId]: offer.candidate.offerRef },
      pendingAxes: (draft?.pendingAxes ?? []).filter((axis) => axis.slotId !== slot.slotId),
    });
    setOfferHint(t('runtimeConfig.setupTask.advanced.offerQueued', {
      defaultValue: 'This variant is queued as the preferred choice and will be downloaded during the reviewed preparation.',
    }));
  }, [draft?.pendingAxes, draft?.preferredOffers, t, writeDraft]);

  const onApply = useCallback(async () => {
    if (!props.onApply || props.disabled || applying) return;
    let options: NimiJsonObject;
    try {
      const value: unknown = JSON.parse(optionsJson);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
      options = value as NimiJsonObject;
    } catch {
      setApplyError(t('runtimeConfig.setupTask.advanced.optionsInvalid'));
      return;
    }
    setApplying(true);
    setApplyError('');
    try {
      await props.onApply({ ...draft, options, axes: boundAxes });
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setApplying(false);
    }
  }, [optionsJson, boundAxes, draft, props, applying, t]);

  const optionKeys = Object.keys(baseOptions).filter((key) => !candidate || optionValueType(baseOptions[key]) !== 'json');
  const changed = props.changed || optionsJson !== JSON.stringify(baseOptions, null, 2);
  const disabled = props.disabled || applying;

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
          const preferredOffer = draft?.preferredOffers?.[slot.slotId];
          const optionalEnabled = !isOptional || !disabledOptionalSlots.has(slot.slotId);
          const slotLabel = slotDisplayLabel(slot, t);
          const candidates = runtimeConfigLoadoutCandidateAssets(slot, assets);
          const offers = slot.offers.filter((offer) => !offer.installedModelAssetId
            || !candidates.some((asset) => asset.modelAssetId === offer.installedModelAssetId));
          const value = preferredOffer ? `offer:${preferredOffer}` : bound ? `asset:${bound.modelAssetId}` : '__unresolved__';
          const choices = [
            { value: '__unresolved__', label: t('runtimeConfig.loadouts.unresolved') },
            ...candidates.map((asset) => ({
              value: `asset:${asset.modelAssetId}`,
              label: `${loadoutAssetLabel(asset, verifiedAssets)} · ${t('runtimeConfig.loadouts.installed')}${asset.totalSizeBytes ? ` · ${formatBytes(asset.totalSizeBytes)}` : ''}`,
            })),
            ...offers.map((offer) => {
              const presentation = loadoutCandidatePresentation(offer.candidate);
              const acquisitionLabel = offer.installedModelAssetId
                ? t('runtimeConfig.loadouts.installed')
                : !offer.candidate.installable
                  ? t('runtimeConfig.recommend.notInstallable')
                  : offer.candidate.totalSizeBytes
                    ? t('runtimeConfig.product.downloadSize', { size: formatBytes(offer.candidate.totalSizeBytes) })
                    : t('runtimeConfig.product.downloadSizeUnknown');
              return {
                value: `offer:${offer.candidate.offerRef}`,
                label: [presentation.headline,
                  offer.candidate.variantLabel || presentation.quant.technical,
                  t(`runtimeConfig.loadouts.hostFit.${offer.applicability}`),
                  acquisitionLabel,
                ].filter(Boolean).join(' · '),
                disabled: offer.applicability === 'unsupported' || (!offer.installedModelAssetId && !offer.candidate.installable),
              };
            }),
          ];
          // Keep a missing current binding visible rather than silently showing another version.
          if (!choices.some((choice) => choice.value === value)) {
            choices.push({ value, label: candidate?.modelAxes.find((axis) => axis.slotId === slot.slotId)?.displayLabel || slotLabel });
          }
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
                <SelectField
                  aria-label={slotLabel}
                  data-testid={`runtime-setup-advanced-version:${slot.slotId}`}
                  value={value}
                  options={choices}
                  disabled={disabled}
                  onValueChange={(next) => {
                    setOfferHint('');
                    if (next.startsWith('offer:')) {
                      const offer = slot.offers.find((item) => item.candidate.offerRef === next.slice(6));
                      if (offer && offer.applicability !== 'unsupported' && (offer.installedModelAssetId || offer.candidate.installable)) onOpenOffer(slot, offer);
                    } else onSelectAxis(slot.slotId, next.startsWith('asset:') ? next.slice(6) : '');
                  }}
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
                    aria-label={key}
                    checked={value === true}
                    onChange={(event) => onOptionChange(key, event.currentTarget.checked)}
                  />
                ) : valueType === 'number' ? (
                  <input
                    type="number"
                    aria-label={key}
                    step="any"
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
                    aria-label={key}
                    className="w-56 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 text-sm text-[var(--nimi-text-primary)]"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => onOptionChange(key, event.currentTarget.value)}
                  />
                ) : (
                  <input
                    type="text"
                    aria-label={key}
                    key={JSON.stringify(value)}
                    className="w-56 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 py-1 font-mono text-xs text-[var(--nimi-text-primary)]"
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
          <textarea aria-label={t('runtimeConfig.setupTask.advanced.optionsJson')} className="min-h-32 w-full rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs text-[var(--nimi-text-primary)]" value={optionsJson} onChange={event => setOptionsJson(event.currentTarget.value)} />
        </details>
      ) : null}
      {props.onApply ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--nimi-border-subtle)] pt-4">
          <Button tone={props.applyLabel ? 'primary' : 'secondary'} disabled={disabled || (props.changed !== undefined && !changed)} onClick={() => { void onApply(); }} data-testid="runtime-setup-advanced-apply">
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
}) {
  const localEnvironment = useRuntimeConfigLocalEnvironmentClient();
  const [assets, setAssets] = useState<readonly NimiRuntimeModelAssetRecord[]>([]);
  const [verifiedAssets, setVerifiedAssets] = useState<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all([localEnvironment.listModelAssets(), localEnvironment.listVerifiedAssets()])
      .then(([nextAssets, nextVerified]) => {
        if (active) { setAssets(nextAssets); setVerifiedAssets(nextVerified); }
      }).catch(() => {});
    return () => { active = false; };
  }, [localEnvironment]);
  return <RuntimeLoadoutOptionsEditor
    recipe={props.recipe}
    candidate={props.candidate}
    draft={props.task.draft}
    assets={assets}
    verifiedAssets={verifiedAssets}
    onChange={(patch) => props.store.updateTask(props.task.taskId, (current) => ({ draft: { ...current.draft, ...patch } }))}
    onApply={props.candidate ? async (draft) => {
      props.store.updateTask(props.task.taskId, () => ({ draft }));
      const result = await updateRuntimeSetupCandidate(props.store, props.task.taskId, props.ports, { options: draft.options, axes: draft.axes });
      if (result.status !== 'ok') throw new Error(result.failure.message);
      props.onCandidateUpdated();
    } : undefined}
  />;
}
