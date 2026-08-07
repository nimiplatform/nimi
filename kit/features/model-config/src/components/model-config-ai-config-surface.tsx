import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiCapabilityAIConfigIntent,
  type NimiJsonObject,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  Button,
  Checkbox,
  InlineAlert,
  SegmentedControl,
  SelectField,
  StatusBadge,
  Surface,
  TextareaField,
  TextField,
  cn,
} from '@nimiplatform/kit/ui';
import {
  ModelPickerDialog,
  ModelSelectorTrigger,
  type ModelPickerCandidateAdapter,
} from '@nimiplatform/kit/features/model-picker';
import { resolveModelConfigCopy } from '../copy.js';
import {
  modelConfigCapabilityFallbackLabel,
  modelConfigCapabilityPosture,
  modelConfigMissingRequiredFeatures,
} from '../projection.js';
import type {
  ModelConfigAIConfigOwnerContext,
  ModelConfigCloudAIConfigModule,
  ModelConfigCloudAuthorizationOptions,
  ModelConfigCloudImplementationOption,
  ModelConfigCloudTargetOption,
  ModelConfigCopy,
  ModelConfigFormattedError,
  ModelConfigLocalSelectionProjection,
  ModelConfigOverwrite,
} from '../types.js';
import { ModelConfigOwnerBoundary } from './model-config-owner-boundary.js';

const EMPTY_AUTHORIZATION: ModelConfigCloudAuthorizationOptions = Object.freeze({
  connectors: Object.freeze([]),
  grants: Object.freeze([]),
});

export type ModelConfigAIConfigSurfaceProps = {
  readonly context: ModelConfigAIConfigOwnerContext;
  readonly capabilityContracts: readonly string[];
  /** Null is canonical absence/not configured; undefined is an unavailable read. */
  readonly capabilities: readonly NimiCapabilityAIConfigIntent[] | null | undefined;
  readonly localSelections?: readonly ModelConfigLocalSelectionProjection[];
  readonly cloudAIConfig?: ModelConfigCloudAIConfigModule;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly loadError?: string | null;
  readonly onRetry?: () => void;
  readonly onOverwrite: ModelConfigOverwrite;
  readonly onOpenMachineConfiguration?: (capabilityContract: string) => void;
  readonly formatError?: (error: unknown) => ModelConfigFormattedError;
  readonly copy?: ModelConfigCopy;
  readonly className?: string;
  readonly titleId?: string;
  readonly headerSlot?: ReactNode;
  readonly footer?: ReactNode;
};

function uniqueContracts(
  requested: readonly string[],
  capabilities: readonly NimiCapabilityAIConfigIntent[] | null | undefined,
): readonly string[] {
  return [...new Set([
    ...requested.map((entry) => entry.trim()).filter(Boolean),
    ...(capabilities || []).map((entry) => entry.capabilityContract.trim()).filter(Boolean),
  ])];
}

function statusBadge(
  posture: ReturnType<typeof modelConfigCapabilityPosture>,
  copy: ReturnType<typeof resolveModelConfigCopy>,
): { readonly label: string; readonly tone: 'neutral' | 'success' | 'warning' } {
  switch (posture) {
    case 'local-configured':
    case 'cloud-configured':
      return { label: copy.configuredLabel, tone: 'success' };
    case 'cloud-selection-required':
    case 'local-selection-missing':
      return { label: copy.selectionRequiredLabel, tone: 'warning' };
    case 'local-configuration-blocked':
      return { label: copy.blockedLabel, tone: 'warning' };
    case 'local-feature-mismatch':
      return { label: copy.mismatchLabel, tone: 'warning' };
    case 'not-configured':
      return { label: copy.notConfiguredLabel, tone: 'neutral' };
  }
}

function descriptorLabel(
  capabilityContract: string,
  descriptor: CanonicalCapabilityDescriptor | undefined,
  copy: ReturnType<typeof resolveModelConfigCopy>,
): string {
  return copy.capabilityLabel(
    capabilityContract,
    modelConfigCapabilityFallbackLabel(descriptor?.capabilityId || capabilityContract),
  );
}

function descriptorDescription(
  capabilityContract: string,
  descriptor: CanonicalCapabilityDescriptor | undefined,
  copy: ReturnType<typeof resolveModelConfigCopy>,
): string {
  const fallback = descriptor
    ? `${descriptor.runtimeEvidenceClass} capability · ${descriptor.governance.dataMovement}`
    : capabilityContract;
  return copy.capabilityDescription(capabilityContract, fallback);
}

export function ModelConfigAIConfigSurface(props: ModelConfigAIConfigSurfaceProps) {
  const copy = useMemo(() => resolveModelConfigCopy(props.copy), [props.copy]);
  const contracts = useMemo(
    () => uniqueContracts(props.capabilityContracts, props.capabilities),
    [props.capabilities, props.capabilityContracts],
  );
  const [activeContract, setActiveContract] = useState<string | null>(() => (
    contracts.length === 1 ? contracts[0] ?? null : null
  ));

  useEffect(() => {
    if (contracts.length === 1) {
      setActiveContract(contracts[0] ?? null);
      return;
    }
    if (activeContract && !contracts.includes(activeContract)) setActiveContract(null);
  }, [activeContract, contracts]);

  const configuredCount = contracts.filter((contract) => (
    props.capabilities?.some((intent) => intent.capabilityContract === contract)
  )).length;
  const activeIntent = activeContract
    ? props.capabilities?.find((intent) => intent.capabilityContract === activeContract) ?? null
    : null;
  const activeSelection = activeContract
    ? props.localSelections?.find((selection) => selection.capabilityContract === activeContract) ?? null
    : null;
  const activeDescriptor = activeContract
    ? CANONICAL_CAPABILITY_CATALOG_BY_ID[activeContract]
    : undefined;

  return (
    <ModelConfigOwnerBoundary context={props.context} className={cn('space-y-4', props.className)}>
      {props.headerSlot}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={props.titleId} className="m-0 text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{copy.title}</h2>
          <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{copy.description}</p>
        </div>
        <StatusBadge tone={configuredCount > 0 ? 'success' : 'neutral'}>
          {configuredCount > 0 ? `${configuredCount}/${contracts.length}` : copy.notConfiguredLabel}
        </StatusBadge>
      </div>

      {props.loadError ? (
        <div className="flex flex-wrap items-center gap-2">
          <InlineAlert tone="warning">{props.loadError || copy.loadFailed}</InlineAlert>
          {props.onRetry ? <Button size="sm" tone="secondary" onClick={props.onRetry}>{copy.retryLabel}</Button> : null}
        </div>
      ) : null}
      {props.loading ? <div className="text-xs text-[var(--nimi-text-muted)]">…</div> : null}

      {!props.loading && !props.loadError && contracts.length > 1 && activeContract === null ? (
        <div className="grid gap-2 sm:grid-cols-2" data-nimi-model-config-capability-grid="true">
          {contracts.map((contract) => {
            const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[contract];
            const intent = props.capabilities?.find((entry) => entry.capabilityContract === contract) ?? null;
            const selection = props.localSelections?.find((entry) => entry.capabilityContract === contract) ?? null;
            const badge = statusBadge(modelConfigCapabilityPosture(intent, selection), copy);
            return (
              <button
                type="button"
                key={contract}
                onClick={() => setActiveContract(contract)}
                className="flex min-w-0 items-start gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-left transition-colors hover:border-[var(--nimi-border-strong)]"
                data-nimi-model-config-capability={contract}
              >
                <span className={cn(
                  'mt-0.5 h-2 w-2 shrink-0 rounded-[var(--nimi-radius-full)]',
                  badge.tone === 'success' ? 'bg-[var(--nimi-status-success)]' : badge.tone === 'warning' ? 'bg-[var(--nimi-status-warning)]' : 'bg-[var(--nimi-text-muted)]',
                )} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{descriptorLabel(contract, descriptor, copy)}</span>
                  <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">{descriptorDescription(contract, descriptor, copy)}</span>
                </span>
                <StatusBadge tone={badge.tone} className="shrink-0 text-[10px]">{badge.label}</StatusBadge>
              </button>
            );
          })}
        </div>
      ) : null}

      {!props.loading && !props.loadError && activeContract ? (
        <div className="space-y-3" data-nimi-model-config-detail={activeContract}>
          {contracts.length > 1 ? (
            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]" onClick={() => setActiveContract(null)}>
              <span aria-hidden="true">←</span> {copy.backLabel}
            </button>
          ) : null}
          <CapabilityIntentEditor
            key={activeContract}
            capabilityContract={activeContract}
            descriptor={activeDescriptor}
            currentIntent={activeIntent}
            allCapabilities={props.capabilities || []}
            selection={activeSelection}
            context={props.context}
            cloudAIConfig={props.cloudAIConfig}
            onOverwrite={props.onOverwrite}
            onOpenMachineConfiguration={props.onOpenMachineConfiguration}
            formatError={props.formatError}
            copy={copy}
            disabled={props.disabled}
          />
        </div>
      ) : null}
      {props.footer}
    </ModelConfigOwnerBoundary>
  );
}

function parseDefaults(value: string): NimiJsonObject | undefined {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Portable defaults must be a JSON object.');
  }
  return parsed as NimiJsonObject;
}

function targetText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function targetOptionId(provider: string, modelId: string): string {
  return JSON.stringify([provider, modelId]);
}

function defaultFormatError(error: unknown, fallback: string): ModelConfigFormattedError {
  return {
    message: fallback,
    technicalDetail: error instanceof Error ? error.message : String(error),
  };
}

type CapabilityIntentEditorProps = {
  readonly capabilityContract: string;
  readonly descriptor?: CanonicalCapabilityDescriptor;
  readonly currentIntent: NimiCapabilityAIConfigIntent | null;
  readonly allCapabilities: readonly NimiCapabilityAIConfigIntent[];
  readonly selection: ModelConfigLocalSelectionProjection | null;
  readonly context: ModelConfigAIConfigOwnerContext;
  readonly cloudAIConfig?: ModelConfigCloudAIConfigModule;
  readonly onOverwrite: ModelConfigOverwrite;
  readonly onOpenMachineConfiguration?: (capabilityContract: string) => void;
  readonly formatError?: (error: unknown) => ModelConfigFormattedError;
  readonly copy: ReturnType<typeof resolveModelConfigCopy>;
  readonly disabled?: boolean;
};

function CapabilityIntentEditor(props: CapabilityIntentEditorProps) {
  const currentCloud = props.currentIntent?.route.oneofKind === 'cloud'
    ? props.currentIntent.route.cloud
    : null;
  const currentTarget = useMemo(
    () => runtimeAIConfigStructToJson(currentCloud?.providerModelTarget),
    [currentCloud?.providerModelTarget],
  );
  const currentProvider = targetText(currentTarget.provider);
  const currentModel = targetText(currentTarget.providerModelId) || targetText(currentTarget.model);
  const currentDefaults = useMemo(
    () => runtimeAIConfigStructToJson(props.currentIntent?.defaults),
    [props.currentIntent?.defaults],
  );
  const syncKey = useMemo(() => JSON.stringify({
    route: props.currentIntent?.route.oneofKind || null,
    requiredFeatures: props.currentIntent?.requiredFeatures || [],
    defaults: currentDefaults,
    provider: currentProvider,
    model: currentModel,
    grantId: currentCloud?.connectorGrantId || '',
  }), [currentCloud?.connectorGrantId, currentDefaults, currentModel, currentProvider, props.currentIntent]);
  const lastSyncKey = useRef('');
  const [routeDraft, setRouteDraft] = useState<'local' | 'cloud'>(
    props.currentIntent?.route.oneofKind === 'cloud' ? 'cloud' : 'local',
  );
  const [featuresDraft, setFeaturesDraft] = useState(props.currentIntent?.requiredFeatures.join(', ') || '');
  const [defaultsDraft, setDefaultsDraft] = useState(Object.keys(currentDefaults).length > 0 ? JSON.stringify(currentDefaults, null, 2) : '');
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<ModelConfigFormattedError | null>(null);
  const [draftError, setDraftError] = useState('');
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [implementations, setImplementations] = useState<readonly ModelConfigCloudImplementationOption[]>([]);
  const [targets, setTargets] = useState<readonly ModelConfigCloudTargetOption[]>([]);
  const [authorization, setAuthorization] = useState<ModelConfigCloudAuthorizationOptions>(EMPTY_AUTHORIZATION);
  const [implementationId, setImplementationId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [grantId, setGrantId] = useState(currentCloud?.connectorGrantId || '');
  const [connectorId, setConnectorId] = useState('');
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (lastSyncKey.current === syncKey) return;
    lastSyncKey.current = syncKey;
    setRouteDraft(props.currentIntent?.route.oneofKind === 'cloud' ? 'cloud' : 'local');
    setFeaturesDraft(props.currentIntent?.requiredFeatures.join(', ') || '');
    setDefaultsDraft(Object.keys(currentDefaults).length > 0 ? JSON.stringify(currentDefaults, null, 2) : '');
    setGrantId(currentCloud?.connectorGrantId || '');
    setSaveFailure(null);
    setDraftError('');
    setTargetConfirmed(false);
    setImpactConfirmed(false);
  }, [currentCloud?.connectorGrantId, currentDefaults, props.currentIntent, syncKey]);

  const selectedImplementation = implementations.find((entry) => entry.optionId === implementationId) || null;
  const selectedTarget = targets.find((entry) => entry.targetId === targetId) || null;
  const selectedGrant = authorization.grants.find((entry) => entry.grantId === grantId) || null;
  const matchingConnectors = authorization.connectors.filter((entry) => entry.provider === selectedImplementation?.provider);
  const matchingGrants = authorization.grants.filter((grant) => authorization.connectors.some((connector) => (
    connector.connectorId === grant.connectorId && connector.provider === selectedImplementation?.provider
  )));
  const selectedConnector = authorization.connectors.find((entry) => entry.connectorId === selectedGrant?.connectorId) || null;
  const accountLabel = selectedConnector?.label || selectedGrant?.grantId || props.copy.cloudAuthorizationNone;

  const loadCloud = useCallback(async () => {
    if (!props.cloudAIConfig) return;
    setCloudLoading(true);
    setCloudError('');
    try {
      const [nextImplementations, nextAuthorization] = await Promise.all([
        props.cloudAIConfig.listImplementations(props.capabilityContract),
        props.context.consumer === 'nimi-first-party'
          ? props.cloudAIConfig.listAuthorizationOptions()
          : Promise.resolve(EMPTY_AUTHORIZATION),
      ]);
      setImplementations(nextImplementations);
      setAuthorization(nextAuthorization);
      const current = nextImplementations.find((entry) => (
        entry.implementation.implementationId === currentCloud?.implementation?.implementationId
        || entry.provider === currentProvider
      ));
      setImplementationId((value) => value || current?.optionId || '');
      setCloudLoaded(true);
    } catch {
      setCloudError(props.copy.cloudLoadFailed);
      setCloudLoaded(true);
    } finally {
      setCloudLoading(false);
    }
  }, [currentCloud?.implementation?.implementationId, currentProvider, props.capabilityContract, props.cloudAIConfig, props.context.consumer, props.copy.cloudLoadFailed]);

  useEffect(() => {
    if (routeDraft !== 'cloud' || !props.cloudAIConfig || cloudLoaded) return;
    void loadCloud();
  }, [cloudLoaded, loadCloud, props.cloudAIConfig, reloadNonce, routeDraft]);

  useEffect(() => {
    if (routeDraft !== 'cloud' || !props.cloudAIConfig || !selectedImplementation) {
      setTargets([]);
      return;
    }
    let cancelled = false;
    setCloudLoading(true);
    setCloudError('');
    void props.cloudAIConfig.listTargets({
      capabilityContract: props.capabilityContract,
      provider: selectedImplementation.provider,
    }).then((nextTargets) => {
      if (cancelled) return;
      setTargets(nextTargets);
      const currentId = currentProvider === selectedImplementation.provider && currentModel
        ? targetOptionId(currentProvider, currentModel)
        : '';
      setTargetId((value) => value || (nextTargets.some((entry) => entry.targetId === currentId) ? currentId : ''));
    }).catch(() => {
      if (!cancelled) setCloudError(props.copy.cloudLoadFailed);
    }).finally(() => {
      if (!cancelled) setCloudLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentModel, currentProvider, props.capabilityContract, props.cloudAIConfig, props.copy.cloudLoadFailed, reloadNonce, routeDraft, selectedImplementation]);

  const targetAdapter = useMemo<ModelPickerCandidateAdapter<ModelConfigCloudTargetOption>>(() => ({
    listCandidates: () => targets,
    getId: (entry) => entry.targetId,
    getTitle: (entry) => entry.label,
    getSource: (entry) => entry.provider,
    getSearchText: (entry) => JSON.stringify(entry.providerModelTarget),
    getDetailRows: (entry) => Object.entries(entry.providerModelTarget).map(([label, value]) => ({
      label,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    })),
  }), [targets]);

  const createGrant = async () => {
    if (!props.cloudAIConfig || !connectorId || saving) return;
    setSaving(true);
    setCloudError('');
    try {
      const grant = await props.cloudAIConfig.createGrant(connectorId);
      setAuthorization(await props.cloudAIConfig.listAuthorizationOptions());
      setGrantId(grant.grantId);
      setImpactConfirmed(false);
    } catch {
      setCloudError(props.copy.cloudLoadFailed);
    } finally {
      setSaving(false);
    }
  };

  const commit = async () => {
    if (saving || !props.descriptor) return;
    setDraftError('');
    setSaveFailure(null);
    try {
      const requiredFeatures = [...new Set(featuresDraft.split(',').map((entry) => entry.trim()).filter(Boolean))];
      const defaults = parseDefaults(defaultsDraft);
      let intent: NimiCapabilityAIConfigIntent;
      if (routeDraft === 'local') {
        intent = createNimiLocalAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          requiredFeatures,
          ...(defaults ? { defaults } : {}),
        });
      } else {
        if (!selectedImplementation || !selectedTarget || !targetConfirmed || !impactConfirmed) return;
        if (grantId && selectedGrant?.status !== 'active') return;
        intent = createNimiCloudAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          requiredFeatures,
          ...(defaults ? { defaults } : {}),
          implementation: selectedImplementation.implementation,
          providerModelTarget: selectedTarget.providerModelTarget,
          connectorGrantId: props.context.consumer === 'nimi-first-party' ? (grantId || null) : null,
        });
      }
      const next = props.allCapabilities
        .filter((entry) => entry.capabilityContract !== props.capabilityContract)
        .concat(intent);
      setSaving(true);
      await props.onOverwrite(next);
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message.includes('Portable defaults'))) {
        setDraftError(error.message);
      } else {
        setSaveFailure(props.formatError?.(error) || defaultFormatError(error, props.copy.saveFailed));
      }
    } finally {
      setSaving(false);
    }
  };

  const posture = modelConfigCapabilityPosture(props.currentIntent, props.selection);
  const badge = statusBadge(posture, props.copy);
  const missingFeatures = modelConfigMissingRequiredFeatures(props.currentIntent, props.selection);
  const routeDisabled = Boolean(props.disabled) || saving || !props.descriptor;

  return (
    <Surface tone="card" className="space-y-4 border border-[var(--nimi-border-subtle)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{descriptorLabel(props.capabilityContract, props.descriptor, props.copy)}</h3>
          <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">{descriptorDescription(props.capabilityContract, props.descriptor, props.copy)}</p>
        </div>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>

      {!props.descriptor ? <InlineAlert tone="warning">{props.copy.unsupportedCapabilityLabel}</InlineAlert> : null}

      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">{props.copy.routeLabel}</div>
        <SegmentedControl
          ariaLabel={props.copy.routeLabel}
          size="sm"
          value={routeDraft}
          onValueChange={(value) => {
            setRouteDraft(value === 'cloud' ? 'cloud' : 'local');
            setSaveFailure(null);
            setDraftError('');
            setTargetConfirmed(false);
            setImpactConfirmed(false);
          }}
          items={[
            { value: 'local', label: props.copy.localLabel, disabled: routeDisabled },
            { value: 'cloud', label: props.copy.cloudLabel, disabled: routeDisabled || !props.cloudAIConfig },
          ]}
        />
      </div>

      {routeDraft === 'local' ? (
        <LocalSelectionSummary
          selection={props.selection}
          missingFeatures={missingFeatures}
          copy={props.copy}
          onOpenMachineConfiguration={props.onOpenMachineConfiguration ? () => props.onOpenMachineConfiguration?.(props.capabilityContract) : undefined}
        />
      ) : null}

      <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-secondary)]">
        <summary className="cursor-pointer font-semibold">{props.copy.advancedLabel}</summary>
        <p className="m-0 mt-2 text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">{props.copy.advancedHint}</p>
        <div className="mt-3 space-y-4">
          <label className="grid gap-1.5">
            <span className="font-semibold">{props.copy.requiredFeaturesLabel}</span>
            <TextField value={featuresDraft} onChange={(event) => setFeaturesDraft(event.currentTarget.value)} placeholder={props.copy.requiredFeaturesPlaceholder} />
          </label>
          <label className="grid gap-1.5">
            <span className="font-semibold">{props.copy.defaultsLabel}</span>
            <TextareaField value={defaultsDraft} onChange={(event) => setDefaultsDraft(event.currentTarget.value)} placeholder={props.copy.defaultsPlaceholder} rows={4} textareaClassName="font-mono text-xs" />
          </label>
        </div>
      </details>

      {routeDraft === 'cloud' ? (
        <div className="space-y-4 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3" data-nimi-model-config-cloud="true">
          {cloudError ? (
            <div className="flex flex-wrap items-center gap-2">
              <InlineAlert tone="warning">{cloudError}</InlineAlert>
              <Button size="sm" tone="secondary" onClick={() => {
                setCloudLoaded(false);
                setCloudError('');
                setReloadNonce((value) => value + 1);
              }}>{props.copy.retryLabel}</Button>
            </div>
          ) : null}
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)]">
            <span>{props.copy.cloudImplementationLabel}</span>
            <SelectField
              aria-label={props.copy.cloudImplementationLabel}
              value={implementationId}
              placeholder={props.copy.cloudImplementationPlaceholder}
              disabled={cloudLoading || saving}
              options={implementations.map((entry) => ({ value: entry.optionId, label: entry.label }))}
              onValueChange={(value) => {
                setImplementationId(value);
                setTargetId('');
                setGrantId('');
                setConnectorId('');
                setTargetConfirmed(false);
                setImpactConfirmed(false);
              }}
            />
          </label>
          <div className="grid gap-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)]">
            <span>{props.copy.cloudTargetLabel}</span>
            <ModelSelectorTrigger
              label={selectedTarget?.label || null}
              detail={selectedTarget?.provider || null}
              placeholder={props.copy.cloudTargetPlaceholder}
              disabled={!selectedImplementation || cloudLoading || saving}
              onClick={() => setPickerOpen(true)}
            />
            <ModelPickerDialog
              open={pickerOpen}
              title={props.copy.cloudTargetDialogTitle}
              description={props.copy.cloudTargetDialogDescription}
              adapter={targetAdapter}
              selectedId={targetId}
              copy={{ cancelLabel: props.copy.cancelLabel, confirmLabel: props.copy.confirmSelectionLabel }}
              onClose={() => setPickerOpen(false)}
              onConfirm={(target) => {
                setTargetId(target.targetId);
                setTargetConfirmed(false);
                setImpactConfirmed(false);
              }}
            />
          </div>
          <Checkbox
            checked={targetConfirmed}
            disabled={!selectedTarget || saving}
            onChange={(event) => setTargetConfirmed(event.currentTarget.checked)}
            label={props.copy.cloudTargetConfirmation}
            className="items-start [&>span:last-child]:whitespace-normal"
          />

          {props.context.consumer === 'nimi-first-party' ? (
            <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-3">
              <label className="grid gap-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                <span>{props.copy.cloudAuthorizationLabel}</span>
                <SelectField
                  aria-label={props.copy.cloudAuthorizationLabel}
                  value={grantId}
                  placeholder={props.copy.cloudAuthorizationNone}
                  disabled={!selectedImplementation || saving}
                  options={matchingGrants.map((grant) => ({
                    value: grant.grantId,
                    label: `${authorization.connectors.find((entry) => entry.connectorId === grant.connectorId)?.label || grant.connectorId} · ${grant.status}`,
                    disabled: grant.status !== 'active',
                  }))}
                  onValueChange={(value) => {
                    setGrantId(value);
                    setImpactConfirmed(false);
                  }}
                />
              </label>
              {!grantId ? <InlineAlert tone="info">{props.copy.cloudAuthorizationNeeded}</InlineAlert> : null}
              {grantId && selectedGrant?.status !== 'active' ? <InlineAlert tone="warning">{props.copy.cloudAuthorizationRevoked}</InlineAlert> : null}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <SelectField
                  aria-label={props.copy.cloudConnectorLabel}
                  value={connectorId}
                  placeholder={props.copy.cloudConnectorPlaceholder}
                  disabled={!selectedImplementation || saving}
                  options={matchingConnectors.map((entry) => ({ value: entry.connectorId, label: entry.label }))}
                  onValueChange={setConnectorId}
                />
                <Button size="sm" tone="secondary" disabled={!connectorId || saving} onClick={() => { void createGrant(); }}>{props.copy.cloudCreateGrantLabel}</Button>
              </div>
              <p className="m-0 text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">{props.copy.cloudAuthorizationSeparation}</p>
            </div>
          ) : null}

          <InlineAlert tone="info">
            <div className="space-y-2">
              <div className="font-semibold">{props.copy.cloudAccountLabel(accountLabel)}</div>
              <Checkbox
                checked={impactConfirmed}
                disabled={!selectedImplementation || !selectedTarget || saving}
                onChange={(event) => setImpactConfirmed(event.currentTarget.checked)}
                label={props.context.owner === 'shared-local-agent-ai-config'
                  ? props.copy.cloudImpactSharedLabel(accountLabel)
                  : props.copy.cloudImpactAppLabel(accountLabel)}
                className="items-start [&>span:last-child]:whitespace-normal"
              />
            </div>
          </InlineAlert>
        </div>
      ) : null}

      {draftError ? <InlineAlert tone="danger">{draftError}</InlineAlert> : null}
      {saveFailure ? (
        <div className="space-y-2">
          <InlineAlert tone="danger">{saveFailure.message}</InlineAlert>
          {saveFailure.technicalDetail ? (
            <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-2 text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer font-semibold">{props.copy.technicalDetailsLabel}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">{saveFailure.technicalDetail}</pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          tone="primary"
          disabled={routeDisabled || (routeDraft === 'cloud' && (
            cloudLoading || !selectedImplementation || !selectedTarget || !targetConfirmed || !impactConfirmed || (Boolean(grantId) && selectedGrant?.status !== 'active')
          ))}
          onClick={() => { void commit(); }}
          data-testid={`model-config-save:${props.capabilityContract}`}
        >
          {saving ? props.copy.savingLabel : routeDraft === 'cloud' ? props.copy.saveCloudLabel : props.copy.saveLocalLabel}
        </Button>
      </div>
    </Surface>
  );
}

function LocalSelectionSummary(props: {
  readonly selection: ModelConfigLocalSelectionProjection | null;
  readonly missingFeatures: readonly string[];
  readonly copy: ReturnType<typeof resolveModelConfigCopy>;
  readonly onOpenMachineConfiguration?: () => void;
}) {
  const selection = props.selection;
  let tone: 'info' | 'warning' | 'success' = 'warning';
  let message = props.copy.localMissingLabel;
  if (selection?.state === 'unavailable') {
    tone = 'info';
    message = props.copy.localUnavailableLabel;
  } else if (selection?.state === 'broken') {
    message = `${props.copy.localBrokenLabel}${selection.reasons.length > 0 ? ` ${selection.reasons.join(', ')}` : ''}`;
  } else if (selection?.state === 'selected' && props.missingFeatures.length > 0) {
    message = props.copy.localMismatchLabel(props.missingFeatures.join(', '));
  } else if (selection?.state === 'selected') {
    tone = 'success';
    message = `${props.copy.localSelectedLabel}: ${selection.displayName || selection.configurationId || ''}`;
  }
  return (
    <div className="space-y-2">
      <InlineAlert tone={tone}>{message}</InlineAlert>
      {props.onOpenMachineConfiguration ? (
        <Button size="sm" tone="secondary" onClick={props.onOpenMachineConfiguration}>{props.copy.openMachineLabel}</Button>
      ) : null}
    </div>
  );
}
