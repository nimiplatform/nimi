import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  createNimiMachineLocalLlamaCppTextConfigurationInput,
  type NimiMachineLocalAIConfiguration,
  type NimiMachineLocalAssetExactBinding,
  type NimiMachineLocalCapabilityConfiguration,
  type NimiMachineLocalCapabilityRequirement,
  type NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';
import {
  Button,
  InlineAlert,
  Surface,
  TextField,
} from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import {
  INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  compatibleMachineLocalAssets,
  machineLocalConfigurationFileState,
  reduceRuntimeConfigMachineLocalAIState,
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
  readonly addDisplayName: string;
  readonly addAcceptsImageInput: boolean;
  readonly deleteConfirmationId: string;
  readonly assetChoiceByRequirement: Readonly<Record<string, string>>;
  readonly onRefresh: () => void;
  readonly onShowAddForm: () => void;
  readonly onHideAddForm: () => void;
  readonly onAddDisplayNameChange: (value: string) => void;
  readonly onAddAcceptsImageInputChange: (value: boolean) => void;
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
  readonly onRequestDelete: (configurationId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (configuration: NimiMachineLocalCapabilityConfiguration) => void;
};

export function MachineLocalAIConfigurationsPage() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const client = useMemo(
    () => sdk.machineProduct().local.aiConfiguration,
    [sdk],
  );
  const [state, dispatch] = useReducer(
    reduceRuntimeConfigMachineLocalAIState,
    INITIAL_RUNTIME_CONFIG_MACHINE_LOCAL_AI_STATE,
  );
  const [feedback, setFeedback] = useState<MachineLocalAIFeedback | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDisplayName, setAddDisplayName] = useState('');
  const [addAcceptsImageInput, setAddAcceptsImageInput] = useState(false);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState('');
  const [assetChoiceByRequirement, setAssetChoiceByRequirement] = useState<Record<string, string>>({});

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
    const displayName = addDisplayName.trim();
    if (!displayName) {
      setFeedback({
        tone: 'danger',
        message: t('runtimeConfig.machineLocalAIConfigurations.displayNameRequired'),
      });
      return;
    }
    const input = createNimiMachineLocalLlamaCppTextConfigurationInput({
      displayName,
      acceptsImageInput: addAcceptsImageInput,
    });
    void runMutation({
      key: 'add',
      operation: () => client.addConfiguration(input),
      commit: (configuration) => {
        dispatch({ type: 'configuration-committed', configuration });
        setAddDisplayName('');
        setAddAcceptsImageInput(false);
        setShowAddForm(false);
      },
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.addSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.addFailed'),
    });
  }, [addAcceptsImageInput, addDisplayName, client, runMutation, t]);

  const selectConfiguration = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
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

  const reprojectRequirements = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
    void runMutation({
      key: `reproject:${configuration.configurationId}`,
      operation: () => client.reprojectRequirements(configuration.configurationId),
      commit: (next) => dispatch({ type: 'configuration-committed', configuration: next }),
      successMessage: t('runtimeConfig.machineLocalAIConfigurations.reprojectSuccess'),
      failureMessage: t('runtimeConfig.machineLocalAIConfigurations.reprojectFailed'),
    });
  }, [client, runMutation, t]);

  const bindRequirement = useCallback((
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

  const unbindRequirement = useCallback((
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

  const deleteConfiguration = useCallback((configuration: NimiMachineLocalCapabilityConfiguration) => {
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

  return (
    <MachineLocalAIConfigurationsView
      aggregate={state.aggregate}
      assets={state.assets}
      loading={state.loading}
      loadTechnicalError={state.technicalError}
      busyAction={busyAction}
      feedback={feedback}
      showAddForm={showAddForm}
      addDisplayName={addDisplayName}
      addAcceptsImageInput={addAcceptsImageInput}
      deleteConfirmationId={deleteConfirmationId}
      assetChoiceByRequirement={assetChoiceByRequirement}
      onRefresh={() => { void refresh(); }}
      onShowAddForm={() => setShowAddForm(true)}
      onHideAddForm={() => setShowAddForm(false)}
      onAddDisplayNameChange={setAddDisplayName}
      onAddAcceptsImageInputChange={setAddAcceptsImageInput}
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
      onRequestDelete={setDeleteConfirmationId}
      onCancelDelete={() => setDeleteConfirmationId('')}
      onConfirmDelete={deleteConfiguration}
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
    ...configurations.map((configuration) => configuration.capabilityContract),
    ...(props.aggregate?.selections ?? []).map((selection) => selection.capabilityContract),
  ])].sort((left, right) => left.localeCompare(right));
  const anyBusy = Boolean(props.busyAction) || props.loading;

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
            displayName={props.addDisplayName}
            acceptsImageInput={props.addAcceptsImageInput}
            busy={anyBusy}
            onDisplayNameChange={props.onAddDisplayNameChange}
            onAcceptsImageInputChange={props.onAddAcceptsImageInputChange}
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
          busyAction={props.loading ? 'loading' : props.busyAction}
          deleteConfirmation={props.deleteConfirmationId === configuration.configurationId}
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
        />
      ))}
    </RuntimePageShell>
  );
}

function MachineLocalAIAddForm(props: {
  readonly displayName: string;
  readonly acceptsImageInput: boolean;
  readonly busy: boolean;
  readonly onDisplayNameChange: (value: string) => void;
  readonly onAcceptsImageInputChange: (value: boolean) => void;
  readonly onCancel: () => void;
  readonly onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid gap-4 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-4 md:grid-cols-2"
      data-testid="machine-local-ai-configuration-add-form"
    >
      <label className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.machineLocalAIConfigurations.displayName')}</span>
        <TextField
          value={props.displayName}
          onChange={(event) => props.onDisplayNameChange(event.currentTarget.value)}
          placeholder={t('runtimeConfig.machineLocalAIConfigurations.displayNamePlaceholder')}
          disabled={props.busy}
        />
      </label>
      <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.machineLocalAIConfigurations.capabilityContract')}</span>
        <div className="flex min-h-10 items-center rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 font-mono text-sm text-[var(--nimi-field-text)]">
          {NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT}
        </div>
      </div>
      <div className="space-y-1.5 text-sm font-medium text-[var(--nimi-text-secondary)]">
        <span>{t('runtimeConfig.machineLocalAIConfigurations.engine')}</span>
        <div className="flex min-h-10 items-center rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)]">
          llama.cpp
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.machineLocalAIConfigurations.inputSupport')}
        </legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm">
          <input
            type="checkbox"
            checked={props.acceptsImageInput}
            disabled={props.busy}
            onChange={(event) => props.onAcceptsImageInputChange(event.currentTarget.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-[var(--nimi-text-primary)]">
              {props.acceptsImageInput
                ? t('runtimeConfig.machineLocalAIConfigurations.textAndImages')
                : t('runtimeConfig.machineLocalAIConfigurations.textOnly')}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--nimi-text-muted)]">
              {props.acceptsImageInput
                ? t('runtimeConfig.machineLocalAIConfigurations.textAndImagesBody')
                : t('runtimeConfig.machineLocalAIConfigurations.textOnlyBody')}
            </span>
          </span>
        </label>
      </fieldset>
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

function MachineLocalAIConfigurationCard(props: {
  readonly configuration: NimiMachineLocalCapabilityConfiguration;
  readonly assets: readonly NimiRuntimeLocalAssetEntry[];
  readonly selected: boolean;
  readonly busyAction: string;
  readonly deleteConfirmation: boolean;
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
}) {
  const { t } = useTranslation();
  const { configuration } = props;
  const fileState = machineLocalConfigurationFileState(configuration);
  const anyBusy = Boolean(props.busyAction);
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
            onClick={() => props.onRequestDelete(configuration.configurationId)}
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
        ) : configuration.projectedRequirements.map((requirement) => {
          const currentBinding = configuration.exactBindings.find(
            (binding) => binding.requirementId === requirement.requirementId,
          );
          const compatibleAssets = compatibleMachineLocalAssets(requirement, props.assets);
          const choiceKey = requirementChoiceKey(
            configuration.configurationId,
            requirement.requirementId,
          );
          const choice = props.assetChoiceByRequirement[choiceKey] ?? '';
          const currentAsset = currentBinding
            ? props.assets.find((asset) => asset.localAssetId === currentBinding.localAssetId)
            : undefined;
          return (
            <div
              key={requirement.requirementId}
              className="grid gap-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3 lg:grid-cols-[minmax(160px,0.8fr)_minmax(240px,1.4fr)_auto] lg:items-end"
            >
              <div>
                <div className="text-sm font-medium text-[var(--nimi-text-primary)]">
                  {requirementDisplayName(requirement, t)}
                </div>
                <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {currentBinding
                    ? t('runtimeConfig.machineLocalAIConfigurations.bound')
                    : t('runtimeConfig.machineLocalAIConfigurations.fileNeeded')}
                  {currentBinding
                    ? ` · ${localAssetDisplayName(currentAsset, t, true)}`
                    : ''}
                </div>
              </div>
              <label className="space-y-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
                <span>{currentBinding
                  ? t('runtimeConfig.machineLocalAIConfigurations.chooseReplacement')
                  : t('runtimeConfig.machineLocalAIConfigurations.chooseFile')}</span>
                <select
                  aria-label={requirementDisplayName(requirement, t)}
                  value={choice}
                  disabled={anyBusy || compatibleAssets.length === 0}
                  onChange={(event) => props.onAssetChoiceChange(
                    configuration.configurationId,
                    requirement.requirementId,
                    event.currentTarget.value,
                  )}
                  className="min-h-10 w-full rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)] disabled:opacity-[var(--nimi-opacity-disabled)]"
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
                  disabled={anyBusy || !choice}
                  onClick={() => props.onBind(configuration, requirement, currentBinding)}
                >
                  {currentBinding
                    ? t('runtimeConfig.machineLocalAIConfigurations.replace')
                    : t('runtimeConfig.machineLocalAIConfigurations.bind')}
                </Button>
                {currentBinding ? (
                  <Button
                    size="sm"
                    tone="ghost"
                    disabled={anyBusy}
                    onClick={() => props.onUnbind(configuration, requirement, currentBinding)}
                  >
                    {t('runtimeConfig.machineLocalAIConfigurations.unbind')}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

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
  return t('runtimeConfig.machineLocalAIConfigurations.otherEngine');
}

function requirementDisplayName(
  requirement: NimiMachineLocalCapabilityRequirement,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (requirement.resourceKind.toLowerCase() === 'mmproj') {
    return t('runtimeConfig.machineLocalAIConfigurations.imageSupportFile');
  }
  return requirement.role === 'main'
    ? t('runtimeConfig.machineLocalAIConfigurations.primaryFile')
    : t('runtimeConfig.machineLocalAIConfigurations.supportingFile');
}

function localAssetDisplayName(
  asset: NimiRuntimeLocalAssetEntry | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  bound = false,
): string {
  return asset?.displayName
    || asset?.sourceFileName
    || (bound
      ? t('runtimeConfig.machineLocalAIConfigurations.boundLocalFile')
      : t('runtimeConfig.machineLocalAIConfigurations.unnamedLocalFile'));
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
