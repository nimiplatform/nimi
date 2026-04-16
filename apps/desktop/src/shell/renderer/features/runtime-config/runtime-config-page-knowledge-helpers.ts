import type { TFunction } from 'i18next';
import type {
  RuntimeKnowledgeBankItem,
  RuntimeKnowledgePageItem,
} from './runtime-config-knowledge-sdk-service';

export type PageDraft = {
  pageId: string;
  slug: string;
  title: string;
  entityType: string;
  content: string;
};

export const DEFAULT_PAGE_DRAFT: PageDraft = {
  pageId: '',
  slug: '',
  title: '',
  entityType: '',
  content: '',
};

export function normalizeText(value: string): string {
  return value.trim();
}

export function formatTimestamp(value: string): string {
  if (!value) {
    return 'n/a';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function bankDescriptor(bank: RuntimeKnowledgeBankItem): string {
  return bank.scope === 'workspace-private'
    ? `workspace:${bank.ownerId || 'unknown'}`
    : `app:${bank.ownerId || 'unknown'}`;
}

export function pageDraftFromItem(page: RuntimeKnowledgePageItem): PageDraft {
  return {
    pageId: page.pageId,
    slug: page.slug,
    title: page.title,
    entityType: page.entityType,
    content: page.content,
  };
}

export function normalizeReasonCode(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hybridUnavailableMessage(reasonCode: string, t: TFunction): string {
  switch (reasonCode) {
    case 'KNOWLEDGE_HYBRID_SEARCH_UNAVAILABLE':
      return t('runtimeConfig.knowledge.hybridUnavailable', { defaultValue: 'Hybrid search is unavailable on the current runtime capability tier.' });
    case 'KNOWLEDGE_EMBEDDING_PROFILE_UNAVAILABLE':
      return t('runtimeConfig.knowledge.hybridEmbeddingUnavailable', { defaultValue: 'Hybrid search requires an embedding profile that is not currently available.' });
    case 'KNOWLEDGE_VECTOR_INDEX_NOT_READY':
      return t('runtimeConfig.knowledge.hybridIndexNotReady', { defaultValue: 'Hybrid search is enabled, but the vector index is not ready yet.' });
    case 'KNOWLEDGE_INDEX_REFRESH_IN_PROGRESS':
      return t('runtimeConfig.knowledge.hybridRefreshInProgress', { defaultValue: 'Hybrid search is temporarily unavailable while the knowledge index is refreshing.' });
    default:
      return '';
  }
}
