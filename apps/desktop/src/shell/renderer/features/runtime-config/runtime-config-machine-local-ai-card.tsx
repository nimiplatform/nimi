import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  type NimiMachineLocalAssetExactBinding,
  type NimiMachineLocalCapabilityConfiguration,
  type NimiMachineLocalCapabilityRequirement,
  type NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  InlineAlert,
  OverlayShell,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SelectField,
  StatusBadge,
  Surface,
  TextField,
} from '@nimiplatform/kit/ui';
import {
  compatibleMachineLocalAssets,
  createRuntimeConfigMachineLocalAIVideoRecipeDraft,
  groupMachineLocalCapabilityRequirements,
  machineLocalConfigurationFileState,
  parseRuntimeConfigMachineLocalAIVideoRecipeDraft,
  type RuntimeConfigMachineLocalAIImpactConfirmation,
  type RuntimeConfigMachineLocalAIVideoExecutionOptions,
} from './runtime-config-machine-local-ai-state.js';
import {
  configuredMachineLocalFixedContextSize,
  displayMachineLocalConfigurationName,
  isMachineLocalLlamaConfiguration,
  isMachineLocalStableDiffusionVideoConfiguration,
  machineLocalAssetDisplayName,
  machineLocalEngineDisplayName,
  machineLocalRequirementGroupDisplay,
} from './runtime-config-machine-local-ai-display.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

export type MachineLocalAIBindHandler = (
  configuration: NimiMachineLocalCapabilityConfiguration,
  requirement: NimiMachineLocalCapabilityRequirement,
  currentBinding: NimiMachineLocalAssetExactBinding | undefined,
  localAssetId: string,
) => void;

type MachineLocalAIImpactBodyKey =
  | 'impactAudioSynthesizeBody'
  | 'impactAudioTranscribeBody'
  | 'impactCapabilityBody'
  | 'impactImageBody'
  | 'impactTextBody'
  | 'impactTextEmbedBody'
  | 'impactVideoBody';

function machineLocalAIImpactBodyKey(capabilityContract: string): MachineLocalAIImpactBodyKey {
  switch (capabilityContract) {
    case NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT:
      return 'impactTextBody';
    case NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT:
      return 'impactTextEmbedBody';
    case NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT:
      return 'impactAudioSynthesizeBody';
    case NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT:
      return 'impactAudioTranscribeBody';
    case NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT:
      return 'impactImageBody';
    case NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT:
      return 'impactVideoBody';
    default:
      return 'impactCapabilityBody';
  }
}

export function MachineLocalAIConfigurationCard(props: {
  readonly configuration: NimiMachineLocalCapabilityConfiguration;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: (configuration: NimiMachineLocalCapabilityConfiguration) => void;
  readonly onClearSelection: (capabilityContract: string) => void;
  readonly onReproject: (configuration: NimiMachineLocalCapabilityConfiguration) => void;
  readonly onUpdateContextCapacity: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    contextSize: number | undefined,
  ) => void;
  readonly onUpdateVideoRecipe: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    executionOptions: RuntimeConfigMachineLocalAIVideoExecutionOptions,
  ) => void;
  readonly onBind: MachineLocalAIBindHandler;
  readonly onUnbind: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding,
  ) => void;
  readonly onRequestDelete: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    selected: boolean,
  ) => void;
}) {
  const { t } = useTranslation();
  const { configuration } = props;
  const fileState = machineLocalConfigurationFileState(configuration);
  const anyBusy = props.busy;
  const fixedContextSize = configuredMachineLocalFixedContextSize(configuration);
  const [contextCapacityMode, setContextCapacityMode] = useState<'auto' | 'fixed'>(
    fixedContextSize === undefined ? 'auto' : 'fixed',
  );
  const [contextCapacityInput, setContextCapacityInput] = useState(String(fixedContextSize ?? 8192));
  const [videoRecipeDraft, setVideoRecipeDraft] = useState(() => (
    createRuntimeConfigMachineLocalAIVideoRecipeDraft(configuration.portableConfig)
  ));
  useEffect(() => {
    const next = configuredMachineLocalFixedContextSize(configuration);
    setContextCapacityMode(next === undefined ? 'auto' : 'fixed');
    setContextCapacityInput(String(next ?? 8192));
    setVideoRecipeDraft(createRuntimeConfigMachineLocalAIVideoRecipeDraft(configuration.portableConfig));
  }, [configuration]);
  const parsedContextCapacity = Number(contextCapacityInput);
  const fixedContextCapacityValid = Number.isInteger(parsedContextCapacity) && parsedContextCapacity > 0;
  let parsedVideoRecipe: RuntimeConfigMachineLocalAIVideoExecutionOptions | null = null;
  try {
    parsedVideoRecipe = parseRuntimeConfigMachineLocalAIVideoRecipeDraft(videoRecipeDraft);
  } catch {
    parsedVideoRecipe = null;
  }
  return (
    <Surface
      tone="card"
      className="space-y-4 p-5"
      data-testid={`machine-local-ai-configuration:${configuration.configurationId}`}
      data-file-state={fileState}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-[var(--nimi-text-primary)]">
              {displayMachineLocalConfigurationName(configuration, t)}
            </h4>
            {props.selected ? (
              <StatusBadge tone="info" shape="soft">
                {t('runtimeConfig.machineLocalAIConfigurations.selected')}
              </StatusBadge>
            ) : null}
            <StatusBadge tone={fileState === 'configured' ? 'success' : 'warning'} shape="soft">
              {t(`runtimeConfig.machineLocalAIConfigurations.${fileState === 'configured' ? 'configured' : 'filesNeeded'}`)}
            </StatusBadge>
          </div>
          <dl className="mt-2 grid gap-x-5 gap-y-1 text-xs text-[var(--nimi-text-secondary)] sm:grid-cols-2">
            <div className="flex gap-1.5">
              <dt className="font-medium">{t('runtimeConfig.machineLocalAIConfigurations.capabilityContract')}:</dt>
              <dd>{displayRuntimeConfigCapabilityLabel(configuration.capabilityContract, t)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-medium">{t('runtimeConfig.machineLocalAIConfigurations.engine')}:</dt>
              <dd>{machineLocalEngineDisplayName(configuration, t)}</dd>
            </div>
            {isMachineLocalLlamaConfiguration(configuration) ? (
              <div className="flex gap-1.5">
                <dt className="font-medium">{t('runtimeConfig.machineLocalAIConfigurations.contextCapacity')}:</dt>
                <dd>{fixedContextSize === undefined
                  ? t('runtimeConfig.machineLocalAIConfigurations.contextCapacityAutoShort')
                  : t('runtimeConfig.machineLocalAIConfigurations.contextCapacityFixedShort', { value: fixedContextSize })}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            {fileState === 'configured'
              ? t('runtimeConfig.machineLocalAIConfigurations.configuredBody')
              : t('runtimeConfig.machineLocalAIConfigurations.filesNeededBody')}
          </p>
          {configuration.interpretability === 'unavailable' ? (
            <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">
              {t('runtimeConfig.machineLocalAIConfigurations.componentUnavailable')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.selected ? (
            <Button
              size="sm"
              tone="ghost"
              disabled={anyBusy}
              onClick={() => props.onClearSelection(configuration.capabilityContract)}
            >
              {t('runtimeConfig.machineLocalAIConfigurations.clearSelection')}
            </Button>
          ) : (
            <Button
              size="sm"
              tone="primary"
              disabled={anyBusy}
              onClick={() => props.onSelect(configuration)}
            >
              {t('runtimeConfig.machineLocalAIConfigurations.select')}
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                tone="secondary"
                disabled={anyBusy}
                aria-label={t('runtimeConfig.machineLocalAIConfigurations.moreActions')}
              >
                …
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0">
              <ActionMenu
                ariaLabel={t('runtimeConfig.machineLocalAIConfigurations.moreActions')}
                items={[
                  {
                    id: 'refresh-requirements',
                    label: t('runtimeConfig.machineLocalAIConfigurations.refreshRequirements'),
                    disabled: anyBusy,
                    onSelect: () => props.onReproject(configuration),
                  },
                  {
                    id: 'delete',
                    label: t('runtimeConfig.machineLocalAIConfigurations.delete'),
                    tone: 'danger',
                    disabled: anyBusy,
                    onSelect: () => props.onRequestDelete(configuration, props.selected),
                  },
                ]}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {isMachineLocalLlamaConfiguration(configuration) ? (
        <details className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.contextCapacityAdvanced')}
          </summary>
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.contextCapacityBody')}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
              <span>{t('runtimeConfig.machineLocalAIConfigurations.contextCapacityMode')}</span>
              <SelectField
                value={contextCapacityMode}
                disabled={anyBusy}
                options={[
                  { value: 'auto', label: t('runtimeConfig.machineLocalAIConfigurations.contextCapacityAuto') },
                  { value: 'fixed', label: t('runtimeConfig.machineLocalAIConfigurations.contextCapacityFixed') },
                ]}
                onValueChange={(value) => setContextCapacityMode(value as 'auto' | 'fixed')}
                data-testid={`machine-local-context-capacity-mode:${configuration.configurationId}`}
              />
            </div>
            {contextCapacityMode === 'fixed' ? (
              <label className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
                <span>{t('runtimeConfig.machineLocalAIConfigurations.contextCapacityTokens')}</span>
                <TextField
                  type="number"
                  min={1}
                  step={1}
                  value={contextCapacityInput}
                  disabled={anyBusy}
                  onChange={(event) => setContextCapacityInput(event.currentTarget.value)}
                  data-testid={`machine-local-context-capacity-value:${configuration.configurationId}`}
                />
              </label>
            ) : <div />}
            <Button
              size="sm"
              tone="primary"
              disabled={anyBusy || (contextCapacityMode === 'fixed' && !fixedContextCapacityValid)}
              onClick={() => props.onUpdateContextCapacity(
                configuration,
                contextCapacityMode === 'auto' ? undefined : parsedContextCapacity,
              )}
            >
              {t('runtimeConfig.machineLocalAIConfigurations.contextCapacitySave')}
            </Button>
          </div>
        </details>
      ) : null}

      {isMachineLocalStableDiffusionVideoConfiguration(configuration) ? (
        <details
          className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-3"
          data-testid={`machine-local-video-recipe:${configuration.configurationId}`}
        >
          <summary className="cursor-pointer text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.videoRecipe')}
          </summary>
          <p className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.videoRecipeBody')}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['cfgScale', 'flowShift'] as const).map((key) => (
              <label key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{t(`runtimeConfig.machineLocalAIConfigurations.videoExecution.${key}`)}</span>
                <TextField
                  type="number"
                  min={0}
                  step="0.1"
                  value={videoRecipeDraft[key]}
                  disabled={anyBusy}
                  onChange={(event) => setVideoRecipeDraft({
                    ...videoRecipeDraft,
                    [key]: event.currentTarget.value,
                  })}
                />
              </label>
            ))}
            {(['sampleMethod', 'scheduler'] as const).map((key) => (
              <label key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{t(`runtimeConfig.machineLocalAIConfigurations.videoExecution.${key}`)}</span>
                <TextField
                  value={videoRecipeDraft[key]}
                  disabled={anyBusy}
                  onChange={(event) => setVideoRecipeDraft({
                    ...videoRecipeDraft,
                    [key]: event.currentTarget.value,
                  })}
                />
              </label>
            ))}
            {(['diffusionFlashAttention', 'offloadParamsToCPU'] as const).map((key) => (
              <div key={key} className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{t(`runtimeConfig.machineLocalAIConfigurations.videoExecution.${key}`)}</span>
                <SelectField
                  value={String(videoRecipeDraft[key])}
                  disabled={anyBusy}
                  options={[
                    { value: 'true', label: t('runtimeConfig.machineLocalAIConfigurations.enabled') },
                    { value: 'false', label: t('runtimeConfig.machineLocalAIConfigurations.disabled') },
                  ]}
                  onValueChange={(value) => setVideoRecipeDraft({
                    ...videoRecipeDraft,
                    [key]: value === 'true',
                  })}
                />
              </div>
            ))}
            <div className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
              <span>{t('runtimeConfig.machineLocalAIConfigurations.videoExecution.rng')}</span>
              <SelectField
                value={videoRecipeDraft.rng}
                disabled={anyBusy}
                options={(['cpu', 'cuda', 'std_default'] as const).map((value) => ({ value, label: value }))}
                onValueChange={(value) => setVideoRecipeDraft({
                  ...videoRecipeDraft,
                  rng: value as typeof videoRecipeDraft.rng,
                })}
              />
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                tone="primary"
                disabled={anyBusy || !parsedVideoRecipe}
                onClick={() => {
                  if (parsedVideoRecipe) props.onUpdateVideoRecipe(configuration, parsedVideoRecipe);
                }}
              >
                {t('runtimeConfig.machineLocalAIConfigurations.videoRecipeSave')}
              </Button>
            </div>
          </div>
        </details>
      ) : null}

      <div className="space-y-2">
        <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.requirementsTitle')}
        </h5>
        {configuration.projectedRequirements.length === 0 ? (
          <p className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.requirementsUnavailable')}
          </p>
        ) : groupMachineLocalCapabilityRequirements(configuration.projectedRequirements).map((group) => (
          <section
            key={`${group.role}:${group.occurrenceOrdinal}`}
            className="space-y-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3"
            data-testid={`machine-local-ai-requirement-group:${group.role}:${group.occurrenceOrdinal}`}
          >
            <h6 className="text-xs font-semibold text-[var(--nimi-text-muted)]">
              {machineLocalRequirementGroupDisplay(group.role, group.occurrenceOrdinal, t)}
            </h6>
            {group.requirements.map((requirement) => (
              <MachineLocalAIRequirementRow
                key={requirement.requirementId}
                configuration={configuration}
                requirement={requirement}
                assets={props.assets}
                anyBusy={anyBusy}
                onBind={props.onBind}
                onUnbind={props.onUnbind}
              />
            ))}
          </section>
        ))}
      </div>
    </Surface>
  );
}

function MachineLocalAIRequirementRow(props: {
  readonly configuration: NimiMachineLocalCapabilityConfiguration;
  readonly requirement: NimiMachineLocalCapabilityRequirement;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly anyBusy: boolean;
  readonly onBind: MachineLocalAIBindHandler;
  readonly onUnbind: MachineLocalAIConfigurationCardUnbindHandler;
}) {
  const { t } = useTranslation();
  const currentBinding = props.configuration.exactBindings.find(
    (binding) => binding.requirementId === props.requirement.requirementId,
  );
  const compatibleAssets = compatibleMachineLocalAssets(props.requirement, props.assets);
  const currentAsset = currentBinding
    ? props.assets.find((asset) => asset.localAssetId === currentBinding.localAssetId)
    : undefined;
  return (
    <div
      className="grid gap-3 rounded-lg bg-[var(--nimi-surface-subtle)] p-3 lg:grid-cols-[minmax(160px,0.8fr)_minmax(240px,1.4fr)_auto] lg:items-end"
      data-testid={`machine-local-ai-requirement:${props.requirement.requirementId}`}
    >
      <div>
        <div className="text-sm font-medium text-[var(--nimi-text-primary)]">
          {props.requirement.displayLabel}
        </div>
        <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {currentBinding
            ? t('runtimeConfig.machineLocalAIConfigurations.bound')
            : t('runtimeConfig.machineLocalAIConfigurations.fileNeeded')}
          {currentBinding ? ` · ${machineLocalAssetDisplayName(currentAsset, t, true)}` : ''}
        </div>
      </div>
      <SelectField
        aria-label={props.requirement.displayLabel}
        value={currentBinding?.localAssetId ?? ''}
        disabled={props.anyBusy || compatibleAssets.length === 0}
        placeholder={compatibleAssets.length > 0
          ? t('runtimeConfig.machineLocalAIConfigurations.chooseFilePlaceholder')
          : t('runtimeConfig.machineLocalAIConfigurations.noCompatibleFiles')}
        options={compatibleAssets.map((asset) => ({
          value: asset.localAssetId,
          label: machineLocalAssetDisplayName(asset, t),
        }))}
        onValueChange={(localAssetId) => {
          if (!localAssetId || localAssetId === currentBinding?.localAssetId) return;
          props.onBind(props.configuration, props.requirement, currentBinding, localAssetId);
        }}
        data-testid={`machine-local-ai-requirement-bind:${props.requirement.requirementId}`}
      />
      {currentBinding ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            tone="ghost"
            disabled={props.anyBusy}
            onClick={() => props.onUnbind(props.configuration, props.requirement, currentBinding)}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.unbind')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type MachineLocalAIConfigurationCardUnbindHandler = (
  configuration: NimiMachineLocalCapabilityConfiguration,
  requirement: NimiMachineLocalCapabilityRequirement,
  currentBinding: NimiMachineLocalAssetExactBinding,
) => void;

export function MachineLocalAIDeleteConfirmDialog(props: {
  readonly open: boolean;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={props.open}
      title={t('runtimeConfig.machineLocalAIConfigurations.deleteDialogTitle')}
      message={props.selected
        ? t('runtimeConfig.machineLocalAIConfigurations.deleteSelectedPrompt')
        : t('runtimeConfig.machineLocalAIConfigurations.deletePrompt')}
      confirmLabel={t('runtimeConfig.machineLocalAIConfigurations.confirmDelete')}
      cancelLabel={t('runtimeConfig.machineLocalAIConfigurations.cancel')}
      confirmTone="danger"
      pending={props.busy}
      onConfirm={props.onConfirm}
      onClose={props.onCancel}
    />
  );
}

export function MachineLocalAIImpactDialog(props: {
  readonly confirmation: RuntimeConfigMachineLocalAIImpactConfirmation;
  readonly mutationBusy: boolean;
  readonly onConfirm: (requestId: string) => void;
  readonly onCancel: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <OverlayShell
      open
      kind="dialog"
      size="S"
      title={t('runtimeConfig.machineLocalAIConfigurations.impactTitle')}
      onClose={() => props.onCancel(props.confirmation.request.requestId)}
    >
      <MachineLocalAIImpactDialogContent
        confirmation={props.confirmation}
        mutationBusy={props.mutationBusy}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
      />
    </OverlayShell>
  );
}

/**
 * Dialog body kept separate from the overlay shell so unit tests can render
 * the impact summary without a DOM portal host.
 */
export function MachineLocalAIImpactDialogContent(props: {
  readonly confirmation: RuntimeConfigMachineLocalAIImpactConfirmation;
  readonly mutationBusy: boolean;
  readonly onConfirm: (requestId: string) => void;
  readonly onCancel: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  const { confirmation } = props;
  const requestId = confirmation.request.requestId;
  const impact = confirmation.impact;
  const impactBodyKey = machineLocalAIImpactBodyKey(confirmation.request.capabilityContract);
  return (
    <div
      className="py-2"
      data-testid="machine-local-ai-impact-confirmation"
      data-operation={confirmation.request.operation}
    >
      {confirmation.status === 'loading' ? (
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.impactLoading')}
        </p>
      ) : confirmation.status === 'failed' ? (
        <InlineAlert tone="danger">
          {t('runtimeConfig.machineLocalAIConfigurations.impactFailed')}
        </InlineAlert>
      ) : impact ? (
        <>
          <p className="text-sm text-[var(--nimi-text-secondary)]">
            {t(`runtimeConfig.machineLocalAIConfigurations.${impactBodyKey}`)}
          </p>
          {impact.affectedOwners.length > 0 ? (
            <ul className="mt-3 grid gap-2" data-testid="machine-local-ai-impact-owner-list">
              {impact.affectedOwners.map((owner) => (
                <li
                  key={`${owner.kind}:${owner.ownerId}`}
                  className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)]"
                >
                  {owner.kind === 'shared-local-agent'
                    ? t('runtimeConfig.machineLocalAIConfigurations.impactSharedLocalAgent')
                    : t('runtimeConfig.machineLocalAIConfigurations.impactLocalApp')}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.machineLocalAIConfigurations.impactNoOwners')}
            </p>
          )}
          <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.impactRequiresConfirmation')}
          </p>
        </>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {confirmation.status === 'ready' && impact ? (
          <Button
            size="sm"
            tone={confirmation.request.operation === 'delete' ? 'danger' : 'primary'}
            disabled={props.mutationBusy}
            onClick={() => props.onConfirm(requestId)}
            data-testid="machine-local-ai-impact-confirm"
          >
            {t(`runtimeConfig.machineLocalAIConfigurations.impactConfirm.${confirmation.request.operation}`)}
          </Button>
        ) : null}
        <Button
          size="sm"
          tone="ghost"
          disabled={props.mutationBusy}
          onClick={() => props.onCancel(requestId)}
        >
          {t('runtimeConfig.machineLocalAIConfigurations.cancel')}
        </Button>
      </div>
    </div>
  );
}
