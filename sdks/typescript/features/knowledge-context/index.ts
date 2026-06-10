import type {
  KnowledgeBank,
  KnowledgeKeywordHit,
  KnowledgePage,
  KnowledgeRequestContext,
  ListKnowledgeBanksRequest,
  ListKnowledgeBanksResponse,
  SearchHybridRequest,
  SearchHybridResponse,
  SearchKeywordRequest,
  SearchKeywordResponse,
} from '../../core-generated/runtime-typed-client';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { dataPart, type NimiDataPart, type NimiJsonObject, type NimiJsonValue } from '../../core/contracts';
import type { NimiAgentContextProvider, NimiAgentContextQuery } from '../../core/agent';
import { resolveNimiAgentContextQuery } from '../../core/agent';
import { createNimiError } from '../../types';

export interface NimiKnowledgeReference {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly score?: number;
  readonly metadata?: NimiJsonObject;
}

export interface NimiKnowledgeCitation {
  readonly referenceId: string;
  readonly label: string;
  readonly url?: string;
}

export interface NimiKnowledgeContextBundle {
  readonly references: readonly NimiKnowledgeReference[];
  readonly citations: readonly NimiKnowledgeCitation[];
}

export interface NimiRuntimeKnowledgeContext {
  readonly appId: string;
  readonly subjectUserId?: string;
}

export interface NimiRuntimeKnowledgeSearchOptions {
  readonly query: string;
  readonly bankIds: readonly string[];
  readonly mode?: 'keyword' | 'hybrid';
  readonly limit?: number;
  readonly minScore?: number;
  readonly entityTypeFilters?: readonly string[];
  readonly slugPrefix?: string;
  readonly pageToken?: string;
}

export interface NimiRuntimeKnowledgeClient {
  listKnowledgeBanks(
    request: ListKnowledgeBanksRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ListKnowledgeBanksResponse>;
  searchKeyword(request: SearchKeywordRequest, options?: RuntimeTypedCallOptions): Promise<SearchKeywordResponse>;
  searchHybrid(request: SearchHybridRequest, options?: RuntimeTypedCallOptions): Promise<SearchHybridResponse>;
}

export interface NimiRuntimeKnowledgeContextClientOptions {
  readonly runtime: NimiRuntimeKnowledgeClient | { readonly knowledge: NimiRuntimeKnowledgeClient };
  readonly context: NimiRuntimeKnowledgeContext;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeKnowledgeContextClient {
  listBanks(options?: { readonly pageSize?: number; readonly pageToken?: string }): Promise<{
    readonly banks: readonly KnowledgeBank[];
    readonly nextPageToken: string;
  }>;
  search(options: NimiRuntimeKnowledgeSearchOptions): Promise<NimiKnowledgeContextBundle & {
    readonly nextPageToken: string;
    readonly rawHits: readonly KnowledgeKeywordHit[];
  }>;
}

export interface NimiRuntimeKnowledgeAgentContextProviderOptions {
  readonly id?: string;
  readonly client: NimiRuntimeKnowledgeContextClient;
  readonly query?: NimiAgentContextQuery;
  readonly search: Omit<NimiRuntimeKnowledgeSearchOptions, 'query'>;
}

export function selectNimiKnowledgeContext(
  references: readonly NimiKnowledgeReference[],
  options: { readonly limit?: number; readonly minScore?: number } = {},
): readonly NimiKnowledgeReference[] {
  const limit = options.limit ?? references.length;
  const minScore = options.minScore ?? Number.NEGATIVE_INFINITY;
  return [...references]
    .filter((reference) => (reference.score ?? 1) >= minScore)
    .sort((left, right) => (right.score ?? 1) - (left.score ?? 1))
    .slice(0, limit);
}

export function createNimiKnowledgeContextBundle(
  references: readonly NimiKnowledgeReference[],
  citations: readonly NimiKnowledgeCitation[] = [],
): NimiKnowledgeContextBundle {
  const knownReferenceIds = new Set(references.map((reference) => reference.id));
  const scopedCitations = citations.filter((citation) => knownReferenceIds.has(citation.referenceId));
  return { references, citations: scopedCitations };
}

export function toNimiKnowledgeContextPart(bundle: NimiKnowledgeContextBundle): NimiDataPart {
  return dataPart({
    kind: 'knowledge-context',
    references: bundle.references.map((reference): NimiJsonValue => ({
      id: reference.id,
      source: reference.source,
      text: reference.text,
      score: reference.score ?? null,
      metadata: reference.metadata ?? {},
    })),
    citations: bundle.citations.map((citation): NimiJsonValue => ({
      referenceId: citation.referenceId,
      label: citation.label,
      url: citation.url ?? null,
    })),
  });
}

export function createNimiRuntimeKnowledgeContextClient(
  options: NimiRuntimeKnowledgeContextClientOptions,
): NimiRuntimeKnowledgeContextClient {
  const client = getRuntimeKnowledgeClient(options.runtime);
  const context = toRuntimeKnowledgeContext(options.context);
  return {
    async listBanks(input = {}) {
      const response = await client.listKnowledgeBanks({
        context,
        scopeFilters: [],
        ownerFilters: [],
        pageSize: Number(input.pageSize ?? 50),
        pageToken: normalizeText(input.pageToken),
      }, options.callOptions);
      return {
        banks: [...response.banks],
        nextPageToken: response.nextPageToken,
      };
    },
    async search(input) {
      const query = normalizeText(input.query);
      if (!query) {
        throw knowledgeContextError(
          'SDK_KNOWLEDGE_QUERY_REQUIRED',
          'Runtime knowledge search requires a query',
          'provide_knowledge_query',
        );
      }
      const bankIds = input.bankIds.map(normalizeText).filter(Boolean);
      if (bankIds.length === 0) {
        throw knowledgeContextError(
          'SDK_KNOWLEDGE_BANK_REQUIRED',
          'Runtime knowledge search requires at least one bank id',
          'provide_knowledge_bank_ids',
        );
      }

      const mode = input.mode ?? 'hybrid';
      if (mode === 'hybrid' && bankIds.length !== 1) {
        throw knowledgeContextError(
          'SDK_KNOWLEDGE_HYBRID_BANK_SCOPE_UNSUPPORTED',
          'Runtime hybrid knowledge search accepts exactly one bank id',
          'use_keyword_search_or_scope_hybrid_to_one_bank',
        );
      }
      const raw = mode === 'keyword'
        ? await client.searchKeyword({
          context,
          bankIds,
          query,
          topK: Number(input.limit ?? 8),
          entityTypeFilters: [...(input.entityTypeFilters ?? [])],
          slugPrefix: normalizeText(input.slugPrefix),
        }, options.callOptions)
        : await client.searchHybrid({
          context,
          bankId: bankIds[0] ?? '',
          query,
          entityTypeFilters: [...(input.entityTypeFilters ?? [])],
          pageSize: Number(input.limit ?? 8),
          pageToken: normalizeText(input.pageToken),
        }, options.callOptions);
      const hits = raw.hits.filter((hit) => hit.score >= (input.minScore ?? Number.NEGATIVE_INFINITY));
      const nextPageToken = mode === 'hybrid'
        ? (raw as SearchHybridResponse).nextPageToken
        : '';
      return {
        ...createNimiKnowledgeContextBundle(hits.map(knowledgeHitToReference)),
        nextPageToken,
        rawHits: hits,
      };
    },
  };
}

export function createNimiRuntimeKnowledgeAgentContextProvider(
  options: NimiRuntimeKnowledgeAgentContextProviderOptions,
): NimiAgentContextProvider {
  return {
    id: normalizeText(options.id) || 'runtime-knowledge-context',
    async load(input) {
      const query = await resolveNimiAgentContextQuery(options.query, input);
      if (!query) {
        throw knowledgeContextError(
          'SDK_KNOWLEDGE_AGENT_CONTEXT_QUERY_REQUIRED',
          'Runtime knowledge agent context provider requires a query or a user message',
          'provide_knowledge_agent_context_query',
        );
      }
      return [
        toNimiKnowledgeContextPart(await options.client.search({
          ...options.search,
          query,
        })),
      ];
    },
  };
}

export function knowledgePageToReference(page: KnowledgePage): NimiKnowledgeReference {
  return {
    id: page.pageId,
    source: page.bankId,
    text: page.content,
    metadata: {
      slug: page.slug,
      title: page.title,
      entityType: page.entityType,
    },
  };
}

function knowledgeHitToReference(hit: KnowledgeKeywordHit): NimiKnowledgeReference {
  return {
    id: hit.pageId,
    source: hit.bankId,
    text: hit.snippet || hit.title,
    score: hit.score,
    metadata: {
      slug: hit.slug,
      title: hit.title,
    },
  };
}

function getRuntimeKnowledgeClient(
  runtime: NimiRuntimeKnowledgeContextClientOptions['runtime'],
): NimiRuntimeKnowledgeClient {
  if ('knowledge' in runtime) {
    return runtime.knowledge;
  }
  return runtime;
}

function toRuntimeKnowledgeContext(context: NimiRuntimeKnowledgeContext): KnowledgeRequestContext {
  return {
    appId: requireText(context.appId, 'Runtime knowledge context requires appId', 'provide_knowledge_context_app_id'),
    subjectUserId: normalizeText(context.subjectUserId),
  };
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw knowledgeContextError('SDK_KNOWLEDGE_FIELD_REQUIRED', message, actionHint);
  }
  return text;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function knowledgeContextError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
