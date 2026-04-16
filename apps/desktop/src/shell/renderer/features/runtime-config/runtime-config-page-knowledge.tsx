import { startTransition, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePageShell } from './runtime-config-page-shell';
import {
  DEFAULT_RUNTIME_KNOWLEDGE_APP_ID,
  createRuntimeKnowledgeBank,
  deleteRuntimeKnowledgeBank,
  deleteRuntimeKnowledgePage,
  getRuntimeKnowledgeIngestTask,
  ingestRuntimeKnowledgeDocument,
  listRuntimeKnowledgeBanks,
  listRuntimeKnowledgeBacklinks,
  listRuntimeKnowledgeLinks,
  listRuntimeKnowledgePages,
  putRuntimeKnowledgePage,
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
import {
  DEFAULT_PAGE_DRAFT,
  normalizeText,
  type PageDraft,
  pageDraftFromItem,
} from './runtime-config-page-knowledge-helpers';
import { KnowledgeContextSection, KnowledgeManagementSection } from './runtime-config-page-knowledge-management';
import { KnowledgeDiscoverySection } from './runtime-config-page-knowledge-discovery';
import { Banner } from './runtime-config-page-knowledge-ui';
import { createKnowledgeDiscoveryActions } from './runtime-config-page-knowledge-discovery-actions';

type KnowledgePageProps = {
  model: RuntimeConfigPanelControllerModel;
};

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

  const {
    loadMoreLinks,
    loadMoreBacklinks,
    loadMoreGraphNodes,
    handleAddLink,
    handleRemoveLink,
    handleRunSearch,
    loadMoreSearchHits,
  } = createKnowledgeDiscoveryActions({
    contextInput,
    graphDepth,
    selectedBankId,
    pageDraft,
    linkTargetPageId,
    setLinkTargetPageId,
    linkTypeDraft,
    searchMode,
    searchQuery,
    setErrorMessage,
    setStatusMessage,
    setGraphLoading,
    setLinkMutationLoading,
    setLinks,
    setBacklinks,
    setGraphNodes,
    setLinksNextPageToken,
    setBacklinksNextPageToken,
    setGraphNextPageToken,
    setSearching,
    setSearchHits,
    setSearchNextPageToken,
    setSearchUnavailableReason,
    t,
  });

  return (
    <RuntimePageShell maxWidth="6xl">
      <KnowledgeContextSection
        appId={appId}
        onAppIdChange={setAppId}
        subjectUserId={subjectUserId}
        onSubjectUserIdChange={setSubjectUserId}
        scope={scope}
        onScopeChange={setScope}
        workspaceId={workspaceId}
        onWorkspaceIdChange={setWorkspaceId}
        banksLoading={banksLoading}
        pagesLoading={pagesLoading}
        canQueryCurrentScope={canQueryCurrentScope}
        writesDisabled={writesDisabled}
      />

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

      <KnowledgeManagementSection
        writesDisabled={writesDisabled}
        canQueryCurrentScope={canQueryCurrentScope}
        bankDisplayName={bankDisplayName}
        onBankDisplayNameChange={setBankDisplayName}
        creatingBank={creatingBank}
        deletingBank={deletingBank}
        selectedBankId={selectedBankId}
        banksLoading={banksLoading}
        banks={banks}
        onSelectedBankIdChange={setSelectedBankId}
        banksNextPageToken={banksNextPageToken}
        onLoadMoreBanks={loadMoreBanks}
        onCreateBank={handleCreateBank}
        onDeleteBank={handleDeleteBank}
        selectedBank={selectedBank}
        pageFilter={pageFilter}
        onPageFilterChange={setPageFilter}
        filteredPages={filteredPages}
        pagesLoading={pagesLoading}
        onResetPageDraft={() => setPageDraft(DEFAULT_PAGE_DRAFT)}
        pageDraft={pageDraft}
        onPageDraftChange={setPageDraft}
        pagesNextPageToken={pagesNextPageToken}
        onLoadMorePages={loadMorePages}
        savingPage={savingPage}
        ingestingPage={ingestingPage}
        deletingPage={deletingPage}
        onSavePage={handleSavePage}
        onIngestPage={handleIngestDocument}
        onDeletePage={handleDeletePage}
        ingestTask={ingestTask}
        onRefreshIngestTask={refreshIngestTask}
      />

      <KnowledgeDiscoverySection
        selectedBankId={selectedBankId}
        pages={pages}
        pageDraft={pageDraft}
        onPageDraftChange={setPageDraft}
        selectedPage={selectedPage}
        writesDisabled={writesDisabled}
        searchMode={searchMode}
        onSearchModeChange={(value) => {
          setSearchMode(value);
          setSearchHits([]);
          setSearchNextPageToken('');
          setSearchUnavailableReason('');
          setStatusMessage('');
        }}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searching={searching}
        onRunSearch={handleRunSearch}
        searchUnavailableReason={searchUnavailableReason}
        searchHits={searchHits}
        searchNextPageToken={searchNextPageToken}
        onLoadMoreSearchHits={() => loadMoreSearchHits(searchNextPageToken)}
        linkTargetOptions={linkTargetOptions}
        linkTargetPageId={linkTargetPageId}
        onLinkTargetPageIdChange={setLinkTargetPageId}
        linkTypeDraft={linkTypeDraft}
        onLinkTypeDraftChange={setLinkTypeDraft}
        linkMutationLoading={linkMutationLoading}
        onAddLink={handleAddLink}
        graphLoading={graphLoading}
        links={links}
        backlinks={backlinks}
        graphNodes={graphNodes}
        onRemoveLink={handleRemoveLink}
        linksNextPageToken={linksNextPageToken}
        backlinksNextPageToken={backlinksNextPageToken}
        graphNextPageToken={graphNextPageToken}
        onLoadMoreLinks={() => loadMoreLinks(linksNextPageToken)}
        onLoadMoreBacklinks={() => loadMoreBacklinks(backlinksNextPageToken)}
        onLoadMoreGraphNodes={() => loadMoreGraphNodes(graphNextPageToken)}
        graphDepth={graphDepth}
        onGraphDepthChange={setGraphDepth}
        selectedBank={selectedBank}
      />
    </RuntimePageShell>
  );
}
