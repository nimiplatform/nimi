import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  createNimiMachineLocalLlamaCppEmbedConfigurationInput,
  createNimiMachineLocalLlamaCppTextConfigurationInput,
  createNimiMachineLocalQwen3ASRConfigurationInput,
  createNimiMachineLocalQwen3ASRTransformersConfigurationInput,
  createNimiMachineLocalQwen3TTSConfigurationInput,
  loadNimiMachineLocalAIConfigurationImpact,
  type NimiMachineLocalAIConfiguration,
  type NimiMachineLocalAssetExactBinding,
  type NimiMachineLocalCapabilityConfiguration,
  type NimiMachineLocalCapabilityRequirement,
  type NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  Surface,
  nimiToast,
} from '@nimiplatform/kit/ui';
import { ModelConfigOwnerBoundary } from '@nimiplatform/kit/features/model-config';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { createRuntimeAgentAIConfigAdapter } from '../../infra/runtime-agent-ai-config.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import {
  INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  machineLocalConfigurationFileState,
  reduceRuntimeConfigMachineLocalAIState,
  runtimeConfigMachineLocalAIImpactCommitAllowed,
  createRuntimeConfigMachineLocalAIAddDraft,
  type RuntimeConfigMachineLocalAIAddDraft,
  type RuntimeConfigMachineLocalAIImpactConfirmation,
  type RuntimeConfigMachineLocalAIImpactRequest,
  type RuntimeConfigMachineLocalAIVideoExecutionOptions,
} from './runtime-config-machine-local-ai-state.js';
import {
  MACHINE_LOCAL_AI_CAPABILITY_PRODUCT_ORDER,
  displayMachineLocalConfigurationName,
  orderMachineLocalCapabilityContracts,
} from './runtime-config-machine-local-ai-display.js';
import {
  MachineLocalAIAddDrawer,
  createMachineLocalImageConfigurationInput,
  createVideoConfigurationInput,
} from './runtime-config-machine-local-ai-add-drawer.js';
import {
  MachineLocalAIConfigurationCard,
  MachineLocalAIDeleteConfirmDialog,
  MachineLocalAIImpactDialog,
} from './runtime-config-machine-local-ai-card.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';

export { createVideoConfigurationInput };

type MachineLocalAIFeedback = {
  readonly tone: 'info' | 'danger';
  readonly message: string;
};

const MACHINE_LOCAL_MODEL_CONFIG_CONTEXT = {
  owner: 'machine-local-ai-configuration',
  consumer: 'nimi-first-party',
} as const;

export type MachineLocalAIConfigurationsViewProps = {
  readonly aggregate: NimiMachineLocalAIConfiguration | null;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly loading: boolean;
  readonly loadTechnicalError: string;
  readonly busyAction: string;
  readonly feedback: MachineLocalAIFeedback | null;
  readonly showAddForm: boolean;
  readonly addDraft: RuntimeConfigMachineLocalAIAddDraft;
  readonly impactConfirmation: RuntimeConfigMachineLocalAIImpactConfirmation | null;
  readonly deleteConfirmationId: string;
  readonly onRefresh: () => void;
  readonly onShowAddForm: () => void;
  readonly onHideAddForm: () => void;
  readonly onAddDraftChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
  readonly onAdd: () => void;
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
  readonly onBind: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding | undefined,
    localAssetId: string,
  ) => void;
  readonly onUnbind: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding,
  ) => void;
  readonly onRequestDelete: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    selected: boolean,
  ) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (configuration: NimiMachineLocalCapabilityConfiguration) => void;
  readonly onConfirmImpact: (requestId: string) => void;
  readonly onCancelImpact: (requestId: string) => void;
};

export function MachineLocalAIConfigurationsPage() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const client = useMemo(
    () => sdk.machineProduct().local.aiConfiguration,
    [sdk],
  );
  const subjectUserId = useAppStore((appState) => String(appState.auth.user?.id ?? '').trim());
  const sharedLocalAgentAIConfig = useMemo(() => createRuntimeAgentAIConfigAdapter({
    runtime: {
      get appId() { return sdk.appId(); },
      get auth() { return sdk.accountRuntime().auth; },
      get agent() { return sdk.accountProduct().agents; },
    },
    getSubjectUserId: () => subjectUserId,
    withScopes: sdk.withRuntimeProtectedScopes,
  }), [sdk, subjectUserId]);
  const [state, dispatch] = useReducer(
    reduceRuntimeConfigMachineLocalAIState,
    INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  );
  const [feedback, setFeedback] = useState<MachineLocalAIFeedback | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState(createRuntimeConfigMachineLocalAIAddDraft);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState('');
  const impactRequestSequence = useRef(0);
  const pendingImpactOperation = useRef<{
    readonly requestId: string;
    readonly run: () => void;
  } | null>(null);

  const refresh = useCallback(async () => {
    dispatch({ type: 'load-started' });
    try {
      const [aggregate, assets] = await Promise.all([
        client.get(),
        client.listLocalAssets(),
      ]);
      dispatch({ type: 'load-succeeded', aggregate, assets });
    } catch (error) {
      dispatch({ type: 'load-failed', technicalError: technicalErrorDetail(error) });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMutation = useCallback(async <T,>(input: {
    readonly key: string;
    readonly operation: () => Promise<T>;
    readonly commit: (result: T) => void;
    readonly successMessage: string;
    readonly failureMessage: string;
  }) => {
    if (busyAction) return;
    setBusyAction(input.key);
    setFeedback(null);
    try {
      const result = await input.operation();
      input.commit(result);
      nimiToast.success(input.successMessage);
    } catch {
      setFeedback({ tone: 'danger', message: input.failureMessage });
    } finally {
      setBusyAction('');
    }
  }, [busyAction]);

  const addConfiguration = useCallback(() => {
    const displayName = addDraft.displayName.trim();
    if (!displayName) {
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.machineLocalAIConfigurations.displayNameRequired'),
      });
      return;
    }
    try {
      const input = addDraft.capabilityContract === NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT
        ? createNimiMachineLocalLlamaCppTextConfigurationInput({
          displayName,
          acceptsImageInput: addDraft.acceptsImageInput,
        })
        : addDraft.capabilityContract === NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT
          ? createNimiMachineLocalLlamaCppEmbedConfigurationInput({ displayName })
          : addDraft.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT
            ? createNimiMachineLocalQwen3TTSConfigurationInput({ displayName })
            : addDraft.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT
              ? addDraft.asrDriverKind === 'qwen3-asr-transformers'
                ? createNimiMachineLocalQwen3ASRTransformersConfigurationInput({ displayName })
                : createNimiMachineLocalQwen3ASRConfigurationInput({ displayName })
              : addDraft.capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT
                ? createVideoConfigurationInput(addDraft, state.assets, displayName)
                : createMachineLocalImageConfigurationInput(addDraft, state.assets, displayName);
      void runMutation({
        key: 'add',
        operation: () => client.addConfiguration(input),
        commit: (configuration) => {
          dispatch({ type: 'configuration-committed', configuration });
          setAddDraft(createRuntimeConfigMachineLocalAIAddDraft());
          setShowAddForm(false);
        },
        successMessage: t('runtimeConfig.machineLocalAIConfigurations.addSuccess'),
        failureMessage: t('runtimeConfig.machineLocalAIConfigurations.addFailed'),
      });
    } catch {
      setFeedback({
        tone: 'danger',
        message: t(addDraft.capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT
          ? 'runtimeConfig.machineLocalAIConfigurations.videoFormInvalid'
          : 'runtimeConfig.machineLocalAIConfigurations.imageFormInvalid'),
      });
    }
  }, [addDraft, client, runMutation, state.assets, t]);

  const commitSelectConfiguration = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
    void runMutation({
      key: `select:${configuration.configurationId}`,
      operation: () => client.select(
        configuration.capabilityContract,
        configuration.configurationId,
      ),
      commit: (selection) => dispatch({ type: 'selection-committed', selection }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.selectSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.selectFailed'),
    });
  }, [client, runMutation, t]);

  const clearSelection = useCallback((capabilityContract: string) => {
    void runMutation({
      key: `clear:${capabilityContract}`,
      operation: () => client.clearSelection(capabilityContract),
      commit: () => dispatch({ type: 'selection-cleared', capabilityContract }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.clearSuccess', {
        capability: capabilityContract,
      }),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.clearFailed'),
    });
  }, [client, runMutation, t]);

  const commitReprojectRequirements = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
    void runMutation({
      key: `reproject:${configuration.configurationId}`,
      operation: () => client.reprojectRequirements(configuration.configurationId),
      commit: (next) => dispatch({ type: 'configuration-committed', configuration: next }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.reprojectSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.reprojectFailed'),
    });
  }, [client, runMutation, t]);

  const commitUpdateContextCapacity = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    contextSize: number | undefined,
  ) => {
    const portableConfig = { ...(configuration.portableConfig ?? {}) };
    if (contextSize === undefined) {
      delete portableConfig.contextSize;
    } else {
      portableConfig.contextSize = contextSize;
    }
    void runMutation({
      key: `context-capacity:${configuration.configurationId}`,
      operation: () => client.updateConfiguration({
        configurationId: configuration.configurationId,
        portableConfig,
        supportedFeatures: configuration.supportedFeatures,
        displayName: configuration.displayName,
        provenance: configuration.provenance,
      }),
      commit: (next) => dispatch({ type: 'configuration-committed', configuration: next }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.contextCapacityUpdateSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.contextCapacityUpdateFailed'),
    });
  }, [client, runMutation, t]);

  const commitUpdateVideoRecipe = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    executionOptions: RuntimeConfigMachineLocalAIVideoExecutionOptions,
  ) => {
    const portableConfig = {
      ...(configuration.portableConfig ?? {}),
      executionOptions: { ...executionOptions },
    };
    void runMutation({
      key: `video-recipe:${configuration.configurationId}`,
      operation: () => client.updateConfiguration({
        configurationId: configuration.configurationId,
        portableConfig,
        supportedFeatures: configuration.supportedFeatures,
        displayName: configuration.displayName,
        provenance: configuration.provenance,
      }),
      commit: (next) => dispatch({ type: 'configuration-committed', configuration: next }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.videoRecipeUpdateSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.videoRecipeUpdateFailed'),
    });
  }, [client, runMutation, t]);

  const commitBindRequirement = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding | undefined,
    localAssetId: string,
  ) => {
    if (currentBinding?.localAssetId === localAssetId) return;
    const asset = state.assets.find((item) => item.localAssetId === localAssetId);
    if (!asset?.expectedVerifiedContentId) {
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.machineLocalAIConfigurations.chooseFileFirst'),
      });
      return;
    }
    const target = {
      localAssetId: asset.localAssetId,
      expectedVerifiedContentId: asset.expectedVerifiedContentId,
    };
    void runMutation({
      key: `${currentBinding ? 'rebind' : 'bind'}:${configuration.configurationId}:${requirement.requirementId}`,
      operation: () => currentBinding
        ? client.rebindRequirement({
          configurationId: configuration.configurationId,
          requirementId: requirement.requirementId,
          expectedCurrentBinding: currentBinding,
          target,
        })
        : client.bindRequirement({
          configurationId: configuration.configurationId,
          requirementId: requirement.requirementId,
          target,
        }),
      commit: (next) => dispatch({ type: 'configuration-committed', configuration: next }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.bindingSuccess'),
      failureMessage: t(`runtimeConfig.machineLocalAIConfigurations.${currentBinding ? 'rebindFailed' : 'bindFailed'}`),
    });
  }, [client, runMutation, state.assets, t]);

  const commitUnbindRequirement = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding,
  ) => {
    void runMutation({
      key: `unbind:${configuration.configurationId}:${requirement.requirementId}`,
      operation: () => client.unbindRequirement({
        configurationId: configuration.configurationId,
        requirementId: requirement.requirementId,
        expectedCurrentBinding: currentBinding,
      }),
      commit: (next) => dispatch({ type: 'configuration-committed', configuration: next }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.unbindSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.unbindFailed'),
    });
  }, [client, runMutation, t]);

  const commitDeleteConfiguration = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
    void runMutation({
      key: `delete:${configuration.configurationId}`,
      operation: () => client.deleteConfiguration(configuration.configurationId),
      commit: () => {
        dispatch({ type: 'configuration-deleted', configurationId: configuration.configurationId });
        setDeleteConfirmationId('');
      },
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.deleteSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.deleteFailed'),
    });
  }, [client, runMutation, t]);

  const isSelectedConfiguration = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
  ) => state.aggregate?.selections.some((selection) => (
    selection.capabilityContract === configuration.capabilityContract
    && selection.configurationId === configuration.configurationId
  )) === true, [state.aggregate]);

  const requestImpactConfirmation = useCallback((
    operation: RuntimeConfigMachineLocalAIImpactRequest['operation'],
    configuration: NimiMachineLocalCapabilityConfiguration,
    run: () => void,
  ) => {
    if (busyAction || pendingImpactOperation.current) return;
    impactRequestSequence.current += 1;
    const request: RuntimeConfigMachineLocalAIImpactRequest = {
      requestId: `impact-${impactRequestSequence.current}`,
      operation,
      configurationId: configuration.configurationId,
      capabilityContract: configuration.capabilityContract,
    };
    pendingImpactOperation.current = { requestId: request.requestId, run };
    setDeleteConfirmationId('');
    setFeedback(null);
    dispatch({ type: 'impact-confirmation-requested', request });
    void loadNimiMachineLocalAIConfigurationImpact({
      operation,
      capabilityContract: configuration.capabilityContract,
      configurationId: configuration.configurationId,
      machine: client,
      aiConfigs: [
        sdk.accountProduct().aiConfig,
        {
          async get() {
            if (!subjectUserId) {
              throw new Error('Authenticated account context is required to derive shared LocalAgent impact.');
            }
            return (await sharedLocalAgentAIConfig.get({ subjectUserId })).aiConfig;
          },
        },
      ],
    }).then((impact) => {
      dispatch({ type: 'impact-load-succeeded', requestId: request.requestId, impact });
    }).catch((error) => {
      dispatch({
        type: 'impact-load-failed',
        requestId: request.requestId,
        technicalError: technicalErrorDetail(error),
      });
    });
  }, [busyAction, client, sdk, sharedLocalAgentAIConfig, subjectUserId]);

  useEffect(() => {
    const pending = state.impactConfirmation;
    if (!pending || !runtimeConfigMachineLocalAIImpactCommitAllowed(state, pending.request.requestId)) {
      return;
    }
    const operation = pendingImpactOperation.current;
    if (!operation || operation.requestId !== pending.request.requestId) return;
    pendingImpactOperation.current = null;
    dispatch({ type: 'impact-confirmation-cleared', requestId: pending.request.requestId });
    operation.run();
  }, [state]);

  const cancelImpactConfirmation = useCallback((requestId: string) => {
    if (pendingImpactOperation.current?.requestId === requestId) {
      pendingImpactOperation.current = null;
    }
    dispatch({ type: 'impact-confirmation-cleared', requestId });
  }, []);

  const selectConfiguration = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
    requestImpactConfirmation('select', configuration, () => commitSelectConfiguration(configuration));
  }, [commitSelectConfiguration, requestImpactConfirmation]);

  const reprojectRequirements = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
    if (isSelectedConfiguration(configuration)) {
      requestImpactConfirmation('update', configuration, () => commitReprojectRequirements(configuration));
      return;
    }
    commitReprojectRequirements(configuration);
  }, [commitReprojectRequirements, isSelectedConfiguration, requestImpactConfirmation]);

  const updateContextCapacity = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    contextSize: number | undefined,
  ) => {
    if (isSelectedConfiguration(configuration)) {
      requestImpactConfirmation('update', configuration, () => (
        commitUpdateContextCapacity(configuration, contextSize)
      ));
      return;
    }
    commitUpdateContextCapacity(configuration, contextSize);
  }, [commitUpdateContextCapacity, isSelectedConfiguration, requestImpactConfirmation]);

  const updateVideoRecipe = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    executionOptions: RuntimeConfigMachineLocalAIVideoExecutionOptions,
  ) => {
    if (isSelectedConfiguration(configuration)) {
      requestImpactConfirmation('update', configuration, () => (
        commitUpdateVideoRecipe(configuration, executionOptions)
      ));
      return;
    }
    commitUpdateVideoRecipe(configuration, executionOptions);
  }, [commitUpdateVideoRecipe, isSelectedConfiguration, requestImpactConfirmation]);

  const bindRequirement = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding | undefined,
    localAssetId: string,
  ) => {
    if (isSelectedConfiguration(configuration)) {
      requestImpactConfirmation('update', configuration, () => (
        commitBindRequirement(configuration, requirement, currentBinding, localAssetId)
      ));
      return;
    }
    commitBindRequirement(configuration, requirement, currentBinding, localAssetId);
  }, [commitBindRequirement, isSelectedConfiguration, requestImpactConfirmation]);

  const unbindRequirement = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding,
  ) => {
    if (isSelectedConfiguration(configuration)) {
      requestImpactConfirmation('update', configuration, () => (
        commitUnbindRequirement(configuration, requirement, currentBinding)
      ));
      return;
    }
    commitUnbindRequirement(configuration, requirement, currentBinding);
  }, [commitUnbindRequirement, isSelectedConfiguration, requestImpactConfirmation]);

  const requestDeleteConfiguration = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    selected: boolean,
  ) => {
    if (selected) {
      requestImpactConfirmation('delete', configuration, () => commitDeleteConfiguration(configuration));
      return;
    }
    setDeleteConfirmationId(configuration.configurationId);
  }, [commitDeleteConfiguration, requestImpactConfirmation]);

  return (
    <MachineLocalAIConfigurationsView
      aggregate={state.aggregate}
      assets={state.assets}
      loading={state.loading}
      loadTechnicalError={state.technicalError}
      busyAction={busyAction}
      feedback={feedback}
      showAddForm={showAddForm}
      addDraft={addDraft}
      impactConfirmation={state.impactConfirmation}
      deleteConfirmationId={deleteConfirmationId}
      onRefresh={() => { void refresh(); }}
      onShowAddForm={() => setShowAddForm(true)}
      onHideAddForm={() => setShowAddForm(false)}
      onAddDraftChange={setAddDraft}
      onAdd={addConfiguration}
      onSelect={selectConfiguration}
      onClearSelection={clearSelection}
      onReproject={reprojectRequirements}
      onUpdateContextCapacity={updateContextCapacity}
      onUpdateVideoRecipe={updateVideoRecipe}
      onBind={bindRequirement}
      onUnbind={unbindRequirement}
      onRequestDelete={requestDeleteConfiguration}
      onCancelDelete={() => setDeleteConfirmationId('')}
      onConfirmDelete={commitDeleteConfiguration}
      onConfirmImpact={(requestId) => dispatch({ type: 'impact-explicitly-confirmed', requestId })}
      onCancelImpact={cancelImpactConfirmation}
    />
  );
}

export function MachineLocalAIConfigurationsView(
  props: MachineLocalAIConfigurationsViewProps,
) {
  const { t } = useTranslation();
  const configurations = props.aggregate?.configurations ?? [];
  const selections = props.aggregate?.selections ?? [];
  const capabilityContracts = orderMachineLocalCapabilityContracts([
    ...MACHINE_LOCAL_AI_CAPABILITY_PRODUCT_ORDER,
    ...configurations.map((configuration) => configuration.capabilityContract),
    ...selections.map((selection) => selection.capabilityContract),
  ]);
  const anyBusy = Boolean(props.busyAction) || props.loading || Boolean(props.impactConfirmation);
  const deleteTarget = configurations.find(
    (configuration) => configuration.configurationId === props.deleteConfirmationId,
  );

  return (
    <ModelConfigOwnerBoundary context={MACHINE_LOCAL_MODEL_CONFIG_CONTEXT}>
      <RuntimePageShell>
      <div
        className="flex flex-wrap items-start justify-between gap-3"
        data-testid="machine-local-ai-configurations-header"
      >
        <div className="max-w-3xl">
          <h3 className="text-base font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.title')}
          </h3>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            tone="secondary"
            disabled={anyBusy}
            onClick={props.onRefresh}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.refresh')}
          </Button>
          <Button
            size="sm"
            tone="primary"
            disabled={anyBusy}
            onClick={props.onShowAddForm}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.add')}
          </Button>
        </div>
      </div>

      {props.feedback ? (
        <div data-testid="machine-local-ai-configurations-feedback">
          <InlineAlert tone={props.feedback.tone}>{props.feedback.message}</InlineAlert>
        </div>
      ) : null}

      {props.loading && !props.aggregate ? (
        <div className="space-y-4" data-testid="machine-local-ai-configurations-loading">
          {[0, 1].map((index) => (
            <Surface key={index} tone="card" className="p-5">
              <LoadingSkeleton lines={3} />
            </Surface>
          ))}
        </div>
      ) : null}

      {!props.loading && props.loadTechnicalError ? (
        <div data-testid="machine-local-ai-configurations-load-error">
          <InlineAlert tone="danger">
            {t('runtimeConfig.machineLocalAIConfigurations.loadFailed')}
          </InlineAlert>
        </div>
      ) : null}

      {props.aggregate ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="machine-local-ai-selection-summary">
          <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.selectionTitle')}
          </h4>
          <div className="space-y-2">
            {capabilityContracts.map((capabilityContract) => {
              const selection = selections.find(
                (item) => item.capabilityContract === capabilityContract,
              );
              const selectedConfiguration = configurations.find(
                (configuration) => configuration.configurationId === selection?.configurationId,
              );
              const selectedFileState = selectedConfiguration
                ? machineLocalConfigurationFileState(selectedConfiguration)
                : null;
              return (
                <div
                  key={capabilityContract}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-3 py-2"
                  data-testid={`machine-local-ai-selection-row:${capabilityContract}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-secondary)]">
                    <span className="font-semibold text-[var(--nimi-text-primary)]">
                      {displayRuntimeConfigCapabilityLabel(capabilityContract, t)}
                    </span>
                    <span>
                      {selectedConfiguration
                        ? displayMachineLocalConfigurationName(selectedConfiguration, t)
                        : t('runtimeConfig.machineLocalAIConfigurations.noSelection')}
                    </span>
                    {selectedFileState ? (
                      <StatusBadge
                        tone={selectedFileState === 'configured' ? 'success' : 'warning'}
                        shape="soft"
                      >
                        {t(`runtimeConfig.machineLocalAIConfigurations.${selectedFileState === 'configured' ? 'configured' : 'filesNeeded'}`)}
                      </StatusBadge>
                    ) : null}
                  </div>
                  {selection ? (
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={anyBusy}
                      onClick={() => props.onClearSelection(capabilityContract)}
                    >
                      {t('runtimeConfig.machineLocalAIConfigurations.clearSelection')}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.selectionDoesNotCheck')}
          </p>
        </Surface>
      ) : null}

      {props.aggregate && configurations.length === 0 ? (
        <EmptyState
          data-testid="machine-local-ai-configurations-empty-info"
          title={t('runtimeConfig.machineLocalAIConfigurations.emptyTitle')}
          description={t('runtimeConfig.machineLocalAIConfigurations.emptyBody')}
          action={(
            <Button size="sm" tone="primary" disabled={anyBusy} onClick={props.onShowAddForm}>
              {t('runtimeConfig.machineLocalAIConfigurations.add')}
            </Button>
          )}
        />
      ) : null}

      {configurations.map((configuration) => (
        <MachineLocalAIConfigurationCard
          key={configuration.configurationId}
          configuration={configuration}
          assets={props.assets}
          selected={selections.some((selection) => (
            selection.capabilityContract === configuration.capabilityContract
            && selection.configurationId === configuration.configurationId
          ))}
          busy={anyBusy}
          onSelect={props.onSelect}
          onClearSelection={props.onClearSelection}
          onReproject={props.onReproject}
          onUpdateContextCapacity={props.onUpdateContextCapacity}
          onUpdateVideoRecipe={props.onUpdateVideoRecipe}
          onBind={props.onBind}
          onUnbind={props.onUnbind}
          onRequestDelete={props.onRequestDelete}
        />
      ))}

      <MachineLocalAIAddDrawer
        open={props.showAddForm}
        draft={props.addDraft}
        assets={props.assets}
        busy={anyBusy}
        onChange={props.onAddDraftChange}
        onCancel={props.onHideAddForm}
        onAdd={props.onAdd}
      />

      <MachineLocalAIDeleteConfirmDialog
        open={Boolean(deleteTarget)}
        selected={deleteTarget ? selections.some((selection) => (
          selection.configurationId === deleteTarget.configurationId
        )) : false}
        busy={Boolean(props.busyAction)}
        onConfirm={() => {
          if (deleteTarget) props.onConfirmDelete(deleteTarget);
        }}
        onCancel={props.onCancelDelete}
      />

      {props.impactConfirmation ? (
        <MachineLocalAIImpactDialog
          confirmation={props.impactConfirmation}
          mutationBusy={Boolean(props.busyAction)}
          onConfirm={props.onConfirmImpact}
          onCancel={props.onCancelImpact}
        />
      ) : null}
      </RuntimePageShell>
    </ModelConfigOwnerBoundary>
  );
}

function technicalErrorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error || 'Unknown error');
  }
  const shaped = error as {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly reasonCode?: unknown;
    readonly actionHint?: unknown;
    readonly details?: unknown;
  };
  const summary = {
    name: String(shaped.name || 'Error'),
    message: String(shaped.message || 'Unknown error'),
    reasonCode: shaped.reasonCode ?? null,
    actionHint: shaped.actionHint ?? null,
    details: shaped.details ?? null,
  };
  try {
    return JSON.stringify(summary, null, 2);
  } catch {
    return `${summary.name}: ${summary.message}`;
  }
}
