import {
  type AgentRecord,
  AgentLifecycleStatus,
  type GetAgentRequest,
  type GetAgentResponse,
  type InitializeAgentRequest,
  type InitializeAgentResponse,
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
  type NimiRuntimeAgentSourceContextStatus,
} from './runtime-agent-context-projections';

export interface NimiRuntimeAgentLifecycleSurface {
  listLocalAgents(input?: NimiRuntimeAgentListLocalAgentsInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  discoverLocalAgentsBySource(input: NimiRuntimeAgentDiscoverLocalAgentsBySourceInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  ensureLocalAgentInitialized(input: NimiRuntimeAgentEnsureLocalAgentInitializedInput): Promise<NimiRuntimeAgentInitializedLocalAgent>;
  initializeLocalAgent(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<NimiRuntimeAgentInitializedLocalAgent>;
  terminateLocalAgent(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
}

export interface NimiRuntimeAgentInitializeLocalAgentInput {
  readonly localAgentRef?: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly displayName?: unknown;
  readonly worldId?: unknown;
}

export interface NimiRuntimeAgentEnsureLocalAgentInitializedInput extends NimiRuntimeAgentInitializeLocalAgentInput {
  readonly localAgentRef: unknown;
}

export interface NimiRuntimeAgentInitializedLocalAgent {
  readonly localAgentRef: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly agent: AgentRecord;
  readonly sourceContextStatus: NimiRuntimeAgentSourceContextStatus | null;
}

export interface NimiRuntimeAgentSourceRefInput {
  readonly kind?: unknown;
  readonly worldId?: unknown;
  readonly sourceId?: unknown;
  readonly sourceContentHash?: unknown;
}

export interface NimiRuntimeAgentDiscoverLocalAgentsBySourceInput {
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef?: unknown;
  readonly sourceRef?: NimiRuntimeAgentSourceRefInput | null;
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
  readonly sourceContentHash: string | null;
  readonly sourceSchemaVersion: string | null;
  readonly snapshotHash: string | null;
  readonly worldContentHash: string | null;
  readonly materializationContextHash: string | null;
  readonly capturedAt: string | null;
  readonly sourceContextStatus: NimiRuntimeAgentSourceContextStatus | null;
  readonly agent: AgentRecord;
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
    initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions): Promise<InitializeAgentResponse>;
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

function buildLifecycleRequest(
  input: NimiRuntimeAgentInitializeLocalAgentInput,
  options: { readonly requireLocalAgentRef: boolean },
) {
  const localAgentRef = normalizeNimiRuntimeAgentText(input.localAgentRef);
  if (options.requireLocalAgentRef && !localAgentRef) {
    lifecycleError(
      'Runtime Agent lifecycle requires provide_runtime_agent_local_ref.',
      'SDK_RUNTIME_AGENT_LOCAL_REF_REQUIRED',
      'provide_runtime_agent_local_ref',
    );
  }
  const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
  const runtimeSourceRef = requireLifecycleText(input.runtimeSourceRef, 'SDK_RUNTIME_AGENT_REALM_ID_REQUIRED', 'provide_runtime_agent_runtime_source_ref');
  return {
    localAgentRef,
    ownerUserId,
    runtimeSourceRef,
    displayName: normalizeNimiRuntimeAgentText(input.displayName) || runtimeSourceRef,
    worldId: normalizeNimiRuntimeAgentText(input.worldId),
  };
}

function normalizeSourceRefInput(value: NimiRuntimeAgentSourceRefInput | null | undefined) {
  if (!value) {
    return null;
  }
  const sourceKind = normalizeNimiRuntimeAgentText(value.kind);
  const sourceWorldId = normalizeNimiRuntimeAgentText(value.worldId);
  const sourceId = normalizeNimiRuntimeAgentText(value.sourceId);
  const sourceContentHash = normalizeNimiRuntimeAgentText(value.sourceContentHash);
  if (!sourceKind || !sourceWorldId || !sourceId || !sourceContentHash) {
    lifecycleError(
      'Runtime Agent lifecycle sourceRef must include kind, worldId, sourceId, and sourceContentHash.',
      'SDK_RUNTIME_AGENT_SOURCE_REF_INVALID',
      'provide_hash_bearing_source_ref',
    );
  }
  return {
    sourceKind,
    sourceWorldId,
    sourceId,
    sourceContentHash,
  };
}

function buildInitializeAgentRequestContext(input: {
  readonly runtimeAppId: string;
  readonly subjectUserId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}) {
  return {
    appId: input.runtimeAppId,
    subjectUserId: input.subjectUserId,
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
  };
}

function normalizeInitializeAgentResponse(
  response: InitializeAgentResponse,
  request: ReturnType<typeof buildLifecycleRequest>,
): NimiRuntimeAgentInitializedLocalAgent {
  const agent = response.agent;
  const localAgentRef = normalizeNimiRuntimeAgentText(agent?.localAgentRef)
    || normalizeNimiRuntimeAgentText(agent?.agentId);
  if (!agent || !isRuntimeLocalAgentRef(localAgentRef)) {
    lifecycleError(
      'Runtime Agent lifecycle initializeAgent returned no Runtime-owned localAgentRef.',
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_initialize_response',
    );
  }
  return {
    localAgentRef,
    ownerUserId: normalizeNimiRuntimeAgentText(agent.ownerUserId) || request.ownerUserId,
    runtimeSourceRef: normalizeNimiRuntimeAgentText(agent.runtimeSourceRef) || request.runtimeSourceRef,
    sourceContextStatus: agent.sourceContextStatus
      ? decodeNimiRuntimeAgentSourceContextStatus(agent.sourceContextStatus)
      : null,
    agent,
  };
}

function readSourceMaterializationProvenance(agent: AgentRecord) {
  const status = agent.sourceContextStatus;
  if (!status) {
    return {
      sourceKind: null,
      sourceWorldId: null,
      sourceWorldName: null,
      sourceId: null,
      sourceContentHash: null,
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
    sourceId: sourceRef?.sourceId ?? null,
    sourceContentHash: sourceRef?.sourceContentHash ?? null,
    sourceSchemaVersion: projection.sourceSchemaVersion,
    snapshotHash: projection.snapshotHash,
    worldContentHash: projection.worldContentHash,
    materializationContextHash: projection.materializationContextHash,
    capturedAt: projection.capturedAt,
    sourceContextStatus: projection,
  };
}

function sourceProvenanceMatches(
  agent: AgentRecord,
  sourceRef: ReturnType<typeof normalizeSourceRefInput>,
): boolean {
  if (!sourceRef) {
    return true;
  }
  const provenance = readSourceMaterializationProvenance(agent);
  return provenance.sourceKind === sourceRef.sourceKind
    && provenance.sourceWorldId === sourceRef.sourceWorldId
    && provenance.sourceId === sourceRef.sourceId
    && provenance.sourceContentHash === sourceRef.sourceContentHash;
}

function toDiscoveredLocalAgent(agent: AgentRecord): NimiRuntimeAgentDiscoveredLocalAgent | null {
  const localAgentRef = normalizeNimiRuntimeAgentText(agent.localAgentRef)
    || normalizeNimiRuntimeAgentText(agent.agentId);
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
}): Promise<AgentRecord[]> {
  const agents: AgentRecord[] = [];
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
  async function initializeWithRuntime(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<NimiRuntimeAgentInitializedLocalAgent> {
    const runtime = options.getRuntime();
    await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent lifecycle requires authenticated subject user id.',
    );
    const request = buildLifecycleRequest(input, { requireLocalAgentRef: false });
    const context = buildInitializeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId: request.ownerUserId,
      ownerUserId: request.ownerUserId,
      runtimeSourceRef: request.runtimeSourceRef,
      localAgentRef: request.localAgentRef,
    });
    try {
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId: request.ownerUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.admin'], (callOptions) => runtime.agent.initializeAgent({
        context,
        agentId: '',
        localAgentRef: request.localAgentRef,
        ownerUserId: request.ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
        displayName: request.displayName,
        autonomyConfig: undefined,
        worldId: request.worldId,
        metadata: undefined,
      }, callOptions));
      return normalizeInitializeAgentResponse(response, request);
    } catch (error) {
      throw asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'initialize_local_agent',
        source: 'runtime',
      });
    }
  }

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
    async ensureLocalAgentInitialized(input) {
      const runtime = options.getRuntime();
      await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent lifecycle requires authenticated subject user id.',
      );
      const request = buildLifecycleRequest(input, { requireLocalAgentRef: true });
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: request.ownerUserId,
        ownerUserId: request.ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
        localAgentRef: request.localAgentRef,
      });
      try {
        const response = await withNimiRuntimeAgentScopes({
          runtime,
          subjectUserId: request.ownerUserId,
          withScopes: options.withScopes,
        }, ['runtime.agent.read'], (callOptions) => runtime.agent.getAgent({
          context,
          agentId: request.localAgentRef,
        }, callOptions));
        const agent = response.agent;
        if (agent && Number(agent.lifecycleStatus) === AgentLifecycleStatus.ACTIVE) {
          return {
            localAgentRef: request.localAgentRef,
            ownerUserId: request.ownerUserId,
            runtimeSourceRef: request.runtimeSourceRef,
            sourceContextStatus: agent.sourceContextStatus
              ? decodeNimiRuntimeAgentSourceContextStatus(agent.sourceContextStatus)
              : null,
            agent,
          };
        }
      } catch (error) {
        const normalized = asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'check_runtime_agent',
          source: 'runtime',
        });
        if (normalized.reasonCode !== 'RUNTIME_GRPC_NOT_FOUND') {
          throw normalized;
        }
      }
      return initializeWithRuntime(input);
    },
    async initializeLocalAgent(input) {
      return initializeWithRuntime(input);
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
