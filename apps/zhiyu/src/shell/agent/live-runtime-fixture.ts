import type { ZhiyuEvidence } from '../app/evidence';

export const ZHIYU_LIVE_RUNTIME_FIXTURE_QUERY = 'nimiZhiyuLiveRuntimeFixture';

const ELECTRON_SDK_ACCEPTANCE_QUERY = 'nimiElectronSdkAcceptance';

export type ZhiyuLiveRuntimeFixtureProjection = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly sourceRef: NonNullable<ZhiyuEvidence['source']['sourceRef']>;
  readonly route: {
    readonly capability: 'text.generate';
    readonly selectedTargetRefKind: string;
    readonly resolvedBindingRef: string;
    readonly executionBinding: NonNullable<ZhiyuEvidence['route']['executionBinding']>;
  };
};

export function readZhiyuLiveRuntimeFixtureProjection(): ZhiyuLiveRuntimeFixtureProjection | null {
  if (!isElectronAcceptanceRenderer()) {
    return null;
  }
  const encoded = new URL(window.location.href).searchParams.get(ZHIYU_LIVE_RUNTIME_FIXTURE_QUERY);
  if (!encoded) {
    return null;
  }
  return parseZhiyuLiveRuntimeFixtureProjection(encoded);
}

export function sourceStatusFromZhiyuLiveRuntimeFixture(
  projection: ZhiyuLiveRuntimeFixtureProjection | null,
): ZhiyuEvidence['source'] | null {
  if (!projection) {
    return null;
  }
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-source-projected',
    actionHint: 'discover_runtime_owned_local_agent',
    source: 'sdk-fixture',
    message: 'Runtime source projection was supplied by the SDK live fixture.',
    ownerUserId: projection.ownerUserId,
    runtimeSourceRef: projection.runtimeSourceRef,
    sourceRef: projection.sourceRef,
  };
}

export function routeStatusFromZhiyuLiveRuntimeFixture(
  projection: ZhiyuLiveRuntimeFixtureProjection | null,
): ZhiyuEvidence['route'] | null {
  if (!projection) {
    return null;
  }
  return {
    transport: 'electron-ipc',
    ready: true,
    capability: 'text.generate',
    aiConfigScopeOwnerId: 'nimi.zhiyu',
    aiConfigScopeSurfaceId: 'zhiyu-agent-home',
    enabledCapabilities: ['text.generate', 'chat.stream', 'text.embed', 'image.generate'],
    bindingCapabilities: {
      'text.generate': 'text.generate',
      'chat.stream': 'text.generate',
      'text.embed': 'text.embed',
      'image.generate': 'image.generate',
    },
    targetRefKinds: {
      'text.generate': projection.route.selectedTargetRefKind,
      'chat.stream': projection.route.selectedTargetRefKind,
      'text.embed': null,
      'image.generate': null,
    },
    reasonCode: 'runtime-route-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'sdk-fixture',
    message: 'Runtime route projection was supplied by the SDK live fixture.',
    selectedTargetRefKind: projection.route.selectedTargetRefKind,
    resolvedBindingRef: projection.route.resolvedBindingRef,
    executionBinding: projection.route.executionBinding,
  };
}

function parseZhiyuLiveRuntimeFixtureProjection(encoded: string): ZhiyuLiveRuntimeFixtureProjection | null {
  const parsed = parseFixtureJSON(encoded);
  if (!parsed) {
    return null;
  }
  const ownerUserId = stringOr(parsed.ownerUserId, '');
  const runtimeSourceRef = stringOr(parsed.runtimeSourceRef, '');
  const sourceRef = asRecord(parsed.sourceRef);
  const sourceKind = stringOr(sourceRef.kind, '');
  const sourceWorldId = stringOr(sourceRef.worldId, '');
  const sourceId = stringOr(sourceRef.sourceId, '');
  const sourceContentHash = stringOr(sourceRef.sourceContentHash, '');
  const route = asRecord(parsed.route);
  const executionBinding = asRecord(route.executionBinding);
  const executionRoute = stringOr(executionBinding.route, '');
  const executionModelId = stringOr(executionBinding.modelId, '');
  if (
    !ownerUserId
    || !runtimeSourceRef
    || !sourceKind
    || !sourceWorldId
    || !sourceId
    || !sourceContentHash
    || route.capability !== 'text.generate'
    || !stringOr(route.selectedTargetRefKind, '')
    || !stringOr(route.resolvedBindingRef, '')
    || (executionRoute !== 'local' && executionRoute !== 'cloud')
    || !executionModelId
  ) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    sourceRef: {
      kind: sourceKind,
      worldId: sourceWorldId,
      sourceId,
      sourceContentHash,
    },
    route: {
      capability: 'text.generate',
      selectedTargetRefKind: stringOr(route.selectedTargetRefKind, ''),
      resolvedBindingRef: stringOr(route.resolvedBindingRef, ''),
      executionBinding: {
        route: executionRoute,
        ['modelId']: executionModelId,
        ...(stringOr(executionBinding.connectorId, '') ? { connectorId: stringOr(executionBinding.connectorId, '') } : {}),
      },
    },
  };
}

function isElectronAcceptanceRenderer(): boolean {
  if (typeof window === 'undefined' || typeof electronRuntimeBridge(window)?.invoke !== 'function') {
    return false;
  }
  return new URL(window.location.href).searchParams.get(ELECTRON_SDK_ACCEPTANCE_QUERY) === '1';
}

function electronRuntimeBridge(value: Window): { readonly invoke?: unknown } | null {
  return (value as unknown as { readonly __NIMI_ELECTRON_RUNTIME__?: { readonly invoke?: unknown } })
    .__NIMI_ELECTRON_RUNTIME__ ?? null;
}

function parseFixtureJSON(encoded: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(decodeBase64UrlText(encoded)) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function decodeBase64UrlText(encoded: string): string {
  const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
