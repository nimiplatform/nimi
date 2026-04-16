import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';
import type {
  RuntimeKnowledgeBankItem,
  RuntimeKnowledgeGraphNodeItem,
  RuntimeKnowledgeKeywordHitItem,
  RuntimeKnowledgeLinkItem,
  RuntimeKnowledgePageItem,
  RuntimeKnowledgeSearchMode,
} from './runtime-config-knowledge-sdk-service';
import {
  bankDescriptor,
  formatTimestamp,
  normalizeText,
  type PageDraft,
  pageDraftFromItem,
} from './runtime-config-page-knowledge-helpers';
import { Banner } from './runtime-config-page-knowledge-ui';

export function KnowledgeDiscoverySection(props: {
  selectedBankId: string;
  pages: RuntimeKnowledgePageItem[];
  pageDraft: PageDraft;
  onPageDraftChange: Dispatch<SetStateAction<PageDraft>>;
  selectedPage: RuntimeKnowledgePageItem | null;
  writesDisabled: boolean;
  searchMode: RuntimeKnowledgeSearchMode;
  onSearchModeChange: (value: RuntimeKnowledgeSearchMode) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searching: boolean;
  onRunSearch: () => Promise<void>;
  searchUnavailableReason: string;
  searchHits: RuntimeKnowledgeKeywordHitItem[];
  searchNextPageToken: string;
  onLoadMoreSearchHits: () => Promise<void>;
  linkTargetOptions: Array<{ value: string; label: string }>;
  linkTargetPageId: string;
  onLinkTargetPageIdChange: (value: string) => void;
  linkTypeDraft: string;
  onLinkTypeDraftChange: (value: string) => void;
  linkMutationLoading: boolean;
  onAddLink: () => Promise<void>;
  graphLoading: boolean;
  links: RuntimeKnowledgeLinkItem[];
  backlinks: RuntimeKnowledgeLinkItem[];
  graphNodes: RuntimeKnowledgeGraphNodeItem[];
  onRemoveLink: (linkId: string) => Promise<void>;
  linksNextPageToken: string;
  backlinksNextPageToken: string;
  graphNextPageToken: string;
  onLoadMoreLinks: () => Promise<void>;
  onLoadMoreBacklinks: () => Promise<void>;
  onLoadMoreGraphNodes: () => Promise<void>;
  graphDepth: number;
  onGraphDepthChange: (value: number) => void;
  selectedBank: RuntimeKnowledgeBankItem | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
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
                  value={props.searchMode}
                  onChange={(value) => props.onSearchModeChange((value as RuntimeKnowledgeSearchMode) || 'keyword')}
                  options={[
                    { value: 'keyword', label: t('runtimeConfig.knowledge.searchModeKeyword', { defaultValue: 'Keyword' }) },
                    { value: 'hybrid', label: t('runtimeConfig.knowledge.searchModeHybrid', { defaultValue: 'Hybrid' }) },
                  ]}
                  disabled={!props.selectedBankId || props.searching}
                />
              </div>
              <Input
                label={t('runtimeConfig.knowledge.searchQuery', { defaultValue: 'Query' })}
                value={props.searchQuery}
                onChange={props.onSearchQueryChange}
                placeholder={t('runtimeConfig.knowledge.searchQueryPlaceholder', { defaultValue: 'roadmap, pricing, integration' })}
                disabled={!props.selectedBankId || props.searching}
              />
            </div>
            <div className="flex items-end">
              <Button variant="secondary" size="sm" disabled={!props.selectedBankId || props.searching || !normalizeText(props.searchQuery)} onClick={() => void props.onRunSearch()}>
                {props.searching
                  ? t('runtimeConfig.knowledge.searching', { defaultValue: 'Searching...' })
                  : t('runtimeConfig.knowledge.searchButton', { defaultValue: 'Search' })}
              </Button>
            </div>
          </div>
          {props.searchMode === 'hybrid' && props.searchUnavailableReason ? (
            <div className="mt-4">
              <Banner
                tone="warning"
                title={t('runtimeConfig.knowledge.hybridUnavailableTitle', { defaultValue: 'Hybrid Search Unavailable' })}
                body={props.searchUnavailableReason}
              />
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {props.searchHits.length === 0 ? (
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {props.searchMode === 'hybrid'
                  ? t('runtimeConfig.knowledge.searchEmptyHybrid', { defaultValue: 'Run a bank-scoped hybrid search to inspect current retrieval results.' })
                  : t('runtimeConfig.knowledge.searchEmpty', { defaultValue: 'Run a bank-scoped keyword search to inspect current recall results.' })}
              </p>
            ) : props.searchHits.map((hit) => (
              <button
                key={`${hit.bankId}:${hit.pageId}`}
                type="button"
                onClick={() => {
                  const matched = props.pages.find((page) => page.pageId === hit.pageId);
                  if (matched) {
                    props.onPageDraftChange(pageDraftFromItem(matched));
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
            {props.searchMode === 'hybrid' && props.searchNextPageToken ? (
              <div className="pt-2">
                <Button variant="ghost" size="sm" disabled={props.searching} onClick={() => void props.onLoadMoreSearchHits()}>
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
                  {props.selectedPage?.title || props.selectedPage?.slug || t('runtimeConfig.knowledge.graphSelectPage', { defaultValue: 'Select a saved page first' })}
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
                  value={props.linkTargetPageId}
                  onChange={props.onLinkTargetPageIdChange}
                  options={props.linkTargetOptions}
                  placeholder={t('runtimeConfig.knowledge.linkTargetPlaceholder', { defaultValue: 'Choose a page' })}
                  disabled={!props.selectedBankId || !props.pageDraft.pageId || props.writesDisabled || props.linkMutationLoading}
                />
              </div>
              <Input
                label={t('runtimeConfig.knowledge.linkType', { defaultValue: 'Link Type' })}
                value={props.linkTypeDraft}
                onChange={props.onLinkTypeDraftChange}
                placeholder={t('runtimeConfig.knowledge.linkTypePlaceholder', { defaultValue: 'references' })}
                disabled={!props.selectedBankId || !props.pageDraft.pageId || props.writesDisabled || props.linkMutationLoading}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={props.writesDisabled || props.linkMutationLoading || !props.selectedBankId || !props.pageDraft.pageId || !normalizeText(props.linkTargetPageId) || !normalizeText(props.linkTypeDraft)}
                onClick={() => void props.onAddLink()}
              >
                {props.linkMutationLoading
                  ? t('runtimeConfig.knowledge.addingLink', { defaultValue: 'Adding...' })
                  : t('runtimeConfig.knowledge.addLink', { defaultValue: 'Add Link' })}
              </Button>
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('runtimeConfig.knowledge.outgoingLinks', { defaultValue: 'Outgoing Links' })}
              </p>
              {props.graphLoading && props.links.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.knowledge.loadingLinks', { defaultValue: 'Loading links...' })}
                </p>
              ) : props.links.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {props.pageDraft.pageId
                    ? t('runtimeConfig.knowledge.noLinks', { defaultValue: 'No outgoing links for the current page yet.' })
                    : t('runtimeConfig.knowledge.noSavedPageSelected', { defaultValue: 'Save or select a page to inspect graph links.' })}
                </p>
              ) : props.links.map((link) => (
                <div key={link.linkId} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{link.toTitle || link.toSlug || link.toPageId}</p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{link.linkType}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.writesDisabled || props.linkMutationLoading}
                      onClick={() => void props.onRemoveLink(link.linkId)}
                    >
                      {t('runtimeConfig.knowledge.removeLink', { defaultValue: 'Remove' })}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{link.toSlug || link.toPageId}</p>
                </div>
              ))}
              {props.linksNextPageToken ? (
                <div className="pt-2">
                  <Button variant="ghost" size="sm" disabled={props.graphLoading} onClick={() => void props.onLoadMoreLinks()}>
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
              {props.graphLoading && props.backlinks.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.knowledge.loadingBacklinks', { defaultValue: 'Loading backlinks...' })}
                </p>
              ) : props.backlinks.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {props.pageDraft.pageId
                    ? t('runtimeConfig.knowledge.noBacklinks', { defaultValue: 'No backlinks for the current page yet.' })
                    : t('runtimeConfig.knowledge.noSavedPageSelected', { defaultValue: 'Save or select a page to inspect graph links.' })}
                </p>
              ) : props.backlinks.map((link) => (
                <div key={link.linkId} className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
                  <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{link.fromTitle || link.fromSlug || link.fromPageId}</p>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{link.linkType}</p>
                  <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{link.fromSlug || link.fromPageId}</p>
                </div>
              ))}
              {props.backlinksNextPageToken ? (
                <div className="pt-2">
                  <Button variant="ghost" size="sm" disabled={props.graphLoading} onClick={() => void props.onLoadMoreBacklinks()}>
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
                  value={String(props.graphDepth)}
                  onChange={(value) => props.onGraphDepthChange(Number(value) || 2)}
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '3', label: '3' },
                    { value: '4', label: '4' },
                    { value: '5', label: '5' },
                  ]}
                  disabled={!props.selectedBankId || !props.pageDraft.pageId || props.graphLoading}
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {props.graphLoading && props.graphNodes.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.knowledge.loadingGraph', { defaultValue: 'Loading graph nodes...' })}
                </p>
              ) : props.graphNodes.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {props.pageDraft.pageId
                    ? t('runtimeConfig.knowledge.noGraphNodes', { defaultValue: 'No traversal nodes are available for the current page.' })
                    : t('runtimeConfig.knowledge.noSavedPageSelected', { defaultValue: 'Save or select a page to inspect graph links.' })}
                </p>
              ) : props.graphNodes.map((node) => (
                <button
                  key={`${node.pageId}:${node.depth}`}
                  type="button"
                  onClick={() => {
                    const matched = props.pages.find((page) => page.pageId === node.pageId);
                    if (matched) {
                      props.onPageDraftChange(pageDraftFromItem(matched));
                    }
                  }}
                  className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                    node.pageId === props.pageDraft.pageId
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
              {props.graphNextPageToken ? (
                <div className="pt-2">
                  <Button variant="ghost" size="sm" disabled={props.graphLoading} onClick={() => void props.onLoadMoreGraphNodes()}>
                    {t('runtimeConfig.knowledge.loadMoreGraphNodes', { defaultValue: 'Load More Graph Nodes' })}
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </section>

      {props.selectedBank ? (
        <section>
          <SectionTitle description={t('runtimeConfig.knowledge.bankMetaDescription', { defaultValue: 'Inspect the selected bank without leaving runtime-config.' })}>
            {t('runtimeConfig.knowledge.bankMetaTitle', { defaultValue: 'Selected Bank' })}
          </SectionTitle>
          <Card className="mt-3 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.bankId', { defaultValue: 'Bank ID' })}</p>
                <p className="mt-1 font-mono text-xs text-[var(--nimi-text-primary)]">{props.selectedBank.bankId}</p>
              </div>
              <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.bankOwner', { defaultValue: 'Owner' })}</p>
                <p className="mt-1 text-sm text-[var(--nimi-text-primary)]">{bankDescriptor(props.selectedBank)}</p>
              </div>
              <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.createdAt', { defaultValue: 'Created At' })}</p>
                <p className="mt-1 text-sm text-[var(--nimi-text-primary)]">{formatTimestamp(props.selectedBank.createdAt)}</p>
              </div>
              <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
                <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.knowledge.updatedAtLabel', { defaultValue: 'Updated At' })}</p>
                <p className="mt-1 text-sm text-[var(--nimi-text-primary)]">{formatTimestamp(props.selectedBank.updatedAt)}</p>
              </div>
            </div>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
