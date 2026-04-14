import { startTransition, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';
import {
  addRuntimeKnowledgeLink,
  DEFAULT_RUNTIME_KNOWLEDGE_APP_ID,
  createRuntimeKnowledgeBank,
  deleteRuntimeKnowledgeBank,
  deleteRuntimeKnowledgePage,
  getRuntimeKnowledgeIngestTask,
  ingestRuntimeKnowledgeDocument,
  listRuntimeKnowledgeBacklinks,
  listRuntimeKnowledgeBanks,
  listRuntimeKnowledgeLinks,
  listRuntimeKnowledgePages,
  putRuntimeKnowledgePage,
  removeRuntimeKnowledgeLink,
  searchRuntimeKnowledgeHybrid,
  searchRuntimeKnowledgeKeyword,
  traverseRuntimeKnowledgeGraph,
  type RuntimeKnowledgeBankItem,
  type RuntimeKnowledgeGraphNodeItem,
  type RuntimeKnowledgeIngestTaskItem,
  type RuntimeKnowledgeKeywordHitItem,
  type RuntimeKnowledgeLinkItem,
  type RuntimeKnowledgePageItem,
  type RuntimeKnowledgeSearchMode,
  type RuntimeKnowledgeScope,
} from './runtime-config-knowledge-sdk-service';

type KnowledgePageProps = {
  model: RuntimeConfigPanelControllerModel;
};

type PageDraft = {
  pageId: string;
  slug: string;
  title: string;
  entityType: string;
  content: string;
};

const DEFAULT_PAGE_DRAFT: PageDraft = {
  pageId: '',
  slug: '',
  title: '',
  entityType: '',
  content: '',
};

function normalizeText(value: string): string {
  return value.trim();
}

function formatTimestamp(value: string): string {
  if (!value) {
    return 'n/a';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function bankDescriptor(bank: RuntimeKnowledgeBankItem): string {
  return bank.scope === 'workspace-private'
    ? `workspace:${bank.ownerId || 'unknown'}`
    : `app:${bank.ownerId || 'unknown'}`;
}

function pageDraftFromItem(page: RuntimeKnowledgePageItem): PageDraft {
  return {
    pageId: page.pageId,
    slug: page.slug,
    title: page.title,
    entityType: page.entityType,
    content: page.content,
  };
}

function normalizeReasonCode(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hybridUnavailableMessage(reasonCode: string, t: ReturnType<typeof useTranslation>['t']): string {
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

function Banner(props: {
  tone: 'info' | 'warning' | 'error';
  title: string;
  body: string;
}) {
  const palette = props.tone === 'error'
    ? 'border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]'
    : props.tone === 'warning'
      ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]'
      : 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]';
  return (
    <div className={`rounded-2xl border px-4 py-3 ${palette}`}>
      <p className="text-sm font-semibold">{props.title}</p>
      <p className="mt-1 text-xs opacity-90">{props.body}</p>
    </div>
  );
}

function TextArea(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  monospace?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{props.label}</label>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        disabled={props.disabled}
        spellCheck={false}
        className={`w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 text-sm text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-60 ${props.monospace ? 'font-mono text-xs' : ''}`}
      />
    </div>
  );
}

export function KnowledgePage({ model }: KnowledgePageProps) {
  const { t } = useTranslation();
  const [appId, setAppId] = useState(DEFAULT_RUNTIME_KNOWLEDGE_APP_ID);
  const [subjectUserId, setSubjectUserId] = useState('');
  const [scope, setScope] = useState<RuntimeKnowledgeScope>('app-private');
  const [workspaceId, setWorkspaceId] = useState('');
  const [bankDisplayName, setBankDisplayName] = useState('');
  const [banks, setBanks] = useState<RuntimeKnowledgeBankItem[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [banksNextPageToken, setBanksNextPageToken] = useState('');
  const [banksLoading, setBanksLoading] = useState(false);
  const [pages, setPages] = useState<RuntimeKnowledgePageItem[]>([]);
  const [pagesNextPageToken, setPagesNextPageToken] = useState('');
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pageDraft, setPageDraft] = useState<PageDraft>(DEFAULT_PAGE_DRAFT);
  const [linkTypeDraft, setLinkTypeDraft] = useState('references');
  const [linkTargetPageId, setLinkTargetPageId] = useState('');
  const [links, setLinks] = useState<RuntimeKnowledgeLinkItem[]>([]);
  const [backlinks, setBacklinks] = useState<RuntimeKnowledgeLinkItem[]>([]);
  const [graphNodes, setGraphNodes] = useState<RuntimeKnowledgeGraphNodeItem[]>([]);
  const [linksNextPageToken, setLinksNextPageToken] = useState('');
  const [backlinksNextPageToken, setBacklinksNextPageToken] = useState('');
  const [graphNextPageToken, setGraphNextPageToken] = useState('');
  const [graphDepth, setGraphDepth] = useState(2);
  const [graphLoading, setGraphLoading] = useState(false);
  const [linkMutationLoading, setLinkMutationLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<RuntimeKnowledgeSearchMode>('keyword');
  const [searchHits, setSearchHits] = useState<RuntimeKnowledgeKeywordHitItem[]>([]);
  const [searchNextPageToken, setSearchNextPageToken] = useState('');
  const [searchUnavailableReason, setSearchUnavailableReason] = useState('');
  const [searching, setSearching] = useState(false);
  const [pageFilter, setPageFilter] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [creatingBank, setCreatingBank] = useState(false);
  const [deletingBank, setDeletingBank] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const [ingestingPage, setIngestingPage] = useState(false);
  const [ingestTask, setIngestTask] = useState<RuntimeKnowledgeIngestTaskItem | null>(null);
  const [deletingPage, setDeletingPage] = useState(false);

  const writesDisabled = model.runtimeWritesDisabled;
  const selectedBank = useMemo(
    () => banks.find((item) => item.bankId === selectedBankId) || null,
    [banks, selectedBankId],
  );
  const selectedPage = useMemo(
    () => pages.find((item) => item.pageId === pageDraft.pageId) || null,
    [pageDraft.pageId, pages],
  );
  const linkTargetOptions = useMemo(
    () => pages
      .filter((item) => item.pageId !== pageDraft.pageId)
      .map((item) => ({
        value: item.pageId,
        label: item.title ? `${item.title} (${item.slug})` : item.slug,
      })),
    [pageDraft.pageId, pages],
  );
  const filteredPages = useMemo(() => {
    const query = normalizeText(pageFilter).toLowerCase();
    if (!query) {
      return pages;
    }
    return pages.filter((page) =>
      page.slug.toLowerCase().includes(query)
      || page.title.toLowerCase().includes(query)
      || page.entityType.toLowerCase().includes(query),
    );
  }, [pageFilter, pages]);

  const contextInput = useMemo(() => ({
    appId: normalizeText(appId) || DEFAULT_RUNTIME_KNOWLEDGE_APP_ID,
    subjectUserId: normalizeText(subjectUserId),
  }), [appId, subjectUserId]);

  const canQueryCurrentScope = scope === 'app-private' || normalizeText(workspaceId) !== '';
  const ingestTaskActive = ingestTask != null && (ingestTask.status === 'QUEUED' || ingestTask.status === 'RUNNING');

  const clearGraphState = () => {
    setLinks([]);
    setBacklinks([]);
    setGraphNodes([]);
    setLinksNextPageToken('');
    setBacklinksNextPageToken('');
    setGraphNextPageToken('');
    setLinkTargetPageId('');
  };

  const refreshPagesForBank = async (bankId: string, preferredPageId?: string) => {
    const response = await listRuntimeKnowledgePages({
      ...contextInput,
      bankId,
      pageSize: 50,
    });
    startTransition(() => {
      setPages(response.pages);
      setPagesNextPageToken(response.nextPageToken);
      setPageDraft((current) => {
        const targetPageId = normalizeText(preferredPageId ?? '') || current.pageId || '';
        if (targetPageId) {
          const matched = response.pages.find((page) => page.pageId === targetPageId);
          if (matched) {
            return pageDraftFromItem(matched);
          }
        }
        return response.pages[0] ? pageDraftFromItem(response.pages[0]) : DEFAULT_PAGE_DRAFT;
      });
    });
  };

  const refreshIngestTask = async (taskId: string) => {
    const task = await getRuntimeKnowledgeIngestTask({
      ...contextInput,
      taskId,
    });
    startTransition(() => {
      setIngestTask(task);
    });
    if (task.status === 'COMPLETED' && task.bankId === selectedBankId) {
      await refreshPagesForBank(task.bankId, task.pageId);
      setStatusMessage(`Ingested ${task.slug || task.pageId}.`);
    } else if (task.status === 'FAILED') {
      setErrorMessage(task.actionHint || `Knowledge ingest failed (${task.reasonCode}).`);
    }
    return task;
  };

  useEffect(() => {
    if (!canQueryCurrentScope) {
      setBanks([]);
      setSelectedBankId('');
      setBanksNextPageToken('');
      setPages([]);
      setPagesNextPageToken('');
      setPageDraft(DEFAULT_PAGE_DRAFT);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setBanksLoading(true);
      setErrorMessage('');
      try {
        const response = await listRuntimeKnowledgeBanks({
          ...contextInput,
          scope,
          workspaceId,
          pageSize: 50,
        });
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setBanks(response.banks);
          setBanksNextPageToken(response.nextPageToken);
          setSelectedBankId((current) => {
            if (current && response.banks.some((bank) => bank.bankId === current)) {
              return current;
            }
            return response.banks[0]?.bankId || '';
          });
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load knowledge banks.');
        }
      } finally {
        if (!cancelled) {
          setBanksLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canQueryCurrentScope, contextInput, scope, workspaceId]);

  useEffect(() => {
    if (!selectedBankId) {
      setPages([]);
      setPagesNextPageToken('');
      setPageDraft(DEFAULT_PAGE_DRAFT);
      setIngestTask(null);
      clearGraphState();
      return;
    }
    let cancelled = false;
    const load = async () => {
      setPagesLoading(true);
      setErrorMessage('');
      try {
        const response = await listRuntimeKnowledgePages({
          ...contextInput,
          bankId: selectedBankId,
          pageSize: 50,
        });
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPages(response.pages);
          setPagesNextPageToken(response.nextPageToken);
          setPageDraft((current) => {
            if (current.pageId) {
              const matched = response.pages.find((page) => page.pageId === current.pageId);
              if (matched) {
                return pageDraftFromItem(matched);
              }
            }
            return response.pages[0] ? pageDraftFromItem(response.pages[0]) : DEFAULT_PAGE_DRAFT;
          });
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load knowledge pages.');
        }
      } finally {
        if (!cancelled) {
          setPagesLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [contextInput, selectedBankId]);

  useEffect(() => {
    if (!selectedBankId || !pageDraft.pageId) {
      clearGraphState();
      return;
    }
    let cancelled = false;
    const load = async () => {
      setGraphLoading(true);
      setErrorMessage('');
      try {
        const [nextLinks, nextBacklinks, nextGraph] = await Promise.all([
          listRuntimeKnowledgeLinks({
            ...contextInput,
            bankId: selectedBankId,
            fromPageId: pageDraft.pageId,
            pageSize: 25,
          }),
          listRuntimeKnowledgeBacklinks({
            ...contextInput,
            bankId: selectedBankId,
            toPageId: pageDraft.pageId,
            pageSize: 25,
          }),
          traverseRuntimeKnowledgeGraph({
            ...contextInput,
            bankId: selectedBankId,
            rootPageId: pageDraft.pageId,
            maxDepth: graphDepth,
            pageSize: 25,
          }),
        ]);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setLinks(nextLinks.items);
          setBacklinks(nextBacklinks.items);
          setGraphNodes(nextGraph.items);
          setLinksNextPageToken(nextLinks.nextPageToken);
          setBacklinksNextPageToken(nextBacklinks.nextPageToken);
          setGraphNextPageToken(nextGraph.nextPageToken);
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load knowledge graph data.');
        }
      } finally {
        if (!cancelled) {
          setGraphLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [contextInput, graphDepth, pageDraft.pageId, selectedBankId]);

  useEffect(() => {
    if (!ingestTaskActive || !ingestTask?.taskId) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void refreshIngestTask(ingestTask.taskId).catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh ingest task.');
        }
      });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [contextInput, ingestTask?.taskId, ingestTask?.status, ingestTaskActive, selectedBankId]);

  const loadMoreBanks = async () => {
    if (!banksNextPageToken) {
      return;
    }
    setBanksLoading(true);
    try {
      const response = await listRuntimeKnowledgeBanks({
        ...contextInput,
        scope,
        workspaceId,
        pageSize: 50,
        pageToken: banksNextPageToken,
      });
      startTransition(() => {
        setBanks((current) => [...current, ...response.banks]);
        setBanksNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load more knowledge banks.');
    } finally {
      setBanksLoading(false);
    }
  };

  const loadMorePages = async () => {
    if (!selectedBankId || !pagesNextPageToken) {
      return;
    }
    setPagesLoading(true);
    try {
      const response = await listRuntimeKnowledgePages({
        ...contextInput,
        bankId: selectedBankId,
        pageSize: 50,
        pageToken: pagesNextPageToken,
      });
      startTransition(() => {
        setPages((current) => [...current, ...response.pages]);
        setPagesNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load more knowledge pages.');
    } finally {
      setPagesLoading(false);
    }
  };

  const loadMoreLinks = async () => {
    if (!selectedBankId || !pageDraft.pageId || !linksNextPageToken) {
      return;
    }
    setGraphLoading(true);
    try {
      const response = await listRuntimeKnowledgeLinks({
        ...contextInput,
        bankId: selectedBankId,
        fromPageId: pageDraft.pageId,
        pageSize: 25,
        pageToken: linksNextPageToken,
      });
      startTransition(() => {
        setLinks((current) => [...current, ...response.items]);
        setLinksNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load more knowledge links.');
    } finally {
      setGraphLoading(false);
    }
  };

  const loadMoreBacklinks = async () => {
    if (!selectedBankId || !pageDraft.pageId || !backlinksNextPageToken) {
      return;
    }
    setGraphLoading(true);
    try {
      const response = await listRuntimeKnowledgeBacklinks({
        ...contextInput,
        bankId: selectedBankId,
        toPageId: pageDraft.pageId,
        pageSize: 25,
        pageToken: backlinksNextPageToken,
      });
      startTransition(() => {
        setBacklinks((current) => [...current, ...response.items]);
        setBacklinksNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load more backlinks.');
    } finally {
      setGraphLoading(false);
    }
  };

  const loadMoreGraphNodes = async () => {
    if (!selectedBankId || !pageDraft.pageId || !graphNextPageToken) {
      return;
    }
    setGraphLoading(true);
    try {
      const response = await traverseRuntimeKnowledgeGraph({
        ...contextInput,
        bankId: selectedBankId,
        rootPageId: pageDraft.pageId,
        maxDepth: graphDepth,
        pageSize: 25,
        pageToken: graphNextPageToken,
      });
      startTransition(() => {
        setGraphNodes((current) => [...current, ...response.items]);
        setGraphNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load more graph nodes.');
    } finally {
      setGraphLoading(false);
    }
  };

  const handleAddLink = async () => {
    if (!selectedBankId || !pageDraft.pageId || !normalizeText(linkTargetPageId) || !normalizeText(linkTypeDraft)) {
      return;
    }
    setLinkMutationLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      await addRuntimeKnowledgeLink({
        ...contextInput,
        bankId: selectedBankId,
        fromPageId: pageDraft.pageId,
        toPageId: linkTargetPageId,
        linkType: linkTypeDraft,
      });
      const [nextLinks, nextBacklinks, nextGraph] = await Promise.all([
        listRuntimeKnowledgeLinks({
          ...contextInput,
          bankId: selectedBankId,
          fromPageId: pageDraft.pageId,
          pageSize: 25,
        }),
        listRuntimeKnowledgeBacklinks({
          ...contextInput,
          bankId: selectedBankId,
          toPageId: pageDraft.pageId,
          pageSize: 25,
        }),
        traverseRuntimeKnowledgeGraph({
          ...contextInput,
          bankId: selectedBankId,
          rootPageId: pageDraft.pageId,
          maxDepth: graphDepth,
          pageSize: 25,
        }),
      ]);
      startTransition(() => {
        setLinks(nextLinks.items);
        setBacklinks(nextBacklinks.items);
        setGraphNodes(nextGraph.items);
        setLinksNextPageToken(nextLinks.nextPageToken);
        setBacklinksNextPageToken(nextBacklinks.nextPageToken);
        setGraphNextPageToken(nextGraph.nextPageToken);
        setLinkTargetPageId('');
      });
      setStatusMessage(`Added link from ${pageDraft.slug || pageDraft.pageId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add knowledge link.');
    } finally {
      setLinkMutationLoading(false);
    }
  };

  const handleRemoveLink = async (linkId: string) => {
    if (!selectedBankId || !pageDraft.pageId || !normalizeText(linkId)) {
      return;
    }
    setLinkMutationLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      await removeRuntimeKnowledgeLink({
        ...contextInput,
        bankId: selectedBankId,
        linkId,
      });
      startTransition(() => {
        setLinks((current) => current.filter((item) => item.linkId !== linkId));
        setBacklinks((current) => current.filter((item) => item.linkId !== linkId));
        setGraphNodes((current) => current);
      });
      const nextGraph = await traverseRuntimeKnowledgeGraph({
        ...contextInput,
        bankId: selectedBankId,
        rootPageId: pageDraft.pageId,
        maxDepth: graphDepth,
        pageSize: 25,
      });
      startTransition(() => {
        setGraphNodes(nextGraph.items);
        setGraphNextPageToken(nextGraph.nextPageToken);
      });
      setStatusMessage(`Removed link ${linkId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove knowledge link.');
    } finally {
      setLinkMutationLoading(false);
    }
  };

  const handleCreateBank = async () => {
    setCreatingBank(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const bank = await createRuntimeKnowledgeBank({
        ...contextInput,
        scope,
        workspaceId,
        displayName: normalizeText(bankDisplayName),
      });
      startTransition(() => {
        setBanks((current) => [bank, ...current.filter((item) => item.bankId !== bank.bankId)]);
        setSelectedBankId(bank.bankId);
        setBankDisplayName('');
      });
      setStatusMessage(`Created knowledge bank ${bank.displayName || bank.bankId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create knowledge bank.');
    } finally {
      setCreatingBank(false);
    }
  };

  const handleDeleteBank = async () => {
    if (!selectedBankId) {
      return;
    }
    setDeletingBank(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      await deleteRuntimeKnowledgeBank({
        ...contextInput,
        bankId: selectedBankId,
      });
      const removedBankId = selectedBankId;
      startTransition(() => {
        setBanks((current) => {
          const next = current.filter((item) => item.bankId !== removedBankId);
          setSelectedBankId(next[0]?.bankId || '');
          return next;
        });
        setPages([]);
        setSearchHits([]);
        setSearchNextPageToken('');
        setSearchUnavailableReason('');
        setIngestTask(null);
        setPageDraft(DEFAULT_PAGE_DRAFT);
      });
      setStatusMessage(`Deleted knowledge bank ${removedBankId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete knowledge bank.');
    } finally {
      setDeletingBank(false);
    }
  };

  const handleSavePage = async () => {
    if (!selectedBankId) {
      setErrorMessage('Select a knowledge bank before saving a page.');
      return;
    }
    setSavingPage(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const savedPage = await putRuntimeKnowledgePage({
        ...contextInput,
        bankId: selectedBankId,
        pageId: normalizeText(pageDraft.pageId),
        slug: pageDraft.slug,
        title: pageDraft.title,
        entityType: pageDraft.entityType,
        content: pageDraft.content,
      });
      startTransition(() => {
        setPages((current) => {
          const next = current.filter((item) => item.pageId !== savedPage.pageId);
          return [savedPage, ...next];
        });
        setPageDraft(pageDraftFromItem(savedPage));
      });
      setStatusMessage(`Saved page ${savedPage.slug || savedPage.pageId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save knowledge page.');
    } finally {
      setSavingPage(false);
    }
  };

  const handleIngestDocument = async () => {
    if (!selectedBankId) {
      setErrorMessage('Select a knowledge bank before ingesting a document.');
      return;
    }
    if (!normalizeText(pageDraft.slug) || !normalizeText(pageDraft.content)) {
      setErrorMessage('Slug and content are required before ingesting a document.');
      return;
    }
    setIngestingPage(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const response = await ingestRuntimeKnowledgeDocument({
        ...contextInput,
        bankId: selectedBankId,
        pageId: normalizeText(pageDraft.pageId),
        slug: pageDraft.slug,
        title: pageDraft.title,
        content: pageDraft.content,
        entityType: pageDraft.entityType,
      });
      const task = await refreshIngestTask(response.taskId);
      setStatusMessage(
        task.status === 'COMPLETED'
          ? `Ingested ${task.slug || task.pageId}.`
          : `Accepted ingest task ${task.taskId}.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to ingest knowledge document.');
    } finally {
      setIngestingPage(false);
    }
  };

  const handleDeletePage = async () => {
    if (!selectedBankId || !pageDraft.pageId) {
      return;
    }
    setDeletingPage(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      await deleteRuntimeKnowledgePage({
        ...contextInput,
        bankId: selectedBankId,
        pageId: pageDraft.pageId,
      });
      const deletedPageId = pageDraft.pageId;
      startTransition(() => {
        const nextPages = pages.filter((page) => page.pageId !== deletedPageId);
        setPages(nextPages);
        setPageDraft(nextPages[0] ? pageDraftFromItem(nextPages[0]) : DEFAULT_PAGE_DRAFT);
      });
      setStatusMessage(`Deleted page ${deletedPageId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete knowledge page.');
    } finally {
      setDeletingPage(false);
    }
  };

  const handleRunSearch = async () => {
    if (!selectedBankId || !normalizeText(searchQuery)) {
      setSearchHits([]);
      setSearchNextPageToken('');
      setSearchUnavailableReason('');
      return;
    }
    setSearching(true);
    setErrorMessage('');
    setSearchUnavailableReason('');
    try {
      const response = searchMode === 'hybrid'
        ? await searchRuntimeKnowledgeHybrid({
            ...contextInput,
            bankId: selectedBankId,
            query: searchQuery,
            pageSize: 10,
          })
        : await searchRuntimeKnowledgeKeyword({
            ...contextInput,
            bankIds: [selectedBankId],
            query: searchQuery,
            topK: 10,
          });
      setSearchHits(response.hits);
      setSearchNextPageToken(response.nextPageToken);
      setStatusMessage(
        response.hits.length > 0
          ? (searchMode === 'hybrid'
            ? `Found ${response.hits.length} hybrid hits.`
            : `Found ${response.hits.length} keyword hits.`)
          : (searchMode === 'hybrid'
            ? 'No hybrid hits matched the current query.'
            : 'No keyword hits matched the current query.'),
      );
    } catch (error) {
      const normalized = asNimiError(error);
      const reasonCode = normalizeReasonCode(normalized.reasonCode);
      if (searchMode === 'hybrid') {
        const unavailable = hybridUnavailableMessage(reasonCode, t);
        if (unavailable) {
          setSearchHits([]);
          setSearchNextPageToken('');
          setSearchUnavailableReason(unavailable);
          setStatusMessage('');
          return;
        }
      }
      setErrorMessage(error instanceof Error ? error.message : 'Failed to search knowledge pages.');
    } finally {
      setSearching(false);
    }
  };

  const loadMoreSearchHits = async () => {
    if (searchMode !== 'hybrid' || !selectedBankId || !searchNextPageToken || !normalizeText(searchQuery)) {
      return;
    }
    setSearching(true);
    setErrorMessage('');
    try {
      const response = await searchRuntimeKnowledgeHybrid({
        ...contextInput,
        bankId: selectedBankId,
        query: searchQuery,
        pageSize: 10,
        pageToken: searchNextPageToken,
      });
      startTransition(() => {
        setSearchHits((current) => [...current, ...response.hits]);
        setSearchNextPageToken(response.nextPageToken);
      });
    } catch (error) {
      const normalized = asNimiError(error);
      const unavailable = hybridUnavailableMessage(normalizeReasonCode(normalized.reasonCode), t);
      if (unavailable) {
        setSearchUnavailableReason(unavailable);
        setSearchNextPageToken('');
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load more search results.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <RuntimePageShell maxWidth="6xl">
      <section>
        <SectionTitle description={t('runtimeConfig.knowledge.contextDescription', { defaultValue: 'Wave 1 runtime-local knowledge is scoped by request context plus app-private or workspace-private bank ownership.' })}>
          {t('runtimeConfig.knowledge.contextTitle', { defaultValue: 'Knowledge Context' })}
        </SectionTitle>
        <Card className="mt-3 p-5">
          <div className="grid gap-4 lg:grid-cols-4">
            <Input
              label={t('runtimeConfig.knowledge.appId', { defaultValue: 'App ID' })}
              value={appId}
              onChange={setAppId}
              placeholder={DEFAULT_RUNTIME_KNOWLEDGE_APP_ID}
              disabled={banksLoading || pagesLoading}
            />
            <Input
              label={t('runtimeConfig.knowledge.subjectUserId', { defaultValue: 'Subject User ID (optional)' })}
              value={subjectUserId}
              onChange={setSubjectUserId}
              placeholder={t('runtimeConfig.knowledge.subjectUserIdPlaceholder', { defaultValue: 'user-123' })}
              disabled={banksLoading || pagesLoading}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.knowledge.scope', { defaultValue: 'Bank Scope' })}
              </label>
              <RuntimeSelect
                value={scope}
                onChange={(value) => setScope(value === 'workspace-private' ? 'workspace-private' : 'app-private')}
                options={[
                  { value: 'app-private', label: t('runtimeConfig.knowledge.scopeAppPrivate', { defaultValue: 'App Private' }) },
                  { value: 'workspace-private', label: t('runtimeConfig.knowledge.scopeWorkspacePrivate', { defaultValue: 'Workspace Private' }) },
                ]}
              />
            </div>
            <Input
              label={t('runtimeConfig.knowledge.workspaceId', { defaultValue: 'Workspace ID' })}
              value={workspaceId}
              onChange={setWorkspaceId}
              placeholder={t('runtimeConfig.knowledge.workspaceIdPlaceholder', { defaultValue: 'workspace-alpha' })}
              disabled={scope !== 'workspace-private' || banksLoading || pagesLoading}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1 text-xs text-[var(--nimi-text-muted)]">
              {t('runtimeConfig.knowledge.contextHint', { defaultValue: 'Desktop runtime client defaults to app_id=nimi.desktop unless you override it here.' })}
            </span>
            {!canQueryCurrentScope ? (
              <span className="rounded-full border border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-1 text-xs text-[var(--nimi-status-warning)]">
                {t('runtimeConfig.knowledge.workspaceRequired', { defaultValue: 'Workspace-private listing requires a workspace ID.' })}
              </span>
            ) : null}
            {writesDisabled ? (
              <span className="rounded-full border border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-1 text-xs text-[var(--nimi-status-warning)]">
                {t('runtimeConfig.knowledge.readOnlyMode', { defaultValue: 'Runtime writes are disabled in the current offline tier.' })}
              </span>
            ) : null}
          </div>
        </Card>
      </section>

      {errorMessage ? (
        <Banner
          tone="error"
          title={t('runtimeConfig.knowledge.errorTitle', { defaultValue: 'Knowledge request failed' })}
          body={errorMessage}
        />
      ) : null}
      {statusMessage ? (
        <Banner
          tone="info"
          title={t('runtimeConfig.knowledge.statusTitle', { defaultValue: 'Knowledge status' })}
          body={statusMessage}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section>
          <SectionTitle description={t('runtimeConfig.knowledge.bankDescription', { defaultValue: 'Create, select, and delete Wave 1 knowledge banks for the current scope.' })}>
            {t('runtimeConfig.knowledge.bankTitle', { defaultValue: 'Knowledge Banks' })}
          </SectionTitle>
          <Card className="mt-3 p-5">
            <div className="space-y-3">
              <Input
                label={t('runtimeConfig.knowledge.bankDisplayName', { defaultValue: 'Display Name' })}
                value={bankDisplayName}
                onChange={setBankDisplayName}
                placeholder={t('runtimeConfig.knowledge.bankDisplayNamePlaceholder', { defaultValue: 'Product Notes' })}
                disabled={writesDisabled || creatingBank}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={writesDisabled || creatingBank || !canQueryCurrentScope} onClick={() => void handleCreateBank()}>
                  {creatingBank
                    ? t('runtimeConfig.knowledge.creatingBank', { defaultValue: 'Creating...' })
                    : t('runtimeConfig.knowledge.createBank', { defaultValue: 'Create Bank' })}
                </Button>
                <Button variant="ghost" size="sm" disabled={writesDisabled || deletingBank || !selectedBankId} onClick={() => void handleDeleteBank()}>
                  {deletingBank
                    ? t('runtimeConfig.knowledge.deletingBank', { defaultValue: 'Deleting...' })
                    : t('runtimeConfig.knowledge.deleteBank', { defaultValue: 'Delete Selected' })}
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {banksLoading && banks.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.knowledge.loadingBanks', { defaultValue: 'Loading banks...' })}
                </p>
              ) : banks.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.knowledge.noBanks', { defaultValue: 'No knowledge banks exist for the current scope yet.' })}
                </p>
              ) : banks.map((bank) => (
                <button
                  key={bank.bankId}
                  type="button"
                  onClick={() => setSelectedBankId(bank.bankId)}
                  className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                    bank.bankId === selectedBankId
                      ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_36%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]'
                  }`}
                >
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{bank.displayName || bank.bankId}</p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{bankDescriptor(bank)}</p>
                  <p className="mt-1 text-[11px] text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.knowledge.updatedAt', { defaultValue: 'Updated {{value}}', value: formatTimestamp(bank.updatedAt) })}
                  </p>
                </button>
              ))}
            </div>

            {banksNextPageToken ? (
              <div className="mt-4">
                <Button variant="ghost" size="sm" disabled={banksLoading} onClick={() => void loadMoreBanks()}>
                  {t('runtimeConfig.knowledge.loadMoreBanks', { defaultValue: 'Load More Banks' })}
                </Button>
              </div>
            ) : null}
          </Card>
        </section>

        <div className="space-y-6">
          <section>
            <SectionTitle description={t('runtimeConfig.knowledge.pageDescription', { defaultValue: 'List and edit pages in the selected bank. ListPages is paginated and sorted by most recently updated pages first.' })}>
              {t('runtimeConfig.knowledge.pageTitle', { defaultValue: 'Knowledge Pages' })}
            </SectionTitle>
            <div className="mt-3 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
              <Card className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {selectedBank?.displayName || t('runtimeConfig.knowledge.selectBankPrompt', { defaultValue: 'Select a bank first' })}
                  </p>
                  <Button variant="ghost" size="sm" disabled={!selectedBankId} onClick={() => setPageDraft(DEFAULT_PAGE_DRAFT)}>
                    {t('runtimeConfig.knowledge.newPage', { defaultValue: 'New Page' })}
                  </Button>
                </div>
                <div className="mt-3">
                  <Input
                    label={t('runtimeConfig.knowledge.pageFilter', { defaultValue: 'Filter Pages' })}
                    value={pageFilter}
                    onChange={setPageFilter}
                    placeholder={t('runtimeConfig.knowledge.pageFilterPlaceholder', { defaultValue: 'slug, title, entity type' })}
                    disabled={!selectedBankId}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {pagesLoading && pages.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.loadingPages', { defaultValue: 'Loading pages...' })}
                    </p>
                  ) : filteredPages.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {selectedBankId
                        ? t('runtimeConfig.knowledge.noPages', { defaultValue: 'No pages found for this bank.' })
                        : t('runtimeConfig.knowledge.noBankSelected', { defaultValue: 'Select a bank to inspect its pages.' })}
                    </p>
                  ) : filteredPages.map((page) => (
                    <button
                      key={page.pageId}
                      type="button"
                      onClick={() => setPageDraft(pageDraftFromItem(page))}
                      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                        page.pageId === pageDraft.pageId
                          ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_36%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]'
                          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]'
                      }`}
                    >
                      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{page.title || page.slug}</p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{page.slug}</p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{page.preview || t('runtimeConfig.knowledge.emptyPreview', { defaultValue: 'No content yet.' })}</p>
                    </button>
                  ))}
                </div>
                {pagesNextPageToken ? (
                  <div className="mt-4">
                    <Button variant="ghost" size="sm" disabled={pagesLoading} onClick={() => void loadMorePages()}>
                      {t('runtimeConfig.knowledge.loadMorePages', { defaultValue: 'Load More Pages' })}
                    </Button>
                  </div>
                ) : null}
              </Card>

              <Card className="p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label={t('runtimeConfig.knowledge.pageSlug', { defaultValue: 'Slug' })}
                    value={pageDraft.slug}
                    onChange={(value) => setPageDraft((current) => ({ ...current, slug: value }))}
                    placeholder={t('runtimeConfig.knowledge.pageSlugPlaceholder', { defaultValue: 'product-brief' })}
                    disabled={!selectedBankId || savingPage}
                  />
                  <Input
                    label={t('runtimeConfig.knowledge.pageEntityType', { defaultValue: 'Entity Type' })}
                    value={pageDraft.entityType}
                    onChange={(value) => setPageDraft((current) => ({ ...current, entityType: value }))}
                    placeholder={t('runtimeConfig.knowledge.pageEntityTypePlaceholder', { defaultValue: 'document' })}
                    disabled={!selectedBankId || savingPage}
                  />
                </div>
                <div className="mt-4">
                  <Input
                    label={t('runtimeConfig.knowledge.pageTitleLabel', { defaultValue: 'Title' })}
                    value={pageDraft.title}
                    onChange={(value) => setPageDraft((current) => ({ ...current, title: value }))}
                    placeholder={t('runtimeConfig.knowledge.pageTitlePlaceholder', { defaultValue: 'Product Brief' })}
                    disabled={!selectedBankId || savingPage}
                  />
                </div>
                <div className="mt-4">
                  <TextArea
                    label={t('runtimeConfig.knowledge.pageContent', { defaultValue: 'Content' })}
                    value={pageDraft.content}
                    onChange={(value) => setPageDraft((current) => ({ ...current, content: value }))}
                    placeholder={t('runtimeConfig.knowledge.pageContentPlaceholder', { defaultValue: 'Write the knowledge page content here...' })}
                    rows={14}
                    disabled={!selectedBankId || savingPage}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={writesDisabled || savingPage || !selectedBankId || !normalizeText(pageDraft.slug)} onClick={() => void handleSavePage()}>
                    {savingPage
                      ? t('runtimeConfig.knowledge.savingPage', { defaultValue: 'Saving...' })
                      : t('runtimeConfig.knowledge.savePage', { defaultValue: 'Save Page' })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={writesDisabled || ingestingPage || !selectedBankId || !normalizeText(pageDraft.slug) || !normalizeText(pageDraft.content)}
                    onClick={() => void handleIngestDocument()}
                  >
                    {ingestingPage
                      ? t('runtimeConfig.knowledge.ingestingPage', { defaultValue: 'Ingesting...' })
                      : t('runtimeConfig.knowledge.ingestPage', { defaultValue: 'Ingest Async' })}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={writesDisabled || deletingPage || !pageDraft.pageId} onClick={() => void handleDeletePage()}>
                    {deletingPage
                      ? t('runtimeConfig.knowledge.deletingPage', { defaultValue: 'Deleting...' })
                      : t('runtimeConfig.knowledge.deletePage', { defaultValue: 'Delete Page' })}
                  </Button>
                  {pageDraft.pageId ? (
                    <span className="text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.pageIdentity', { defaultValue: 'Page ID: {{value}}', value: pageDraft.pageId })}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.pageCreateHint', { defaultValue: 'New pages are created on first save.' })}
                    </span>
                  )}
                </div>
                {ingestTask ? (
                  <div className="mt-4 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                          {t('runtimeConfig.knowledge.ingestTaskTitle', { defaultValue: 'Latest Ingest Task' })}
                        </p>
                        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                          {t('runtimeConfig.knowledge.ingestTaskSummary', {
                            defaultValue: '{{status}} · {{progress}}%',
                            status: ingestTask.status,
                            progress: ingestTask.progressPercent,
                          })}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" disabled={!ingestTask.taskId} onClick={() => void refreshIngestTask(ingestTask.taskId)}>
                        {t('runtimeConfig.knowledge.refreshIngestTask', { defaultValue: 'Refresh Task' })}
                      </Button>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--nimi-border-subtle)]">
                      <div
                        className="h-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-[width] duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, ingestTask.progressPercent))}%` }}
                      />
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-[var(--nimi-text-muted)] md:grid-cols-2">
                      <span>{t('runtimeConfig.knowledge.ingestTaskId', { defaultValue: 'Task ID: {{value}}', value: ingestTask.taskId })}</span>
                      <span>{t('runtimeConfig.knowledge.ingestTaskReason', { defaultValue: 'Reason: {{value}}', value: ingestTask.reasonCode })}</span>
                      <span>{t('runtimeConfig.knowledge.ingestTaskUpdated', { defaultValue: 'Updated {{value}}', value: formatTimestamp(ingestTask.updatedAt) })}</span>
                      {ingestTask.pageId ? (
                        <span>{t('runtimeConfig.knowledge.ingestTaskPageId', { defaultValue: 'Page ID: {{value}}', value: ingestTask.pageId })}</span>
                      ) : null}
                    </div>
                    {ingestTask.actionHint ? (
                      <p className="mt-3 text-xs text-[var(--nimi-text-secondary)]">{ingestTask.actionHint}</p>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </div>
          </section>

          <section>
            <SectionTitle description={t('runtimeConfig.knowledge.searchDescription', { defaultValue: 'SearchKeyword does bank-scoped lexical recall. SearchHybrid extends the same bank-scoped surface with hybrid retrieval when the runtime supports it.' })}>
              {t('runtimeConfig.knowledge.searchTitle', { defaultValue: 'Knowledge Search' })}
            </SectionTitle>
            <Card className="mt-3 p-5">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 max-w-56">
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.knowledge.searchMode', { defaultValue: 'Search Mode' })}
                    </label>
                    <RuntimeSelect
                      value={searchMode}
                      onChange={(value) => {
                        setSearchMode((value as RuntimeKnowledgeSearchMode) || 'keyword');
                        setSearchHits([]);
                        setSearchNextPageToken('');
                        setSearchUnavailableReason('');
                        setStatusMessage('');
                      }}
                      options={[
                        { value: 'keyword', label: t('runtimeConfig.knowledge.searchModeKeyword', { defaultValue: 'Keyword' }) },
                        { value: 'hybrid', label: t('runtimeConfig.knowledge.searchModeHybrid', { defaultValue: 'Hybrid' }) },
                      ]}
                      disabled={!selectedBankId || searching}
                    />
                  </div>
                  <Input
                    label={t('runtimeConfig.knowledge.searchQuery', { defaultValue: 'Query' })}
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('runtimeConfig.knowledge.searchQueryPlaceholder', { defaultValue: 'roadmap, pricing, integration' })}
                    disabled={!selectedBankId || searching}
                  />
                </div>
                <div className="flex items-end">
                  <Button variant="secondary" size="sm" disabled={!selectedBankId || searching || !normalizeText(searchQuery)} onClick={() => void handleRunSearch()}>
                    {searching
                      ? t('runtimeConfig.knowledge.searching', { defaultValue: 'Searching...' })
                      : t('runtimeConfig.knowledge.searchButton', { defaultValue: 'Search' })}
                  </Button>
                </div>
              </div>
              {searchMode === 'hybrid' && searchUnavailableReason ? (
                <div className="mt-4">
                  <Banner
                    tone="warning"
                    title={t('runtimeConfig.knowledge.hybridUnavailableTitle', { defaultValue: 'Hybrid Search Unavailable' })}
                    body={searchUnavailableReason}
                  />
                </div>
              ) : null}
              <div className="mt-4 space-y-2">
                {searchHits.length === 0 ? (
                  <p className="text-sm text-[var(--nimi-text-muted)]">
                    {searchMode === 'hybrid'
                      ? t('runtimeConfig.knowledge.searchEmptyHybrid', { defaultValue: 'Run a bank-scoped hybrid search to inspect current retrieval results.' })
                      : t('runtimeConfig.knowledge.searchEmpty', { defaultValue: 'Run a bank-scoped keyword search to inspect current recall results.' })}
                  </p>
                ) : searchHits.map((hit) => (
                  <button
                    key={`${hit.bankId}:${hit.pageId}`}
                    type="button"
                    onClick={() => {
                      const matched = pages.find((page) => page.pageId === hit.pageId);
                      if (matched) {
                        setPageDraft(pageDraftFromItem(matched));
                      }
                    }}
                    className="w-full rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-left hover:border-[var(--nimi-border-strong)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{hit.title || hit.slug}</p>
                      <span className="text-[11px] text-[var(--nimi-text-muted)]">score {hit.score.toFixed(2)}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{hit.slug}</p>
                    <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{hit.snippet}</p>
                  </button>
                ))}
                {searchMode === 'hybrid' && searchNextPageToken ? (
                  <div className="pt-2">
                    <Button variant="ghost" size="sm" disabled={searching} onClick={() => void loadMoreSearchHits()}>
                      {t('runtimeConfig.knowledge.loadMoreSearchResults', { defaultValue: 'Load More Results' })}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          </section>

          <section>
            <SectionTitle description={t('runtimeConfig.knowledge.graphDescription', { defaultValue: 'Wave 2B adds same-bank page links, backlinks, and bounded graph traversal without implying citation or shared truth.' })}>
              {t('runtimeConfig.knowledge.graphTitle', { defaultValue: 'Knowledge Graph' })}
            </SectionTitle>
            <div className="mt-3 grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,340px)_minmax(0,1fr)]">
              <Card className="p-5">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                      {selectedPage?.title || selectedPage?.slug || t('runtimeConfig.knowledge.graphSelectPage', { defaultValue: 'Select a saved page first' })}
                    </p>
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.graphOutgoingHint', { defaultValue: 'Create outgoing same-bank links from the currently selected page.' })}
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.knowledge.linkTarget', { defaultValue: 'Target Page' })}
                    </label>
                    <RuntimeSelect
                      value={linkTargetPageId}
                      onChange={setLinkTargetPageId}
                      options={linkTargetOptions}
                      placeholder={t('runtimeConfig.knowledge.linkTargetPlaceholder', { defaultValue: 'Choose a page' })}
                      disabled={!selectedBankId || !pageDraft.pageId || writesDisabled || linkMutationLoading}
                    />
                  </div>
                  <Input
                    label={t('runtimeConfig.knowledge.linkType', { defaultValue: 'Link Type' })}
                    value={linkTypeDraft}
                    onChange={setLinkTypeDraft}
                    placeholder={t('runtimeConfig.knowledge.linkTypePlaceholder', { defaultValue: 'references' })}
                    disabled={!selectedBankId || !pageDraft.pageId || writesDisabled || linkMutationLoading}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={writesDisabled || linkMutationLoading || !selectedBankId || !pageDraft.pageId || !normalizeText(linkTargetPageId) || !normalizeText(linkTypeDraft)}
                    onClick={() => void handleAddLink()}
                  >
                    {linkMutationLoading
                      ? t('runtimeConfig.knowledge.addingLink', { defaultValue: 'Adding...' })
                      : t('runtimeConfig.knowledge.addLink', { defaultValue: 'Add Link' })}
                  </Button>
                </div>

                <div className="mt-5 space-y-2">
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.knowledge.outgoingLinks', { defaultValue: 'Outgoing Links' })}
                  </p>
                  {graphLoading && links.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.loadingLinks', { defaultValue: 'Loading links...' })}
                    </p>
                  ) : links.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {pageDraft.pageId
                        ? t('runtimeConfig.knowledge.noLinks', { defaultValue: 'No outgoing links for the current page yet.' })
                        : t('runtimeConfig.knowledge.noSavedPageSelected', { defaultValue: 'Save or select a page to inspect graph links.' })}
                    </p>
                  ) : links.map((link) => (
                    <div key={link.linkId} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{link.toTitle || link.toSlug || link.toPageId}</p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{link.linkType}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={writesDisabled || linkMutationLoading}
                          onClick={() => void handleRemoveLink(link.linkId)}
                        >
                          {t('runtimeConfig.knowledge.removeLink', { defaultValue: 'Remove' })}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{link.toSlug || link.toPageId}</p>
                    </div>
                  ))}
                  {linksNextPageToken ? (
                    <div className="pt-2">
                      <Button variant="ghost" size="sm" disabled={graphLoading} onClick={() => void loadMoreLinks()}>
                        {t('runtimeConfig.knowledge.loadMoreLinks', { defaultValue: 'Load More Links' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>

              <Card className="p-5">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                    {t('runtimeConfig.knowledge.backlinks', { defaultValue: 'Backlinks' })}
                  </p>
                  <p className="text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.knowledge.backlinksHint', { defaultValue: 'Incoming links into the selected page remain read-only projections.' })}
                  </p>
                </div>
                <div className="mt-4 space-y-2">
                  {graphLoading && backlinks.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.loadingBacklinks', { defaultValue: 'Loading backlinks...' })}
                    </p>
                  ) : backlinks.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {pageDraft.pageId
                        ? t('runtimeConfig.knowledge.noBacklinks', { defaultValue: 'No backlinks for the current page yet.' })
                        : t('runtimeConfig.knowledge.noSavedPageSelected', { defaultValue: 'Save or select a page to inspect graph links.' })}
                    </p>
                  ) : backlinks.map((link) => (
                    <div key={link.linkId} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
                      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{link.fromTitle || link.fromSlug || link.fromPageId}</p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{link.linkType}</p>
                      <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{link.fromSlug || link.fromPageId}</p>
                    </div>
                  ))}
                  {backlinksNextPageToken ? (
                    <div className="pt-2">
                      <Button variant="ghost" size="sm" disabled={graphLoading} onClick={() => void loadMoreBacklinks()}>
                        {t('runtimeConfig.knowledge.loadMoreBacklinks', { defaultValue: 'Load More Backlinks' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                      {t('runtimeConfig.knowledge.graphTraversal', { defaultValue: 'Graph Traversal' })}
                    </p>
                    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.graphTraversalHint', { defaultValue: 'Breadth-first expansion stays inside the selected bank and root page boundary.' })}
                    </p>
                  </div>
                  <div className="w-32">
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
                      {t('runtimeConfig.knowledge.graphDepth', { defaultValue: 'Max Depth' })}
                    </label>
                    <RuntimeSelect
                      value={String(graphDepth)}
                      onChange={(value) => setGraphDepth(Number(value) || 2)}
                      options={[
                        { value: '1', label: '1' },
                        { value: '2', label: '2' },
                        { value: '3', label: '3' },
                        { value: '4', label: '4' },
                        { value: '5', label: '5' },
                      ]}
                      disabled={!selectedBankId || !pageDraft.pageId || graphLoading}
                    />
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {graphLoading && graphNodes.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {t('runtimeConfig.knowledge.loadingGraph', { defaultValue: 'Loading graph nodes...' })}
                    </p>
                  ) : graphNodes.length === 0 ? (
                    <p className="text-sm text-[var(--nimi-text-muted)]">
                      {pageDraft.pageId
                        ? t('runtimeConfig.knowledge.noGraphNodes', { defaultValue: 'No traversal nodes are available for the current page.' })
                        : t('runtimeConfig.knowledge.noSavedPageSelected', { defaultValue: 'Save or select a page to inspect graph links.' })}
                    </p>
                  ) : graphNodes.map((node) => (
                    <button
                      key={`${node.pageId}:${node.depth}`}
                      type="button"
                      onClick={() => {
                        const matched = pages.find((page) => page.pageId === node.pageId);
                        if (matched) {
                          setPageDraft(pageDraftFromItem(matched));
                        }
                      }}
                      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                        node.pageId === pageDraft.pageId
                          ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_36%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]'
                          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{node.title || node.slug || node.pageId}</p>
                        <span className="text-[11px] text-[var(--nimi-text-muted)]">
                          {t('runtimeConfig.knowledge.depthLabel', { defaultValue: 'depth {{value}}', value: node.depth })}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{node.slug || node.pageId}</p>
                    </button>
                  ))}
                  {graphNextPageToken ? (
                    <div className="pt-2">
                      <Button variant="ghost" size="sm" disabled={graphLoading} onClick={() => void loadMoreGraphNodes()}>
                        {t('runtimeConfig.knowledge.loadMoreGraphNodes', { defaultValue: 'Load More Graph Nodes' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>
          </section>

          {selectedBank ? (
            <section>
              <SectionTitle description={t('runtimeConfig.knowledge.bankMetaDescription', { defaultValue: 'Inspect the selected bank without leaving runtime-config.' })}>
                {t('runtimeConfig.knowledge.bankMetaTitle', { defaultValue: 'Selected Bank' })}
              </SectionTitle>
              <Card className="mt-3 p-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.bankId', { defaultValue: 'Bank ID' })}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--nimi-text-primary)]">{selectedBank.bankId}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.bankOwner', { defaultValue: 'Owner' })}</p>
                    <p className="mt-1 text-sm text-[var(--nimi-text-primary)]">{bankDescriptor(selectedBank)}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.createdAt', { defaultValue: 'Created At' })}</p>
                    <p className="mt-1 text-sm text-[var(--nimi-text-primary)]">{formatTimestamp(selectedBank.createdAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.updatedAtLabel', { defaultValue: 'Updated At' })}</p>
                    <p className="mt-1 text-sm text-[var(--nimi-text-primary)]">{formatTimestamp(selectedBank.updatedAt)}</p>
                  </div>
                </div>
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </RuntimePageShell>
  );
}
