import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiAIConfigCloudConnectorOption,
  type NimiAIConfigCloudTargetOption,
  type NimiPortableAppAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  type CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  Button,
  InlineAlert,
  LoadingSkeleton,
  SelectField,
  StatusBadge,
  cn,
} from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
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
  ModelConfigCopy,
  ModelConfigEffectiveSelectionProjection,
  ModelConfigFormattedError,
  ModelConfigListOptions,
  ModelConfigOverwrite,
} from '../types.js';
import { sanitizeCapabilityDefaults } from '../capability-defaults.js';
import { CapabilityDefaultsEditor } from './capability-defaults-editor.js';
import { ModelConfigOwnerBoundary } from './model-config-owner-boundary.js';

type ResolvedCopy = ReturnType<typeof resolveModelConfigCopy>;
type PostureBadge = {
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'warning';
};

type ModelConfigRouteChoice =
  | {
      readonly id: string;
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
      readonly connectorRef: string;
      readonly connectorLabel: string;
      readonly target: NimiAIConfigCloudTargetOption;
    };

export type ModelConfigAllowedRoute = ModelConfigRouteChoice['route'];

const DEFAULT_ALLOWED_ROUTES: readonly ModelConfigAllowedRoute[] = ['local', 'cloud'];

export type ModelConfigAIConfigSurfaceProps = {
  readonly context: ModelConfigAIConfigOwnerContext;
  readonly capabilityContracts: readonly string[];
  /** App product policy may narrow the editor without changing AIConfig authority or wire shape. */
  readonly allowedRoutes?: readonly ModelConfigAllowedRoute[];
  /** Opens one requested capability detail on first mount when it is in capabilityContracts. */
  readonly initialCapabilityContract?: string | null;
  /** Null is canonical absence/not configured; undefined is an unavailable read. */
  readonly capabilities: readonly NimiPortableAppAIConfigIntent[] | null | undefined;
  readonly revision?: string;
  /** Route-neutral Runtime effective facts; undefined means this host cannot observe them. */
  readonly effectiveSelections?: readonly ModelConfigEffectiveSelectionProjection[];
  readonly listOptions?: ModelConfigListOptions;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly loadError?: string | null;
  readonly onRetry?: () => void;
  readonly onOverwrite?: ModelConfigOverwrite;
  /** Optional centralized-management handoff. It never gates editing in this surface. */
  readonly onOpenOwnerConfiguration?: () => void;
  readonly onOpenMachineLoadout?: (capabilityContract: string) => void;
  readonly formatError?: (error: unknown) => ModelConfigFormattedError;
  readonly copy?: ModelConfigCopy;
  readonly className?: string;
  readonly titleId?: string;
  readonly headerSlot?: ReactNode;
  readonly footer?: ReactNode;
};

function uniqueContracts(
  requested: readonly string[],
  capabilities: readonly NimiPortableAppAIConfigIntent[] | null | undefined,
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
    case 'cloud-selection-missing':
      return { label: copy.selectionRequiredLabel, tone: 'warning' };
    case 'local-configuration-blocked':
    case 'cloud-configuration-blocked':
      return { label: copy.blockedLabel, tone: 'warning' };
    case 'local-configuration-unavailable':
    case 'cloud-configuration-unavailable':
      return { label: copy.unavailableLabel, tone: 'warning' };
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

function cloudChoiceId(connectorRef: string, targetId: string): string {
  return JSON.stringify(['cloud', connectorRef, targetId]);
}

function localChoice(
  selection: ModelConfigEffectiveSelectionProjection | null | undefined,
  copy: ResolvedCopy,
): Extract<ModelConfigRouteChoice, { readonly route: 'local' }> {
  const local = selection?.resource?.oneofKind === 'local' ? selection.resource.local : null;
  let description = copy.localChoiceDescription;
  if (selection?.state === 'ready' && local) {
    description = copy.localSelectedLabel;
  } else if (selection === null || selection?.state === 'missing') {
    description = copy.localMissingLabel;
  } else if (selection?.state === 'blocked') {
    description = copy.localBrokenLabel;
  } else if (selection?.state === 'unavailable') {
    description = copy.localUnavailableLabel;
  }
  return {
    id: 'local',
    route: 'local',
    label: local?.label || copy.localLabel,
    description,
  };
}

function cloudOptionChoice(
  connector: NimiAIConfigCloudConnectorOption,
  target: NimiAIConfigCloudTargetOption,
): Extract<ModelConfigRouteChoice, { readonly route: 'cloud' }> {
  const provider = targetText(target.providerModelTarget.provider);
  return {
    id: cloudChoiceId(connector.connectorRef, targetText(target.providerModelTarget.remoteModelCatalogId)),
    route: 'cloud',
    label: target.label,
    description: connector.label,
    provider,
    connectorRef: connector.connectorRef,
    connectorLabel: connector.label,
    target,
  };
}

function currentRouteChoice(
  intent: NimiPortableAppAIConfigIntent | null,
  selection: ModelConfigEffectiveSelectionProjection | null | undefined,
  copy: ResolvedCopy,
): ModelConfigRouteChoice | null {
  if (intent?.route.oneofKind === 'local') return localChoice(selection, copy);
  if (intent?.route.oneofKind !== 'cloud') return null;
  const cloud = intent.route.cloud;
  const target = runtimeAIConfigStructToJson(cloud.providerModelTarget);
  const provider = targetText(target.provider);
  const modelId = targetText(target.providerModelId);
  const remoteModelCatalogId = targetText(target.remoteModelCatalogId);
  const connectorRef = cloud.connectorRef;
  const effectiveCloud = selection?.resource?.oneofKind === 'cloud' ? selection.resource.cloud : null;
  const connectorLabel = effectiveCloud?.connector.label || connectorRef;
  if (!modelConfigHasExactCloudTarget(intent) || !provider || !modelId || !remoteModelCatalogId || !connectorRef || !cloud.implementation) return null;
  const targetId = remoteModelCatalogId;
  return {
    id: cloudChoiceId(connectorRef, targetId),
    route: 'cloud',
    label: modelId,
    description: `${provider} · ${connectorLabel}`,
    provider,
    connectorRef,
    connectorLabel,
    target: {
      connectorRef,
      label: modelId,
      capabilityContract: intent.capabilityContract,
      implementation: cloud.implementation,
      providerModelTarget: target,
      supportedFeatures: [...(effectiveCloud?.target.supportedFeatures || [])],
      state: selection?.state === 'blocked' || selection?.state === 'missing'
        ? 'blocked'
        : selection?.state === 'unavailable' ? 'blocked' : 'ready',
      reasons: [...(selection?.reasons || [])],
    },
  };
}

function cloudModelLabel(intent: NimiPortableAppAIConfigIntent | null): string | null {
  if (!modelConfigHasExactCloudTarget(intent) || intent?.route.oneofKind !== 'cloud') return null;
  const target = runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget);
  return targetText(target.providerModelId) || null;
}

function capabilitySummary(
  intent: NimiPortableAppAIConfigIntent | null,
  selection: ModelConfigEffectiveSelectionProjection | null | undefined,
  descriptor: CanonicalCapabilityDescriptor | undefined,
  copy: ResolvedCopy,
): string {
  const posture = modelConfigCapabilityPosture(intent, selection);
  if (posture === 'local-configured') {
    const local = selection?.resource?.oneofKind === 'local' ? selection.resource.local : null;
    return local?.label || local?.loadoutRef || copy.configuredLabel;
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    const selection = props.effectiveSelections === undefined
      ? undefined
      : props.effectiveSelections.find((entry) => entry.capabilityContract === contract) ?? null;
    const badge = statusBadge(modelConfigCapabilityPosture(intent, selection), copy);
    return { contract, descriptor, intent, selection, badge };
  });
  const configuredCount = entries.filter((entry) => entry.badge.tone === 'success').length;
  const aggregateBadge: PostureBadge = configuredCount > 0 && configuredCount < entries.length
    ? { label: `${configuredCount}/${entries.length} ${copy.configuredLabel}`, tone: 'warning' }
    : entries.some((entry) => entry.badge.tone === 'warning')
      ? { label: copy.selectionRequiredLabel, tone: 'warning' }
      : configuredCount === entries.length && entries.length > 0
      ? { label: copy.configuredLabel, tone: 'success' }
      : { label: copy.notConfiguredLabel, tone: 'neutral' };
  const activeEntry = entries.find((entry) => entry.contract === activeContract) || null;
  const configurationObserved = props.capabilities !== undefined;

  return (
    <ModelConfigOwnerBoundary context={props.context} className={cn('min-w-0 space-y-5', props.className)}>
      {props.headerSlot}
      {props.loadError ? (
        <div className="flex flex-wrap items-center gap-2">
          <InlineAlert tone="warning">{props.loadError || copy.loadFailed}</InlineAlert>
          {props.onRetry ? <Button size="sm" tone="secondary" onClick={props.onRetry}>{copy.retryLabel}</Button> : null}
        </div>
      ) : null}
      {props.loading && props.capabilities === undefined ? (
        <LoadingSkeleton lines={2} label={copy.modelPickerLoadingLabel} />
      ) : null}
      {!props.loading && !configurationObserved && !props.loadError ? (
        <InlineAlert tone="warning" data-nimi-model-config-unavailable="true">{copy.loadFailed}</InlineAlert>
      ) : null}

      {!configurationObserved ? null : activeEntry ? (
        <div className="space-y-4" data-nimi-model-config-detail={activeEntry.contract}>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveContract(null)}
              aria-label={copy.backLabel}
              className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--nimi-radius-sm)] px-2 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]', FOCUS_RING_CLASS_NAME)}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 19-7-7 7-7" /></svg>
              <span>{copy.backLabel}</span>
            </button>
            <h2 id={props.titleId} className="m-0 min-w-0 flex-1 truncate text-[length:var(--nimi-type-label-size)] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
              {copy.detailTitle(descriptorLabel(activeEntry.contract, activeEntry.descriptor, copy))}
            </h2>
            {activeEntry.badge.tone === 'success' ? null : (
              <StatusBadge tone={activeEntry.badge.tone} className="shrink-0 text-[length:var(--nimi-type-overline-size)]">{activeEntry.badge.label}</StatusBadge>
            )}
          </div>
          <CapabilityIntentEditor
            key={activeEntry.contract}
            capabilityContract={activeEntry.contract}
            allowedRoutes={props.allowedRoutes || DEFAULT_ALLOWED_ROUTES}
            descriptor={activeEntry.descriptor}
            currentIntent={activeEntry.intent}
            allCapabilities={props.capabilities || []}
            selection={activeEntry.selection}
            context={props.context}
            revision={props.revision}
            listOptions={props.listOptions}
            onOverwrite={props.onOverwrite}
            onOpenOwnerConfiguration={props.onOpenOwnerConfiguration}
            onOpenMachineLoadout={props.onOpenMachineLoadout}
            formatError={props.formatError}
            copy={copy}
            disabled={props.disabled}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex min-w-0 items-baseline justify-between gap-4">
            <h2 id={props.titleId} className="m-0 text-[length:var(--nimi-type-body-size)] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{copy.title}</h2>
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
              <span className={cn('h-1.5 w-1.5 rounded-[var(--nimi-radius-full)]', statusDotClass(aggregateBadge.tone))} />
              <span>{aggregateBadge.label}</span>
            </div>
          </div>

          {props.capabilities !== undefined ? (
            <div className="space-y-2" data-nimi-model-config-capability-grid="true">
              {entries.map((entry) => (
                <button
                  type="button"
                  key={entry.contract}
                  onClick={() => setActiveContract(entry.contract)}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 rounded-[var(--nimi-radius-md)] border p-3 text-left transition-colors',
                    FOCUS_RING_CLASS_NAME,
                    entry.badge.tone === 'warning'
                      ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_5%,var(--nimi-surface-card))] hover:border-[var(--nimi-status-warning)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]',
                  )}
                  data-nimi-model-config-capability={entry.contract}
                >
                  <CapabilityIcon descriptor={entry.descriptor} tone={entry.badge.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">
                      {descriptorLabel(entry.contract, entry.descriptor, copy)}
                    </span>
                    <span className={cn(
                      'mt-1 flex items-center gap-1.5 truncate text-[length:var(--nimi-type-caption-size)]',
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
  readonly allowedRoutes: readonly ModelConfigAllowedRoute[];
  readonly descriptor?: CanonicalCapabilityDescriptor;
  readonly currentIntent: NimiPortableAppAIConfigIntent | null;
  readonly allCapabilities: readonly NimiPortableAppAIConfigIntent[];
  readonly selection: ModelConfigEffectiveSelectionProjection | null | undefined;
  readonly context: ModelConfigAIConfigOwnerContext;
  readonly revision?: string;
  readonly listOptions?: ModelConfigListOptions;
  readonly onOverwrite?: ModelConfigOverwrite;
  readonly onOpenOwnerConfiguration?: () => void;
  readonly onOpenMachineLoadout?: (capabilityContract: string) => void;
  readonly formatError?: (error: unknown) => ModelConfigFormattedError;
  readonly copy: ResolvedCopy;
  readonly disabled?: boolean;
};

function CapabilityIntentEditor(props: CapabilityIntentEditorProps) {
  if (!props.onOverwrite || props.revision === undefined || !props.listOptions) {
    return <ReadOnlyCapabilityIntentView {...props} />;
  }
  return <EditableCapabilityIntentEditor {...props} />;
}

function ReadOnlyCapabilityIntentView(props: CapabilityIntentEditorProps) {
  const posture = modelConfigCapabilityPosture(props.currentIntent, props.selection);
  const badge = statusBadge(posture, props.copy);
  return (
    <div className="min-w-0 space-y-4" data-nimi-model-config-capability={props.capabilityContract} data-nimi-model-config-read-only="true">
      {!props.descriptor ? <InlineAlert tone="warning">{props.copy.unsupportedCapabilityLabel}</InlineAlert> : null}
      <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">{props.copy.activeModelLabel}</div>
            <p className="m-0 mt-1 truncate text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">
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

function EditableCapabilityIntentEditor(props: CapabilityIntentEditorProps) {
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
  const preserveDraftAcrossSync = useRef(false);
  const [draftChoice, setDraftChoice] = useState<ModelConfigRouteChoice | null>(currentChoice);
  const [draftDefaults, setDraftDefaults] = useState(currentDefaults);
  const [connectors, setConnectors] = useState<readonly NimiAIConfigCloudConnectorOption[]>([]);
  const [connectorRef, setConnectorRef] = useState(currentChoice?.route === 'cloud' ? currentChoice.connectorRef : '');
  const [pickerConnectorRef, setPickerConnectorRef] = useState(currentChoice?.route === 'cloud' ? currentChoice.connectorRef : '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutationKind, setMutationKind] = useState<'save' | 'clear' | null>(null);
  const [cloudError, setCloudError] = useState('');
  const [saveFailure, setSaveFailure] = useState<ModelConfigFormattedError | null>(null);
  const [conflictCurrent, setConflictCurrent] = useState<{
    readonly revision: string;
    readonly intent: NimiPortableAppAIConfigIntent | null;
  } | null>(null);

  useEffect(() => {
    if (lastSyncKey.current === syncKey) return;
    lastSyncKey.current = syncKey;
    if (preserveDraftAcrossSync.current) return;
    const preserveConnector = currentChoice?.route === 'cloud'
      && draftChoice?.route === 'cloud'
      && currentChoice.id === draftChoice.id;
    setDraftChoice(currentChoice);
    setDraftDefaults(currentDefaults);
    if (!preserveConnector) {
      setConnectorRef(currentChoice?.route === 'cloud' ? currentChoice.connectorRef : '');
      setPickerConnectorRef(currentChoice?.route === 'cloud' ? currentChoice.connectorRef : '');
    }
    setSaveFailure(null);
    setConflictCurrent(null);
  }, [currentChoice, currentDefaults, draftChoice, syncKey]);

  const listChoices = useCallback(async (): Promise<readonly ModelConfigRouteChoice[]> => {
    const locals: readonly Extract<ModelConfigRouteChoice, { readonly route: 'local' }>[] = props.allowedRoutes.includes('local')
      ? [localChoice(props.selection, props.copy)]
      : [];
    setCloudError('');
    if (!props.allowedRoutes.includes('cloud')) return locals;
    try {
      const connectorResult = await props.listOptions!({
        kind: 'cloud-connectors', capabilityContract: props.capabilityContract,
      });
      if (connectorResult.kind !== 'cloud-connectors') throw new Error('Cloud Connector options mismatch');
      setConnectors(connectorResult.options);
      const connector = connectorResult.options.find((entry) => entry.connectorRef === pickerConnectorRef && entry.state === 'ready');
      if (!connector) return locals;
      const targetResult = await props.listOptions!({
        kind: 'cloud-targets', capabilityContract: props.capabilityContract,
        connectorRef: connector.connectorRef,
      });
      if (targetResult.kind !== 'cloud-targets') throw new Error('Cloud target options mismatch');
      return [...locals, ...targetResult.options
        .filter((target) => target.state === 'ready')
        .map((target) => cloudOptionChoice(connector, target))];
    } catch {
      setCloudError(props.copy.cloudLoadFailed);
      return locals;
    }
  }, [pickerConnectorRef, props.allowedRoutes, props.capabilityContract, props.copy, props.listOptions, props.selection]);

  const pickerAdapter = useMemo<ModelPickerCandidateAdapter<ModelConfigRouteChoice>>(() => ({
    listCandidates: listChoices,
    getId: (choice) => choice.id,
    getTitle: (choice) => choice.label,
    getDescription: (choice) => choice.description,
    getSource: (choice) => choice.route,
    getBadges: (choice) => [{
      label: choice.route === 'cloud' ? choice.provider : props.copy.localLabel,
      tone: choice.route === 'cloud' ? 'neutral' : props.selection?.state === 'ready' ? 'success' : 'warning',
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
    ? connectors.find((entry) => entry.connectorRef === draftChoice.connectorRef) || {
        connectorRef: draftChoice.connectorRef,
        label: draftChoice.connectorLabel,
        provider: draftChoice.provider,
        state: 'ready' as const,
        reasons: [],
      }
    : null;
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
      let intent: NimiPortableAppAIConfigIntent;
      if (draftChoice.route === 'local') {
        intent = createNimiLocalAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          requiredFeatures,
          ...(defaults ? { defaults } : {}),
        });
      } else {
        if (!selectedConnector || !exactCloudSelection) return;
        intent = createNimiCloudAIConfigCapabilityIntent({
          capabilityContract: props.capabilityContract,
          connectorRef: draftChoice.connectorRef,
          requiredFeatures,
          ...(defaults ? { defaults } : {}),
          implementation: draftChoice.target.implementation,
          providerModelTarget: draftChoice.target.providerModelTarget,
        });
      }
      const next = props.allCapabilities
        .filter((entry) => entry.capabilityContract !== props.capabilityContract)
        .concat(intent);
      preserveDraftAcrossSync.current = true;
      setMutationKind('save');
      setSaving(true);
      const result = await props.onOverwrite({
        expectedRevision: props.revision || '',
        capabilities: next,
      });
      if (result.outcome === 'conflict') {
        setConflictCurrent({
          revision: result.revision,
          intent: result.config?.capabilities.find(
            (entry) => entry.capabilityContract === props.capabilityContract,
          ) ?? null,
        });
        setSaveFailure({
          message: `${props.copy.conflictLabel}. ${props.copy.conflictDescription}`,
        });
        return;
      }
      preserveDraftAcrossSync.current = false;
      setConflictCurrent(null);
      setSaveFailure(null);
    } catch (error) {
      preserveDraftAcrossSync.current = false;
      setConflictCurrent(null);
      setSaveFailure(props.formatError?.(error) || defaultFormatError(error, props.copy.saveFailed));
    } finally {
      setSaving(false);
      setMutationKind(null);
    }
  };

  const clearIntent = async () => {
    if (saving || !props.currentIntent || !props.onOverwrite || !props.revision) return;
    preserveDraftAcrossSync.current = true;
    setSaveFailure(null);
    setMutationKind('clear');
    setSaving(true);
    try {
      const result = await props.onOverwrite({
        expectedRevision: props.revision,
        capabilities: props.allCapabilities.filter(
          (entry) => entry.capabilityContract !== props.capabilityContract,
        ),
      });
      if (result.outcome === 'conflict') {
        setConflictCurrent({
          revision: result.revision,
          intent: result.config?.capabilities.find(
            (entry) => entry.capabilityContract === props.capabilityContract,
          ) ?? null,
        });
        setSaveFailure({
          message: `${props.copy.conflictLabel}. ${props.copy.conflictDescription}`,
        });
        return;
      }
      preserveDraftAcrossSync.current = false;
      setDraftChoice(null);
      setDraftDefaults({});
      setConnectorRef('');
      setPickerConnectorRef('');
      setConflictCurrent(null);
      setSaveFailure(null);
    } catch (error) {
      preserveDraftAcrossSync.current = false;
      setConflictCurrent(null);
      setSaveFailure(props.formatError?.(error) || defaultFormatError(error, props.copy.saveFailed));
    } finally {
      setSaving(false);
      setMutationKind(null);
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
      ? currentChoice?.id === draftChoice.id
        ? modelConfigCapabilityPosture(props.currentIntent, props.selection)
        : exactCloudSelection ? 'cloud-configured' : 'not-configured'
      : 'not-configured';
  const draftBadge = statusBadge(draftPosture, props.copy);
  const routeDisabled = Boolean(props.disabled) || saving || !props.descriptor;
  const draftRouteAllowed = draftChoice ? props.allowedRoutes.includes(draftChoice.route) : true;
  const modelDetail = draftChoice?.route === 'local'
    ? props.copy.localLabel
    : draftChoice?.route === 'cloud' ? draftChoice.provider : null;
  const modelDetailStatus = draftChoice
    ? draftBadge.tone === 'success' ? props.copy.activeModelConfiguredLabel : props.copy.activeModelSetupPendingLabel
    : null;
  const displayedChoice = draftChoice?.route === 'local'
    ? localChoice(props.selection, props.copy)
    : draftChoice;

  return (
    <div className="min-w-0 space-y-4" data-nimi-model-config-capability={props.capabilityContract}>
      {!props.descriptor ? <InlineAlert tone="warning">{props.copy.unsupportedCapabilityLabel}</InlineAlert> : null}

      <div className="grid min-w-0 gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate nimi-type-overline uppercase text-[var(--nimi-text-muted)]">
            {props.copy.activeModelLabel}
          </span>
          <span className="truncate text-[length:var(--nimi-type-overline-size)] font-medium text-[var(--nimi-text-muted)]">
            {props.copy.activeModelHint}
          </span>
        </div>
        <ModelSelectorTrigger
          source={displayedChoice?.route || null}
          label={displayedChoice?.label || null}
          detail={modelDetail}
          detailStatus={modelDetailStatus}
          detailTone={draftBadge.tone === 'success' ? 'success' : draftBadge.tone === 'warning' ? 'warning' : 'neutral'}
          hoverBorderTone="success"
          placeholder={props.copy.notConfiguredLabel}
          disabled={routeDisabled}
          dataTestId={`model-config-model-trigger:${props.capabilityContract}`}
          onClick={() => {
            setPickerConnectorRef(connectorRef);
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
          initialSourceFilter={draftChoice && props.allowedRoutes.includes(draftChoice.route)
            ? draftChoice.route
            : props.allowedRoutes[0] || 'local'}
          sourceOptions={props.allowedRoutes}
          copy={{
            searchPlaceholder: props.copy.modelPickerSearchPlaceholder,
            loadingLabel: props.copy.modelPickerLoadingLabel,
            emptyLabel: cloudError || (connectors.length === 0
                ? props.copy.cloudNoConnectorsLabel
                : !pickerConnectorRef
                  ? props.copy.cloudConnectorSelectionRequired
                  : props.copy.modelPickerEmptyLabel),
            sourceLabels: { local: props.copy.localLabel, cloud: props.copy.cloudLabel },
            cancelLabel: props.copy.cancelLabel,
            confirmLabel: props.copy.confirmSelectionLabel,
          }}
          renderSourceControls={({ source, isLoading, clearSelection }) => {
            if (source !== 'cloud') return null;
            return (
              <div className="space-y-2" data-nimi-model-config-cloud-connector-picker="true">
                {connectors.length > 0 ? (
                  <label className="grid gap-1.5 text-xs font-semibold text-[var(--nimi-text-primary)]">
                    <span>{props.copy.cloudConnectorPickerLabel}</span>
                    <SelectField
                      aria-label={props.copy.cloudConnectorPickerLabel}
                      value={pickerConnectorRef}
                      placeholder={props.copy.cloudConnectorPickerPlaceholder}
                      contentLayer="dialog"
                      disabled={isLoading && connectors.length === 0}
                      options={connectors.filter((entry) => entry.state === 'ready').map((entry) => ({
                        value: entry.connectorRef,
                        label: `${entry.label} · ${entry.provider}`,
                      }))}
                      onValueChange={(value) => {
                        clearSelection();
                        setPickerConnectorRef(value);
                        setCloudError('');
                      }}
                    />
                  </label>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--nimi-text-muted)]">
                      {isLoading && !cloudError ? props.copy.modelPickerLoadingLabel : cloudError || props.copy.cloudNoConnectorsLabel}
                    </span>
                  </div>
                )}
                {connectors.length > 0 && !pickerConnectorRef ? (
                  <p className="m-0 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{props.copy.cloudConnectorSelectionRequired}</p>
                ) : null}
              </div>
            );
          }}
          renderItemActions={(choice) => choice.route === 'local' && props.onOpenMachineLoadout ? (
            <Button
              size="sm"
              tone="secondary"
              onClick={() => props.onOpenMachineLoadout?.(props.capabilityContract)}
            >
              {props.copy.openMachineLabel}
            </Button>
          ) : null}
          onClose={() => setPickerOpen(false)}
          onConfirm={(choice) => {
            setDraftChoice(choice);
            setConnectorRef(choice.route === 'cloud' ? choice.connectorRef : '');
            setSaveFailure(null);
          }}
        />
      </div>

      {draftChoice?.route === 'local' ? (
        <LocalSelectionSummary
          selection={props.selection}
          missingFeatures={missingFeatures}
          copy={props.copy}
          onOpenMachineLoadout={props.onOpenMachineLoadout ? () => props.onOpenMachineLoadout?.(props.capabilityContract) : undefined}
        />
      ) : null}

      {draftChoice?.route === 'cloud' ? (
        <div className="space-y-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3" data-nimi-model-config-cloud="true">
          <div>
            <div className="text-xs font-semibold text-[var(--nimi-text-primary)]">{props.copy.cloudNoticeLabel}</div>
            <p className="m-0 mt-1 text-[length:var(--nimi-type-overline-size)] leading-relaxed text-[var(--nimi-text-muted)]">{props.copy.cloudNoticeDescription}</p>
          </div>
          {cloudError ? <InlineAlert tone="warning">{cloudError}</InlineAlert> : null}
          <InlineAlert tone="info">
            <div className="font-semibold">
              {selectedConnector ? `${selectedConnector.label} · ${selectedConnector.provider}` : props.copy.cloudConnectorSelectionRequired}
            </div>
          </InlineAlert>
        </div>
      ) : null}

      <CapabilityDefaultsEditor
        capabilityContract={props.capabilityContract}
        value={draftDefaults}
        onChange={setDraftDefaults}
        route={draftChoice?.route || null}
        effectiveDefaults={null}
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
          {conflictCurrent ? (
            <p
              className="m-0 text-xs text-[var(--nimi-text-secondary)]"
              data-nimi-model-config-conflict-current="true"
            >
              {props.copy.conflictCurrentLabel(
                conflictCurrent.revision,
                conflictCurrent.intent?.route.oneofKind === 'local'
                  ? props.copy.localLabel
                  : conflictCurrent.intent?.route.oneofKind === 'cloud'
                    ? `${props.copy.cloudLabel} · ${cloudModelLabel(conflictCurrent.intent) || conflictCurrent.intent.route.cloud.connectorRef}`
                    : props.copy.notConfiguredLabel,
              )}
            </p>
          ) : null}
          {saveFailure.technicalDetail ? (
            <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] p-2 text-xs text-[var(--nimi-text-secondary)]">
              <summary className="cursor-pointer font-semibold">{props.copy.technicalDetailsLabel}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[length:var(--nimi-type-overline-size)]">{saveFailure.technicalDetail}</pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {props.currentIntent ? (
          <Button
            tone="secondary"
            disabled={routeDisabled || !props.revision}
            onClick={() => { void clearIntent(); }}
            data-testid={`model-config-clear:${props.capabilityContract}`}
          >
            {saving && mutationKind === 'clear' ? props.copy.clearingLabel : props.copy.clearLabel}
          </Button>
        ) : null}
        <Button
          tone="primary"
          disabled={routeDisabled || !draftRouteAllowed || !draftChoice || !props.revision
            || (draftChoice.route === 'cloud' && (!selectedConnector || !exactCloudSelection))}
          onClick={() => { void commit(); }}
          data-testid={`model-config-save:${props.capabilityContract}`}
        >
          {saving && mutationKind === 'save'
            ? props.copy.savingLabel
            : draftChoice?.route === 'cloud' ? props.copy.saveCloudLabel : props.copy.saveLocalLabel}
        </Button>
      </div>
    </div>
  );
}

function LocalSelectionSummary(props: {
  readonly selection: ModelConfigEffectiveSelectionProjection | null | undefined;
  readonly missingFeatures: readonly string[];
  readonly copy: ResolvedCopy;
  readonly onOpenMachineLoadout?: () => void;
}) {
  const selection = props.selection;
  const local = selection?.resource?.oneofKind === 'local' ? selection.resource.local : null;
  let toneClass = 'text-[var(--nimi-status-warning)]';
  let message = props.copy.localMissingLabel;
  if (selection === undefined) {
    toneClass = 'text-[var(--nimi-status-success)]';
    message = `${props.copy.localLabel} · ${props.copy.configuredLabel}`;
  } else if (selection?.state === 'unavailable') {
    toneClass = 'text-[var(--nimi-text-muted)]';
    message = props.copy.localUnavailableLabel;
  } else if (selection?.state === 'blocked') {
    message = `${props.copy.localBrokenLabel}${selection.reasons.length > 0 ? ` ${selection.reasons.join(', ')}` : ''}`;
  } else if (selection?.state === 'ready' && props.missingFeatures.length > 0) {
    message = props.copy.localMismatchLabel(props.missingFeatures.join(', '));
  } else if (selection?.state === 'ready' && local) {
    toneClass = 'text-[var(--nimi-status-success)]';
    message = `${props.copy.localSelectedLabel}: ${local.label || local.loadoutRef || ''}`;
  }
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <p className={cn('m-0 min-w-0 text-[length:var(--nimi-type-overline-size)] leading-relaxed', toneClass)}>{message}</p>
      {props.onOpenMachineLoadout ? (
        <button type="button" onClick={props.onOpenMachineLoadout} className={cn('shrink-0 text-[length:var(--nimi-type-overline-size)] font-medium text-[var(--nimi-action-primary-bg)] hover:underline', FOCUS_RING_CLASS_NAME)}>
          {props.copy.openMachineLabel}
        </button>
      ) : null}
    </div>
  );
}
