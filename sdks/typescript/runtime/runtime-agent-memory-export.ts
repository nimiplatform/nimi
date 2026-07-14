import {
  MemoryCanonicalClass,
  type CanonicalMemoryView,
  type GetAgentStateRequest,
  type GetAgentStateResponse,
  type MemoryBankLocator,
  type QueryAgentMemoryRequest,
  type QueryAgentMemoryResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { asNimiError, createNimiError, type JsonObject } from '../types';
import { buildRuntimeAgentRequestContext, projectRuntimeLocalAgentIdentity, type RuntimeLocalAgentIdentityInput } from './agent-local-identity';
import {
  formatNimiRuntimeAgentCanonicalClass,
  formatNimiRuntimeAgentMemoryRecordKind,
  formatNimiRuntimeAgentMemoryReplicationOutcome,
  normalizeNimiRuntimeAgentOptionalNumber,
  projectNimiRuntimeAgentStateSnapshot,
  summarizeNimiRuntimeAgentCanonicalMemoryView,
} from './runtime-agent-inspect-projection';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import {
  fromNimiRuntimeProtoStruct,
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
} from './runtime-agent-values';

/**
 * Canonical memory export helper.
 *
 * Authority posture (S-SURFACE-015 / S-SURFACE-016, `.nimi/spec/sdks/kernel/surface-contract.md`):
 * this module is a developer-experience composition over the admitted
 * RuntimeAgentService read projection (`queryAgentMemory` + `getAgentState`).
 * It owns no platform truth, writes nothing, and never presents client-side
 * assembly as canonical memory state. The produced envelope is handed to the
 * caller as a read projection snapshot; any persistence of that envelope is the
 * caller's decision outside platform authority.
 */

export const NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION = 1;

/**
 * `queryAgentMemory` is an int32 `limit` surface without a page cursor (the
 * runtime internally pages its memory history and returns at most `limit`
 * views per call). `limit` must therefore hold `maxRecords + 1` for the
 * completeness sentinel below, which bounds `maxRecords` at int32 max - 1.
 */
const MAX_EXPORT_RECORDS_UPPER_BOUND = 2_147_483_646;

export interface NimiRuntimeAgentMemoryExportBank {
  readonly bankKey: string;
  readonly scope: 'agent-core' | 'agent-dyadic' | 'world-shared' | 'app-private' | 'workspace-private';
  readonly agentId: string | null;
  readonly userId: string | null;
  readonly worldId: string | null;
  readonly accountId: string | null;
  readonly appId: string | null;
  readonly workspaceId: string | null;
  readonly recordCount: number;
}

export interface NimiRuntimeAgentMemoryExportProvenance {
  readonly sourceSystem: string | null;
  readonly sourceEventId: string | null;
  readonly authorId: string | null;
  readonly traceId: string | null;
  readonly committedAt: string | null;
}

export type NimiRuntimeAgentMemoryExportPayload =
  | {
    readonly kind: 'episodic';
    readonly summary: string;
    readonly occurredAt: string | null;
    readonly participants: readonly string[];
  }
  | {
    readonly kind: 'semantic';
    readonly subject: string;
    readonly predicate: string;
    readonly object: string;
    readonly confidence: number;
  }
  | {
    readonly kind: 'observational';
    readonly observation: string;
    readonly observedAt: string | null;
    readonly sourceRef: string | null;
  };

export interface NimiRuntimeAgentMemoryExportRecord {
  readonly memoryId: string;
  readonly bankKey: string;
  readonly canonicalClass: string | null;
  readonly kind: string | null;
  readonly summary: string;
  readonly payload: NimiRuntimeAgentMemoryExportPayload;
  readonly provenance: NimiRuntimeAgentMemoryExportProvenance | null;
  readonly replicationOutcome: string | null;
  readonly metadata: JsonObject | null;
  readonly extensions: JsonObject | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly policyReason: string | null;
  readonly recallScore: number | null;
}

export interface NimiRuntimeAgentMemoryExportEnvelope {
  readonly schemaVersion: typeof NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly agentId: string;
  readonly banks: readonly NimiRuntimeAgentMemoryExportBank[];
  readonly records: readonly NimiRuntimeAgentMemoryExportRecord[];
}

export interface NimiHostRuntimeAgentMemoryExportClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: {
    getAgentState(request: GetAgentStateRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentStateResponse>;
    queryAgentMemory(request: QueryAgentMemoryRequest, options?: RuntimeTypedCallOptions): Promise<QueryAgentMemoryResponse>;
  };
}

export interface NimiRuntimeAgentMemoryExportInput extends RuntimeLocalAgentIdentityInput {
  /**
   * Caller-supplied export clock (ISO-8601). The SDK never stamps wall time
   * itself for the envelope: per S-SURFACE-016 the helper owns no time
   * authority, so the host app decides what "exported at" means.
   */
  readonly exportedAt: string;
  /**
   * Hard upper bound on collected records. When the canonical surface holds
   * more records than this bound the export fails closed with
   * `SDK_RUNTIME_AGENT_MEMORY_EXPORT_MAX_RECORDS_EXCEEDED`. There is no
   * silent truncation path.
   */
  readonly maxRecords: number;
  readonly includeInvalidated?: boolean;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function exportError(message: string, reasonCode: string, actionHint: string, details?: JsonObject): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
    details,
  });
}

function requireExportAgentId(agentId: unknown): string {
  const normalized = normalizeNimiRuntimeAgentText(agentId);
  if (!normalized) {
    exportError(
      'Runtime Agent memory export requires agent id.',
      'SDK_RUNTIME_AGENT_ID_REQUIRED',
      'provide_runtime_agent_id',
    );
  }
  return normalized;
}

function requireExportedAt(value: unknown): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  const parsed = Date.parse(normalized);
  if (!normalized || Number.isNaN(parsed)) {
    exportError(
      'Runtime Agent memory export requires a caller-supplied ISO-8601 exportedAt value.',
      'SDK_RUNTIME_AGENT_MEMORY_EXPORT_EXPORTED_AT_INVALID',
      'provide_export_clock_iso_string',
    );
  }
  return new Date(parsed).toISOString();
}

function requireMaxRecords(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_EXPORT_RECORDS_UPPER_BOUND) {
    exportError(
      `Runtime Agent memory export requires maxRecords as a positive integer not exceeding ${MAX_EXPORT_RECORDS_UPPER_BOUND}.`,
      'SDK_RUNTIME_AGENT_MEMORY_EXPORT_MAX_RECORDS_INVALID',
      'provide_export_max_records',
    );
  }
  return value;
}

interface NimiRuntimeAgentMemoryExportBankIdentity {
  readonly bankKey: string;
  readonly scope: NimiRuntimeAgentMemoryExportBank['scope'];
  readonly agentId: string | null;
  readonly userId: string | null;
  readonly worldId: string | null;
  readonly accountId: string | null;
  readonly appId: string | null;
  readonly workspaceId: string | null;
}

function projectExportBankIdentity(
  locator: MemoryBankLocator | undefined,
  memoryId: string,
): NimiRuntimeAgentMemoryExportBankIdentity {
  const owner = locator?.owner;
  switch (owner?.oneofKind) {
    case 'agentCore':
      return {
        bankKey: `agent-core:${owner.agentCore.agentId}`,
        scope: 'agent-core',
        agentId: normalizeNimiRuntimeAgentText(owner.agentCore.agentId) || null,
        userId: null,
        worldId: null,
        accountId: null,
        appId: null,
        workspaceId: null,
      };
    case 'agentDyadic':
      return {
        bankKey: `agent-dyadic:${owner.agentDyadic.agentId}:${owner.agentDyadic.userId}`,
        scope: 'agent-dyadic',
        agentId: normalizeNimiRuntimeAgentText(owner.agentDyadic.agentId) || null,
        userId: normalizeNimiRuntimeAgentText(owner.agentDyadic.userId) || null,
        worldId: null,
        accountId: null,
        appId: null,
        workspaceId: null,
      };
    case 'worldShared':
      return {
        bankKey: `world-shared:${owner.worldShared.worldId}`,
        scope: 'world-shared',
        agentId: null,
        userId: null,
        worldId: normalizeNimiRuntimeAgentText(owner.worldShared.worldId) || null,
        accountId: null,
        appId: null,
        workspaceId: null,
      };
    case 'appPrivate':
      return {
        bankKey: `app-private:${owner.appPrivate.accountId}:${owner.appPrivate.appId}`,
        scope: 'app-private',
        agentId: null,
        userId: null,
        worldId: null,
        accountId: normalizeNimiRuntimeAgentText(owner.appPrivate.accountId) || null,
        appId: normalizeNimiRuntimeAgentText(owner.appPrivate.appId) || null,
        workspaceId: null,
      };
    case 'workspacePrivate':
      return {
        bankKey: `workspace-private:${owner.workspacePrivate.accountId}:${owner.workspacePrivate.workspaceId}`,
        scope: 'workspace-private',
        agentId: null,
        userId: null,
        worldId: null,
        accountId: normalizeNimiRuntimeAgentText(owner.workspacePrivate.accountId) || null,
        appId: null,
        workspaceId: normalizeNimiRuntimeAgentText(owner.workspacePrivate.workspaceId) || null,
      };
    default:
      exportError(
        `Runtime Agent memory export record ${memoryId} is missing its source bank owner.`,
        'SDK_RUNTIME_AGENT_MEMORY_EXPORT_RECORD_INVALID',
        'check_runtime_agent_memory_projection',
        { memoryId },
      );
  }
}

function projectExportPayload(view: CanonicalMemoryView, memoryId: string): NimiRuntimeAgentMemoryExportPayload {
  const payload = view.record?.payload;
  switch (payload?.oneofKind) {
    case 'episodic':
      return {
        kind: 'episodic',
        summary: normalizeNimiRuntimeAgentText(payload.episodic.summary),
        occurredAt: toNimiRuntimeIsoFromTimestamp(payload.episodic.occurredAt),
        participants: (payload.episodic.participants || []).map((participant) => normalizeNimiRuntimeAgentText(participant)),
      };
    case 'semantic':
      return {
        kind: 'semantic',
        subject: normalizeNimiRuntimeAgentText(payload.semantic.subject),
        predicate: normalizeNimiRuntimeAgentText(payload.semantic.predicate),
        object: normalizeNimiRuntimeAgentText(payload.semantic.object),
        confidence: normalizeNimiRuntimeAgentOptionalNumber(payload.semantic.confidence) ?? 0,
      };
    case 'observational':
      return {
        kind: 'observational',
        observation: normalizeNimiRuntimeAgentText(payload.observational.observation),
        observedAt: toNimiRuntimeIsoFromTimestamp(payload.observational.observedAt),
        sourceRef: normalizeNimiRuntimeAgentText(payload.observational.sourceRef) || null,
      };
    default:
      // Missing oneof discriminator is a typed contract violation; an export
      // that silently drops or blanks the record body would be pseudo-success.
      exportError(
        `Runtime Agent memory export record ${memoryId} has no payload discriminator.`,
        'SDK_RUNTIME_AGENT_MEMORY_EXPORT_RECORD_INVALID',
        'check_runtime_agent_memory_projection',
        { memoryId },
      );
  }
}

function projectExportProvenance(view: CanonicalMemoryView): NimiRuntimeAgentMemoryExportProvenance | null {
  const provenance = view.record?.provenance;
  if (!provenance) {
    return null;
  }
  return {
    sourceSystem: normalizeNimiRuntimeAgentText(provenance.sourceSystem) || null,
    sourceEventId: normalizeNimiRuntimeAgentText(provenance.sourceEventId) || null,
    authorId: normalizeNimiRuntimeAgentText(provenance.authorId) || null,
    traceId: normalizeNimiRuntimeAgentText(provenance.traceId) || null,
    committedAt: toNimiRuntimeIsoFromTimestamp(provenance.committedAt),
  };
}

function projectExportStruct(value: CanonicalMemoryView['record']): {
  readonly metadata: JsonObject | null;
  readonly extensions: JsonObject | null;
} {
  const metadata = value?.metadata ? fromNimiRuntimeProtoStruct(value.metadata) : null;
  const extensions = value?.extensions ? fromNimiRuntimeProtoStruct(value.extensions) : null;
  return {
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
    extensions: extensions && Object.keys(extensions).length > 0 ? extensions : null,
  };
}

function projectExportView(view: CanonicalMemoryView): {
  readonly record: NimiRuntimeAgentMemoryExportRecord;
  readonly bank: NimiRuntimeAgentMemoryExportBankIdentity;
} {
  const memoryId = normalizeNimiRuntimeAgentText(view.record?.memoryId);
  if (!memoryId) {
    exportError(
      'Runtime Agent memory export received a canonical memory view without memory id.',
      'SDK_RUNTIME_AGENT_MEMORY_EXPORT_RECORD_INVALID',
      'check_runtime_agent_memory_projection',
    );
  }
  const bank = projectExportBankIdentity(view.sourceBank || view.record?.bank, memoryId);
  const structs = projectExportStruct(view.record);
  return {
    bank,
    record: {
      memoryId,
      bankKey: bank.bankKey,
      canonicalClass: formatNimiRuntimeAgentCanonicalClass(view.canonicalClass),
      kind: formatNimiRuntimeAgentMemoryRecordKind(view.record?.kind),
      summary: summarizeNimiRuntimeAgentCanonicalMemoryView(view).trim(),
      payload: projectExportPayload(view, memoryId),
      provenance: projectExportProvenance(view),
      replicationOutcome: view.record?.replication
        ? formatNimiRuntimeAgentMemoryReplicationOutcome(view.record.replication.outcome)
        : null,
      metadata: structs.metadata,
      extensions: structs.extensions,
      createdAt: toNimiRuntimeIsoFromTimestamp(view.record?.createdAt),
      updatedAt: toNimiRuntimeIsoFromTimestamp(view.record?.updatedAt),
      policyReason: normalizeNimiRuntimeAgentText(view.policyReason) || null,
      recallScore: normalizeNimiRuntimeAgentOptionalNumber(view.recallScore),
    },
  };
}

export function projectNimiRuntimeAgentMemoryExportRecord(
  view: CanonicalMemoryView,
): NimiRuntimeAgentMemoryExportRecord {
  return projectExportView(view).record;
}

/**
 * Collects every canonical memory record reachable through the admitted
 * RuntimeAgentService read projection into a typed export envelope.
 *
 * Collection loop: the export walks the agent's admitted canonical classes
 * (public-shared always; world-shared / dyadic only when the agent state
 * projection exposes the matching active context, mirroring the inspect
 * surface). `queryAgentMemory` exposes a `limit` bound but no page cursor, so
 * each class is read once with `limit = remaining + 1` as a completeness
 * sentinel: a response that fills the sentinel proves more records exist than
 * the caller's `maxRecords` bound and the export fails closed instead of
 * truncating. A response below the sentinel is provably complete for that
 * class. Empty memory is a valid empty envelope, not an error.
 */
export async function createNimiRuntimeAgentMemoryExport(
  client: NimiHostRuntimeAgentMemoryExportClient,
  input: NimiRuntimeAgentMemoryExportInput,
): Promise<NimiRuntimeAgentMemoryExportEnvelope> {
  const identity = projectRuntimeLocalAgentIdentity(input);
  const agentId = requireExportAgentId(identity.localAgentRef);
  const exportedAt = requireExportedAt(input.exportedAt);
  const maxRecords = requireMaxRecords(input.maxRecords);
  const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
    input.getSubjectUserId,
    'Runtime Agent memory export requires authenticated subject user id.',
  );
  const requestContext = buildRuntimeAgentRequestContext({
    runtimeAppId: client.appId,
    subjectUserId,
    ...identity,
  });
  const scoped = <T>(operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>): Promise<T> =>
    withNimiRuntimeAgentScopes({
      runtime: client,
      subjectUserId,
      withScopes: input.withScopes,
    }, ['runtime.agent.read'], operation);

  let stateResponse: GetAgentStateResponse;
  try {
    stateResponse = await scoped((callOptions) => client.agent.getAgentState({
      context: requestContext,
      agentId: requestContext.localAgentRef,
    }, callOptions));
  } catch (error) {
    throw asNimiError(error, {
      message: 'Runtime Agent memory export failed to read agent state.',
      reasonCode: 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_READ_FAILED',
      actionHint: 'check_runtime_agent_memory_status',
    });
  }
  const stateSnapshot = projectNimiRuntimeAgentStateSnapshot(stateResponse.state);
  const canonicalClasses = [
    MemoryCanonicalClass.PUBLIC_SHARED,
    ...(stateSnapshot.activeWorldId ? [MemoryCanonicalClass.WORLD_SHARED] : []),
    ...(stateSnapshot.activeUserId ? [MemoryCanonicalClass.DYADIC] : []),
  ];

  const records: NimiRuntimeAgentMemoryExportRecord[] = [];
  const banks = new Map<string, NimiRuntimeAgentMemoryExportBank>();
  for (const canonicalClass of canonicalClasses) {
    const remaining = maxRecords - records.length;
    let response: QueryAgentMemoryResponse;
    try {
      response = await scoped((callOptions) => client.agent.queryAgentMemory({
        context: requestContext,
        agentId: requestContext.localAgentRef,
        query: '',
        limit: remaining + 1,
        canonicalClasses: [canonicalClass],
        kinds: [],
        includeInvalidated: input.includeInvalidated === true,
      }, callOptions));
    } catch (error) {
      // Abort the whole export: a partial envelope presented as complete
      // would violate the no-pseudo-success boundary.
      throw asNimiError(error, {
        message: 'Runtime Agent memory export failed while reading canonical memory.',
        reasonCode: 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_READ_FAILED',
        actionHint: 'check_runtime_agent_memory_status',
      });
    }
    const pageViews = response.memories || [];
    if (pageViews.length > remaining) {
      exportError(
        `Runtime Agent memory export exceeds the maxRecords bound of ${maxRecords}.`,
        'SDK_RUNTIME_AGENT_MEMORY_EXPORT_MAX_RECORDS_EXCEEDED',
        'raise_export_max_records',
        {
          maxRecords,
          canonicalClass: formatNimiRuntimeAgentCanonicalClass(canonicalClass),
        },
      );
    }
    for (const view of pageViews) {
      const projected = projectExportView(view);
      records.push(projected.record);
      const existing = banks.get(projected.bank.bankKey);
      banks.set(projected.bank.bankKey, {
        ...projected.bank,
        recordCount: (existing?.recordCount ?? 0) + 1,
      });
    }
  }

  return {
    schemaVersion: NIMI_RUNTIME_AGENT_MEMORY_EXPORT_SCHEMA_VERSION,
    exportedAt,
    agentId,
    banks: [...banks.values()].sort((left, right) => left.bankKey.localeCompare(right.bankKey)),
    records,
  };
}
