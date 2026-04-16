import { startTransition, type Dispatch, type SetStateAction } from 'react';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import {
  addRuntimeKnowledgeLink,
  listRuntimeKnowledgeBacklinks,
  listRuntimeKnowledgeLinks,
  removeRuntimeKnowledgeLink,
  searchRuntimeKnowledgeHybrid,
  searchRuntimeKnowledgeKeyword,
  traverseRuntimeKnowledgeGraph,
  type RuntimeKnowledgeGraphNodeItem,
  type RuntimeKnowledgeKeywordHitItem,
  type RuntimeKnowledgeLinkItem,
  type RuntimeKnowledgeSearchMode,
} from './runtime-config-knowledge-sdk-service';
import {
  hybridUnavailableMessage,
  normalizeReasonCode,
  normalizeText,
  type PageDraft,
} from './runtime-config-page-knowledge-helpers';

type ContextInput = {
  appId: string;
  subjectUserId: string;
};

export function createKnowledgeDiscoveryActions(input: {
  contextInput: ContextInput;
  graphDepth: number;
  selectedBankId: string;
  pageDraft: PageDraft;
  linkTargetPageId: string;
  setLinkTargetPageId: (value: string) => void;
  linkTypeDraft: string;
  searchMode: RuntimeKnowledgeSearchMode;
  searchQuery: string;
  setErrorMessage: (value: string) => void;
  setStatusMessage: (value: string) => void;
  setGraphLoading: (value: boolean) => void;
  setLinkMutationLoading: (value: boolean) => void;
  setLinks: Dispatch<SetStateAction<RuntimeKnowledgeLinkItem[]>>;
  setBacklinks: Dispatch<SetStateAction<RuntimeKnowledgeLinkItem[]>>;
  setGraphNodes: Dispatch<SetStateAction<RuntimeKnowledgeGraphNodeItem[]>>;
  setLinksNextPageToken: (value: string) => void;
  setBacklinksNextPageToken: (value: string) => void;
  setGraphNextPageToken: (value: string) => void;
  setSearching: (value: boolean) => void;
  setSearchHits: Dispatch<SetStateAction<RuntimeKnowledgeKeywordHitItem[]>>;
  setSearchNextPageToken: (value: string) => void;
  setSearchUnavailableReason: (value: string) => void;
  t: TFunction;
}) {
  const loadMoreLinks = async (pageToken: string) => {
    if (!input.selectedBankId || !input.pageDraft.pageId || !pageToken) {
      return;
    }
    input.setGraphLoading(true);
    try {
      const response = await listRuntimeKnowledgeLinks({
        ...input.contextInput,
        bankId: input.selectedBankId,
        fromPageId: input.pageDraft.pageId,
        pageSize: 25,
        pageToken,
      });
      startTransition(() => {
        input.setLinks((current) => [...current, ...response.items]);
        input.setLinksNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to load more knowledge links.');
    } finally {
      input.setGraphLoading(false);
    }
  };

  const loadMoreBacklinks = async (pageToken: string) => {
    if (!input.selectedBankId || !input.pageDraft.pageId || !pageToken) {
      return;
    }
    input.setGraphLoading(true);
    try {
      const response = await listRuntimeKnowledgeBacklinks({
        ...input.contextInput,
        bankId: input.selectedBankId,
        toPageId: input.pageDraft.pageId,
        pageSize: 25,
        pageToken,
      });
      startTransition(() => {
        input.setBacklinks((current) => [...current, ...response.items]);
        input.setBacklinksNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to load more backlinks.');
    } finally {
      input.setGraphLoading(false);
    }
  };

  const loadMoreGraphNodes = async (pageToken: string) => {
    if (!input.selectedBankId || !input.pageDraft.pageId || !pageToken) {
      return;
    }
    input.setGraphLoading(true);
    try {
      const response = await traverseRuntimeKnowledgeGraph({
        ...input.contextInput,
        bankId: input.selectedBankId,
        rootPageId: input.pageDraft.pageId,
        maxDepth: input.graphDepth,
        pageSize: 25,
        pageToken,
      });
      startTransition(() => {
        input.setGraphNodes((current) => [...current, ...response.items]);
        input.setGraphNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to load more graph nodes.');
    } finally {
      input.setGraphLoading(false);
    }
  };

  const handleAddLink = async () => {
    if (!input.selectedBankId || !input.pageDraft.pageId || !normalizeText(input.linkTargetPageId) || !normalizeText(input.linkTypeDraft)) {
      return;
    }
    input.setLinkMutationLoading(true);
    input.setErrorMessage('');
    input.setStatusMessage('');
    try {
      await addRuntimeKnowledgeLink({
        ...input.contextInput,
        bankId: input.selectedBankId,
        fromPageId: input.pageDraft.pageId,
        toPageId: input.linkTargetPageId,
        linkType: input.linkTypeDraft,
      });
      const [nextLinks, nextBacklinks, nextGraph] = await Promise.all([
        listRuntimeKnowledgeLinks({
          ...input.contextInput,
          bankId: input.selectedBankId,
          fromPageId: input.pageDraft.pageId,
          pageSize: 25,
        }),
        listRuntimeKnowledgeBacklinks({
          ...input.contextInput,
          bankId: input.selectedBankId,
          toPageId: input.pageDraft.pageId,
          pageSize: 25,
        }),
        traverseRuntimeKnowledgeGraph({
          ...input.contextInput,
          bankId: input.selectedBankId,
          rootPageId: input.pageDraft.pageId,
          maxDepth: input.graphDepth,
          pageSize: 25,
        }),
      ]);
      startTransition(() => {
        input.setLinks(nextLinks.items);
        input.setBacklinks(nextBacklinks.items);
        input.setGraphNodes(nextGraph.items);
        input.setLinksNextPageToken(nextLinks.nextPageToken);
        input.setBacklinksNextPageToken(nextBacklinks.nextPageToken);
        input.setGraphNextPageToken(nextGraph.nextPageToken);
        input.setLinkTargetPageId('');
      });
      input.setStatusMessage(`Added link from ${input.pageDraft.slug || input.pageDraft.pageId}.`);
    } catch (error) {
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to add knowledge link.');
    } finally {
      input.setLinkMutationLoading(false);
    }
  };

  const handleRemoveLink = async (linkId: string) => {
    if (!input.selectedBankId || !input.pageDraft.pageId || !normalizeText(linkId)) {
      return;
    }
    input.setLinkMutationLoading(true);
    input.setErrorMessage('');
    input.setStatusMessage('');
    try {
      await removeRuntimeKnowledgeLink({
        ...input.contextInput,
        bankId: input.selectedBankId,
        linkId,
      });
      startTransition(() => {
        input.setLinks((current) => current.filter((item) => item.linkId !== linkId));
        input.setBacklinks((current) => current.filter((item) => item.linkId !== linkId));
        input.setGraphNodes((current) => current);
      });
      const nextGraph = await traverseRuntimeKnowledgeGraph({
        ...input.contextInput,
        bankId: input.selectedBankId,
        rootPageId: input.pageDraft.pageId,
        maxDepth: input.graphDepth,
        pageSize: 25,
      });
      startTransition(() => {
        input.setGraphNodes(nextGraph.items);
        input.setGraphNextPageToken(nextGraph.nextPageToken);
      });
      input.setStatusMessage(`Removed link ${linkId}.`);
    } catch (error) {
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to remove knowledge link.');
    } finally {
      input.setLinkMutationLoading(false);
    }
  };

  const handleRunSearch = async () => {
    if (!input.selectedBankId || !normalizeText(input.searchQuery)) {
      input.setSearchHits([]);
      input.setSearchNextPageToken('');
      input.setSearchUnavailableReason('');
      return;
    }
    input.setSearching(true);
    input.setErrorMessage('');
    input.setSearchUnavailableReason('');
    try {
      const response = input.searchMode === 'hybrid'
        ? await searchRuntimeKnowledgeHybrid({
            ...input.contextInput,
            bankId: input.selectedBankId,
            query: input.searchQuery,
            pageSize: 10,
          })
        : await searchRuntimeKnowledgeKeyword({
            ...input.contextInput,
            bankIds: [input.selectedBankId],
            query: input.searchQuery,
            topK: 10,
          });
      input.setSearchHits(response.hits);
      input.setSearchNextPageToken(response.nextPageToken);
      input.setStatusMessage(
        response.hits.length > 0
          ? (input.searchMode === 'hybrid'
            ? `Found ${response.hits.length} hybrid hits.`
            : `Found ${response.hits.length} keyword hits.`)
          : (input.searchMode === 'hybrid'
            ? 'No hybrid hits matched the current query.'
            : 'No keyword hits matched the current query.'),
      );
    } catch (error) {
      const normalized = asNimiError(error);
      const reasonCode = normalizeReasonCode(normalized.reasonCode);
      if (input.searchMode === 'hybrid') {
        const unavailable = hybridUnavailableMessage(reasonCode, input.t);
        if (unavailable) {
          input.setSearchHits([]);
          input.setSearchNextPageToken('');
          input.setSearchUnavailableReason(unavailable);
          input.setStatusMessage('');
          return;
        }
      }
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to search knowledge pages.');
    } finally {
      input.setSearching(false);
    }
  };

  const loadMoreSearchHits = async (pageToken: string) => {
    if (input.searchMode !== 'hybrid' || !input.selectedBankId || !pageToken || !normalizeText(input.searchQuery)) {
      return;
    }
    input.setSearching(true);
    input.setErrorMessage('');
    try {
      const response = await searchRuntimeKnowledgeHybrid({
        ...input.contextInput,
        bankId: input.selectedBankId,
        query: input.searchQuery,
        pageSize: 10,
        pageToken,
      });
      startTransition(() => {
        input.setSearchHits((current) => [...current, ...response.hits]);
        input.setSearchNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      const normalized = asNimiError(error);
      const unavailable = hybridUnavailableMessage(normalizeReasonCode(normalized.reasonCode), input.t);
      if (unavailable) {
        input.setSearchUnavailableReason(unavailable);
        input.setSearchNextPageToken('');
        return;
      }
      input.setErrorMessage(error instanceof Error ? error.message : 'Failed to load more search results.');
    } finally {
      input.setSearching(false);
    }
  };

  return {
    loadMoreLinks,
    loadMoreBacklinks,
    loadMoreGraphNodes,
    handleAddLink,
    handleRemoveLink,
    handleRunSearch,
    loadMoreSearchHits,
  };
}
