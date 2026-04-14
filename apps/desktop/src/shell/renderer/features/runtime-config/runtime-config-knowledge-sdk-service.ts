import { getPlatformClient } from '@nimiplatform/sdk';
import {
  asNimiError,
  KnowledgeBankScope,
  KnowledgeIngestTaskStatus,
  RuntimeReasonCode,
  toProtoStruct,
  type KnowledgeKeywordHit,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type KnowledgeIngestTask,
  type KnowledgeLink,
  type KnowledgePage,
  type KnowledgeBank,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

const KNOWLEDGE_CALL_OPTIONS = {
  timeoutMs: 8000,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'runtime-config.knowledge',
    surfaceId: 'runtime.config',
  },
};

export const DEFAULT_RUNTIME_KNOWLEDGE_APP_ID = 'nimi.desktop';

export type RuntimeKnowledgeScope = 'app-private' | 'workspace-private';

export type RuntimeKnowledgeContextInput = {
  appId: string;
  subjectUserId?: string;
};

export type RuntimeKnowledgeBankItem = {
  bankId: string;
  displayName: string;
  scope: RuntimeKnowledgeScope;
  ownerId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeKnowledgePageItem = {
  pageId: string;
  bankId: string;
  slug: string;
  title: string;
  content: string;
  entityType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  preview: string;
};

export type RuntimeKnowledgeKeywordHitItem = {
  bankId: string;
  pageId: string;
  slug: string;
  title: string;
  snippet: string;
  score: number;
  metadata: Record<string, unknown>;
};

export type RuntimeKnowledgeLinkItem = {
  linkId: string;
  bankId: string;
  fromPageId: string;
  toPageId: string;
  linkType: string;
  fromSlug: string;
  fromTitle: string;
  fromEntityType: string;
  toSlug: string;
  toTitle: string;
  toEntityType: string;
  metadata: Record<string, unknown>;
};

export type RuntimeKnowledgeGraphNodeItem = {
  bankId: string;
  pageId: string;
  slug: string;
  title: string;
  entityType: string;
  metadata: Record<string, unknown>;
  depth: number;
};

export type RuntimeKnowledgeSearchMode = 'keyword' | 'hybrid';

export type RuntimeKnowledgeSearchResult = {
  hits: RuntimeKnowledgeKeywordHitItem[];
  nextPageToken: string;
  reasonCode: RuntimeReasonCode;
};

export type RuntimeKnowledgeGraphResult = {
  items: RuntimeKnowledgeGraphNodeItem[];
  nextPageToken: string;
};

export type RuntimeKnowledgeLinkListResult = {
  items: RuntimeKnowledgeLinkItem[];
  nextPageToken: string;
};

export type RuntimeKnowledgeIngestTaskItem = {
  taskId: string;
  bankId: string;
  pageId: string;
  slug: string;
  title: string;
  status: string;
  progressPercent: number;
  reasonCode: RuntimeReasonCode;
  actionHint: string;
  createdAt: string;
  updatedAt: string;
};

function runtimeKnowledge() {
  return getPlatformClient().runtime.knowledge;
}

function withKnowledgeError<T>(promise: Promise<T>, actionHint: string): Promise<T> {
  return promise.catch((error) => {
    throw asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint,
      source: 'runtime',
    });
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToIso(timestamp?: { seconds: string; nanos: number }): string {
  const seconds = Number(timestamp?.seconds || 0);
  const nanos = Number(timestamp?.nanos || 0);
  if (!Number.isFinite(seconds)) {
    return '';
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : '';
}

function protoStructToJson(value?: {
  fields?: Record<string, {
    kind?: {
      oneofKind?: string;
      nullValue?: number;
      numberValue?: number;
      stringValue?: string;
      boolValue?: boolean;
      structValue?: unknown;
      listValue?: { values?: Array<{ kind?: unknown }> };
    };
  }>;
}): Record<string, unknown> {
  const fields = value?.fields || {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, entry]) => [key, protoValueToJson(entry)]),
  );
}

function protoValueToJson(value?: {
  kind?: {
    oneofKind?: string;
    nullValue?: number;
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
    structValue?: unknown;
    listValue?: { values?: Array<{ kind?: unknown }> };
  };
}): unknown {
  switch (value?.kind?.oneofKind) {
    case 'numberValue':
      return value.kind.numberValue ?? 0;
    case 'stringValue':
      return value.kind.stringValue ?? '';
    case 'boolValue':
      return Boolean(value.kind.boolValue);
    case 'structValue':
      return protoStructToJson(value.kind.structValue as Parameters<typeof protoStructToJson>[0]);
    case 'listValue':
      return (value.kind.listValue?.values || []).map((item) => protoValueToJson(item as never));
    default:
      return null;
  }
}

function normalizeContext(input: RuntimeKnowledgeContextInput) {
  return {
    appId: normalizeText(input.appId) || DEFAULT_RUNTIME_KNOWLEDGE_APP_ID,
    subjectUserId: normalizeText(input.subjectUserId),
  };
}

function normalizeScope(scope: RuntimeKnowledgeScope): KnowledgeBankScope {
  return scope === 'workspace-private'
    ? KnowledgeBankScope.WORKSPACE_PRIVATE
    : KnowledgeBankScope.APP_PRIVATE;
}

function bankLocator(scope: RuntimeKnowledgeScope, input: RuntimeKnowledgeContextInput, workspaceId: string) {
  if (scope === 'workspace-private') {
    return {
      locator: {
        oneofKind: 'workspacePrivate' as const,
        workspacePrivate: {
          workspaceId: normalizeText(workspaceId),
        },
      },
    };
  }
  return {
    locator: {
      oneofKind: 'appPrivate' as const,
      appPrivate: {
        appId: normalizeContext(input).appId,
      },
    },
  };
}

function bankOwnerFilters(scope: RuntimeKnowledgeScope, input: RuntimeKnowledgeContextInput, workspaceId: string) {
  if (scope === 'workspace-private') {
    const normalizedWorkspaceId = normalizeText(workspaceId);
    return normalizedWorkspaceId
      ? [{
          owner: {
            oneofKind: 'workspacePrivate' as const,
            workspacePrivate: {
              workspaceId: normalizedWorkspaceId,
            },
          },
        }]
      : [];
  }
  return [{
    owner: {
      oneofKind: 'appPrivate' as const,
      appPrivate: {
        appId: normalizeContext(input).appId,
      },
    },
  }];
}

function bankOwnerId(bank?: KnowledgeBank): string {
  if (bank?.locator?.owner.oneofKind === 'workspacePrivate') {
    return normalizeText(bank.locator.owner.workspacePrivate.workspaceId);
  }
  if (bank?.locator?.owner.oneofKind === 'appPrivate') {
    return normalizeText(bank.locator.owner.appPrivate.appId);
  }
  return '';
}

function bankScope(bank?: KnowledgeBank): RuntimeKnowledgeScope {
  return bank?.locator?.scope === KnowledgeBankScope.WORKSPACE_PRIVATE
    ? 'workspace-private'
    : 'app-private';
}

export function summarizeKnowledgeContent(content: string): string {
  const normalized = normalizeText(content).replace(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

export function normalizeKnowledgeBank(bank?: KnowledgeBank): RuntimeKnowledgeBankItem {
  return {
    bankId: normalizeText(bank?.bankId),
    displayName: normalizeText(bank?.displayName),
    scope: bankScope(bank),
    ownerId: bankOwnerId(bank),
    metadata: protoStructToJson(bank?.metadata),
    createdAt: timestampToIso(bank?.createdAt),
    updatedAt: timestampToIso(bank?.updatedAt),
  };
}

export function normalizeKnowledgePage(page?: KnowledgePage): RuntimeKnowledgePageItem {
  const content = normalizeText(page?.content);
  return {
    pageId: normalizeText(page?.pageId),
    bankId: normalizeText(page?.bankId),
    slug: normalizeText(page?.slug),
    title: normalizeText(page?.title),
    content,
    entityType: normalizeText(page?.entityType),
    metadata: protoStructToJson(page?.metadata),
    createdAt: timestampToIso(page?.createdAt),
    updatedAt: timestampToIso(page?.updatedAt),
    preview: summarizeKnowledgeContent(content),
  };
}

export function normalizeKnowledgeKeywordHit(hit?: KnowledgeKeywordHit): RuntimeKnowledgeKeywordHitItem {
  return {
    bankId: normalizeText(hit?.bankId),
    pageId: normalizeText(hit?.pageId),
    slug: normalizeText(hit?.slug),
    title: normalizeText(hit?.title),
    snippet: normalizeText(hit?.snippet),
    score: Number(hit?.score || 0),
    metadata: protoStructToJson(hit?.metadata),
  };
}

function normalizeKnowledgeLink(link?: KnowledgeLink): RuntimeKnowledgeLinkItem {
  return {
    linkId: normalizeText(link?.linkId),
    bankId: normalizeText(link?.bankId),
    fromPageId: normalizeText(link?.fromPageId),
    toPageId: normalizeText(link?.toPageId),
    linkType: normalizeText(link?.linkType),
    fromSlug: '',
    fromTitle: '',
    fromEntityType: '',
    toSlug: '',
    toTitle: '',
    toEntityType: '',
    metadata: protoStructToJson(link?.metadata),
  };
}

export function normalizeKnowledgeGraphEdge(edge?: KnowledgeGraphEdge): RuntimeKnowledgeLinkItem {
  const base = normalizeKnowledgeLink(edge?.link);
  return {
    ...base,
    fromSlug: normalizeText(edge?.fromSlug),
    fromTitle: normalizeText(edge?.fromTitle),
    fromEntityType: normalizeText(edge?.fromEntityType),
    toSlug: normalizeText(edge?.toSlug),
    toTitle: normalizeText(edge?.toTitle),
    toEntityType: normalizeText(edge?.toEntityType),
  };
}

export function normalizeKnowledgeGraphNode(node?: KnowledgeGraphNode): RuntimeKnowledgeGraphNodeItem {
  return {
    bankId: normalizeText(node?.bankId),
    pageId: normalizeText(node?.pageId),
    slug: normalizeText(node?.slug),
    title: normalizeText(node?.title),
    entityType: normalizeText(node?.entityType),
    metadata: protoStructToJson(node?.metadata),
    depth: Number(node?.depth || 0),
  };
}

export function normalizeKnowledgeIngestTask(task?: KnowledgeIngestTask): RuntimeKnowledgeIngestTaskItem {
  const status = task?.status ?? KnowledgeIngestTaskStatus.UNSPECIFIED;
  return {
    taskId: normalizeText(task?.taskId),
    bankId: normalizeText(task?.bankId),
    pageId: normalizeText(task?.pageId),
    slug: normalizeText(task?.slug),
    title: normalizeText(task?.title),
    status: KnowledgeIngestTaskStatus[status] || 'UNSPECIFIED',
    progressPercent: Number(task?.progressPercent || 0),
    reasonCode: task?.reasonCode ?? RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    actionHint: normalizeText(task?.actionHint),
    createdAt: timestampToIso(task?.createdAt),
    updatedAt: timestampToIso(task?.updatedAt),
  };
}

export async function listRuntimeKnowledgeBanks(input: RuntimeKnowledgeContextInput & {
  scope: RuntimeKnowledgeScope;
  workspaceId?: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<{ banks: RuntimeKnowledgeBankItem[]; nextPageToken: string }> {
  const context = normalizeContext(input);
  const response = await withKnowledgeError(
    runtimeKnowledge().listKnowledgeBanks({
      context,
      scopeFilters: [normalizeScope(input.scope)],
      ownerFilters: bankOwnerFilters(input.scope, context, normalizeText(input.workspaceId)),
      pageSize: input.pageSize ?? 50,
      pageToken: normalizeText(input.pageToken),
    }, KNOWLEDGE_CALL_OPTIONS),
    'list_runtime_knowledge_banks',
  );
  return {
    banks: response.banks.map((item) => normalizeKnowledgeBank(item)),
    nextPageToken: normalizeText(response.nextPageToken),
  };
}

export async function createRuntimeKnowledgeBank(input: RuntimeKnowledgeContextInput & {
  scope: RuntimeKnowledgeScope;
  workspaceId?: string;
  displayName: string;
}): Promise<RuntimeKnowledgeBankItem> {
  const context = normalizeContext(input);
  const response = await withKnowledgeError(
    runtimeKnowledge().createKnowledgeBank({
      context,
      locator: bankLocator(input.scope, context, normalizeText(input.workspaceId)),
      displayName: normalizeText(input.displayName),
    }, KNOWLEDGE_CALL_OPTIONS),
    'create_runtime_knowledge_bank',
  );
  return normalizeKnowledgeBank(response.bank);
}

export async function deleteRuntimeKnowledgeBank(input: RuntimeKnowledgeContextInput & {
  bankId: string;
}): Promise<RuntimeReasonCode> {
  const response = await withKnowledgeError(
    runtimeKnowledge().deleteKnowledgeBank({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
    }, KNOWLEDGE_CALL_OPTIONS),
    'delete_runtime_knowledge_bank',
  );
  return response.ack?.reasonCode ?? RuntimeReasonCode.REASON_CODE_UNSPECIFIED;
}

export async function listRuntimeKnowledgePages(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  slugPrefix?: string;
  entityTypeFilters?: string[];
  pageSize?: number;
  pageToken?: string;
}): Promise<{ pages: RuntimeKnowledgePageItem[]; nextPageToken: string }> {
  const response = await withKnowledgeError(
    runtimeKnowledge().listPages({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      entityTypeFilters: (input.entityTypeFilters || []).map((item) => normalizeText(item)).filter(Boolean),
      slugPrefix: normalizeText(input.slugPrefix),
      pageSize: input.pageSize ?? 50,
      pageToken: normalizeText(input.pageToken),
    }, KNOWLEDGE_CALL_OPTIONS),
    'list_runtime_knowledge_pages',
  );
  return {
    pages: response.pages.map((item) => normalizeKnowledgePage(item)),
    nextPageToken: normalizeText(response.nextPageToken),
  };
}

export async function putRuntimeKnowledgePage(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  pageId?: string;
  slug: string;
  title: string;
  content: string;
  entityType?: string;
  metadata?: Record<string, unknown>;
}): Promise<RuntimeKnowledgePageItem> {
  const response = await withKnowledgeError(
    runtimeKnowledge().putPage({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      pageId: normalizeText(input.pageId),
      slug: normalizeText(input.slug),
      title: normalizeText(input.title),
      content: normalizeText(input.content),
      entityType: normalizeText(input.entityType),
      metadata: input.metadata ? toProtoStruct(input.metadata) : undefined,
    }, KNOWLEDGE_CALL_OPTIONS),
    'put_runtime_knowledge_page',
  );
  return normalizeKnowledgePage(response.page);
}

export async function ingestRuntimeKnowledgeDocument(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  pageId?: string;
  slug: string;
  title: string;
  content: string;
  entityType?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ taskId: string; accepted: boolean; reasonCode: RuntimeReasonCode }> {
  const response = await withKnowledgeError(
    runtimeKnowledge().ingestDocument({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      pageId: normalizeText(input.pageId),
      slug: normalizeText(input.slug),
      title: normalizeText(input.title),
      content: normalizeText(input.content),
      entityType: normalizeText(input.entityType),
      metadata: input.metadata ? toProtoStruct(input.metadata) : undefined,
    }, KNOWLEDGE_CALL_OPTIONS),
    'ingest_runtime_knowledge_document',
  );
  return {
    taskId: normalizeText(response.taskId),
    accepted: Boolean(response.accepted),
    reasonCode: response.reasonCode,
  };
}

export async function getRuntimeKnowledgeIngestTask(input: RuntimeKnowledgeContextInput & {
  taskId: string;
}): Promise<RuntimeKnowledgeIngestTaskItem> {
  const response = await withKnowledgeError(
    runtimeKnowledge().getIngestTask({
      context: normalizeContext(input),
      taskId: normalizeText(input.taskId),
    }, KNOWLEDGE_CALL_OPTIONS),
    'get_runtime_knowledge_ingest_task',
  );
  return normalizeKnowledgeIngestTask(response.task);
}

export async function deleteRuntimeKnowledgePage(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  pageId: string;
}): Promise<RuntimeReasonCode> {
  const response = await withKnowledgeError(
    runtimeKnowledge().deletePage({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      lookup: {
        oneofKind: 'pageId',
        pageId: normalizeText(input.pageId),
      },
    }, KNOWLEDGE_CALL_OPTIONS),
    'delete_runtime_knowledge_page',
  );
  return response.ack?.reasonCode ?? RuntimeReasonCode.REASON_CODE_UNSPECIFIED;
}

export async function searchRuntimeKnowledgeKeyword(input: RuntimeKnowledgeContextInput & {
  bankIds: string[];
  query: string;
  topK?: number;
}): Promise<RuntimeKnowledgeSearchResult> {
  const response = await withKnowledgeError(
    runtimeKnowledge().searchKeyword({
      context: normalizeContext(input),
      bankIds: input.bankIds.map((item) => normalizeText(item)).filter(Boolean),
      query: normalizeText(input.query),
      topK: input.topK ?? 10,
      entityTypeFilters: [],
      slugPrefix: '',
    }, KNOWLEDGE_CALL_OPTIONS),
    'search_runtime_knowledge_keyword',
  );
  return {
    hits: response.hits.map((item) => normalizeKnowledgeKeywordHit(item)),
    nextPageToken: '',
    reasonCode: response.reasonCode,
  };
}

export async function searchRuntimeKnowledgeHybrid(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  query: string;
  pageSize?: number;
  pageToken?: string;
  entityTypeFilters?: string[];
}): Promise<RuntimeKnowledgeSearchResult> {
  const response = await withKnowledgeError(
    runtimeKnowledge().searchHybrid({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      query: normalizeText(input.query),
      entityTypeFilters: (input.entityTypeFilters || []).map((item) => normalizeText(item)).filter(Boolean),
      pageSize: input.pageSize ?? 10,
      pageToken: normalizeText(input.pageToken),
    }, KNOWLEDGE_CALL_OPTIONS),
    'search_runtime_knowledge_hybrid',
  );
  return {
    hits: response.hits.map((item) => normalizeKnowledgeKeywordHit(item)),
    nextPageToken: normalizeText(response.nextPageToken),
    reasonCode: response.reasonCode,
  };
}

export async function addRuntimeKnowledgeLink(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  fromPageId: string;
  toPageId: string;
  linkType: string;
  metadata?: Record<string, unknown>;
}): Promise<RuntimeKnowledgeLinkItem> {
  const response = await withKnowledgeError(
    runtimeKnowledge().addLink({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      fromPageId: normalizeText(input.fromPageId),
      toPageId: normalizeText(input.toPageId),
      linkType: normalizeText(input.linkType),
      metadata: input.metadata ? toProtoStruct(input.metadata) : undefined,
    }, KNOWLEDGE_CALL_OPTIONS),
    'add_runtime_knowledge_link',
  );
  return normalizeKnowledgeLink(response.link);
}

export async function removeRuntimeKnowledgeLink(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  linkId: string;
}): Promise<RuntimeReasonCode> {
  const response = await withKnowledgeError(
    runtimeKnowledge().removeLink({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      linkId: normalizeText(input.linkId),
    }, KNOWLEDGE_CALL_OPTIONS),
    'remove_runtime_knowledge_link',
  );
  return response.ack?.reasonCode ?? RuntimeReasonCode.REASON_CODE_UNSPECIFIED;
}

export async function listRuntimeKnowledgeLinks(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  fromPageId: string;
  linkTypeFilters?: string[];
  pageSize?: number;
  pageToken?: string;
}): Promise<RuntimeKnowledgeLinkListResult> {
  const response = await withKnowledgeError(
    runtimeKnowledge().listLinks({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      fromPageId: normalizeText(input.fromPageId),
      linkTypeFilters: (input.linkTypeFilters || []).map((item) => normalizeText(item)).filter(Boolean),
      pageSize: input.pageSize ?? 25,
      pageToken: normalizeText(input.pageToken),
    }, KNOWLEDGE_CALL_OPTIONS),
    'list_runtime_knowledge_links',
  );
  return {
    items: response.links.map((item) => normalizeKnowledgeGraphEdge(item)),
    nextPageToken: normalizeText(response.nextPageToken),
  };
}

export async function listRuntimeKnowledgeBacklinks(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  toPageId: string;
  linkTypeFilters?: string[];
  pageSize?: number;
  pageToken?: string;
}): Promise<RuntimeKnowledgeLinkListResult> {
  const response = await withKnowledgeError(
    runtimeKnowledge().listBacklinks({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      toPageId: normalizeText(input.toPageId),
      linkTypeFilters: (input.linkTypeFilters || []).map((item) => normalizeText(item)).filter(Boolean),
      pageSize: input.pageSize ?? 25,
      pageToken: normalizeText(input.pageToken),
    }, KNOWLEDGE_CALL_OPTIONS),
    'list_runtime_knowledge_backlinks',
  );
  return {
    items: response.backlinks.map((item) => normalizeKnowledgeGraphEdge(item)),
    nextPageToken: normalizeText(response.nextPageToken),
  };
}

export async function traverseRuntimeKnowledgeGraph(input: RuntimeKnowledgeContextInput & {
  bankId: string;
  rootPageId: string;
  linkTypeFilters?: string[];
  maxDepth?: number;
  pageSize?: number;
  pageToken?: string;
}): Promise<RuntimeKnowledgeGraphResult> {
  const response = await withKnowledgeError(
    runtimeKnowledge().traverseGraph({
      context: normalizeContext(input),
      bankId: normalizeText(input.bankId),
      rootPageId: normalizeText(input.rootPageId),
      linkTypeFilters: (input.linkTypeFilters || []).map((item) => normalizeText(item)).filter(Boolean),
      maxDepth: input.maxDepth ?? 2,
      pageSize: input.pageSize ?? 25,
      pageToken: normalizeText(input.pageToken),
    }, KNOWLEDGE_CALL_OPTIONS),
    'traverse_runtime_knowledge_graph',
  );
  return {
    items: response.nodes.map((item) => normalizeKnowledgeGraphNode(item)),
    nextPageToken: normalizeText(response.nextPageToken),
  };
}
