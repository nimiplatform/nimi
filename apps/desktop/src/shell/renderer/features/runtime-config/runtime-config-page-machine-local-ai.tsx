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
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_MODEL_FAMILIES,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_SLOT_DESCRIPTORS,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  createNimiMachineLocalLlamaCppTextConfigurationInput,
  createNimiMachineLocalStableDiffusionImageConfigurationInput,
  createNimiMachineLocalStableDiffusionVideoConfigurationInput,
  loadNimiMachineLocalAIConfigurationImpact,
  type NimiMachineLocalAIConfiguration,
  type NimiMachineLocalAssetExactBinding,
  type NimiMachineLocalCapabilityConfiguration,
  type NimiMachineLocalCapabilityRequirement,
  type NimiMachineLocalStableDiffusionSlotDescriptor,
  type NimiMachineLocalStableDiffusionSlotId,
  type NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  InlineAlert,
  Surface,
  TextField,
} from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { createRuntimeAgentAIConfigAdapter } from '../../infra/runtime-agent-ai-config.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import {
  INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  RUNTIME_CONFIG_MACHINE_LOCAL_VIDEO_SLOT_IDS,
  compatibleMachineLocalAssets,
  createRuntimeConfigMachineLocalAIAddDraft,
  groupMachineLocalCapabilityRequirements,
  machineLocalConfigurationFileState,
  moveRuntimeConfigMachineLocalAILoRA,
  reduceRuntimeConfigMachineLocalAIState,
  runtimeConfigMachineLocalAIImpactCommitAllowed,
  type RuntimeConfigMachineLocalAIAddDraft,
  type RuntimeConfigMachineLocalAIImpactConfirmation,
  type RuntimeConfigMachineLocalAIImpactRequest,
  type RuntimeConfigMachineLocalAIVideoSlotId,
} from './runtime-config-machine-local-ai-state.js';
import { RuntimePageShell } from './runtime-config-page-shell.js';

type MachineLocalAIFeedback = {
  readonly tone: 'info' | 'success' | 'danger';
  readonly message: string;
  readonly technicalDetail?: string;
};

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
  readonly assetChoiceByRequirement: Readonly<Record<string, string>>;
  readonly onRefresh: () => void;
  readonly onShowAddForm: () => void;
  readonly onHideAddForm: () => void;
  readonly onAddDraftChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
  readonly onAdd: () => void;
  readonly onSelect: (configuration: NimiMachineLocalCapabilityConfiguration) => void;
  readonly onClearSelection: (capabilityContract: string) => void;
  readonly onReproject: (configuration: NimiMachineLocalCapabilityConfiguration) => void;
  readonly onAssetChoiceChange: (
    configurationId: string,
    requirementId: string,
    localAssetId: string,
  ) => void;
  readonly onBind: (
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding | undefined,
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
  const [assetChoiceByRequirement, setAssetChoiceByRequirement] = useState<Record<string, string>>({});
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
      setFeedback({ tone: 'success', message: input.successMessage });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: input.failureMessage,
        technicalDetail: technicalErrorDetail(error),
      });
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
        : addDraft.capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT
          ? createVideoConfigurationInput(addDraft, state.assets, displayName)
          : createImageConfigurationInput(addDraft, state.assets, displayName);
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
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message: t(addDraft.capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT
          ? 'runtimeConfig.machineLocalAIConfigurations.videoFormInvalid'
          : 'runtimeConfig.machineLocalAIConfigurations.imageFormInvalid'),
        technicalDetail: technicalErrorDetail(error),
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

  const commitBindRequirement = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding | undefined,
  ) => {
    const key = requirementChoiceKey(configuration.configurationId, requirement.requirementId);
    const localAssetId = assetChoiceByRequirement[key] ?? '';
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
      key: `${currentBinding ? 'rebind' : 'bind'}:${key}`,
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
      commit: (next) => {
        dispatch({ type: 'configuration-committed', configuration: next });
        setAssetChoiceByRequirement((current) => ({ ...current, [key]: '' }));
      },
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.bindingSuccess'),
      failureMessage: t(`runtimeConfig.machineLocalAIConfigurations.${currentBinding ? 'rebindFailed' : 'bindFailed'}`),
    });
  }, [assetChoiceByRequirement, client, runMutation, state.assets, t]);

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

  const bindRequirement = useCallback((
    configuration: NimiMachineLocalCapabilityConfiguration,
    requirement: NimiMachineLocalCapabilityRequirement,
    currentBinding: NimiMachineLocalAssetExactBinding | undefined,
  ) => {
    if (isSelectedConfiguration(configuration)) {
      requestImpactConfirmation('update', configuration, () => (
        commitBindRequirement(configuration, requirement, currentBinding)
      ));
      return;
    }
    commitBindRequirement(configuration, requirement, currentBinding);
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
      assetChoiceByRequirement={assetChoiceByRequirement}
      onRefresh={() => { void refresh(); }}
      onShowAddForm={() => setShowAddForm(true)}
      onHideAddForm={() => setShowAddForm(false)}
      onAddDraftChange={setAddDraft}
      onAdd={addConfiguration}
      onSelect={selectConfiguration}
      onClearSelection={clearSelection}
      onReproject={reprojectRequirements}
      onAssetChoiceChange={(configurationId, requirementId, localAssetId) => {
        setAssetChoiceByRequirement((current) => ({
          ...current,
          [requirementChoiceKey(configurationId, requirementId)]: localAssetId,
        }));
      }}
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
  const capabilityContracts = [...new Set([
    NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
    NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
    NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
    ...configurations.map((configuration) => configuration.capabilityContract),
    ...(props.aggregate?.selections ?? []).map((selection) => selection.capabilityContract),
  ])].sort((left, right) => left.localeCompare(right));
  const anyBusy = Boolean(props.busyAction) || props.loading || Boolean(props.impactConfirmation);

  return (
    <RuntimePageShell maxWidth="full" className="max-w-[78rem] space-y-4 px-6 py-6">
      <Surface tone="card" className="space-y-4 p-5" data-testid="machine-local-ai-configurations-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
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
              disabled={anyBusy || props.loading}
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

        {props.showAddForm ? (
          <MachineLocalAIAddForm
            draft={props.addDraft}
            assets={props.assets}
            busy={anyBusy}
            onChange={props.onAddDraftChange}
            onCancel={props.onHideAddForm}
            onAdd={props.onAdd}
          />
        ) : null}
      </Surface>

      {props.feedback ? (
        <div data-testid="machine-local-ai-configurations-feedback">
          <InlineAlert tone={props.feedback.tone}>{props.feedback.message}</InlineAlert>
          {props.feedback.technicalDetail ? (
            <TechnicalDetails detail={props.feedback.technicalDetail} />
          ) : null}
        </div>
      ) : null}

      {props.loading && !props.aggregate ? (
        <Surface tone="card" className="p-5 text-sm text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.loading')}
        </Surface>
      ) : null}

      {!props.loading && props.loadTechnicalError ? (
        <div data-testid="machine-local-ai-configurations-load-error">
          <InlineAlert tone="danger">
            {t('runtimeConfig.machineLocalAIConfigurations.loadFailed')}
          </InlineAlert>
          <TechnicalDetails detail={props.loadTechnicalError} />
        </div>
      ) : null}

      {props.aggregate ? (
        <Surface tone="card" className="space-y-3 p-4" data-testid="machine-local-ai-selection-summary">
          <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.selectionTitle')}
          </h4>
          <div className="space-y-2">
            {capabilityContracts.map((capabilityContract) => {
              const selection = props.aggregate?.selections.find(
                (item) => item.capabilityContract === capabilityContract,
              );
              const selectedConfiguration = configurations.find(
                (configuration) => configuration.configurationId === selection?.configurationId,
              );
              return (
                <div
                  key={capabilityContract}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-3 py-2"
                >
                  <div className="text-xs text-[var(--nimi-text-secondary)]">
                    <span className="font-mono font-semibold text-[var(--nimi-text-primary)]">
                      {capabilityContract}
                    </span>
                    <span className="ml-2">
                      {selectedConfiguration
                        ? t('runtimeConfig.machineLocalAIConfigurations.selectionCurrent', {
                          name: displayConfigurationName(selectedConfiguration, t),
                        })
                        : t('runtimeConfig.machineLocalAIConfigurations.noSelection')}
                    </span>
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
        <div
          data-testid="machine-local-ai-configurations-empty-info"
          className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))] p-5"
        >
          <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.emptyTitle')}
          </h4>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.emptyBody')}
          </p>
        </div>
      ) : null}

      {configurations.map((configuration) => (
        <MachineLocalAIConfigurationCard
          key={configuration.configurationId}
          configuration={configuration}
          assets={props.assets}
          selected={props.aggregate?.selections.some((selection) => (
            selection.capabilityContract === configuration.capabilityContract
            && selection.configurationId === configuration.configurationId
          )) === true}
          busyAction={props.loading
            ? 'loading'
            : props.busyAction || (props.impactConfirmation ? 'impact-confirmation' : '')}
          deleteConfirmation={props.deleteConfirmationId === configuration.configurationId}
          impactConfirmation={props.impactConfirmation?.request.configurationId === configuration.configurationId
            ? props.impactConfirmation
            : null}
          assetChoiceByRequirement={props.assetChoiceByRequirement}
          onSelect={props.onSelect}
          onClearSelection={props.onClearSelection}
          onReproject={props.onReproject}
          onAssetChoiceChange={props.onAssetChoiceChange}
          onBind={props.onBind}
          onUnbind={props.onUnbind}
          onRequestDelete={props.onRequestDelete}
          onCancelDelete={props.onCancelDelete}
          onConfirmDelete={props.onConfirmDelete}
          onConfirmImpact={props.onConfirmImpact}
          onCancelImpact={props.onCancelImpact}
        />
      ))}
    </RuntimePageShell>
  );
}

function MachineLocalAIAddForm(props: {
  readonly draft: RuntimeConfigMachineLocalAIAddDraft;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly busy: boolean;
  readonly onChange: (value: RuntimeConfigMachineLocalAIAddDraft) => void;
  readonly onCancel: () => void;
  readonly onAdd: () => void;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const update = (patch: Partial<RuntimeConfigMachineLocalAIAddDraft>) => {
    props.onChange({ ...draft, ...patch });
  };
  return (
    <div
      className="grid gap-4 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-4 md:grid-cols-2"
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
      <label className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.machineLocalAIConfigurations.capabilityContract')}</span>
        <select
          value={draft.capabilityContract}
          disabled={props.busy}
          onChange={(event) => update({
            capabilityContract: event.currentTarget.value as RuntimeConfigMachineLocalAIAddDraft['capabilityContract'],
          })}
          className={machineLocalSelectClassName}
          data-testid="machine-local-ai-add-capability"
        >
          <option value={NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT}>text.generate</option>
          <option value={NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT}>image.generate</option>
          <option value={NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT}>video.generate</option>
        </select>
      </label>

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
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
              <input
                type="checkbox"
                checked={draft.acceptsImageInput}
                disabled={props.busy}
                onChange={(event) => update({ acceptsImageInput: event.currentTarget.checked })}
                className="mt-0.5"
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
            </label>
          </fieldset>
        </>
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

      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" tone="primary" loading={props.busy} onClick={props.onAdd}>
          {t('runtimeConfig.machineLocalAIConfigurations.save')}
        </Button>
        <Button size="sm" tone="ghost" disabled={props.busy} onClick={props.onCancel}>
          {t('runtimeConfig.machineLocalAIConfigurations.cancel')}
        </Button>
      </div>
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
  const verifiedAssets = props.assets.filter((asset) => (
    asset.status !== 'removed' && Boolean(asset.expectedVerifiedContentId)
  ));
  const slotDescriptors: readonly NimiMachineLocalStableDiffusionSlotDescriptor[] =
    NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_SLOT_DESCRIPTORS;
  const slots = slotDescriptors.filter((slot) => (
    !slot.requiredModelFamilies || slot.requiredModelFamilies.includes(draft.modelFamily)
  ));
  const updateSlot = (
    slotId: NimiMachineLocalStableDiffusionSlotId,
    patch: Partial<RuntimeConfigMachineLocalAIAddDraft['slots'][NimiMachineLocalStableDiffusionSlotId]>,
  ) => props.onChange({
    ...draft,
    slots: {
      ...draft.slots,
      [slotId]: { ...draft.slots[slotId], ...patch },
    },
  });
  const updateLoRA = (
    index: number,
    patch: Partial<RuntimeConfigMachineLocalAIAddDraft['loras'][number]>,
  ) => props.onChange({
    ...draft,
    loras: draft.loras.map((lora, itemIndex) => (
      itemIndex === index ? { ...lora, ...patch } : lora
    )),
  });

  return (
    <div className="grid gap-4 md:col-span-2" data-testid="machine-local-ai-image-fields">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.modelFamily')}</span>
          <select
            value={draft.modelFamily}
            disabled={props.busy}
            onChange={(event) => props.onChange({
              ...draft,
              modelFamily: event.currentTarget.value as RuntimeConfigMachineLocalAIAddDraft['modelFamily'],
            })}
            className={machineLocalSelectClassName}
            data-testid="machine-local-ai-image-family"
          >
            {NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_MODEL_FAMILIES.map((family) => (
              <option key={family} value={family}>{modelFamilyDisplayName(family)}</option>
            ))}
          </select>
        </label>
        <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <div className={machineLocalReadOnlyFieldClassName}>stable-diffusion.cpp</div>
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
        <input
          type="checkbox"
          checked={draft.enableInputImage}
          disabled={props.busy}
          onChange={(event) => props.onChange({
            ...draft,
            enableInputImage: event.currentTarget.checked,
          })}
          className="mt-0.5"
        />
        <span>
          <span className="block font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeature')}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeatureBody')}
          </span>
        </span>
      </label>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.imageSlotsTitle')}
        </legend>
        {slots.map((slot) => {
          const slotDraft = draft.slots[slot.slotId];
          return (
            <div
              key={slot.slotId}
              className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_minmax(220px,1.2fr)]"
              data-testid={`machine-local-ai-image-slot:${slot.slotId}`}
            >
              <div>
                <div className="text-xs font-semibold text-[var(--nimi-text-muted)]">
                  {requirementGroupDisplay(slot.role, slot.occurrenceOrdinal, t)}
                </div>
                <div className="mt-1 text-sm font-medium text-[var(--nimi-text-primary)]">
                  {slot.displayLabel}
                </div>
              </div>
              <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{t('runtimeConfig.machineLocalAIConfigurations.requirementPolicy')}</span>
                <select
                  value={slotDraft.requirementPolicy}
                  disabled={props.busy}
                  onChange={(event) => updateSlot(slot.slotId, {
                    requirementPolicy: event.currentTarget.value as typeof slotDraft.requirementPolicy,
                    localAssetId: event.currentTarget.value === 'strict' ? slotDraft.localAssetId : '',
                  })}
                  className={machineLocalSelectClassName}
                >
                  <option value="substitutable">{t('runtimeConfig.machineLocalAIConfigurations.policySubstitutable')}</option>
                  <option value="strict">{t('runtimeConfig.machineLocalAIConfigurations.policyStrict')}</option>
                </select>
              </label>
              {slotDraft.requirementPolicy === 'strict' ? (
                <ExactAssetSelect
                  value={slotDraft.localAssetId}
                  assets={verifiedAssets}
                  busy={props.busy}
                  label={t('runtimeConfig.machineLocalAIConfigurations.preferredFile')}
                  onChange={(localAssetId) => updateSlot(slot.slotId, { localAssetId })}
                />
              ) : (
                <p className="self-end text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.machineLocalAIConfigurations.policySubstitutableBody')}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="grid gap-3" data-testid="machine-local-ai-lora-list">
        <div className="flex items-center justify-between gap-3">
          <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.lorasTitle')}
          </legend>
          <Button
            type="button"
            size="sm"
            disabled={props.busy || draft.loras.length >= 32}
            onClick={() => {
              const ordinal = draft.loras.length + 1;
              props.onChange({
                ...draft,
                loras: [...draft.loras, {
                  draftId: nextLoRADraftId(draft.loras),
                  displayLabel: `LoRA ${ordinal}`,
                  requirementPolicy: 'substitutable',
                  localAssetId: '',
                  weight: '1',
                }],
              });
            }}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.addLora')}
          </Button>
        </div>
        {draft.loras.length === 0 ? (
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.noLoras')}
          </p>
        ) : draft.loras.map((lora, index) => (
          <div
            key={lora.draftId}
            className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3 lg:grid-cols-[110px_minmax(150px,1fr)_minmax(150px,0.8fr)_100px_auto]"
            data-testid={`machine-local-ai-lora:${index + 1}`}
            data-occurrence-ordinal={index + 1}
          >
            <div className="text-xs font-semibold text-[var(--nimi-text-muted)]">
              {requirementGroupDisplay('companion', index + 1, t)}
            </div>
            <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
              <span>{t('runtimeConfig.machineLocalAIConfigurations.slotDisplayLabel')}</span>
              <TextField
                value={lora.displayLabel}
                disabled={props.busy}
                onChange={(event) => updateLoRA(index, { displayLabel: event.currentTarget.value })}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
              <span>{t('runtimeConfig.machineLocalAIConfigurations.requirementPolicy')}</span>
              <select
                value={lora.requirementPolicy}
                disabled={props.busy}
                onChange={(event) => updateLoRA(index, {
                  requirementPolicy: event.currentTarget.value as typeof lora.requirementPolicy,
                  localAssetId: event.currentTarget.value === 'strict' ? lora.localAssetId : '',
                })}
                className={machineLocalSelectClassName}
              >
                <option value="substitutable">{t('runtimeConfig.machineLocalAIConfigurations.policySubstitutable')}</option>
                <option value="strict">{t('runtimeConfig.machineLocalAIConfigurations.policyStrict')}</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
              <span>{t('runtimeConfig.machineLocalAIConfigurations.loraWeight')}</span>
              <TextField
                type="number"
                min={-4}
                max={4}
                step="0.1"
                value={lora.weight}
                disabled={props.busy}
                onChange={(event) => updateLoRA(index, { weight: event.currentTarget.value })}
              />
            </label>
            <div className="flex flex-wrap items-end gap-1">
              <Button
                type="button"
                size="sm"
                tone="ghost"
                disabled={props.busy || index === 0}
                onClick={() => props.onChange({
                  ...draft,
                  loras: moveRuntimeConfigMachineLocalAILoRA(draft.loras, index, -1),
                })}
              >
                {t('runtimeConfig.machineLocalAIConfigurations.moveUp')}
              </Button>
              <Button
                type="button"
                size="sm"
                tone="ghost"
                disabled={props.busy || index === draft.loras.length - 1}
                onClick={() => props.onChange({
                  ...draft,
                  loras: moveRuntimeConfigMachineLocalAILoRA(draft.loras, index, 1),
                })}
              >
                {t('runtimeConfig.machineLocalAIConfigurations.moveDown')}
              </Button>
              <Button
                type="button"
                size="sm"
                tone="danger"
                disabled={props.busy}
                onClick={() => props.onChange({
                  ...draft,
                  loras: draft.loras.filter((_, itemIndex) => itemIndex !== index),
                })}
              >
                {t('runtimeConfig.machineLocalAIConfigurations.remove')}
              </Button>
            </div>
            {lora.requirementPolicy === 'strict' ? (
              <div className="lg:col-start-2 lg:col-span-3">
                <ExactAssetSelect
                  value={lora.localAssetId}
                  assets={verifiedAssets}
                  busy={props.busy}
                  label={t('runtimeConfig.machineLocalAIConfigurations.preferredFile')}
                  onChange={(localAssetId) => updateLoRA(index, { localAssetId })}
                />
              </div>
            ) : null}
          </div>
        ))}
      </fieldset>

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
    <div className="grid gap-4 md:col-span-2" data-testid="machine-local-ai-video-fields">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
          <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
          <div className={machineLocalReadOnlyFieldClassName}>stable-diffusion.cpp</div>
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
        <input
          type="checkbox"
          checked={draft.enableInputImage}
          disabled={props.busy}
          onChange={(event) => props.onChange({
            ...draft,
            enableInputImage: event.currentTarget.checked,
          })}
          className="mt-0.5"
        />
        <span>
          <span className="block font-medium text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeature')}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.machineLocalAIConfigurations.imageInputFeatureBody')}
          </span>
        </span>
      </label>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.videoSlotsTitle')}
        </legend>
        {MACHINE_LOCAL_VIDEO_SLOTS.map((slot) => {
          const slotDraft = draft.videoSlots[slot.slotId];
          return (
            <div
              key={slot.slotId}
              className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_minmax(220px,1.2fr)]"
              data-testid={`machine-local-ai-video-slot:${slot.slotId}`}
            >
              <div>
                <div className="text-xs font-semibold text-[var(--nimi-text-muted)]">
                  {requirementGroupDisplay(slot.role, 0, t)}
                </div>
                <div className="mt-1 text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t(`runtimeConfig.machineLocalAIConfigurations.${slot.labelKey}`)}
                </div>
              </div>
              <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{t('runtimeConfig.machineLocalAIConfigurations.requirementPolicy')}</span>
                <select
                  value={slotDraft.requirementPolicy}
                  disabled={props.busy}
                  onChange={(event) => updateSlot(slot.slotId, {
                    requirementPolicy: event.currentTarget.value as typeof slotDraft.requirementPolicy,
                    localAssetId: event.currentTarget.value === 'strict' ? slotDraft.localAssetId : '',
                  })}
                  className={machineLocalSelectClassName}
                >
                  <option value="substitutable">{t('runtimeConfig.machineLocalAIConfigurations.policySubstitutable')}</option>
                  <option value="strict">{t('runtimeConfig.machineLocalAIConfigurations.policyStrict')}</option>
                </select>
              </label>
              {slotDraft.requirementPolicy === 'strict' ? (
                <ExactAssetSelect
                  value={slotDraft.localAssetId}
                  assets={verifiedAssets}
                  busy={props.busy}
                  label={t('runtimeConfig.machineLocalAIConfigurations.preferredFile')}
                  onChange={(localAssetId) => updateSlot(slot.slotId, { localAssetId })}
                />
              ) : (
                <p className="self-end text-xs text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.machineLocalAIConfigurations.policySubstitutableBody')}
                </p>
              )}
            </div>
          );
        })}
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
    <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
      <span>{props.label}</span>
      <select
        value={props.value}
        disabled={props.busy || props.assets.length === 0}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        className={machineLocalSelectClassName}
      >
        <option value="">{props.assets.length > 0
          ? t('runtimeConfig.machineLocalAIConfigurations.chooseFilePlaceholder')
          : t('runtimeConfig.machineLocalAIConfigurations.noCompatibleFiles')}</option>
        {props.assets.map((asset) => (
          <option key={asset.localAssetId} value={asset.localAssetId}>
            {localAssetDisplayName(asset, t)}
          </option>
        ))}
      </select>
    </label>
  );
}

function MachineLocalAIConfigurationCard(props: {
  readonly configuration: NimiMachineLocalCapabilityConfiguration;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly selected: boolean;
  readonly busyAction: string;
  readonly deleteConfirmation: boolean;
  readonly impactConfirmation: RuntimeConfigMachineLocalAIImpactConfirmation | null;
  readonly assetChoiceByRequirement: Readonly<Record<string, string>>;
  readonly onSelect: MachineLocalAIConfigurationsViewProps['onSelect'];
  readonly onClearSelection: MachineLocalAIConfigurationsViewProps['onClearSelection'];
  readonly onReproject: MachineLocalAIConfigurationsViewProps['onReproject'];
  readonly onAssetChoiceChange: MachineLocalAIConfigurationsViewProps['onAssetChoiceChange'];
  readonly onBind: MachineLocalAIConfigurationsViewProps['onBind'];
  readonly onUnbind: MachineLocalAIConfigurationsViewProps['onUnbind'];
  readonly onRequestDelete: MachineLocalAIConfigurationsViewProps['onRequestDelete'];
  readonly onCancelDelete: MachineLocalAIConfigurationsViewProps['onCancelDelete'];
  readonly onConfirmDelete: MachineLocalAIConfigurationsViewProps['onConfirmDelete'];
  readonly onConfirmImpact: MachineLocalAIConfigurationsViewProps['onConfirmImpact'];
  readonly onCancelImpact: MachineLocalAIConfigurationsViewProps['onCancelImpact'];
}) {
  const { t } = useTranslation();
  const { configuration } = props;
  const fileState = machineLocalConfigurationFileState(configuration);
  const anyBusy = Boolean(props.busyAction) || Boolean(props.impactConfirmation);
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
              {displayConfigurationName(configuration, t)}
            </h4>
            {props.selected ? (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-action-primary-bg)]">
                {t('runtimeConfig.machineLocalAIConfigurations.selected')}
              </span>
            ) : null}
            <span className={fileState === 'configured'
              ? 'rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-status-success)]'
              : 'rounded-full bg-[var(--nimi-surface-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-text-secondary)]'}>
              {t(`runtimeConfig.machineLocalAIConfigurations.${fileState === 'configured' ? 'configured' : 'filesNeeded'}`)}
            </span>
          </div>
          <dl className="mt-2 grid gap-x-5 gap-y-1 text-xs text-[var(--nimi-text-secondary)] sm:grid-cols-2">
            <div className="flex gap-1.5">
              <dt className="font-medium">{t('runtimeConfig.machineLocalAIConfigurations.capabilityContract')}:</dt>
              <dd className="font-mono">{configuration.capabilityContract}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-medium">{t('runtimeConfig.machineLocalAIConfigurations.engine')}:</dt>
              <dd>{engineDisplayName(configuration, t)}</dd>
            </div>
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
        <div className="flex flex-wrap gap-2">
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
          <Button
            size="sm"
            disabled={anyBusy}
            onClick={() => props.onReproject(configuration)}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.refreshRequirements')}
          </Button>
          <Button
            size="sm"
            tone="danger"
            disabled={anyBusy}
            onClick={() => props.onRequestDelete(configuration, props.selected)}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.delete')}
          </Button>
        </div>
      </div>

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
              {requirementGroupDisplay(group.role, group.occurrenceOrdinal, t)}
            </h6>
            {group.requirements.map((requirement) => (
              <MachineLocalAIRequirementRow
                key={requirement.requirementId}
                configuration={configuration}
                requirement={requirement}
                assets={props.assets}
                anyBusy={anyBusy}
                choice={props.assetChoiceByRequirement[requirementChoiceKey(
                  configuration.configurationId,
                  requirement.requirementId,
                )] ?? ''}
                onAssetChoiceChange={props.onAssetChoiceChange}
                onBind={props.onBind}
                onUnbind={props.onUnbind}
              />
            ))}
          </section>
        ))}
      </div>

      {props.impactConfirmation ? (
        <MachineLocalAIImpactPanel
          confirmation={props.impactConfirmation}
          mutationBusy={Boolean(props.busyAction) && props.busyAction !== 'impact-confirmation'}
          onConfirm={props.onConfirmImpact}
          onCancel={props.onCancelImpact}
        />
      ) : null}

      {props.deleteConfirmation ? (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[var(--nimi-status-danger-soft-bg)] p-3">
          <p className="text-sm text-[var(--nimi-status-danger-soft-text)]">
            {props.selected
              ? t('runtimeConfig.machineLocalAIConfigurations.deleteSelectedPrompt')
              : t('runtimeConfig.machineLocalAIConfigurations.deletePrompt')}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              tone="danger"
              disabled={anyBusy}
              onClick={() => props.onConfirmDelete(configuration)}
            >
              {t('runtimeConfig.machineLocalAIConfigurations.confirmDelete')}
            </Button>
            <Button size="sm" tone="ghost" disabled={anyBusy} onClick={props.onCancelDelete}>
              {t('runtimeConfig.machineLocalAIConfigurations.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <TechnicalDetails detail={JSON.stringify({
        configurationId: configuration.configurationId,
        implementation: configuration.implementation,
        interpretability: configuration.interpretability,
        requirementResolution: configuration.requirementResolution,
        supportedFeatures: configuration.supportedFeatures,
        reasons: configuration.reasons,
        portableConfig: configuration.portableConfig ?? null,
        requirements: configuration.projectedRequirements,
        bindings: configuration.exactBindings,
      }, null, 2)} />
    </Surface>
  );
}

function MachineLocalAIRequirementRow(props: {
  readonly configuration: NimiMachineLocalCapabilityConfiguration;
  readonly requirement: NimiMachineLocalCapabilityRequirement;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly anyBusy: boolean;
  readonly choice: string;
  readonly onAssetChoiceChange: MachineLocalAIConfigurationsViewProps['onAssetChoiceChange'];
  readonly onBind: MachineLocalAIConfigurationsViewProps['onBind'];
  readonly onUnbind: MachineLocalAIConfigurationsViewProps['onUnbind'];
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
    <div className="grid gap-3 rounded-lg bg-[var(--nimi-surface-subtle)] p-3 lg:grid-cols-[minmax(160px,0.8fr)_minmax(240px,1.4fr)_auto] lg:items-end">
      <div>
        <div className="text-sm font-medium text-[var(--nimi-text-primary)]">
          {props.requirement.displayLabel}
        </div>
        <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          {currentBinding
            ? t('runtimeConfig.machineLocalAIConfigurations.bound')
            : t('runtimeConfig.machineLocalAIConfigurations.fileNeeded')}
          {currentBinding ? ` · ${localAssetDisplayName(currentAsset, t, true)}` : ''}
        </div>
      </div>
      <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
        <span>{currentBinding
          ? t('runtimeConfig.machineLocalAIConfigurations.chooseReplacement')
          : t('runtimeConfig.machineLocalAIConfigurations.chooseFile')}</span>
        <select
          aria-label={props.requirement.displayLabel}
          value={props.choice}
          disabled={props.anyBusy || compatibleAssets.length === 0}
          onChange={(event) => props.onAssetChoiceChange(
            props.configuration.configurationId,
            props.requirement.requirementId,
            event.currentTarget.value,
          )}
          className={machineLocalSelectClassName}
        >
          <option value="">
            {compatibleAssets.length > 0
              ? t('runtimeConfig.machineLocalAIConfigurations.chooseFilePlaceholder')
              : t('runtimeConfig.machineLocalAIConfigurations.noCompatibleFiles')}
          </option>
          {compatibleAssets.map((asset) => (
            <option key={asset.localAssetId} value={asset.localAssetId}>
              {localAssetDisplayName(asset, t)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={props.anyBusy || !props.choice}
          onClick={() => props.onBind(props.configuration, props.requirement, currentBinding)}
        >
          {currentBinding
            ? t('runtimeConfig.machineLocalAIConfigurations.replace')
            : t('runtimeConfig.machineLocalAIConfigurations.bind')}
        </Button>
        {currentBinding ? (
          <Button
            size="sm"
            tone="ghost"
            disabled={props.anyBusy}
            onClick={() => props.onUnbind(props.configuration, props.requirement, currentBinding)}
          >
            {t('runtimeConfig.machineLocalAIConfigurations.unbind')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MachineLocalAIImpactPanel(props: {
  readonly confirmation: RuntimeConfigMachineLocalAIImpactConfirmation;
  readonly mutationBusy: boolean;
  readonly onConfirm: (requestId: string) => void;
  readonly onCancel: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  const { confirmation } = props;
  const requestId = confirmation.request.requestId;
  const impact = confirmation.impact;
  const impactBodyKey = confirmation.request.capabilityContract
    === NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT
    ? 'impactImageBody'
    : confirmation.request.capabilityContract
      === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT
      ? 'impactVideoBody'
      : 'impactTextBody';
  return (
    <div
      className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))] p-4"
      data-testid="machine-local-ai-impact-confirmation"
      data-operation={confirmation.request.operation}
    >
      <h5 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {t('runtimeConfig.machineLocalAIConfigurations.impactTitle')}
      </h5>
      {confirmation.status === 'loading' ? (
        <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.impactLoading')}
        </p>
      ) : confirmation.status === 'failed' ? (
        <div className="mt-2">
          <InlineAlert tone="danger">
            {t('runtimeConfig.machineLocalAIConfigurations.impactFailed')}
          </InlineAlert>
          <TechnicalDetails detail={confirmation.technicalError} />
        </div>
      ) : impact ? (
        <>
          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
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

function TechnicalDetails({ detail }: { readonly detail: string }) {
  const { t } = useTranslation();
  return (
    <details className="mt-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
      <summary className="cursor-pointer font-semibold">
        {t('runtimeConfig.machineLocalAIConfigurations.technicalDetails')}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">{detail}</pre>
    </details>
  );
}

function displayConfigurationName(
  configuration: NimiMachineLocalCapabilityConfiguration,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return configuration.displayName
    || t('runtimeConfig.machineLocalAIConfigurations.unnamedConfiguration');
}

function engineDisplayName(
  configuration: NimiMachineLocalCapabilityConfiguration,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const implementation = configuration.implementation;
  if (
    implementation.implementationId
      === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.implementationId
    && implementation.driverId
      === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.driverId
  ) {
    return 'llama.cpp';
  }
  if (
    implementation.implementationId
      === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION.implementationId
    && implementation.driverId
      === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION.driverId
  ) {
    return 'stable-diffusion.cpp';
  }
  return t('runtimeConfig.machineLocalAIConfigurations.otherEngine');
}

function localAssetDisplayName(
  asset: NimiRuntimeLocalAssetEntry | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  bound = false,
): string {
  const name = asset?.displayName
    || asset?.sourceFileName
    || (bound
      ? t('runtimeConfig.machineLocalAIConfigurations.boundLocalFile')
      : t('runtimeConfig.machineLocalAIConfigurations.unnamedLocalFile'));
  return asset?.exactContent?.kind === 'sharded-bundle'
    ? `${name} · ${t('runtimeConfig.machineLocalAIConfigurations.fileBundle')}`
    : name;
}

const machineLocalSelectClassName = 'min-h-10 w-full rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)] disabled:opacity-[var(--nimi-opacity-disabled)]';
const machineLocalReadOnlyFieldClassName = 'flex min-h-10 items-center rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)]';

function createImageConfigurationInput(
  draft: RuntimeConfigMachineLocalAIAddDraft,
  assets: readonly NimiRuntimeLocalAssetEntry[],
  displayName: string,
) {
  const preferredContentId = (slotId: NimiMachineLocalStableDiffusionSlotId): string | undefined => {
    const slot = draft.slots[slotId];
    if (slot.requirementPolicy !== 'strict') return undefined;
    const contentId = assets.find((asset) => asset.localAssetId === slot.localAssetId)
      ?.expectedVerifiedContentId;
    if (!contentId) throw new Error(`A preferred local file is required for ${slotId}.`);
    return contentId;
  };
  const loras = draft.loras.map((lora, index) => {
    const contentId = lora.requirementPolicy === 'strict'
      ? assets.find((asset) => asset.localAssetId === lora.localAssetId)
        ?.expectedVerifiedContentId
      : undefined;
    if (lora.requirementPolicy === 'strict' && !contentId) {
      throw new Error(`A preferred local file is required for LoRA ${index + 1}.`);
    }
    return {
      displayLabel: requireDraftText(lora.displayLabel, `LoRA ${index + 1} label`),
      requirementPolicy: lora.requirementPolicy,
      ...(contentId ? { verifiedContentId: contentId } : {}),
      weight: parseDraftNumber(lora.weight, `LoRA ${index + 1} weight`),
    };
  });
  const mainVerifiedContentId = preferredContentId('main');
  const textEncoderVerifiedContentId = preferredContentId('textEncoder');
  const vaeVerifiedContentId = preferredContentId('vae');
  const uncondDiffusionVerifiedContentId = draft.modelFamily === 'ideogram4'
    ? preferredContentId('uncondDiffusion')
    : undefined;
  return createNimiMachineLocalStableDiffusionImageConfigurationInput({
    displayName,
    modelFamily: draft.modelFamily,
    enableInputImage: draft.enableInputImage,
    mainRequirementPolicy: draft.slots.main.requirementPolicy,
    ...(mainVerifiedContentId ? { mainVerifiedContentId } : {}),
    textEncoderRequirementPolicy: draft.slots.textEncoder.requirementPolicy,
    ...(textEncoderVerifiedContentId ? { textEncoderVerifiedContentId } : {}),
    vaeRequirementPolicy: draft.slots.vae.requirementPolicy,
    ...(vaeVerifiedContentId ? { vaeVerifiedContentId } : {}),
    ...(draft.modelFamily === 'ideogram4' ? {
      uncondDiffusionRequirementPolicy: draft.slots.uncondDiffusion.requirementPolicy,
      ...(uncondDiffusionVerifiedContentId ? { uncondDiffusionVerifiedContentId } : {}),
    } : {}),
    loras,
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
  return createNimiMachineLocalStableDiffusionVideoConfigurationInput({
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
}

function parseDraftNumber(value: string, field: string): number {
  if (!value || value.trim() !== value) throw new Error(`${field} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a finite number.`);
  return number;
}

function requireDraftText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function nextLoRADraftId(
  loras: RuntimeConfigMachineLocalAIAddDraft['loras'],
): string {
  let index = 1;
  const ids = new Set(loras.map((lora) => lora.draftId));
  while (ids.has(`lora-${index}`)) index += 1;
  return `lora-${index}`;
}

function modelFamilyDisplayName(family: RuntimeConfigMachineLocalAIAddDraft['modelFamily']): string {
  switch (family) {
    case 'z-image':
      return 'Z-Image';
    case 'z-image-turbo':
      return 'Z-Image Turbo';
    case 'ideogram4':
      return 'Ideogram 4';
  }
}

function requirementGroupDisplay(
  role: NimiMachineLocalCapabilityRequirement['role'],
  occurrenceOrdinal: number,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const roleLabel = role === 'main'
    ? t('runtimeConfig.machineLocalAIConfigurations.roleMain')
    : t('runtimeConfig.machineLocalAIConfigurations.roleCompanion');
  return occurrenceOrdinal > 0
    ? t('runtimeConfig.machineLocalAIConfigurations.roleOrdinal', {
      role: roleLabel,
      position: occurrenceOrdinal,
    })
    : t('runtimeConfig.machineLocalAIConfigurations.roleSingleton', { role: roleLabel });
}

function requirementChoiceKey(configurationId: string, requirementId: string): string {
  return `${configurationId}\u0000${requirementId}`;
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
