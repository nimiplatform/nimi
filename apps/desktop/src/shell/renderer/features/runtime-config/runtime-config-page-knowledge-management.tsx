import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import { Button, Card, Input, RuntimeSelect } from './runtime-config-primitives';
import type {
  RuntimeKnowledgeBankItem,
  RuntimeKnowledgeIngestTaskItem,
  RuntimeKnowledgePageItem,
  RuntimeKnowledgeScope,
} from './runtime-config-knowledge-sdk-service';
import {
  bankDescriptor,
  formatTimestamp,
  normalizeText,
  type PageDraft,
  pageDraftFromItem,
} from './runtime-config-page-knowledge-helpers';
import { TextArea } from './runtime-config-page-knowledge-ui';

const DEFAULT_RUNTIME_KNOWLEDGE_APP_ID = 'nimi.desktop';

export function KnowledgeContextSection(props: {
  appId: string;
  onAppIdChange: (value: string) => void;
  subjectUserId: string;
  onSubjectUserIdChange: (value: string) => void;
  scope: RuntimeKnowledgeScope;
  onScopeChange: (value: RuntimeKnowledgeScope) => void;
  workspaceId: string;
  onWorkspaceIdChange: (value: string) => void;
  banksLoading: boolean;
  pagesLoading: boolean;
  canQueryCurrentScope: boolean;
  writesDisabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section>
      <SectionTitle description={t('runtimeConfig.knowledge.contextDescription', { defaultValue: 'Wave 1 runtime-local knowledge is scoped by request context plus app-private or workspace-private bank ownership.' })}>
        {t('runtimeConfig.knowledge.contextTitle', { defaultValue: 'Knowledge Context' })}
      </SectionTitle>
      <Card className="mt-3 p-5">
        <div className="grid gap-4 lg:grid-cols-4">
          <Input
            label={t('runtimeConfig.knowledge.appId', { defaultValue: 'App ID' })}
            value={props.appId}
            onChange={props.onAppIdChange}
            placeholder={DEFAULT_RUNTIME_KNOWLEDGE_APP_ID}
            disabled={props.banksLoading || props.pagesLoading}
          />
          <Input
            label={t('runtimeConfig.knowledge.subjectUserId', { defaultValue: 'Subject User ID (optional)' })}
            value={props.subjectUserId}
            onChange={props.onSubjectUserIdChange}
            placeholder={t('runtimeConfig.knowledge.subjectUserIdPlaceholder', { defaultValue: 'user-123' })}
            disabled={props.banksLoading || props.pagesLoading}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.knowledge.scope', { defaultValue: 'Bank Scope' })}
            </label>
            <RuntimeSelect
              value={props.scope}
              onChange={(value) => props.onScopeChange(value === 'workspace-private' ? 'workspace-private' : 'app-private')}
              options={[
                { value: 'app-private', label: t('runtimeConfig.knowledge.scopeAppPrivate', { defaultValue: 'App Private' }) },
                { value: 'workspace-private', label: t('runtimeConfig.knowledge.scopeWorkspacePrivate', { defaultValue: 'Workspace Private' }) },
              ]}
            />
          </div>
          <Input
            label={t('runtimeConfig.knowledge.workspaceId', { defaultValue: 'Workspace ID' })}
            value={props.workspaceId}
            onChange={props.onWorkspaceIdChange}
            placeholder={t('runtimeConfig.knowledge.workspaceIdPlaceholder', { defaultValue: 'workspace-alpha' })}
            disabled={props.scope !== 'workspace-private' || props.banksLoading || props.pagesLoading}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-1 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.knowledge.contextHint', { defaultValue: 'Desktop runtime client defaults to app_id=nimi.desktop unless you override it here.' })}
          </span>
          {!props.canQueryCurrentScope ? (
            <span className="rounded-full border border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-1 text-xs text-[var(--nimi-status-warning)]">
              {t('runtimeConfig.knowledge.workspaceRequired', { defaultValue: 'Workspace-private listing requires a workspace ID.' })}
            </span>
          ) : null}
          {props.writesDisabled ? (
            <span className="rounded-full border border-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-1 text-xs text-[var(--nimi-status-warning)]">
              {t('runtimeConfig.knowledge.readOnlyMode', { defaultValue: 'Runtime writes are disabled in the current offline tier.' })}
            </span>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

export function KnowledgeManagementSection(props: {
  writesDisabled: boolean;
  canQueryCurrentScope: boolean;
  bankDisplayName: string;
  onBankDisplayNameChange: (value: string) => void;
  creatingBank: boolean;
  deletingBank: boolean;
  selectedBankId: string;
  banksLoading: boolean;
  banks: RuntimeKnowledgeBankItem[];
  onSelectedBankIdChange: (value: string) => void;
  banksNextPageToken: string;
  onLoadMoreBanks: () => Promise<void>;
  onCreateBank: () => Promise<void>;
  onDeleteBank: () => Promise<void>;
  selectedBank: RuntimeKnowledgeBankItem | null;
  pageFilter: string;
  onPageFilterChange: (value: string) => void;
  filteredPages: RuntimeKnowledgePageItem[];
  pagesLoading: boolean;
  onResetPageDraft: () => void;
  pageDraft: PageDraft;
  onPageDraftChange: Dispatch<SetStateAction<PageDraft>>;
  pagesNextPageToken: string;
  onLoadMorePages: () => Promise<void>;
  savingPage: boolean;
  ingestingPage: boolean;
  deletingPage: boolean;
  onSavePage: () => Promise<void>;
  onIngestPage: () => Promise<void>;
  onDeletePage: () => Promise<void>;
  ingestTask: RuntimeKnowledgeIngestTaskItem | null;
  onRefreshIngestTask: (taskId: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section>
        <SectionTitle description={t('runtimeConfig.knowledge.bankDescription', { defaultValue: 'Create, select, and delete Wave 1 knowledge banks for the current scope.' })}>
          {t('runtimeConfig.knowledge.bankTitle', { defaultValue: 'Knowledge Banks' })}
        </SectionTitle>
        <Card className="mt-3 p-5">
          <div className="space-y-3">
            <Input
              label={t('runtimeConfig.knowledge.bankDisplayName', { defaultValue: 'Display Name' })}
              value={props.bankDisplayName}
              onChange={props.onBankDisplayNameChange}
              placeholder={t('runtimeConfig.knowledge.bankDisplayNamePlaceholder', { defaultValue: 'Product Notes' })}
              disabled={props.writesDisabled || props.creatingBank}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={props.writesDisabled || props.creatingBank || !props.canQueryCurrentScope} onClick={() => void props.onCreateBank()}>
                {props.creatingBank
                  ? t('runtimeConfig.knowledge.creatingBank', { defaultValue: 'Creating...' })
                  : t('runtimeConfig.knowledge.createBank', { defaultValue: 'Create Bank' })}
              </Button>
              <Button variant="ghost" size="sm" disabled={props.writesDisabled || props.deletingBank || !props.selectedBankId} onClick={() => void props.onDeleteBank()}>
                {props.deletingBank
                  ? t('runtimeConfig.knowledge.deletingBank', { defaultValue: 'Deleting...' })
                  : t('runtimeConfig.knowledge.deleteBank', { defaultValue: 'Delete Selected' })}
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {props.banksLoading && props.banks.length === 0 ? (
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.knowledge.loadingBanks', { defaultValue: 'Loading banks...' })}
              </p>
            ) : props.banks.length === 0 ? (
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {t('runtimeConfig.knowledge.noBanks', { defaultValue: 'No knowledge banks exist for the current scope yet.' })}
              </p>
            ) : props.banks.map((bank) => (
              <button
                key={bank.bankId}
                type="button"
                onClick={() => props.onSelectedBankIdChange(bank.bankId)}
                className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                  bank.bankId === props.selectedBankId
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

          {props.banksNextPageToken ? (
            <div className="mt-4">
              <Button variant="ghost" size="sm" disabled={props.banksLoading} onClick={() => void props.onLoadMoreBanks()}>
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
                  {props.selectedBank?.displayName || t('runtimeConfig.knowledge.selectBankPrompt', { defaultValue: 'Select a bank first' })}
                </p>
                <Button variant="ghost" size="sm" disabled={!props.selectedBankId} onClick={props.onResetPageDraft}>
                  {t('runtimeConfig.knowledge.newPage', { defaultValue: 'New Page' })}
                </Button>
              </div>
              <div className="mt-3">
                <Input
                  label={t('runtimeConfig.knowledge.pageFilter', { defaultValue: 'Filter Pages' })}
                  value={props.pageFilter}
                  onChange={props.onPageFilterChange}
                  placeholder={t('runtimeConfig.knowledge.pageFilterPlaceholder', { defaultValue: 'slug, title, entity type' })}
                  disabled={!props.selectedBankId}
                />
              </div>
              <div className="mt-4 space-y-2">
                {props.pagesLoading && props.filteredPages.length === 0 ? (
                  <p className="text-sm text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.knowledge.loadingPages', { defaultValue: 'Loading pages...' })}
                  </p>
                ) : props.filteredPages.length === 0 ? (
                  <p className="text-sm text-[var(--nimi-text-muted)]">
                    {props.selectedBankId
                      ? t('runtimeConfig.knowledge.noPages', { defaultValue: 'No pages found for this bank.' })
                      : t('runtimeConfig.knowledge.noBankSelected', { defaultValue: 'Select a bank to inspect its pages.' })}
                  </p>
                ) : props.filteredPages.map((page) => (
                  <button
                    key={page.pageId}
                    type="button"
                    onClick={() => props.onPageDraftChange(pageDraftFromItem(page))}
                    className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                      page.pageId === props.pageDraft.pageId
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
              {props.pagesNextPageToken ? (
                <div className="mt-4">
                  <Button variant="ghost" size="sm" disabled={props.pagesLoading} onClick={() => void props.onLoadMorePages()}>
                    {t('runtimeConfig.knowledge.loadMorePages', { defaultValue: 'Load More Pages' })}
                  </Button>
                </div>
              ) : null}
            </Card>

            <Card className="p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.knowledge.pageSlug', { defaultValue: 'Slug' })}
                  value={props.pageDraft.slug}
                  onChange={(value) => props.onPageDraftChange((current) => ({ ...current, slug: value }))}
                  placeholder={t('runtimeConfig.knowledge.pageSlugPlaceholder', { defaultValue: 'product-brief' })}
                  disabled={!props.selectedBankId || props.savingPage}
                />
                <Input
                  label={t('runtimeConfig.knowledge.pageEntityType', { defaultValue: 'Entity Type' })}
                  value={props.pageDraft.entityType}
                  onChange={(value) => props.onPageDraftChange((current) => ({ ...current, entityType: value }))}
                  placeholder={t('runtimeConfig.knowledge.pageEntityTypePlaceholder', { defaultValue: 'document' })}
                  disabled={!props.selectedBankId || props.savingPage}
                />
              </div>
              <div className="mt-4">
                <Input
                  label={t('runtimeConfig.knowledge.pageTitleLabel', { defaultValue: 'Title' })}
                  value={props.pageDraft.title}
                  onChange={(value) => props.onPageDraftChange((current) => ({ ...current, title: value }))}
                  placeholder={t('runtimeConfig.knowledge.pageTitlePlaceholder', { defaultValue: 'Product Brief' })}
                  disabled={!props.selectedBankId || props.savingPage}
                />
              </div>
              <div className="mt-4">
                <TextArea
                  label={t('runtimeConfig.knowledge.pageContent', { defaultValue: 'Content' })}
                  value={props.pageDraft.content}
                  onChange={(value) => props.onPageDraftChange((current) => ({ ...current, content: value }))}
                  placeholder={t('runtimeConfig.knowledge.pageContentPlaceholder', { defaultValue: 'Write the knowledge page content here...' })}
                  rows={14}
                  disabled={!props.selectedBankId || props.savingPage}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" disabled={props.writesDisabled || props.savingPage || !props.selectedBankId || !normalizeText(props.pageDraft.slug)} onClick={() => void props.onSavePage()}>
                  {props.savingPage
                    ? t('runtimeConfig.knowledge.savingPage', { defaultValue: 'Saving...' })
                    : t('runtimeConfig.knowledge.savePage', { defaultValue: 'Save Page' })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.writesDisabled || props.ingestingPage || !props.selectedBankId || !normalizeText(props.pageDraft.slug) || !normalizeText(props.pageDraft.content)}
                  onClick={() => void props.onIngestPage()}
                >
                  {props.ingestingPage
                    ? t('runtimeConfig.knowledge.ingestingPage', { defaultValue: 'Ingesting...' })
                    : t('runtimeConfig.knowledge.ingestPage', { defaultValue: 'Ingest Async' })}
                </Button>
                <Button variant="ghost" size="sm" disabled={props.writesDisabled || props.deletingPage || !props.pageDraft.pageId} onClick={() => void props.onDeletePage()}>
                  {props.deletingPage
                    ? t('runtimeConfig.knowledge.deletingPage', { defaultValue: 'Deleting...' })
                    : t('runtimeConfig.knowledge.deletePage', { defaultValue: 'Delete Page' })}
                </Button>
                {props.pageDraft.pageId ? (
                  <span className="text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.knowledge.pageIdentity', { defaultValue: 'Page ID: {{value}}', value: props.pageDraft.pageId })}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--nimi-text-muted)]">
                    {t('runtimeConfig.knowledge.pageCreateHint', { defaultValue: 'New pages are created on first save.' })}
                  </span>
                )}
              </div>
              {props.ingestTask ? (
                <div className="mt-4 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                        {t('runtimeConfig.knowledge.ingestTaskTitle', { defaultValue: 'Latest Ingest Task' })}
                      </p>
                      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                        {t('runtimeConfig.knowledge.ingestTaskSummary', {
                          defaultValue: '{{status}} · {{progress}}%',
                          status: props.ingestTask.status,
                          progress: props.ingestTask.progressPercent,
                        })}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" disabled={!props.ingestTask.taskId} onClick={() => void props.onRefreshIngestTask(props.ingestTask?.taskId || '')}>
                      {t('runtimeConfig.knowledge.refreshIngestTask', { defaultValue: 'Refresh Task' })}
                    </Button>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--nimi-border-subtle)]">
                    <div
                      className="h-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-[width] duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, props.ingestTask.progressPercent))}%` }}
                    />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--nimi-text-muted)] md:grid-cols-2">
                    <span>{t('runtimeConfig.knowledge.ingestTaskId', { defaultValue: 'Task ID: {{value}}', value: props.ingestTask.taskId })}</span>
                    <span>{t('runtimeConfig.knowledge.ingestTaskReason', { defaultValue: 'Reason: {{value}}', value: props.ingestTask.reasonCode })}</span>
                    <span>{t('runtimeConfig.knowledge.ingestTaskUpdated', { defaultValue: 'Updated {{value}}', value: formatTimestamp(props.ingestTask.updatedAt) })}</span>
                    {props.ingestTask.pageId ? (
                      <span>{t('runtimeConfig.knowledge.ingestTaskPageId', { defaultValue: 'Page ID: {{value}}', value: props.ingestTask.pageId })}</span>
                    ) : null}
                  </div>
                  {props.ingestTask.actionHint ? (
                    <p className="mt-3 text-xs text-[var(--nimi-text-secondary)]">{props.ingestTask.actionHint}</p>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
