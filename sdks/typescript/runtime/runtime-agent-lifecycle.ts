import {
  type LocalAgentRecord,
  AgentLifecycleStatus,
  type GetAgentRequest,
  type GetAgentResponse,
  type ListAgentsRequest,
  type ListAgentsResponse,
  type RuntimeTypedCallOptions,
  type TerminateAgentRequest,
  type TerminateAgentResponse,
} from '../core-generated/runtime-typed-client';
import { asNimiError, createNimiError, ReasonCode } from '../types';
import { buildRuntimeAgentRequestContext, isRuntimeLocalAgentRef } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';
import {
  decodeNimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentSourceRef,
  type NimiRuntimeAgentSourceContextStatus,
} from './runtime-agent-context-projections';

export interface NimiRuntimeAgentLifecycleSurface {
  listLocalAgents(input?: NimiRuntimeAgentListLocalAgentsInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  discoverLocalAgentsBySource(input: NimiRuntimeAgentDiscoverLocalAgentsBySourceInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  terminateLocalAgent(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
}

export interface NimiRuntimeAgentDiscoverLocalAgentsBySourceInput {
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef?: unknown;
  readonly sourceRef?: NimiRuntimeAgentSourceRef | null;
}

export interface NimiRuntimeAgentDiscoveredLocalAgent {
  readonly localAgentRef: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly displayName: string;
  readonly sourceKind: string | null;
  readonly sourceWorldId: string | null;
  readonly sourceWorldName: string | null;
  readonly sourceId: string | null;
  readonly sourceHash: string | null;
  readonly sourceSchemaVersion: string | null;
  readonly snapshotHash: string | null;
  readonly worldContentHash: string | null;
  readonly materializationContextHash: string | null;
  readonly capturedAt: string | null;
  readonly sourceContextStatus: NimiRuntimeAgentSourceContextStatus | null;
  readonly agent: LocalAgentRecord;
}

export interface NimiRuntimeAgentListLocalAgentsInput {
  readonly ownerUserId?: unknown;
}

export interface NimiRuntimeAgentTerminateLocalAgentInput {
  readonly localAgentRef: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly reason?: unknown;
}

export interface NimiHostRuntimeAgentLifecycleClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: {
    getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentResponse>;
    listAgents(request: ListAgentsRequest, options?: RuntimeTypedCallOptions): Promise<ListAgentsResponse>;
    terminateAgent(request: TerminateAgentRequest, options?: RuntimeTypedCallOptions): Promise<TerminateAgentResponse>;
  };
}

export interface NimiHostRuntimeAgentLifecycleSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentLifecycleClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function lifecycleError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function requireLifecycleText(value: unknown, reasonCode: string, actionHint: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    lifecycleError(`Runtime Agent lifecycle requires ${actionHint}.`, reasonCode, actionHint);
  }
  return normalized;
}

function normalizeSourceRefInput(value: NimiRuntimeAgentSourceRef | null | undefined): NimiRuntimeAgentSourceRef | null {
  if (!value) {
    return null;
  }
  const id = normalizeNimiRuntimeAgentText(value.id);
  const worldId = normalizeNimiRuntimeAgentText(value.worldId);
  const sourceHash = normalizeNimiRuntimeAgentText(value.sourceHash);
  if (!id || !worldId || !/^[a-f0-9]{64}$/u.test(sourceHash)) {
    lifecycleError(
      'Runtime Agent lifecycle sourceRef must be a canonical CharacterSourceRefV3.',
      'SDK_RUNTIME_AGENT_SOURCE_REF_INVALID',
      'provide_character_source_ref_v3',
    );
  }
  if (value.kind === 'worldCharacter') {
    const entityWorldId = normalizeNimiRuntimeAgentText(value.worldEntityRef?.worldId);
    const entityId = normalizeNimiRuntimeAgentText(value.worldEntityRef?.entityId);
    if (value.worldEntityRef?.kind !== 'worldEntity' || entityWorldId !== worldId || !entityId) {
      lifecycleError(
        'Runtime Agent lifecycle WorldCharacter sourceRef has an invalid world entity binding.',
        'SDK_RUNTIME_AGENT_SOURCE_REF_INVALID',
        'provide_character_source_ref_v3',
      );
    }
    return {
      kind: 'worldCharacter', id, worldId, sourceHash,
      worldEntityRef: { kind: 'worldEntity', worldId: entityWorldId, entityId },
    };
  }
  const ownerAccountId = normalizeNimiRuntimeAgentText(value.ownerAccountId);
  if (value.kind !== 'personaCharacter' || !ownerAccountId) {
    lifecycleError(
      'Runtime Agent lifecycle PersonaCharacter sourceRef has an invalid owner binding.',
      'SDK_RUNTIME_AGENT_SOURCE_REF_INVALID',
      'provide_character_source_ref_v3',
    );
  }
  return { kind: 'personaCharacter', id, worldId, ownerAccountId, sourceHash };
}

function readSourceMaterializationProvenance(agent: LocalAgentRecord) {
  const status = agent.sourceContextStatus;
  if (!status) {
    return {
      sourceKind: null,
      sourceWorldId: null,
      sourceWorldName: null,
      sourceId: null,
      sourceHash: null,
      sourceSchemaVersion: null,
      snapshotHash: null,
      worldContentHash: null,
      materializationContextHash: null,
      capturedAt: null,
      sourceContextStatus: null,
    };
  }
  let projection: NimiRuntimeAgentSourceContextStatus;
  try {
    projection = decodeNimiRuntimeAgentSourceContextStatus(status);
  } catch {
    lifecycleError(
      'Runtime Agent bounded source context status is invalid.',
      'SDK_RUNTIME_AGENT_SOURCE_STATUS_INVALID',
      'check_runtime_agent_source_context_status',
    );
  }
  const sourceRef = projection.sourceRef;
  return {
    sourceKind: sourceRef?.kind ?? null,
    sourceWorldId: sourceRef?.worldId ?? null,
    sourceWorldName: null,
    sourceId: sourceRef?.id ?? null,
    sourceHash: sourceRef?.sourceHash ?? null,
    sourceSchemaVersion: projection.sourceSchemaVersion,
    snapshotHash: projection.snapshotHash,
    worldContentHash: projection.worldContentHash,
    materializationContextHash: projection.materializationContextHash,
    capturedAt: projection.capturedAt,
    sourceContextStatus: projection,
  };
}

function sourceProvenanceMatches(
  agent: LocalAgentRecord,
  sourceRef: ReturnType<typeof normalizeSourceRefInput>,
): boolean {
  if (!sourceRef) {
    return true;
  }
  const provenance = readSourceMaterializationProvenance(agent);
  return provenance.sourceContextStatus?.sourceRef !== null
    && provenance.sourceContextStatus?.sourceRef !== undefined
    && sourceRefsMatch(provenance.sourceContextStatus.sourceRef, sourceRef);
}

function sourceRefsMatch(left: NimiRuntimeAgentSourceRef, right: NimiRuntimeAgentSourceRef): boolean {
  if (left.kind !== right.kind || left.id !== right.id || left.worldId !== right.worldId || left.sourceHash !== right.sourceHash) {
    return false;
  }
  if (left.kind === 'worldCharacter' && right.kind === 'worldCharacter') {
    return left.worldEntityRef.kind === right.worldEntityRef.kind
      && left.worldEntityRef.worldId === right.worldEntityRef.worldId
      && left.worldEntityRef.entityId === right.worldEntityRef.entityId;
  }
  return left.kind === 'personaCharacter'
    && right.kind === 'personaCharacter'
    && left.ownerAccountId === right.ownerAccountId;
}

function toDiscoveredLocalAgent(agent: LocalAgentRecord): NimiRuntimeAgentDiscoveredLocalAgent | null {
  const localAgentRef = normalizeNimiRuntimeAgentText(agent.localAgentRef);
  const ownerUserId = normalizeNimiRuntimeAgentText(agent.ownerUserId);
  const runtimeSourceRef = normalizeNimiRuntimeAgentText(agent.runtimeSourceRef);
  if (!isRuntimeLocalAgentRef(localAgentRef) || !ownerUserId || !runtimeSourceRef) {
    return null;
  }
  const provenance = readSourceMaterializationProvenance(agent);
  return {
    localAgentRef,
    ownerUserId,
    runtimeSourceRef,
    displayName: normalizeNimiRuntimeAgentText(agent.displayName),
    ...provenance,
    agent,
  };
}

async function listAllRuntimeAgents(input: {
  readonly runtime: NimiHostRuntimeAgentLifecycleClient;
  readonly subjectUserId: string;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}): Promise<LocalAgentRecord[]> {
  const agents: LocalAgentRecord[] = [];
  let pageToken = '';
  const seenPageTokens = new Set<string>();
  for (let page = 0; page < 50; page += 1) {
    const response = await withNimiRuntimeAgentScopes({
      runtime: input.runtime,
      subjectUserId: input.subjectUserId,
      withScopes: input.withScopes,
    }, ['runtime.agent.read'], (callOptions) => input.runtime.agent.listAgents({
      lifecycleFilter: AgentLifecycleStatus.ACTIVE,
      autonomyEnabled: undefined,
      pageSize: 200,
      pageToken,
    }, callOptions));
    agents.push(...(response.agents || []));
    const nextPageToken = normalizeNimiRuntimeAgentText(response.nextPageToken);
    if (!nextPageToken) {
      return agents;
    }
    if (seenPageTokens.has(nextPageToken) || nextPageToken === pageToken) {
      lifecycleError(
        'Runtime Agent lifecycle discovery received a non-advancing inventory page token.',
        'SDK_RUNTIME_AGENT_DISCOVERY_INVALID',
        'check_runtime_agent_inventory_pagination',
      );
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  lifecycleError(
    'Runtime Agent lifecycle discovery exceeded the inventory pagination limit.',
    'SDK_RUNTIME_AGENT_DISCOVERY_INVALID',
    'check_runtime_agent_inventory_pagination',
  );
}

export function createNimiHostRuntimeAgentLifecycleSurface(
  options: NimiHostRuntimeAgentLifecycleSurfaceOptions,
): NimiRuntimeAgentLifecycleSurface {
  return {
    async listLocalAgents(input = {}) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent lifecycle requires authenticated subject user id.',
      );
      const ownerUserId = normalizeNimiRuntimeAgentText(input.ownerUserId) || subjectUserId;
      const agents = await listAllRuntimeAgents({
        runtime,
        subjectUserId: ownerUserId,
        withScopes: options.withScopes,
      });
      return agents
        .filter((agent) => Number(agent.lifecycleStatus) === AgentLifecycleStatus.ACTIVE)
        .filter((agent) => normalizeNimiRuntimeAgentText(agent.ownerUserId) === ownerUserId)
        .map(toDiscoveredLocalAgent)
        .filter((agent): agent is NimiRuntimeAgentDiscoveredLocalAgent => agent !== null);
    },
    async discoverLocalAgentsBySource(input) {
      const runtime = options.getRuntime();
      await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent lifecycle requires authenticated subject user id.',
      );
      const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
      const runtimeSourceRef = normalizeNimiRuntimeAgentText(input.runtimeSourceRef);
      const sourceRef = normalizeSourceRefInput(input.sourceRef);
      if (!runtimeSourceRef && !sourceRef) {
        lifecycleError(
          'Runtime Agent lifecycle discovery requires runtimeSourceRef or hash-bearing sourceRef.',
          'SDK_RUNTIME_AGENT_SOURCE_DISCOVERY_INPUT_REQUIRED',
          'provide_runtime_source_ref_or_hash_bearing_source_ref',
        );
      }
      const agents = await listAllRuntimeAgents({
        runtime,
        subjectUserId: ownerUserId,
        withScopes: options.withScopes,
      });
      return agents
        .filter((agent) => Number(agent.lifecycleStatus) === AgentLifecycleStatus.ACTIVE)
        .filter((agent) => normalizeNimiRuntimeAgentText(agent.ownerUserId) === ownerUserId)
        .filter((agent) => !runtimeSourceRef || normalizeNimiRuntimeAgentText(agent.runtimeSourceRef) === runtimeSourceRef)
        .filter((agent) => sourceProvenanceMatches(agent, sourceRef))
        .map(toDiscoveredLocalAgent)
        .filter((agent): agent is NimiRuntimeAgentDiscoveredLocalAgent => agent !== null);
    },
    async terminateLocalAgent(input) {
      const runtime = options.getRuntime();
      const localAgentRef = requireLifecycleText(input.localAgentRef, 'SDK_RUNTIME_AGENT_LOCAL_REF_REQUIRED', 'provide_runtime_agent_local_ref');
      const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
      const runtimeSourceRef = requireLifecycleText(input.runtimeSourceRef, 'SDK_RUNTIME_AGENT_REALM_ID_REQUIRED', 'provide_runtime_agent_runtime_source_ref');
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: ownerUserId,
        ownerUserId,
        runtimeSourceRef,
        localAgentRef,
      });
      await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId: ownerUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.admin'], (callOptions) => runtime.agent.terminateAgent({
        context,
        agentId: localAgentRef,
        reason: normalizeNimiRuntimeAgentText(input.reason) || 'runtime-agent-lifecycle:terminate-local-agent',
      }, callOptions));
    },
  };
}
