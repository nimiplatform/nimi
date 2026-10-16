import { HomeExecutionNotices } from './execution-notices.js';
import { ActionMenu, Button, IconButton, InlineAlert, LoadingSkeleton, Popover, PopoverContent, PopoverTrigger, type NimiMenuItem } from '@nimiplatform/kit/ui';
import { Bell, Check, ListFilter } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HomeMessageCard,
  HomeMessageGroupPanel,
  HomeMessageStack,
  type HomeMessageCardContext,
} from './home-message-card.js';
import type { HomeMessages } from './home-messages-controller.js';
import { filterTimelineMessages, homePreviewGroups, isPendingMessage, quickFilterSelection, type HomeMessageGroup, type HomeTimelineQuickFilter } from './home-messages-model.js';

/** Loaded pending items; `more` while the open-todo listing is still incomplete. */
export function pendingSummary(messages: HomeMessages): Readonly<{ count: number; more: boolean; known: boolean }> {
  const pending = messages.app.pending;
  return {
    count: messages.messages.filter(isPendingMessage).length,
    more: !pending.complete,
    known: pending.status !== 'loading' || pending.records.length > 0,
  };
}

function appLoading(messages: HomeMessages): boolean {
  const { pending, recent } = messages.app;
  return (pending.status === 'loading' || recent.status === 'loading') && !pending.records.length && !recent.records.length;
}

/** Source-local read problems; each keeps the other sources usable. */
export function HomeMessageSourceNotices({ messages, app = true, realm = true, preferences = true }: {
  messages: HomeMessages;
  app?: boolean;
  realm?: boolean;
  preferences?: boolean;
}) {
  const { t } = useTranslation();
  const { preferences: displayPreferences } = messages;
  const retry = (onClick: () => void, label = t('runtimeConfig.overview.messages.retry')) => (
    <Button tone="ghost" size="sm" onClick={onClick}>{label}</Button>
  );
  return (
    <>
      {app && (messages.app.pending.status === 'unavailable' || messages.app.recent.status === 'unavailable') ? (
        <InlineAlert tone="warning" action={retry(messages.app.retry)} data-testid="home-messages-app-unavailable">
          <p className="font-medium">{t('runtimeConfig.overview.messages.appUnavailable')}</p>
          <p>{t('runtimeConfig.overview.messages.otherSourcesShown')}</p>
        </InlineAlert>
      ) : null}
      {realm && messages.realm.status === 'unavailable' ? (
        <InlineAlert tone="warning" action={retry(messages.realm.retry)} data-testid="home-messages-realm-unavailable">
          {t('runtimeConfig.overview.messages.realmUnavailable')}
        </InlineAlert>
      ) : null}
      {realm && messages.realm.stale ? (
        <InlineAlert tone="neutral" action={retry(messages.realm.retry)}>
          {t('runtimeConfig.overview.messages.realmStale')}
        </InlineAlert>
      ) : null}
      {preferences && displayPreferences.state.status === 'unavailable' ? (
        <InlineAlert
          tone="warning"
          action={retry(displayPreferences.reload, t('runtimeConfig.overview.messages.reload'))}
          data-testid="home-messages-preferences-unavailable"
        >
          {t('runtimeConfig.overview.messages.preferencesUnavailable')}
        </InlineAlert>
      ) : null}
      {preferences && displayPreferences.saveFailed ? (
        <InlineAlert tone="warning" action={retry(displayPreferences.retrySave)} data-testid="home-messages-save-failed">
          <p className="font-medium">{t('runtimeConfig.overview.messages.saveFailed')}</p>
          <p>{t('runtimeConfig.overview.messages.saveFailedBody')}</p>
        </InlineAlert>
      ) : null}
    </>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-[var(--nimi-border-subtle)] px-4 py-5 text-center text-sm text-[var(--nimi-text-secondary)]">
      {children}
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
/**
 * One bounded timeline with its navigation and local filters above the list.
 * Source-owned state and the complete Message center remain independent.
 */
export function HomeMessagesColumn({ messages, context, onViewAll }: {
  messages: HomeMessages;
  context: HomeMessageCardContext;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HomeTimelineQuickFilter>('all');
  const { type, status } = quickFilterSelection(filter);
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = filter !== 'all';
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Expanding or collapsing replaces the focused control; focus follows it.
  const [focusRequest, setFocusRequest] = useState<Readonly<{ key: string; target: 'group' | 'stack' }> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = messages.homeMessages
    ? homePreviewGroups(filterTimelineMessages(messages.homeMessages, type, status)) : null;
  const columnContext: HomeMessageCardContext = {
    ...context,
    // A hidden card leaves the list; keep keyboard focus in the list.
    onHide: (targets) => Promise.resolve(context.onHide(targets)).then((hidden) => {
      if (hidden) listRef.current?.focus();
      return Boolean(hidden);
    }),
  };
  const pending = pendingSummary(messages);
  const appRelevant = type !== 'post';
  const realmRelevant = (type === 'all' || type === 'post') && status === 'all';
  const loading = !groups || (appRelevant && appLoading(messages)) || (realmRelevant && messages.realm.status === 'loading');
  const appComplete = status === 'pending' ? messages.app.pending.complete
    : type === 'message' ? messages.app.recent.complete
    : messages.app.pending.complete && messages.app.recent.complete;
  const complete = (!appRelevant || appComplete)
    && (!realmRelevant || (messages.realm.status === 'ready' && !messages.realm.hasMore));
  const clearFilters = () => setFilter('all');
  const quickFilterItem = (value: HomeTimelineQuickFilter): NimiMenuItem => ({
    id: value,
    label: t(`runtimeConfig.overview.messages.quickFilters.${value}`),
    icon: filter === value
      ? <Check size={14} aria-hidden="true" />
      : <span className="inline-block size-3.5" aria-hidden="true" />,
    onSelect: () => { setFilter(value); setFilterOpen(false); },
  });
  const toggle = (key: string, open: boolean) => {
    setFocusRequest({ key, target: open ? 'group' : 'stack' });
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const focusHandled = () => setFocusRequest(null);
  const renderGroup = (group: HomeMessageGroup) => {
    if (group.messages.length === 1) {
      return <HomeMessageCard key={group.key} message={group.messages[0]!} variant="home" context={columnContext} />;
    }
    return expanded.has(group.key) ? (
      <HomeMessageGroupPanel
        key={group.key}
        group={group}
        context={columnContext}
        onCollapse={() => toggle(group.key, false)}
        autoFocus={focusRequest?.key === group.key && focusRequest.target === 'group'}
        onAutoFocused={focusHandled}
      />
    ) : (
      <HomeMessageStack
        key={group.key}
        group={group}
        context={columnContext}
        onExpand={() => toggle(group.key, true)}
        autoFocus={focusRequest?.key === group.key && focusRequest.target === 'stack'}
        onAutoFocused={focusHandled}
      />
    );
  };
  return (
    <aside className="flex min-w-0 flex-col gap-3" aria-label={t('runtimeConfig.overview.messages.title')} data-testid="home-messages">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 px-1" data-testid="home-messages-toolbar">
        <h2 className="text-xl font-semibold tracking-tight">{t('runtimeConfig.overview.messages.title')}</h2>
        <button
          type="button"
          aria-pressed={filter === 'pending'}
          onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
          className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${filter === 'pending'
            ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
            : 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-active)]'}`}
          data-testid="home-messages-pending"
        >
          {pending.known
            ? t(pending.more ? 'runtimeConfig.overview.messages.filterPendingCountMore' : 'runtimeConfig.overview.messages.filterPendingCount', { count: pending.count })
            : t('runtimeConfig.overview.messages.filterPending')}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <Button tone="ghost" size="sm" onClick={onViewAll} aria-label={t('runtimeConfig.overview.messages.viewAll')} data-testid="home-messages-view-all">
            {t('runtimeConfig.overview.messages.viewAllShort')}
          </Button>
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <IconButton
                icon={<ListFilter size={16} />}
                aria-label={t(filtered ? 'runtimeConfig.overview.messages.filtersActive' : 'runtimeConfig.overview.messages.filters')}
                title={t('runtimeConfig.overview.messages.filters')}
                className={`rounded-full ${filtered ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : ''}`}
                data-testid="home-messages-filter"
              />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-44 p-1">
              <ActionMenu
                items={(['all', 'unread', 'pending'] as const).map(quickFilterItem)}
                ariaLabel={t('runtimeConfig.overview.messages.filters')}
              />
              <div className="mx-1 my-1 border-t border-[var(--nimi-border-subtle)]" role="separator" />
              <ActionMenu
                items={(['message', 'post', 'todo'] as const).map(quickFilterItem)}
                ariaLabel={t('runtimeConfig.overview.messages.quickFilterTypeGroup')}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {filtered ? (
        <div className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--nimi-text-secondary)]" role="status">
          <span>{t(`runtimeConfig.overview.messages.quickFilters.${filter}`)}</span>
          <Button tone="ghost" size="sm" onClick={clearFilters}>{t('runtimeConfig.overview.messages.clearFilters')}</Button>
        </div>
      ) : null}

      <HomeExecutionNotices onViewAll={onViewAll} />
      <HomeMessageSourceNotices messages={messages} app={appRelevant} realm={realmRelevant} />

      <div
        ref={listRef}
        tabIndex={-1}
        aria-label={t('runtimeConfig.overview.messages.title')}
        className="flex flex-col gap-5 outline-none"
        data-testid="home-messages-list"
      >
        {groups?.map(renderGroup)}
        {!groups?.length && !loading ? (
          <EmptyHint>
            <Bell size={18} aria-hidden="true" className="text-[var(--nimi-text-muted)]" />
            <p>
              {!filtered && messages.offHomeCount > 0
                ? t('runtimeConfig.overview.messages.allHidden')
                : complete
                  ? t(filtered ? 'runtimeConfig.overview.messages.noMatches' : 'runtimeConfig.overview.messages.empty')
                  : t('runtimeConfig.overview.messages.notLoaded')}
            </p>
          </EmptyHint>
        ) : null}
        {loading ? (
          <div className="rounded-[20px] px-3.5 py-3">
            <LoadingSkeleton lines={2} label={t('Common.loading')} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
