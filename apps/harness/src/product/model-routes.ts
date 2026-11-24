import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
} from '@nimiplatform/sdk/ai';

export type NimiRouteKind = 'cloud' | 'local' | 'unset';

export interface NimiSavedConfigOption {
  readonly configRef: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly revision: string;
  readonly routeKind: NimiRouteKind;
  readonly connectorRef?: string;
  readonly connectorLabel?: string;
  readonly provider?: string;
  readonly targetLabel?: string;
  readonly targetKey?: string;
  readonly ready: boolean;
}

export interface NimiLocalRouteOption {
  readonly available: boolean;
  readonly state: 'ready' | 'missing' | 'blocked';
  readonly label?: string;
  readonly loadoutRef?: string;
  readonly reasons: readonly string[];
  readonly matchedConfigRef?: string;
}

export interface NimiCloudTargetOption {
  readonly connectorRef: string;
  readonly connectorLabel: string;
  readonly provider: string;
  readonly targetKey: string;
  readonly label: string;
  readonly providerModelId?: string;
  readonly matchedConfigRef?: string;
  readonly matchedConfigName?: string;
}

export interface NimiCloudConnectorGroup {
  readonly connectorRef: string;
  readonly label: string;
  readonly provider: string;
  readonly targets: readonly NimiCloudTargetOption[];
}

export interface NimiModelRouteCatalog {
  readonly configs: readonly NimiSavedConfigOption[];
  readonly local: NimiLocalRouteOption;
  readonly cloudConnectors: readonly NimiCloudConnectorGroup[];
}

export type NimiEnsureRouteInput =
  | { readonly route: 'local' }
  | { readonly route: 'cloud'; readonly connectorRef: string; readonly targetKey: string };

export interface NimiAiConfigClientLike {
  get(query?: { configRef?: string; includeRecords?: boolean }): Promise<{
    record?: { configRef: string; name: string; revision: string; isDefault: boolean } | null;
    records?: readonly { configRef: string; name: string; revision: string; isDefault: boolean }[];
    revision: string;
    config?: { capabilities?: readonly any[] } | null;
    effectiveSelections: readonly any[];
  }>;
  listOptions(query: {
    kind: 'local-loadouts' | 'cloud-connectors' | 'cloud-targets';
    capabilityContract: string;
    connectorRef?: string;
  }): Promise<any>;
  overwrite(input: {
    record?: { action: 'create'; name: string } | { action: 'save'; configRef: string };
    expectedRevision: string;
    capabilities: readonly any[];
  }): Promise<{
    outcome: 'committed' | 'conflict';
    record?: { configRef: string; name: string; revision: string; isDefault: boolean } | null;
    revision: string;
  }>;
}

function isProtobufStruct(value: unknown): value is { fields: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'fields' in value && typeof (value as { fields?: unknown }).fields === 'object'
    && (value as { fields?: unknown }).fields !== null;
}

export function unwrapTargetJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (isProtobufStruct(value)) {
    return runtimeAIConfigStructToJson(value as Parameters<typeof runtimeAIConfigStructToJson>[0]) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export function canonicalTargetKey(raw: unknown): string {
  const target = unwrapTargetJson(raw);
  if (!target) return '';
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(target).sort()) {
    sorted[key] = target[key];
  }
  try { return JSON.stringify(sorted); } catch { return ''; }
}

function targetObjectsMatch(leftRaw: unknown, rightRaw: unknown): boolean {
  const left = unwrapTargetJson(leftRaw);
  const right = unwrapTargetJson(rightRaw);
  if (!left || !right) return false;
  if (canonicalTargetKey(left) === canonicalTargetKey(right)) return true;
  const leftCatalog = typeof left.remoteModelCatalogId === 'string' ? left.remoteModelCatalogId : '';
  const rightCatalog = typeof right.remoteModelCatalogId === 'string' ? right.remoteModelCatalogId : '';
  if (leftCatalog && rightCatalog) return leftCatalog === rightCatalog;
  const leftModel = typeof left.providerModelId === 'string' ? left.providerModelId : '';
  const rightModel = typeof right.providerModelId === 'string' ? right.providerModelId : '';
  return Boolean(leftModel && rightModel && leftModel === rightModel);
}

function uniqueRecordName(baseName: string, existingNames: ReadonlySet<string>): string {
  const sanitized = baseName.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 118) || 'Nimi Model';
  if (!existingNames.has(sanitized)) return sanitized;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${sanitized} (${suffix})`.slice(0, 128);
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${sanitized.slice(0, 110)}-${Date.now().toString(36)}`;
}

async function readAllRecordSnapshots(aiConfig: NimiAiConfigClientLike) {
  const directory = await aiConfig.get({ includeRecords: true });
  const records = directory.records ?? (directory.record ? [directory.record] : []);
  const snapshots = await Promise.all(records.map(async record => {
    const snapshot = record.configRef === directory.record?.configRef
      ? directory
      : await aiConfig.get({ configRef: record.configRef });
    return { record, snapshot };
  }));
  snapshots.sort((a, b) => {
    if (a.record.isDefault !== b.record.isDefault) return a.record.isDefault ? -1 : 1;
    return a.record.name.localeCompare(b.record.name);
  });
  return { directory, snapshots };
}

type TextBehaviorProjectionLike = {
  readonly kind?: string;
  readonly configurationState?: string;
  readonly configuredToolUse?: { readonly supportsStream?: boolean } | null;
};

/**
 * Harness agent turns require streaming tool-use support.
 * When Runtime projects canonical `textBehaviors` on `text.generate` Cloud targets,
 * keep only targets with configured streaming tool-use; when absent (older Runtime),
 * fall back to allowing ready targets.
 */
export function supportsStreamingToolUse(target: { readonly textBehaviors?: readonly TextBehaviorProjectionLike[] }): boolean {
  if (!Array.isArray(target.textBehaviors) || target.textBehaviors.length === 0) return true;
  const toolUse = target.textBehaviors.find(b => b.kind === 'tool-use');
  return toolUse?.configurationState === 'configured' && toolUse.configuredToolUse?.supportsStream === true;
}

export async function loadNimiModelRouteCatalog(
  aiConfig: NimiAiConfigClientLike,
): Promise<NimiModelRouteCatalog> {
  const [{ snapshots }, localRes, connectorsRes] = await Promise.all([
    readAllRecordSnapshots(aiConfig),
    aiConfig.listOptions({ kind: 'local-loadouts', capabilityContract: 'text.generate' })
      .catch(() => ({ kind: 'local-loadouts', options: [], truncated: false })),
    aiConfig.listOptions({ kind: 'cloud-connectors', capabilityContract: 'text.generate' })
      .catch(() => ({ kind: 'cloud-connectors', options: [], truncated: false })),
  ]);

  const configs: NimiSavedConfigOption[] = [];
  const matchEntries: {
    configRef: string;
    name: string;
    routeKind: NimiRouteKind;
    connectorRef?: string;
    targetObj?: Record<string, unknown>;
  }[] = [];

  for (const { record, snapshot } of snapshots) {
    const selection = snapshot.effectiveSelections.find(s => s.capabilityContract === 'text.generate');
    const intent = snapshot.config?.capabilities?.find(c => c.capabilityContract === 'text.generate');
    const resource = selection?.resource;
    const local = resource?.oneofKind === 'local' ? resource.local : undefined;
    const cloud = resource?.oneofKind === 'cloud' ? resource.cloud : undefined;
    const routeKind: NimiRouteKind = local || intent?.route?.oneofKind === 'local'
      ? 'local'
      : cloud || intent?.route?.oneofKind === 'cloud'
        ? 'cloud'
        : 'unset';
    const intentTarget = intent?.route?.oneofKind === 'cloud'
      ? unwrapTargetJson(intent.route.cloud.providerModelTarget)
      : undefined;
    const effectiveTarget = cloud?.target?.providerModelTarget
      ? unwrapTargetJson(cloud.target.providerModelTarget)
      : undefined;
    const targetObj = intentTarget ?? effectiveTarget;
    const connectorRef = cloud?.connector?.connectorRef
      ?? (intent?.route?.oneofKind === 'cloud' ? intent.route.cloud.connectorRef : undefined);
    const connectorLabel = cloud?.connector?.label;
    const provider = cloud?.connector?.provider
      ?? (typeof targetObj?.provider === 'string' ? targetObj.provider : undefined);
    const targetLabel = cloud?.target?.label ?? local?.label;
    const targetKey = routeKind === 'cloud' ? canonicalTargetKey(targetObj) : undefined;
    const ready = Boolean(resource && selection?.state === 'ready');

    matchEntries.push({
      configRef: record.configRef,
      name: record.name,
      routeKind,
      ...(connectorRef ? { connectorRef } : {}),
      ...(targetObj ? { targetObj } : {}),
    });

    configs.push({
      configRef: record.configRef,
      name: record.name,
      isDefault: record.isDefault,
      revision: record.revision,
      routeKind,
      ...(connectorRef ? { connectorRef } : {}),
      ...(connectorLabel ? { connectorLabel } : {}),
      ...(provider ? { provider } : {}),
      ...(targetLabel ? { targetLabel } : {}),
      ...(targetKey ? { targetKey } : {}),
      ready,
    });
  }

  const localOption = localRes?.kind === 'local-loadouts' ? localRes.options?.[0] : undefined;
  const matchedLocal = matchEntries.find(e => e.routeKind === 'local');
  const local: NimiLocalRouteOption = {
    available: Boolean(localOption && localOption.state === 'ready'),
    state: localOption ? (localOption.state === 'ready' ? 'ready' : 'blocked') : 'missing',
    ...(localOption?.label ? { label: localOption.label } : {}),
    ...(localOption?.loadoutRef ? { loadoutRef: localOption.loadoutRef } : {}),
    reasons: Array.isArray(localOption?.reasons) ? localOption.reasons : [],
    ...(matchedLocal ? { matchedConfigRef: matchedLocal.configRef } : {}),
  };

  const readyConnectors: any[] = connectorsRes?.kind === 'cloud-connectors'
    ? (connectorsRes.options ?? []).filter((c: any) => c.state === 'ready')
    : [];

  const cloudConnectors = (await Promise.all(readyConnectors.map(async connector => {
    const targetsRes = await aiConfig.listOptions({
      kind: 'cloud-targets',
      capabilityContract: 'text.generate',
      connectorRef: connector.connectorRef,
    }).catch(() => ({ kind: 'cloud-targets', options: [], truncated: false }));
    const readyTargets: any[] = targetsRes?.kind === 'cloud-targets'
      ? (targetsRes.options ?? []).filter((t: any) => t.state === 'ready' && supportsStreamingToolUse(t))
      : [];
    const targets: NimiCloudTargetOption[] = readyTargets.map(target => {
      const targetObj = unwrapTargetJson(target.providerModelTarget) ?? {};
      const targetKey = canonicalTargetKey(targetObj);
      const providerModelId = typeof targetObj.providerModelId === 'string' ? targetObj.providerModelId : undefined;
      const matched = matchEntries.find(e =>
        e.routeKind === 'cloud'
        && e.connectorRef === connector.connectorRef
        && targetObjectsMatch(e.targetObj, targetObj));
      return {
        connectorRef: connector.connectorRef,
        connectorLabel: connector.label,
        provider: connector.provider,
        targetKey,
        label: target.label,
        ...(providerModelId ? { providerModelId } : {}),
        ...(matched ? { matchedConfigRef: matched.configRef, matchedConfigName: matched.name } : {}),
      };
    });
    return {
      connectorRef: connector.connectorRef,
      label: connector.label,
      provider: connector.provider,
      targets,
    } satisfies NimiCloudConnectorGroup;
  }))).filter(group => group.targets.length > 0);

  cloudConnectors.sort((a, b) => a.label.localeCompare(b.label));

  return { configs, local, cloudConnectors };
}

export async function ensureNimiRouteConfig(
  aiConfig: NimiAiConfigClientLike,
  input: NimiEnsureRouteInput,
): Promise<{ readonly configRef: string; readonly name: string; readonly created: boolean }> {
  const findExisting = async () => {
    const { directory, snapshots } = await readAllRecordSnapshots(aiConfig);
    if (input.route === 'local') {
      const matched = snapshots.find(({ snapshot }) =>
        snapshot.config?.capabilities?.some(c => c.capabilityContract === 'text.generate' && c.route?.oneofKind === 'local'));
      return { directory, snapshots, matched };
    }
    const matched = snapshots.find(({ snapshot }) => {
      const intent = snapshot.config?.capabilities?.find(c => c.capabilityContract === 'text.generate');
      if (!intent || intent.route?.oneofKind !== 'cloud') return false;
      return intent.route.cloud.connectorRef === input.connectorRef
        && canonicalTargetKey(intent.route.cloud.providerModelTarget) === input.targetKey;
    });
    return { directory, snapshots, matched };
  };

  const initial = await findExisting();
  if (initial.matched) {
    const sel = initial.matched.snapshot.effectiveSelections.find(s => s.capabilityContract === 'text.generate');
    if (sel?.state === 'ready') {
      return {
        configRef: initial.matched.record.configRef,
        name: initial.matched.record.name,
        created: false,
      };
    }
  }

  const defaultSnapshot = initial.snapshots.find(s => s.record.isDefault)?.snapshot ?? initial.directory;
  const preservedCapabilities = (defaultSnapshot.config?.capabilities ?? [])
    .filter(c => c.capabilityContract !== 'text.generate');
  const existingNames = new Set(initial.snapshots.map(s => s.record.name));

  let textIntent: unknown;
  let recordName: string;

  if (input.route === 'local') {
    const localRes = await aiConfig.listOptions({ kind: 'local-loadouts', capabilityContract: 'text.generate' });
    const localOption = localRes?.kind === 'local-loadouts' ? localRes.options?.[0] : undefined;
    if (!localOption || localOption.state !== 'ready') {
      throw new Error('No ready on-device text model is configured in Nimi Home. Open Nimi Home to configure a local model.');
    }
    textIntent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      requiredFeatures: [],
    });
    recordName = uniqueRecordName(localOption.label ? `Local · ${localOption.label}` : 'Local', existingNames);
  } else {
    const connectorsRes = await aiConfig.listOptions({ kind: 'cloud-connectors', capabilityContract: 'text.generate' });
    const connector = connectorsRes?.kind === 'cloud-connectors'
      ? (connectorsRes.options ?? []).find((c: any) => c.connectorRef === input.connectorRef && c.state === 'ready')
      : undefined;
    if (!connector) {
      throw new Error('Selected Nimi Cloud connector is unavailable. Refresh models or check Nimi Home.');
    }
    const targetsRes = await aiConfig.listOptions({
      kind: 'cloud-targets',
      capabilityContract: 'text.generate',
      connectorRef: connector.connectorRef,
    });
    const target = targetsRes?.kind === 'cloud-targets'
      ? (targetsRes.options ?? []).find((t: any) => t.state === 'ready' && canonicalTargetKey(t.providerModelTarget) === input.targetKey)
      : undefined;
    if (!target) {
      throw new Error('Selected Nimi Cloud model is no longer available. Refresh models and choose another target.');
    }
    textIntent = createNimiCloudAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      connectorRef: connector.connectorRef,
      requiredFeatures: [],
      implementation: target.implementation,
      providerModelTarget: unwrapTargetJson(target.providerModelTarget) as never,
    });
    recordName = uniqueRecordName(`${connector.label} / ${target.label}`, existingNames);
  }

  const overwriteRes = await aiConfig.overwrite({
    record: { action: 'create', name: recordName },
    expectedRevision: '0',
    capabilities: [...preservedCapabilities, textIntent],
  });

  if (overwriteRes.outcome !== 'committed' || !overwriteRes.record) {
    const retry = await findExisting();
    if (retry.matched) {
      return {
        configRef: retry.matched.record.configRef,
        name: retry.matched.record.name,
        created: false,
      };
    }
    throw new Error('Could not save this Nimi model route (maximum 64 named configurations or concurrent update). Manage configurations in Models & Access.');
  }

  return {
    configRef: overwriteRes.record.configRef,
    name: overwriteRes.record.name,
    created: true,
  };
}
