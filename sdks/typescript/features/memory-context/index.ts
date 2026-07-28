import type {
  HistoryRequest,
  HistoryResponse,
  MemoryBankLocator,
  MemoryEvent,
  MemoryRecord,
  MemoryRecallHit,
  RecallRequest,
  RecallResponse,
  SubscribeMemoryEventsRequest,
} from '../../core-generated/runtime-typed-client';
import { MemoryBankScope as RuntimeMemoryBankScope } from '../../core-generated/runtime-typed-client';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { dataPart, type NimiDataPart, type NimiJsonObject, type NimiJsonValue } from '../../core/contracts';
import type { NimiAiContextProvider, NimiAiContextQuery } from '../../core/ai-runner';
import { resolveNimiAiContextQuery } from '../../core/ai-runner';
import { createNimiError } from '../../types';

export interface NimiMemorySnippet {
  readonly id: string;
  readonly text: string;
  readonly importance?: number;
  readonly updatedAt?: string;
  readonly metadata?: NimiJsonObject;
}

export interface NimiMemorySummary {
  readonly id: string;
  readonly text: string;
  readonly snippetIds: readonly string[];
}

export interface NimiMemoryContextWindow {
  readonly snippets: readonly NimiMemorySnippet[];
  readonly summaries: readonly NimiMemorySummary[];
}

export interface NimiRuntimeMemoryContext {
  readonly appId: string;
  readonly subjectUserId?: string;
}

export interface NimiRuntimeMemoryRecallOptions {
  readonly query: string;
  readonly limit?: number;
  readonly minRelevance?: number;
  readonly includeInvalidated?: boolean;
}

export interface NimiRuntimeMemoryHistoryOptions {
  readonly pageSize?: number;
  readonly pageToken?: string;
  readonly includeInvalidated?: boolean;
}

export interface NimiRuntimeMemoryClient {
  recall(request: RecallRequest, options?: RuntimeTypedCallOptions): Promise<RecallResponse>;
  history(request: HistoryRequest, options?: RuntimeTypedCallOptions): Promise<HistoryResponse>;
  subscribeMemoryEvents?(
    request: SubscribeMemoryEventsRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<MemoryEvent>;
}

export interface NimiRuntimeMemoryContextClientOptions {
  readonly runtime: NimiRuntimeMemoryClient | { readonly memory: NimiRuntimeMemoryClient };
  readonly context: NimiRuntimeMemoryContext;
  readonly bank: MemoryBankLocator;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeMemoryContextClient {
  recall(options: NimiRuntimeMemoryRecallOptions): Promise<NimiMemoryContextWindow>;
  history(options?: NimiRuntimeMemoryHistoryOptions): Promise<NimiMemoryContextWindow & { readonly nextPageToken: string }>;
  subscribeEvents?(cursor?: string): AsyncIterable<MemoryEvent>;
}

export interface NimiRuntimeMemoryAiContextProviderOptions {
  readonly id?: string;
  readonly client: NimiRuntimeMemoryContextClient;
  readonly query?: NimiAiContextQuery;
  readonly recall?: Omit<NimiRuntimeMemoryRecallOptions, 'query'>;
}

export function buildNimiMemoryContextWindow(
  snippets: readonly NimiMemorySnippet[],
  options: { readonly limit?: number; readonly minImportance?: number } = {},
): NimiMemoryContextWindow {
  const limit = options.limit ?? snippets.length;
  const minImportance = options.minImportance ?? Number.NEGATIVE_INFINITY;
  const selected = [...snippets]
    .filter((snippet) => (snippet.importance ?? 0) >= minImportance)
    .sort((left, right) => (right.importance ?? 0) - (left.importance ?? 0))
    .slice(0, limit);

  return {
    snippets: selected,
    summaries: [],
  };
}

export function toNimiMemoryContextPart(window: NimiMemoryContextWindow): NimiDataPart {
  return dataPart({
    kind: 'memory-context',
    snippets: window.snippets.map((snippet): NimiJsonValue => ({
      id: snippet.id,
      text: snippet.text,
      importance: snippet.importance ?? null,
      updatedAt: snippet.updatedAt ?? null,
      metadata: snippet.metadata ?? {},
    })),
    summaries: window.summaries.map((summary): NimiJsonValue => ({
      id: summary.id,
      text: summary.text,
      snippetIds: [...summary.snippetIds],
    })),
  });
}

export function createNimiRuntimeMemoryContextClient(
  options: NimiRuntimeMemoryContextClientOptions,
): NimiRuntimeMemoryContextClient {
  const client = getRuntimeMemoryClient(options.runtime);
  const context = toRuntimeMemoryContext(options.context);
  const bank = requireMemoryBank(options.bank);
  return {
    async recall(input) {
      const query = normalizeText(input.query);
      if (!query) {
        throw memoryContextError('SDK_MEMORY_RECALL_QUERY_REQUIRED', 'Runtime memory recall requires a query', 'provide_memory_recall_query');
      }
      const response = await client.recall({
        context,
        bank,
        query: {
          query,
          kinds: [],
          limit: Number(input.limit ?? 8),
          canonicalClasses: [],
          includeInvalidated: input.includeInvalidated === true,
        },
      }, options.callOptions);
      const minRelevance = input.minRelevance ?? Number.NEGATIVE_INFINITY;
      return buildNimiMemoryContextWindow(
        response.hits
          .filter((hit) => hit.relevanceScore >= minRelevance)
          .map(memoryHitToSnippet)
          .filter((snippet): snippet is NimiMemorySnippet => Boolean(snippet)),
      );
    },
    async history(input = {}) {
      const response = await client.history({
        context,
        bank,
        query: {
          kinds: [],
          pageSize: Number(input.pageSize ?? 20),
          pageToken: normalizeText(input.pageToken),
          includeInvalidated: input.includeInvalidated === true,
        },
      }, options.callOptions);
      return {
        ...buildNimiMemoryContextWindow(response.records.map(memoryRecordToSnippet)),
        nextPageToken: response.nextPageToken,
      };
    },
    subscribeEvents: client.subscribeMemoryEvents
      ? (cursor = '') => client.subscribeMemoryEvents?.({
        context,
        scopeFilters: [],
        ownerFilters: [],
        cursor,
      }, options.callOptions) ?? emptyAsyncIterable()
      : undefined,
  };
}

export function createNimiRuntimeMemoryAiContextProvider(
  options: NimiRuntimeMemoryAiContextProviderOptions,
): NimiAiContextProvider {
  return {
    id: normalizeText(options.id) || 'runtime-memory-context',
    async load(input) {
      const query = await resolveNimiAiContextQuery(options.query, input);
      if (!query) {
        throw memoryContextError(
          'SDK_MEMORY_AI_CONTEXT_QUERY_REQUIRED',
          'Runtime memory AI context provider requires a query or a user message',
          'provide_memory_ai_context_query',
        );
      }
      return [
        toNimiMemoryContextPart(await options.client.recall({
          ...options.recall,
          query,
        })),
      ];
    },
  };
}

export function createNimiAppPrivateMemoryBankLocator(input: {
  readonly accountId: string;
  readonly appId: string;
}): MemoryBankLocator {
  return {
    scope: RuntimeMemoryBankScope.APP_PRIVATE,
    owner: {
      oneofKind: 'appPrivate',
      appPrivate: {
        accountId: requireText(input.accountId, 'memory app-private locator requires accountId', 'provide_memory_account_id'),
        appId: requireText(input.appId, 'memory app-private locator requires appId', 'provide_memory_app_id'),
      },
    },
  };
}

export function createNimiWorkspacePrivateMemoryBankLocator(input: {
  readonly accountId: string;
  readonly workspaceId: string;
}): MemoryBankLocator {
  return {
    scope: RuntimeMemoryBankScope.WORKSPACE_PRIVATE,
    owner: {
      oneofKind: 'workspacePrivate',
      workspacePrivate: {
        accountId: requireText(input.accountId, 'memory workspace locator requires accountId', 'provide_memory_account_id'),
        workspaceId: requireText(input.workspaceId, 'memory workspace locator requires workspaceId', 'provide_memory_workspace_id'),
      },
    },
  };
}

function getRuntimeMemoryClient(
  runtime: NimiRuntimeMemoryContextClientOptions['runtime'],
): NimiRuntimeMemoryClient {
  if ('memory' in runtime) {
    return runtime.memory;
  }
  return runtime;
}

function toRuntimeMemoryContext(context: NimiRuntimeMemoryContext): { readonly appId: string; readonly subjectUserId: string } {
  return {
    appId: requireText(context.appId, 'Runtime memory context requires appId', 'provide_memory_context_app_id'),
    subjectUserId: normalizeText(context.subjectUserId),
  };
}

function requireMemoryBank(bank: MemoryBankLocator): MemoryBankLocator {
  if (!bank || typeof bank !== 'object' || bank.scope === RuntimeMemoryBankScope.UNSPECIFIED) {
    throw memoryContextError(
      'SDK_MEMORY_BANK_REQUIRED',
      'Runtime memory context requires an explicit MemoryBankLocator',
      'provide_memory_bank_locator',
    );
  }
  return bank;
}

function memoryHitToSnippet(hit: MemoryRecallHit): NimiMemorySnippet | null {
  if (!hit.record) {
    return null;
  }
  return {
    ...memoryRecordToSnippet(hit.record),
    importance: hit.relevanceScore,
    metadata: {
      ...memoryRecordMetadata(hit.record),
      matchReason: hit.matchReason,
    },
  };
}

function memoryRecordToSnippet(record: MemoryRecord): NimiMemorySnippet {
  return {
    id: record.memoryId,
    text: memoryRecordText(record),
    updatedAt: timestampToIso(record.updatedAt),
    metadata: memoryRecordMetadata(record),
  };
}

function memoryRecordText(record: MemoryRecord): string {
  const payload = record.payload;
  if (payload.oneofKind === 'episodic') {
    return payload.episodic.summary;
  }
  if (payload.oneofKind === 'semantic') {
    return [payload.semantic.subject, payload.semantic.predicate, payload.semantic.object]
      .filter(Boolean)
      .join(' ');
  }
  if (payload.oneofKind === 'observational') {
    return payload.observational.observation;
  }
  return '';
}

function memoryRecordMetadata(record: MemoryRecord): NimiJsonObject {
  return {
    kind: record.kind,
    canonicalClass: record.canonicalClass,
    provenance: record.provenance ? {
      sourceSystem: record.provenance.sourceSystem,
      sourceEventId: record.provenance.sourceEventId,
      authorId: record.provenance.authorId,
      traceId: record.provenance.traceId,
      committedAt: timestampToIso(record.provenance.committedAt) ?? null,
    } : null,
    createdAt: timestampToIso(record.createdAt) ?? null,
    replicationOutcome: record.replication?.outcome ?? null,
  };
}

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  return;
}

function timestampToIso(timestamp: { readonly seconds: string; readonly nanos: number } | undefined): string | undefined {
  if (!timestamp) {
    return undefined;
  }
  const millis = Number(BigInt(timestamp.seconds) * 1000n + BigInt(Math.floor(timestamp.nanos / 1_000_000)));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw memoryContextError('SDK_MEMORY_FIELD_REQUIRED', message, actionHint);
  }
  return text;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function memoryContextError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
