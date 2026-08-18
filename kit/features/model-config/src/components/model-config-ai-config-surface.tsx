import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiCapabilityAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  Button,
  Checkbox,
  InlineAlert,
  SelectField,
  StatusBadge,
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
  modelConfigHasExactCloudTarget,
  modelConfigJsonHasExactCloudTarget,
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
import { sanitizeCapabilityDefaults } from '../capability-defaults.js';
import { CapabilityDefaultsEditor } from './capability-defaults-editor.js';
import { ModelConfigOwnerBoundary } from './model-config-owner-boundary.js';

const EMPTY_AUTHORIZATION: ModelConfigCloudAuthorizationOptions = Object.freeze({
  connectors: Object.freeze([]),
});

type ResolvedCopy = ReturnType<typeof resolveModelConfigCopy>;
type PostureBadge = {
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'warning';
};

type ModelConfigRouteChoice =
  | {
      readonly id: 'local';
      readonly route: 'local';
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly route: 'cloud';
      readonly label: string;
      readonly description: string;
      readonly provider: string;
      readonly implementation: ModelConfigCloudImplementationOption;
      readonly target: ModelConfigCloudTargetOption;
    };

export type ModelConfigAIConfigSurfaceProps = {
  readonly context: ModelConfigAIConfigOwnerContext;
  readonly capabilityContracts: readonly string[];
  /** Opens one requested capability detail on first mount when it is in capabilityContracts. */
  readonly initialCapabilityContract?: string | null;
  /** Null is canonical absence/not configured; undefined is an unavailable read. */
  readonly capabilities: readonly NimiCapabilityAIConfigIntent[] | null | undefined;
  readonly localSelections?: readonly ModelConfigLocalSelectionProjection[];
  readonly cloudAIConfig?: ModelConfigCloudAIConfigModule;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly loadError?: string | null;
  readonly onRetry?: () => void;
  readonly onOverwrite?: ModelConfigOverwrite;
  /** Opens the Nimi-owned owner surface for read-only protected App mounts. */
  readonly onOpenOwnerConfiguration?: () => void;
  readonly onOpenMachineConfiguration?: (capabilityContract: string) => void;
  readonly onOpenCloudConnectorConfiguration?: () => void;
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
  copy: ResolvedCopy,
): PostureBadge {
  switch (posture) {
    case 'local-configured':
    case 'cloud-configured':
      return { label: copy.configuredLabel, tone: 'success' };
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
  copy: ResolvedCopy,
): string {
  return copy.capabilityLabel(
    capabilityContract,
    modelConfigCapabilityFallbackLabel(descriptor?.capabilityId || capabilityContract),
  );
}

function descriptorDescription(
  capabilityContract: string,
  descriptor: CanonicalCapabilityDescriptor | undefined,
  copy: ResolvedCopy,
): string {
  const fallback = descriptor
    ? `${descriptor.runtimeEvidenceClass} capability · ${descriptor.governance.dataMovement}`
    : capabilityContract;
  return copy.capabilityDescription(capabilityContract, fallback);
}

function targetText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloudChoiceId(implementationId: string, targetId: string): string {
  return JSON.stringify(['cloud', implementationId, targetId]);
}

function localChoice(
  selection: ModelConfigLocalSelectionProjection | null,
  copy: ResolvedCopy,
): ModelConfigRouteChoice {
  let description = copy.localChoiceDescription;
  if (selection?.state === 'selected') {
    description = copy.localSelectedLabel;
  } else if (selection?.state === 'broken') {
    description = copy.localBrokenLabel;
  } else if (selection?.state === 'unavailable') {
    description = copy.localUnavailableLabel;
  }
  return {
    id: 'local',
    route: 'local',
    label: selection?.displayName || copy.localLabel,
    description,
  };
}

function routeChoices(
  local: ModelConfigRouteChoice,
  groups: readonly {
    readonly implementation: ModelConfigCloudImplementationOption;
    readonly targets: readonly ModelConfigCloudTargetOption[];
  }[],
): readonly ModelConfigRouteChoice[] {
  const choices = new Map<string, ModelConfigRouteChoice>();
  choices.set(local.id, local);
  for (const group of groups) {
    for (const target of group.targets) {
      const id = cloudChoiceId(group.implementation.implementation.implementationId, target.targetId);
      choices.set(id, {
        id,
        route: 'cloud',
        label: target.label,
        description: group.implementation.label,
        provider: group.implementation.provider,
        implementation: group.implementation,
        target,
      });
    }
  }
  return [...choices.values()];
}

function currentRouteChoice(
  intent: NimiCapabilityAIConfigIntent | null,
  selection: ModelConfigLocalSelectionProjection | null,
  copy: ResolvedCopy,
): ModelConfigRouteChoice | null {
  if (intent?.route.oneofKind === 'local') return localChoice(selection, copy);
  if (intent?.route.oneofKind !== 'cloud') return null;
  const cloud = intent.route.cloud;
  const target = runtimeAIConfigStructToJson(cloud.providerModelTarget);
  const provider = targetText(target.provider);
  const modelId = targetText(target.providerModelId);
  const remoteModelCatalogId = targetText(target.remoteModelCatalogId);
  const implementationId = cloud.implementation?.implementationId || '';
  if (!modelConfigHasExactCloudTarget(intent) || !provider || !modelId || !remoteModelCatalogId || !implementationId || !cloud.implementation) return null;
  const targetId = remoteModelCatalogId;
  return {
    id: cloudChoiceId(implementationId, targetId),
    route: 'cloud',
    label: modelId,
    description: provider,
    provider,
    implementation: {
      optionId: implementationId,
      label: implementationId,
      provider,
      implementation: cloud.implementation,
    },
    target: {
      targetId,
      label: modelId,
      provider,
      providerModelTarget: target,
    },
  };
}

function cloudModelLabel(intent: NimiCapabilityAIConfigIntent | null): string | null {
  if (!modelConfigHasExactCloudTarget(intent) || intent?.route.oneofKind !== 'cloud') return null;
  const target = runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget);
  return targetText(target.providerModelId) || null;
}

function capabilitySummary(
  intent: NimiCapabilityAIConfigIntent | null,
  selection: ModelConfigLocalSelectionProjection | null,
  descriptor: CanonicalCapabilityDescriptor | undefined,
  copy: ResolvedCopy,
): string {
  const posture = modelConfigCapabilityPosture(intent, selection);
  if (posture === 'local-configured') {
    return selection?.displayName || selection?.configurationId || copy.configuredLabel;
  }
  if (posture === 'cloud-configured') {
    return cloudModelLabel(intent) || statusBadge(posture, copy).label;
  }
  if (posture !== 'not-configured') return statusBadge(posture, copy).label;
  return descriptorDescription(intent?.capabilityContract || descriptor?.capabilityId || '', descriptor, copy);
}

function statusDotClass(tone: PostureBadge['tone']): string {
  if (tone === 'success') return 'bg-[var(--nimi-status-success)]';
  if (tone === 'warning') return 'bg-[var(--nimi-status-warning)]';
  return 'bg-[var(--nimi-text-muted)]';
}

function capabilityIconPath(section: CanonicalCapabilityDescriptor['section'] | undefined): string {
  switch (section) {
    case 'chat':
      return 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';
    case 'stt':
      return 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8';
    case 'tts':
      return 'M11 5 6 9H2v6h4l5 4V5zM19 5a10 10 0 0 1 0 14M16 8a5 5 0 0 1 0 8';
    case 'image':
      return 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5L5 21';
    default:
      return 'M12 2v20M2 12h20';
  }
}

function CapabilityIcon(props: { readonly descriptor?: CanonicalCapabilityDescriptor; readonly tone: PostureBadge['tone'] }) {
  const toneClass = props.tone === 'success'
    ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)] text-[var(--nimi-status-success)]'
    : props.tone === 'warning'
      ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]'
      : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]';
  return (
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', toneClass)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={capabilityIconPath(props.descriptor?.section)} />
      </svg>
    </span>
  );
}

function defaultFormatError(error: unknown, fallback: string): ModelConfigFormattedError {
  return {
    message: fallback,
    technicalDetail: error instanceof Error ? error.message : String(error),
  };
}

export function ModelConfigAIConfigSurface(props: ModelConfigAIConfigSurfaceProps) {
  const copy = useMemo(() => resolveModelConfigCopy(props.copy), [props.copy]);
  const contracts = useMemo(
    () => uniqueContracts(props.capabilityContracts, props.capabilities),
    [props.capabilities, props.capabilityContracts],
  );
  const [activeContract, setActiveContract] = useState<string | null>(() => {
    const initial = props.initialCapabilityContract?.trim() || '';
    return initial && contracts.includes(initial) ? initial : null;
  });

  useEffect(() => {
    if (activeContract && !contracts.includes(activeContract)) setActiveContract(null);
  }, [activeContract, contracts]);

  const entries = contracts.map((contract) => {
    const descriptor = CANONICAL_CAPABILITY_CATALOG_BY_ID[contract];
    const intent = props.capabilities?.find((entry) => entry.capabilityContract === contract) ?? null;
    const selection = props.localSelections?.find((entry) => entry.capabilityContract === contract) ?? null;
    const badge = statusBadge(modelConfigCapabilityPosture(intent, selection), copy);
    return { contract, descriptor, intent, selection, badge };
  });
  const configuredCount = entries.filter((entry) => entry.badge.tone === 'success').length;
  const aggregateBadge: PostureBadge = entries.some((entry) => entry.badge.tone === 'warning')
    ? { label: copy.selectionRequiredLabel, tone: 'warning' }
    : configuredCount === entries.length && entries.length > 0
      ? { label: copy.configuredLabel, tone: 'success' }
      : { label: copy.notConfiguredLabel, tone: 'neutral' };
  const activeEntry = entries.find((entry) => entry.contract === activeContract) || null;

  return (
    <ModelConfigOwnerBoundary context={props.context} className={cn('min-w-0 space-y-5', props.className)}>
      {props.headerSlot}

      {activeEntry ? (
        <div className="space-y-4" data-nimi-model-config-detail={activeEntry.contract}>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveContract(null)}
              aria-label={copy.backLabel}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--nimi-radius-sm)] px-2 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 19-7-7 7-7" /></svg>
              <span>{copy.backLabel}</span>
            </button>
            <h2 id={props.titleId} className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
              {copy.detailTitle(descriptorLabel(activeEntry.contract, activeEntry.descriptor, copy))}
            </h2>
            {activeEntry.badge.tone === 'success' ? null : (
              <StatusBadge tone={activeEntry.badge.tone} className="shrink-0 text-[10px]">{activeEntry.badge.label}</StatusBadge>
            )}
          </div>
          <CapabilityIntentEditor
            key={activeEntry.contract}
            capabilityContract={activeEntry.contract}
            descriptor={activeEntry.descriptor}
            currentIntent={activeEntry.intent}
            allCapabilities={props.capabilities || []}
            selection={activeEntry.selection}
            context={props.context}
            cloudAIConfig={props.cloudAIConfig}
            onOverwrite={props.onOverwrite}
            onOpenOwnerConfiguration={props.onOpenOwnerConfiguration}
            onOpenMachineConfiguration={props.onOpenMachineConfiguration}
            onOpenCloudConnectorConfiguration={props.onOpenCloudConnectorConfiguration}
            formatError={props.formatError}
            copy={copy}
            disabled={props.disabled}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex min-w-0 items-baseline justify-between gap-4">
            <h2 id={props.titleId} className="m-0 text-[14px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{copy.title}</h2>
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
              <span className={cn('h-1.5 w-1.5 rounded-[var(--nimi-radius-full)]', statusDotClass(aggregateBadge.tone))} />
              <span>{aggregateBadge.label}</span>
            </div>
          </div>

          {props.loadError ? (
            <div className="flex flex-wrap items-center gap-2">
              <InlineAlert tone="warning">{props.loadError || copy.loadFailed}</InlineAlert>
              {props.onRetry ? <Button size="sm" tone="secondary" onClick={props.onRetry}>{copy.retryLabel}</Button> : null}
            </div>
          ) : null}
          {props.loading ? <div className="text-xs text-[var(--nimi-text-muted)]">…</div> : null}

          {!props.loading && !props.loadError ? (
            <div className="space-y-2" data-nimi-model-config-capability-grid="true">
              {entries.map((entry) => (
                <button
                  type="button"
                  key={entry.contract}
                  onClick={() => setActiveContract(entry.contract)}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 rounded-[var(--nimi-radius-md)] border p-3 text-left transition-colors',
                    entry.badge.tone === 'warning'
                      ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_5%,var(--nimi-surface-card))] hover:border-[var(--nimi-status-warning)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]',
                  )}
                  data-nimi-model-config-capability={entry.contract}
                >
                  <CapabilityIcon descriptor={entry.descriptor} tone={entry.badge.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--nimi-text-primary)]">
                      {descriptorLabel(entry.contract, entry.descriptor, copy)}
                    </span>
                    <span className={cn(
                      'mt-1 flex items-center gap-1.5 truncate text-[11.5px]',
                      entry.badge.tone === 'success'
                        ? 'text-[var(--nimi-status-success)]'
                        : entry.badge.tone === 'warning'
                          ? 'text-[var(--nimi-status-warning)]'
                          : 'text-[var(--nimi-text-muted)]',
                    )}>
                      <span className={cn('h-[5px] w-[5px] shrink-0 rounded-[var(--nimi-radius-full)]', statusDotClass(entry.badge.tone))} />
                      <span className="truncate">{capabilitySummary(entry.intent, entry.selection, entry.descriptor, copy)}</span>
                    </span>
                  </span>
                  <svg className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {props.footer}
    </ModelConfigOwnerBoundary>
  );
}

type CapabilityIntentEditorProps = {
  readonly capabilityContract: string;
  readonly descriptor?: CanonicalCapabilityDescriptor;
  readonly currentIntent: NimiCapabilityAIConfigIntent | null;
  readonly allCapabilities: readonly NimiCapabilityAIConfigIntent[];
  readonly selection: ModelConfigLocalSelectionProjection | null;
  readonly context: ModelConfigAIConfigOwnerContext;
  readonly cloudAIConfig?: ModelConfigCloudAIConfigModule;
  readonly onOverwrite?: ModelConfigOverwrite;
  readonly onOpenOwnerConfiguration?: () => void;
  readonly onOpenMachineConfiguration?: (capabilityContract: string) => void;
  readonly onOpenCloudConnectorConfiguration?: () => void;
  readonly formatError?: (error: unknown) => ModelConfigFormattedError;
  readonly copy: ResolvedCopy;
  readonly disabled?: boolean;
};

function CapabilityIntentEditor(props: CapabilityIntentEditorProps) {
  if (props.context.consumer === 'third-party-app') {
    return <ThirdPartyCapabilityIntentView {...props} />;
  }
  return <FirstPartyCapabilityIntentEditor {...props} />;
}

function ThirdPartyCapabilityIntentView(props: CapabilityIntentEditorProps) {
  const posture = modelConfigCapabilityPosture(props.currentIntent, props.selection);
  const badge = statusBadge(posture, props.copy);
  return (
    <div className="min-w-0 space-y-4" data-nimi-model-config-capability={props.capabilityContract} data-nimi-model-config-read-only="true">
      {!props.descriptor ? <InlineAlert tone="warning">{props.copy.unsupportedCapabilityLabel}</InlineAlert> : null}
      <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">{props.copy.activeModelLabel}</div>
            <p className="m-0 mt-1 truncate text-[11px] text-[var(--nimi-text-muted)]">
              {capabilitySummary(props.currentIntent, props.selection, props.descriptor, props.copy)}
            </p>
          </div>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </div>
      </div>
      {props.onOpenOwnerConfiguration ? (
        <div className="flex justify-end">
          <Button tone="primary" onClick={props.onOpenOwnerConfiguration} data-nimi-model-config-owner-handoff="true">
            {props.copy.openCloudConnectorsLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FirstPartyCapabilityIntentEditor(props: CapabilityIntentEditorProps) {
  const currentChoice = useMemo(
    () => currentRouteChoice(props.currentIntent, props.selection, props.copy),
    [props.copy, props.currentIntent, props.selection],
  );
  const currentDefaults = useMemo(
    () => sanitizeCapabilityDefaults(
      props.capabilityContract,
      runtimeAIConfigStructToJson(props.currentIntent?.defaults),
    ),
    [props.capabilityContract, props.currentIntent?.defaults],
  );
  const syncKey = useMemo(() => JSON.stringify({
    choice: currentChoice?.id || null,
    requiredFeatures: props.currentIntent?.requiredFeatures || [],
    defaults: currentDefaults,
  }), [currentChoice?.id, currentDefaults, props.currentIntent?.requiredFeatures]);
  const lastSyncKey = useRef('');
  const [draftChoice, setDraftChoice] = useState<ModelConfigRouteChoice | null>(currentChoice);
  const [draftDefaults, setDraftDefaults] = useState(currentDefaults);
  const [authorization, setAuthorization] = useState<ModelConfigCloudAuthorizationOptions>(EMPTY_AUTHORIZATION);
  const [connectorId, setConnectorId] = useState('');
  const [pickerConnectorId, setPickerConnectorId] = useState('');
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [saveFailure, setSaveFailure] = useState<ModelConfigFormattedError | null>(null);

  useEffect(() => {
    if (lastSyncKey.current === syncKey) return;
    lastSyncKey.current = syncKey;
    const preserveConnector = currentChoice?.route === 'cloud'
      && draftChoice?.route === 'cloud'
      && currentChoice.id === draftChoice.id;
    setDraftChoice(currentChoice);
    setDraftDefaults(currentDefaults);
    if (!preserveConnector) {
      setConnectorId('');
      setPickerConnectorId('');
    }
    setImpactConfirmed(false);
    setSaveFailure(null);
  }, [currentChoice, currentDefaults, draftChoice, syncKey]);

  useEffect(() => {
    if (
      !props.cloudAIConfig
      || props.context.consumer !== 'nimi-first-party'
      || props.currentIntent?.route.oneofKind !== 'cloud'
    ) return;
    let cancelled = false;
    void props.cloudAIConfig.listAuthorizationOptions().then((next) => {
      if (cancelled) return;
      setAuthorization(next);
      setConnectorId('');
      setPickerConnectorId('');
    }).catch(() => {
      if (!cancelled) setCloudError(props.copy.cloudLoadFailed);
    });
    return () => { cancelled = true; };
  }, [currentChoice, props.cloudAIConfig, props.context.consumer, props.copy.cloudLoadFailed, props.currentIntent?.route.oneofKind]);

  const listChoices = useCallback(async (): Promise<readonly ModelConfigRouteChoice[]> => {
    const local = localChoice(props.selection, props.copy);
    if (!props.cloudAIConfig) return [local];
    setCloudError('');
    try {
      if (props.context.consumer === 'nimi-first-party') {
        let nextAuthorization: ModelConfigCloudAuthorizationOptions;
        try {
          nextAuthorization = await props.cloudAIConfig.listAuthorizationOptions();
          setAuthorization(nextAuthorization);
        } catch {
          setAuthorization(EMPTY_AUTHORIZATION);
          setCloudError(props.copy.cloudLoadFailed);
          return [local];
        }
        const connector = nextAuthorization.connectors.find((entry) => entry.connectorId === pickerConnectorId);
        if (!connector) return [local];
        const implementations = (await props.cloudAIConfig.listImplementations(props.capabilityContract))
          .filter((entry) => entry.provider === connector.provider);
        const targets = await props.cloudAIConfig.listTargets({
          capabilityContract: props.capabilityContract,
          provider: connector.provider,
          connectorId: connector.connectorId,
        });
        return routeChoices(local, implementations.map((implementation) => ({ implementation, targets })));
      }
      return [local];
    } catch {
      setCloudError(props.copy.cloudLoadFailed);
      return [local];
    }
  }, [pickerConnectorId, props.capabilityContract, props.cloudAIConfig, props.context.consumer, props.copy, props.selection]);

  const pickerAdapter = useMemo<ModelPickerCandidateAdapter<ModelConfigRouteChoice>>(() => ({
    listCandidates: listChoices,
    getId: (choice) => choice.id,
    getTitle: (choice) => choice.label,
    getDescription: (choice) => choice.description,
    getSource: (choice) => choice.route,
    getBadges: (choice) => [{
      label: choice.route === 'cloud' ? choice.provider : props.copy.localLabel,
      tone: choice.route === 'cloud' ? 'neutral' : props.selection?.state === 'selected' ? 'success' : 'warning',
    }],
    getSearchText: (choice) => choice.route === 'cloud'
      ? JSON.stringify(choice.target.providerModelTarget)
      : `${choice.label} ${choice.description}`,
    getDetailRows: (choice) => choice.route === 'cloud'
      ? Object.entries(choice.target.providerModelTarget).map(([label, value]) => ({
          label,
          value: typeof value === 'string' ? value : JSON.stringify(value),
        }))
      : [],
  }), [listChoices, props.copy.localLabel, props.selection?.state]);

  const selectedConnector = draftChoice?.route === 'cloud'
    ? authorization.connectors.find((entry) => (
        entry.connectorId === connectorId && entry.provider === draftChoice.provider
      )) || null
    : null;
  const accountLabel = selectedConnector?.label || props.copy.cloudAuthorizationNone;
  const exactCloudSelection = draftChoice?.route === 'cloud'
    && modelConfigJsonHasExactCloudTarget(draftChoice.target.providerModelTarget);
  const missingFeatures = draftChoice?.route === 'local'
    ? modelConfigMissingRequiredFeatures(props.currentIntent, props.selection)
    : [];

  const commit = async () => {
    if (saving || !props.descriptor || !draftChoice || !props.onOverwrite) return;
    setSaveFailure(null);
    try {
      const requiredFeatures = [...(props.currentIntent?.requiredFeatures || [])];
      const defaults = Object.keys(draftDefaults).length > 0 ? draftDefaults : undefined;
      let intent: NimiCapabilityAIConfigIntent;
      if (draftChoice.route === 'local') {
        intent = createNimiLocalAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          requiredFeatures,
          ...(defaults ? { defaults } : {}),
        });
      } else {
        if (!impactConfirmed || !selectedConnector || !exactCloudSelection) return;
        intent = createNimiCloudAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          requiredFeatures,
          ...(defaults ? { defaults } : {}),
          implementation: draftChoice.implementation.implementation,
          providerModelTarget: draftChoice.target.providerModelTarget,
        });
      }
      const next = props.allCapabilities
        .filter((entry) => entry.capabilityContract !== props.capabilityContract)
        .concat(intent);
      setSaving(true);
      await props.onOverwrite(next);
    } catch (error) {
      setSaveFailure(props.formatError?.(error) || defaultFormatError(error, props.copy.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  const draftPosture = draftChoice?.route === 'local'
    ? modelConfigCapabilityPosture(
        props.currentIntent?.route.oneofKind === 'local' ? props.currentIntent : createNimiLocalAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          requiredFeatures: [...(props.currentIntent?.requiredFeatures || [])],
        }),
        props.selection,
      )
    : draftChoice?.route === 'cloud'
      ? exactCloudSelection ? 'cloud-configured' : 'not-configured'
      : 'not-configured';
  const draftBadge = statusBadge(draftPosture, props.copy);
  const routeDisabled = Boolean(props.disabled) || saving || !props.descriptor;
  const modelDetail = draftChoice?.route === 'local'
    ? props.copy.localLabel
    : draftChoice?.route === 'cloud' ? draftChoice.provider : null;
  const modelDetailStatus = draftChoice
    ? draftBadge.tone === 'success' ? props.copy.activeModelConfiguredLabel : props.copy.activeModelSetupPendingLabel
    : null;

  return (
    <div className="min-w-0 space-y-4" data-nimi-model-config-capability={props.capabilityContract}>
      {!props.descriptor ? <InlineAlert tone="warning">{props.copy.unsupportedCapabilityLabel}</InlineAlert> : null}

      <div className="grid min-w-0 gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
            {props.copy.activeModelLabel}
          </span>
          <span className="truncate text-[11px] font-medium text-[var(--nimi-text-muted)]">
            {props.copy.activeModelHint}
          </span>
        </div>
        <ModelSelectorTrigger
          source={draftChoice?.route || null}
          label={draftChoice?.label || null}
          detail={modelDetail}
          detailStatus={modelDetailStatus}
          detailTone={draftBadge.tone === 'success' ? 'success' : draftBadge.tone === 'warning' ? 'warning' : 'neutral'}
          hoverBorderTone="success"
          placeholder={props.copy.notConfiguredLabel}
          disabled={routeDisabled}
          dataTestId={`model-config-model-trigger:${props.capabilityContract}`}
          onClick={() => {
            setPickerConnectorId(connectorId);
            setPickerOpen(true);
          }}
        />
        <ModelPickerDialog
          open={pickerOpen}
          presentation="route"
          title={props.copy.modelPickerTitle}
          description={descriptorLabel(props.capabilityContract, props.descriptor, props.copy)}
          adapter={pickerAdapter}
          selectedId={draftChoice?.id || ''}
          initialSourceFilter={draftChoice?.route || 'local'}
          sourceOptions={props.cloudAIConfig || props.onOpenCloudConnectorConfiguration
            ? ['local', 'cloud']
            : ['local']}
          copy={{
            searchPlaceholder: props.copy.modelPickerSearchPlaceholder,
            loadingLabel: props.copy.modelPickerLoadingLabel,
            emptyLabel: props.context.consumer === 'nimi-first-party'
              ? cloudError || (authorization.connectors.length === 0
                ? props.copy.cloudNoConnectorsLabel
                : !pickerConnectorId
                  ? props.copy.cloudConnectorSelectionRequired
                  : props.copy.modelPickerEmptyLabel)
              : props.copy.modelPickerEmptyLabel,
            sourceLabels: { local: props.copy.localLabel, cloud: props.copy.cloudLabel },
            cancelLabel: props.copy.cancelLabel,
            confirmLabel: props.copy.confirmSelectionLabel,
          }}
          renderSourceControls={({ source, isLoading, clearSelection }) => {
            if (source !== 'cloud') return null;
            if (props.context.consumer !== 'nimi-first-party') {
              return !props.cloudAIConfig && props.onOpenCloudConnectorConfiguration ? (
                <div
                  className="flex items-center justify-between gap-3"
                  data-nimi-model-config-cloud-connector-handoff="true"
                >
                  <span className="text-xs text-[var(--nimi-text-muted)]">
                    {props.copy.cloudConnectorSelectionRequired}
                  </span>
                  <Button
                    size="sm"
                    tone="secondary"
                    onClick={() => {
                      setPickerOpen(false);
                      props.onOpenCloudConnectorConfiguration?.();
                    }}
                  >
                    {props.copy.openCloudConnectorsLabel}
                  </Button>
                </div>
              ) : null;
            }
            return (
              <div className="space-y-2" data-nimi-model-config-cloud-connector-picker="true">
                {authorization.connectors.length > 0 ? (
                  <label className="grid gap-1.5 text-xs font-semibold text-[var(--nimi-text-primary)]">
                    <span>{props.copy.cloudConnectorPickerLabel}</span>
                    <SelectField
                      aria-label={props.copy.cloudConnectorPickerLabel}
                      value={pickerConnectorId}
                      placeholder={props.copy.cloudConnectorPickerPlaceholder}
                      contentLayer="dialog"
                      disabled={isLoading && authorization.connectors.length === 0}
                      options={authorization.connectors.map((entry) => ({
                        value: entry.connectorId,
                        label: `${entry.label} · ${entry.provider}`,
                      }))}
                      onValueChange={(value) => {
                        clearSelection();
                        setPickerConnectorId(value);
                        setCloudError('');
                      }}
                    />
                  </label>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--nimi-text-muted)]">
                      {isLoading && !cloudError ? props.copy.modelPickerLoadingLabel : cloudError || props.copy.cloudNoConnectorsLabel}
                    </span>
                    {props.onOpenCloudConnectorConfiguration ? (
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={() => {
                          setPickerOpen(false);
                          props.onOpenCloudConnectorConfiguration?.();
                        }}
                      >
                        {props.copy.openCloudConnectorsLabel}
                      </Button>
                    ) : null}
                  </div>
                )}
                {authorization.connectors.length > 0 && !pickerConnectorId ? (
                  <p className="m-0 text-[11px] text-[var(--nimi-text-muted)]">{props.copy.cloudConnectorSelectionRequired}</p>
                ) : null}
              </div>
            );
          }}
          renderItemActions={(choice) => choice.route === 'local' && props.onOpenMachineConfiguration ? (
            <Button
              size="sm"
              tone="secondary"
              onClick={() => props.onOpenMachineConfiguration?.(props.capabilityContract)}
            >
              {props.copy.openMachineLabel}
            </Button>
          ) : null}
          onClose={() => setPickerOpen(false)}
          onConfirm={(choice) => {
            setDraftChoice(choice);
            setConnectorId(choice.route === 'cloud' ? pickerConnectorId : '');
            setImpactConfirmed(false);
            setSaveFailure(null);
          }}
        />
      </div>

      {draftChoice?.route === 'local' ? (
        <LocalSelectionSummary
          selection={props.selection}
          missingFeatures={missingFeatures}
          copy={props.copy}
          onOpenMachineConfiguration={props.onOpenMachineConfiguration ? () => props.onOpenMachineConfiguration?.(props.capabilityContract) : undefined}
        />
      ) : null}

      {draftChoice?.route === 'cloud' ? (
        <div className="space-y-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3" data-nimi-model-config-cloud="true">
          <div>
            <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">{props.copy.cloudAuthorizationLabel}</div>
            <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--nimi-text-muted)]">{props.copy.cloudAuthorizationSeparation}</p>
          </div>
          {cloudError ? <InlineAlert tone="warning">{cloudError}</InlineAlert> : null}
          <InlineAlert tone="info">
            <div className="space-y-2">
              <div className="font-semibold">{props.copy.cloudAccountLabel(accountLabel)}</div>
              <Checkbox
                checked={impactConfirmed}
                disabled={saving}
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

      <CapabilityDefaultsEditor
        capabilityContract={props.capabilityContract}
        value={draftDefaults}
        onChange={setDraftDefaults}
        route={draftChoice?.route || null}
        effectiveDefaults={draftChoice?.route === 'local' ? props.selection?.effectiveDefaults : null}
        disabled={routeDisabled}
        copy={{
          label: props.copy.defaultsLabel,
          hint: props.copy.defaultsPlaceholder,
          unsetLabel: props.copy.defaultsUnsetLabel,
          trueLabel: props.copy.defaultsTrueLabel,
          falseLabel: props.copy.defaultsFalseLabel,
          listPlaceholder: props.copy.defaultsListPlaceholder,
          localEffectivePlaceholder: props.copy.defaultsLocalEffectivePlaceholder,
          cloudEffectivePlaceholder: props.copy.defaultsCloudEffectivePlaceholder,
          randomValue: props.copy.defaultsRandomValue,
        }}
      />

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
          disabled={routeDisabled || !draftChoice || (draftChoice.route === 'cloud' && (!impactConfirmed || !selectedConnector || !exactCloudSelection))}
          onClick={() => { void commit(); }}
          data-testid={`model-config-save:${props.capabilityContract}`}
        >
          {saving ? props.copy.savingLabel : draftChoice?.route === 'cloud' ? props.copy.saveCloudLabel : props.copy.saveLocalLabel}
        </Button>
      </div>
    </div>
  );
}

function LocalSelectionSummary(props: {
  readonly selection: ModelConfigLocalSelectionProjection | null;
  readonly missingFeatures: readonly string[];
  readonly copy: ResolvedCopy;
  readonly onOpenMachineConfiguration?: () => void;
}) {
  const selection = props.selection;
  let toneClass = 'text-[var(--nimi-status-warning)]';
  let message = props.copy.localMissingLabel;
  if (selection?.state === 'unavailable') {
    toneClass = 'text-[var(--nimi-text-muted)]';
    message = props.copy.localUnavailableLabel;
  } else if (selection?.state === 'broken') {
    message = `${props.copy.localBrokenLabel}${selection.reasons.length > 0 ? ` ${selection.reasons.join(', ')}` : ''}`;
  } else if (selection?.state === 'selected' && props.missingFeatures.length > 0) {
    message = props.copy.localMismatchLabel(props.missingFeatures.join(', '));
  } else if (selection?.state === 'selected') {
    toneClass = 'text-[var(--nimi-status-success)]';
    message = `${props.copy.localSelectedLabel}: ${selection.displayName || selection.configurationId || ''}`;
  }
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <p className={cn('m-0 min-w-0 text-[11px] leading-relaxed', toneClass)}>{message}</p>
      {props.onOpenMachineConfiguration ? (
        <button type="button" onClick={props.onOpenMachineConfiguration} className="shrink-0 text-[11px] font-medium text-[var(--nimi-action-primary-bg)] hover:underline">
          {props.copy.openMachineLabel}
        </button>
      ) : null}
    </div>
  );
}
