import { useTranslation } from 'react-i18next';
import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT,
  createNimiMachineLocalStableDiffusionImageConfigurationInput,
  createNimiMachineLocalStableDiffusionVideoConfigurationInput,
  type NimiMachineLocalCapabilityRequirement,
  type NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  Checkbox,
  OverlayShell,
  SelectField,
  TextField,
} from '@nimiplatform/kit/ui';
import {
  parseRuntimeConfigMachineLocalAIVideoRecipeDraft,
  type RuntimeConfigMachineLocalAIAddDraft,
  type RuntimeConfigMachineLocalAIVideoSlotId,
} from './runtime-config-machine-local-ai-state.js';
import {
  machineLocalAssetDisplayName,
  machineLocalModelFamilyDisplayName,
  machineLocalReadOnlyFieldClassName,
  machineLocalRequirementGroupDisplay,
} from './runtime-config-machine-local-ai-display.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

const MACHINE_LOCAL_ADD_CAPABILITY_OPTIONS = [
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT,
] as const;

export function MachineLocalAIAddDrawer(props: {
  readonly open: boolean;
  readonly draft: RuntimeConfigMachineLocalAIAddDraft;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly busy: boolean;
  readonly onChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
  readonly onCancel: () => void;
  readonly onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <OverlayShell
      open={props.open}
      kind="drawer"
      size="M"
      title={t('runtimeConfig.machineLocalAIConfigurations.add')}
      onClose={props.onCancel}
      panelClassName="flex flex-col"
      contentClassName="min-h-0 flex-1 overflow-y-auto"
      dataTestId="machine-local-ai-configuration-add-drawer"
      footer={(
        <div className="flex justify-end gap-2">
          <Button size="sm" tone="ghost" disabled={props.busy} onClick={props.onCancel}>
            {t('runtimeConfig.machineLocalAIConfigurations.cancel')}
          </Button>
          <Button size="sm" tone="primary" loading={props.busy} onClick={props.onAdd}>
            {t('runtimeConfig.machineLocalAIConfigurations.save')}
          </Button>
        </div>
      )}
    >
      <MachineLocalAIAddFormFields
        draft={props.draft}
        assets={props.assets}
        busy={props.busy}
        onChange={props.onChange}
      />
    </OverlayShell>
  );
}

/**
 * Drawer body kept separate from the overlay shell so unit tests can render
 * the form without a DOM portal host.
 */
export function MachineLocalAIAddFormFields(props: {
  readonly draft: RuntimeConfigMachineLocalAIAddDraft;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly busy: boolean;
  readonly onChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const update = (patch: Partial<RuntimeConfigMachineLocalAIAddDraft>) => {
    props.onChange({ ...draft, ...patch });
  };
  return (
    <div
      className="grid gap-4 py-2"
      data-testid="machine-local-ai-configuration-add-form"
      data-capability={draft.capabilityContract}
    >
      <label className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.machineLocalAIConfigurations.displayName')}</span>
        <TextField
          value={draft.displayName}
          onChange={(event) => update({ displayName: event.currentTarget.value })}
          placeholder={t('runtimeConfig.machineLocalAIConfigurations.displayNamePlaceholder')}
          disabled={props.busy}
        />
      </label>
      <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.machineLocalAIConfigurations.capabilityContract')}</span>
        <SelectField
          value={draft.capabilityContract}
          disabled={props.busy}
          options={MACHINE_LOCAL_ADD_CAPABILITY_OPTIONS.map((contract) => ({
            value: contract,
            label: displayRuntimeConfigCapabilityLabel(contract, t),
          }))}
          onValueChange={(value) => update({
            capabilityContract: value as RuntimeConfigMachineLocalAIAddDraft['capabilityContract'],
          })}
          contentLayer="dialog"
          data-testid="machine-local-ai-add-capability"
        />
      </div>

      {draft.capabilityContract === NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT ? (
        <>
          <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
            <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
            <div className={machineLocalReadOnlyFieldClassName}>llama.cpp</div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.machineLocalAIConfigurations.inputSupport')}
            </legend>
            <div className="flex items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
              <Checkbox
                checked={draft.acceptsImageInput}
                disabled={props.busy}
                onChange={(event) => update({ acceptsImageInput: event.currentTarget.checked })}
                className="mt-0.5"
                aria-label={t('runtimeConfig.machineLocalAIConfigurations.inputSupport')}
              />
              <span>
                <span className="block font-medium text-[var(--nimi-text-primary)]">
                  {draft.acceptsImageInput
                    ? t('runtimeConfig.machineLocalAIConfigurations.textAndImages')
                    : t('runtimeConfig.machineLocalAIConfigurations.textOnly')}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
                  {draft.acceptsImageInput
                    ? t('runtimeConfig.machineLocalAIConfigurations.textAndImagesBody')
                    : t('runtimeConfig.machineLocalAIConfigurations.textOnlyBody')}
                </span>
              </span>
            </div>
          </fieldset>
        </>
      ) : draft.capabilityContract === NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT ? (
        <div
          className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]"
          data-testid="machine-local-ai-embed-fields"
        >
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <div className={machineLocalReadOnlyFieldClassName}>llama.cpp</div>
        </div>
      ) : draft.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT ? (
        <div
          className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]"
          data-testid="machine-local-ai-tts-fields"
        >
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <div className={machineLocalReadOnlyFieldClassName}>
            {t('runtimeConfig.machineLocalAIConfigurations.qwen3TTSEngine')}
          </div>
        </div>
      ) : draft.capabilityContract === NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT ? (
        <div
          className="space-y-3"
          data-testid="machine-local-ai-voice-create-fields"
        >
          <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
            <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
            <div className={machineLocalReadOnlyFieldClassName}>
              {t('runtimeConfig.machineLocalAIConfigurations.qwen3TTSEngine')}
            </div>
          </div>
          <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
            <span>{t('runtimeConfig.machineLocalAIConfigurations.voiceCreateSource')}</span>
            <SelectField
              value={draft.voiceCreateSource}
              disabled={props.busy}
              options={[
                {
                  value: 'reference-audio',
                  label: t('runtimeConfig.machineLocalAIConfigurations.voiceCreateReferenceAudio'),
                },
                {
                  value: 'text-description',
                  label: t('runtimeConfig.machineLocalAIConfigurations.voiceCreateTextDescription'),
                },
              ]}
              onValueChange={(value) => update({
                voiceCreateSource: value as RuntimeConfigMachineLocalAIAddDraft['voiceCreateSource'],
              })}
              contentLayer="dialog"
              data-testid="machine-local-ai-voice-create-source"
            />
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.machineLocalAIConfigurations.voiceCreateSourceBody')}
            </p>
          </div>
        </div>
      ) : draft.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT ? (
        <div
          className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]"
          data-testid="machine-local-ai-asr-fields"
        >
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <SelectField
            value={draft.asrDriverKind}
            disabled={props.busy}
            options={[
              {
                value: 'qwen3-asr',
                label: t('runtimeConfig.machineLocalAIConfigurations.qwen3ASREngine'),
              },
              {
                value: 'qwen3-asr-transformers',
                label: t('runtimeConfig.machineLocalAIConfigurations.qwen3ASRTransformersEngine'),
              },
            ]}
            onValueChange={(value) => update({
              asrDriverKind: value as RuntimeConfigMachineLocalAIAddDraft['asrDriverKind'],
            })}
            contentLayer="dialog"
            data-testid="machine-local-ai-asr-driver"
          />
        </div>
      ) : draft.capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT ? (
        <MachineLocalAIVideoAddFields
          draft={draft}
          assets={props.assets}
          busy={props.busy}
          onChange={props.onChange}
        />
      ) : (
        <MachineLocalAIImageAddFields
          draft={draft}
          assets={props.assets}
          busy={props.busy}
          onChange={props.onChange}
        />
      )}
    </div>
  );
}

function MachineLocalAIImageAddFields(props: {
  readonly draft: RuntimeConfigMachineLocalAIAddDraft;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly busy: boolean;
  readonly onChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const verifiedImageAssets = props.assets.filter((asset) => (
    asset.kind === 'image'
    && (asset.status === 'installed' || asset.status === 'active')
    && Boolean(asset.family)
    && Boolean(asset.exactContent?.verifiedContentId)
  ));
  return (
    <div className="grid gap-4" data-testid="machine-local-ai-image-fields">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <ExactAssetSelect
            value={draft.mainLocalAssetId}
            assets={verifiedImageAssets}
            busy={props.busy}
            label={t('runtimeConfig.machineLocalAIConfigurations.preferredFile')}
            onChange={(localAssetId) => {
              const asset = verifiedImageAssets.find((candidate) => candidate.localAssetId === localAssetId);
              props.onChange({
                ...draft,
                mainLocalAssetId: localAssetId,
                modelFamily: asset?.family ?? '',
              });
            }}
          />
        </div>
        <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.modelFamily')}</span>
          <div className={machineLocalReadOnlyFieldClassName} data-testid="machine-local-ai-image-family">
            {draft.modelFamily ? machineLocalModelFamilyDisplayName(draft.modelFamily) : '—'}
          </div>
        </div>
        <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <div className={machineLocalReadOnlyFieldClassName}>stable-diffusion.cpp</div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
        <Checkbox
          checked={draft.enableInputImage}
          disabled={props.busy}
          onChange={(event) => props.onChange({
            ...draft,
            enableInputImage: event.currentTarget.checked,
          })}
          className="mt-0.5"
          aria-label={t('runtimeConfig.machineLocalAIConfigurations.imageInputFeature')}
        />
        <span>
          <span className="block font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeature')}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeatureBody')}
          </span>
        </span>
      </div>

      <fieldset className="grid gap-3 md:grid-cols-5" data-testid="machine-local-ai-image-execution-options">
        <legend className="mb-1 text-sm font-semibold text-[var(--nimi-text-primary)] md:col-span-5">
          {t('runtimeConfig.machineLocalAIConfigurations.executionOptions')}
        </legend>
        {(['steps', 'cfgScale', 'width', 'height', 'seed'] as const).map((key) => (
          <label key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
            <span>{t(`runtimeConfig.machineLocalAIConfigurations.execution.${key}`)}</span>
            <TextField
              type="number"
              value={draft.executionOptions[key]}
              disabled={props.busy}
              onChange={(event) => props.onChange({
                ...draft,
                executionOptions: {
                  ...draft.executionOptions,
                  [key]: event.currentTarget.value,
                },
              })}
            />
          </label>
        ))}
      </fieldset>
    </div>
  );
}

const MACHINE_LOCAL_VIDEO_SLOTS: ReadonlyArray<{
  readonly slotId: RuntimeConfigMachineLocalAIVideoSlotId;
  readonly role: NimiMachineLocalCapabilityRequirement['role'];
  readonly labelKey: string;
}> = [
  { slotId: 'fl2va', role: 'main', labelKey: 'videoSlotFl2va' },
  { slotId: 'ref2va', role: 'companion', labelKey: 'videoSlotRef2va' },
  { slotId: 'encoder', role: 'companion', labelKey: 'videoSlotEncoder' },
  { slotId: 'videoVAE', role: 'companion', labelKey: 'videoSlotVideoVae' },
  { slotId: 'audioVAE', role: 'companion', labelKey: 'videoSlotAudioVae' },
];

function MachineLocalAIVideoAddFields(props: {
  readonly draft: RuntimeConfigMachineLocalAIAddDraft;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly busy: boolean;
  readonly onChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const verifiedAssets = props.assets.filter((asset) => (
    asset.status !== 'removed' && Boolean(asset.expectedVerifiedContentId)
  ));
  const updateSlot = (
    slotId: RuntimeConfigMachineLocalAIVideoSlotId,
    patch: Partial<RuntimeConfigMachineLocalAIAddDraft['videoSlots'][RuntimeConfigMachineLocalAIVideoSlotId]>,
  ) => props.onChange({
    ...draft,
    videoSlots: {
      ...draft.videoSlots,
      [slotId]: { ...draft.videoSlots[slotId], ...patch },
    },
  });

  return (
    <div className="grid gap-4" data-testid="machine-local-ai-video-fields">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <div className={machineLocalReadOnlyFieldClassName}>stable-diffusion.cpp</div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
        <Checkbox
          checked={draft.enableInputImage}
          disabled={props.busy}
          onChange={(event) => props.onChange({
            ...draft,
            enableInputImage: event.currentTarget.checked,
          })}
          className="mt-0.5"
          aria-label={t('runtimeConfig.machineLocalAIConfigurations.imageInputFeature')}
        />
        <span>
          <span className="block font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeature')}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeatureBody')}
          </span>
        </span>
      </div>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.videoSlotsTitle')}
        </legend>
        {MACHINE_LOCAL_VIDEO_SLOTS.map((slot) => {
          const slotDraft = draft.videoSlots[slot.slotId];
          return (
            <div
              key={slot.slotId}
              className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3"
              data-testid={`machine-local-ai-video-slot:${slot.slotId}`}
            >
              <div>
                <div className="text-xs font-semibold text-[var(--nimi-text-muted)]">
                  {machineLocalRequirementGroupDisplay(slot.role, 0, t)}
                </div>
                <div className="mt-1 text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t(`runtimeConfig.machineLocalAIConfigurations.${slot.labelKey}`)}
                </div>
              </div>
              <div className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{t('runtimeConfig.machineLocalAIConfigurations.requirementPolicy')}</span>
                <SelectField
                  value={slotDraft.requirementPolicy}
                  disabled={props.busy}
                  options={[
                    { value: 'substitutable', label: t('runtimeConfig.machineLocalAIConfigurations.policySubstitutable') },
                    { value: 'strict', label: t('runtimeConfig.machineLocalAIConfigurations.policyStrict') },
                  ]}
                  onValueChange={(value) => updateSlot(slot.slotId, {
                    requirementPolicy: value as typeof slotDraft.requirementPolicy,
                    localAssetId: value === 'strict' ? slotDraft.localAssetId : '',
                  })}
                  contentLayer="dialog"
                />
              </div>
              {slotDraft.requirementPolicy === 'strict' ? (
                <ExactAssetSelect
                  value={slotDraft.localAssetId}
                  assets={verifiedAssets}
                  busy={props.busy}
                  label={t('runtimeConfig.machineLocalAIConfigurations.preferredFile')}
                  onChange={(localAssetId) => updateSlot(slot.slotId, { localAssetId })}
                />
              ) : (
                <p className="text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.machineLocalAIConfigurations.policySubstitutableBody')}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset
        className="grid gap-3 md:grid-cols-2"
        data-testid="machine-local-ai-video-execution-options"
      >
        <legend className="mb-1 text-sm font-semibold text-[var(--nimi-text-primary)] md:col-span-2">
          {t('runtimeConfig.machineLocalAIConfigurations.videoRecipe')}
        </legend>
        <p className="text-xs text-[var(--nimi-text-muted)] md:col-span-2">
          {t('runtimeConfig.machineLocalAIConfigurations.videoRecipeBody')}
        </p>
        {(['cfgScale', 'flowShift'] as const).map((key) => (
          <label key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
            <span>{t(`runtimeConfig.machineLocalAIConfigurations.videoExecution.${key}`)}</span>
            <TextField
              type="number"
              min={0}
              step="0.1"
              value={draft.videoExecutionOptions[key]}
              disabled={props.busy}
              onChange={(event) => props.onChange({
                ...draft,
                videoExecutionOptions: {
                  ...draft.videoExecutionOptions,
                  [key]: event.currentTarget.value,
                },
              })}
            />
          </label>
        ))}
        {(['sampleMethod', 'scheduler'] as const).map((key) => (
          <label key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
            <span>{t(`runtimeConfig.machineLocalAIConfigurations.videoExecution.${key}`)}</span>
            <TextField
              value={draft.videoExecutionOptions[key]}
              disabled={props.busy}
              onChange={(event) => props.onChange({
                ...draft,
                videoExecutionOptions: {
                  ...draft.videoExecutionOptions,
                  [key]: event.currentTarget.value,
                },
              })}
            />
          </label>
        ))}
        {(['diffusionFlashAttention', 'offloadParamsToCPU'] as const).map((key) => (
          <div key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
            <span>{t(`runtimeConfig.machineLocalAIConfigurations.videoExecution.${key}`)}</span>
            <SelectField
              value={String(draft.videoExecutionOptions[key])}
              disabled={props.busy}
              options={[
                { value: 'true', label: t('runtimeConfig.machineLocalAIConfigurations.enabled') },
                { value: 'false', label: t('runtimeConfig.machineLocalAIConfigurations.disabled') },
              ]}
              onValueChange={(value) => props.onChange({
                ...draft,
                videoExecutionOptions: {
                  ...draft.videoExecutionOptions,
                  [key]: value === 'true',
                },
              })}
              contentLayer="dialog"
            />
          </div>
        ))}
        <div className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.videoExecution.rng')}</span>
          <SelectField
            value={draft.videoExecutionOptions.rng}
            disabled={props.busy}
            options={(['cpu', 'cuda', 'std_default'] as const).map((value) => ({ value, label: value }))}
            onValueChange={(value) => props.onChange({
              ...draft,
              videoExecutionOptions: {
                ...draft.videoExecutionOptions,
                rng: value as RuntimeConfigMachineLocalAIAddDraft['videoExecutionOptions']['rng'],
              },
            })}
            contentLayer="dialog"
          />
        </div>
      </fieldset>
    </div>
  );
}

function ExactAssetSelect(props: {
  readonly value: string;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly busy: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
      <span>{props.label}</span>
      <SelectField
        value={props.value}
        disabled={props.busy || props.assets.length === 0}
        placeholder={props.assets.length > 0
          ? t('runtimeConfig.machineLocalAIConfigurations.chooseFilePlaceholder')
          : t('runtimeConfig.machineLocalAIConfigurations.noCompatibleFiles')}
        options={props.assets.map((asset) => ({
          value: asset.localAssetId,
          label: machineLocalAssetDisplayName(asset, t),
        }))}
        onValueChange={props.onChange}
        contentLayer="dialog"
      />
    </div>
  );
}

// nimi-authority: rule.nimi.desktop.ai-consumption.r023
// nimi-authority: rule.nimi.runtime.ai-provider.r064
export function createMachineLocalImageConfigurationInput(
  draft: RuntimeConfigMachineLocalAIAddDraft,
  assets: readonly NimiRuntimeLocalAssetEntry[],
  displayName: string,
) {
  const mainAsset = assets.find((asset) => asset.localAssetId === draft.mainLocalAssetId);
  if (
    !mainAsset
    || mainAsset.kind !== 'image'
    || (mainAsset.status !== 'installed' && mainAsset.status !== 'active')
    || !mainAsset.family
    || !mainAsset.exactContent?.verifiedContentId
  ) {
    throw new Error('A verified Runtime-projected main image asset is required.');
  }
  if (draft.modelFamily !== mainAsset.family) {
    throw new Error('The selected main asset family changed before Add.');
  }
  return createNimiMachineLocalStableDiffusionImageConfigurationInput({
    displayName,
    modelFamily: mainAsset.family,
    enableInputImage: draft.enableInputImage,
    executionOptions: {
      steps: parseDraftNumber(draft.executionOptions.steps, 'steps'),
      cfgScale: parseDraftNumber(draft.executionOptions.cfgScale, 'cfgScale'),
      width: parseDraftNumber(draft.executionOptions.width, 'width'),
      height: parseDraftNumber(draft.executionOptions.height, 'height'),
      seed: parseDraftNumber(draft.executionOptions.seed, 'seed'),
    },
  });
}

export function createVideoConfigurationInput(
  draft: RuntimeConfigMachineLocalAIAddDraft,
  assets: readonly NimiRuntimeLocalAssetEntry[],
  displayName: string,
) {
  const preferredContentId = (slotId: RuntimeConfigMachineLocalAIVideoSlotId): string | undefined => {
    const slot = draft.videoSlots[slotId];
    if (slot.requirementPolicy !== 'strict') return undefined;
    const contentId = assets.find((asset) => asset.localAssetId === slot.localAssetId)
      ?.expectedVerifiedContentId;
    if (!contentId) throw new Error(`A preferred local file is required for ${slotId}.`);
    return contentId;
  };
  const fl2vaVerifiedContentId = preferredContentId('fl2va');
  const ref2vaVerifiedContentId = preferredContentId('ref2va');
  const encoderVerifiedContentId = preferredContentId('encoder');
  const videoVAEVerifiedContentId = preferredContentId('videoVAE');
  const audioVAEVerifiedContentId = preferredContentId('audioVAE');
  const input = createNimiMachineLocalStableDiffusionVideoConfigurationInput({
    displayName,
    enableInputImage: draft.enableInputImage,
    fl2vaRequirementPolicy: draft.videoSlots.fl2va.requirementPolicy,
    ...(fl2vaVerifiedContentId ? { fl2vaVerifiedContentId } : {}),
    ref2vaRequirementPolicy: draft.videoSlots.ref2va.requirementPolicy,
    ...(ref2vaVerifiedContentId ? { ref2vaVerifiedContentId } : {}),
    encoderRequirementPolicy: draft.videoSlots.encoder.requirementPolicy,
    ...(encoderVerifiedContentId ? { encoderVerifiedContentId } : {}),
    videoVAERequirementPolicy: draft.videoSlots.videoVAE.requirementPolicy,
    ...(videoVAEVerifiedContentId ? { videoVAEVerifiedContentId } : {}),
    audioVAERequirementPolicy: draft.videoSlots.audioVAE.requirementPolicy,
    ...(audioVAEVerifiedContentId ? { audioVAEVerifiedContentId } : {}),
  });
  return {
    ...input,
    portableConfig: {
      ...(input.portableConfig ?? {}),
      executionOptions: parseRuntimeConfigMachineLocalAIVideoRecipeDraft(
        draft.videoExecutionOptions,
      ),
    },
  };
}

function parseDraftNumber(value: string, field: string): number {
  if (!value || value.trim() !== value) throw new Error(`${field} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a finite number.`);
  return number;
}
