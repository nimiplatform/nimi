import { HomeExecutionNotices, type ExecutionNoticeAppArtworkResolver } from './execution-notices.js';
import { ActionMenu, AppCardSurface, Button, IconButton, InlineAlert, LoadingSkeleton, Popover, PopoverContent, PopoverTrigger, ScrollArea, Tooltip, type NimiMenuItem } from '@nimiplatform/kit/ui';
import { Bell, Check, ListFilter } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HomeMessageCard,
  HomeMessageGroupPanel,
  HomeMessageStack,
  type HomeMessageCardContext,
} from './home-message-card.js';
import type { HomeMessages, HomeSystemListing } from './home-messages-controller.js';
import { filterTimelineMessages, homePreviewGroups, isPendingMessage, messageCenterSourceKey, messageDomainOfGroup, quickFilterSelection, type HomeMessageGroup, type HomeTimelineQuickFilter } from './home-messages-model.js';

/** Loaded pending items; `more` while the open-todo listing is still incomplete. */
export function pendingSummary(messages: HomeMessages, sourceKey: string | null = null): Readonly<{ count: number; more: boolean; known: boolean }> {
  const pending = messages.app.pending;
  const domain = messageDomainOfGroup(sourceKey);
  const count = messages.messages.filter(message => isPendingMessage(message) && (!sourceKey || messageCenterSourceKey(message) === sourceKey)).length;
  const complete = (domain !== null && domain !== 'app' || pending.complete)
    && (domain !== null && domain !== 'realm' || messages.realm.requests.complete)
    && messages.systemSources.filter(source => source.kind === 'access' && (!sourceKey || sourceKey === 'system:access')).every(source => source.status === 'ready');
  return { count, more: !complete, known: complete || count > 0 };
}

function appLoading(messages: HomeMessages): boolean {
  const { pending, recent } = messages.app;
  return (pending.status === 'loading' || recent.status === 'loading' || messages.realm.notifications.loading || messages.realm.requests.loading) && !messages.messages.length;
}

/** Source-local read problems; each keeps the other sources usable. */
export function HomeMessageSourceNotices({ messages, systemSources, app = true, realm = true, preferences = true }: {
  messages: HomeMessages;
  systemSources: readonly HomeSystemListing[];
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
      {systemSources.filter(source => source.status === 'unavailable').map(source => (
        <InlineAlert key={source.kind} tone="warning" action={source.retry && retry(source.retry)}>
          {t(`runtimeConfig.overview.messages.system.${source.kind}Unavailable`)}
        </InlineAlert>
      ))}
      {realm && messages.realm.notifications.failed ? <InlineAlert tone="warning" action={retry(messages.realm.notifications.retry)}>{t('runtimeConfig.overview.messages.realmUnavailable')}</InlineAlert> : null}
      {realm && messages.realm.requests.failed ? <InlineAlert tone="warning" action={retry(messages.realm.requests.retry)}>{t('runtimeConfig.overview.messages.requestsUnavailable')}</InlineAlert> : null}
      {app && (messages.app.pending.status === 'unavailable' || messages.app.recent.status === 'unavailable') ? (
        <InlineAlert tone="warning" action={retry(messages.app.retry)} data-testid="home-messages-app-unavailable">
          <p className="font-medium">{t('runtimeConfig.overview.messages.appUnavailable')}</p>
          <p>{t('runtimeConfig.overview.messages.otherSourcesShown')}</p>
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

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
/**
 * One bounded timeline with its navigation and local filters above the list.
 * Source-owned state and the complete Message center remain independent.
 */
export function HomeMessagesColumn({ messages, context, onViewAll, appArtworkForNotice, variant = 'card', initialFilter = 'all' }: {
  messages: HomeMessages;
  context: HomeMessageCardContext;
  onViewAll: () => void;
  appArtworkForNotice?: ExecutionNoticeAppArtworkResolver;
  variant?: 'card' | 'drawer';
  initialFilter?: HomeTimelineQuickFilter;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HomeTimelineQuickFilter>(initialFilter);
  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);
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
  const systemSources = messages.systemSources.filter(source => status !== 'unread' && (source.kind === 'access' ? type !== 'message' : status === 'all' && type !== 'todo'));
  const loading = !groups || appLoading(messages)
    || (!groups.length && systemSources.some(source => source.status === 'loading'));
  const appComplete = status === 'pending' ? messages.app.pending.complete
    : type === 'message' ? messages.app.recent.complete
    : messages.app.pending.complete && messages.app.recent.complete;
  const complete = appComplete && messages.realm.requests.complete
    && (status === 'pending' || messages.realm.notifications.complete)
    && systemSources.every(source => source.status === 'ready');
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
  const quiet = !filtered && !loading && complete && groups?.length === 0
    && messages.offHomeCount === 0 && pending.known && pending.count === 0
    && messages.preferences.state.status === 'ready' && !messages.preferences.saveFailed;
  const isDrawer = variant === 'drawer';

  const body = (
    <>
      <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="home-messages-toolbar">
        {!isDrawer ? (
          <h2 className={`text-base font-semibold ${quiet ? 'sr-only group-has-[.home-message-notices:not(:empty)]/messages:not-sr-only' : ''}`}>
            {t('runtimeConfig.overview.messages.title')}
          </h2>
        ) : null}
        {isDrawer ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
                filter === 'all'
                  ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-surface-card)]'
                  : 'bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)]'
              }`}
            >
              {t('runtimeConfig.overview.messages.filterAll')}
            </button>
            <button
              type="button"
              aria-pressed={filter === 'pending'}
              onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
              className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
                filter === 'pending'
                  ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-surface-card)]'
                  : pending.count > 0
                    ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]'
                    : 'bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)]'
              }`}
              data-testid="home-messages-pending"
            >
              {pending.known
                ? t(pending.more ? 'runtimeConfig.overview.messages.filterPendingCountMore' : 'runtimeConfig.overview.messages.filterPendingCount', { count: pending.count })
                : t('runtimeConfig.overview.messages.filterPending')}
            </button>
            <button
              type="button"
              aria-pressed={filter === 'unread'}
              onClick={() => setFilter(filter === 'unread' ? 'all' : 'unread')}
              className={`rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
                filter === 'unread'
                  ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-surface-card)]'
                  : 'bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)]'
              }`}
            >
              {t('runtimeConfig.overview.messages.filterUnread')}
            </button>
          </div>
        ) : quiet ? (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)] group-has-[.home-message-notices:not(:empty)]/messages:hidden">
            <Bell size={15} aria-hidden="true" />{t('runtimeConfig.overview.messages.empty')}
          </span>
        ) : (
          <button
            type="button"
            aria-pressed={filter === 'pending'}
            onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
            className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${filter === 'pending'
              ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
              : pending.count > 0 ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]' : 'bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)]'}`}
            data-testid="home-messages-pending"
          >
            {pending.known
              ? t(pending.more ? 'runtimeConfig.overview.messages.filterPendingCountMore' : 'runtimeConfig.overview.messages.filterPendingCount', { count: pending.count })
              : t('runtimeConfig.overview.messages.filterPending')}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!isDrawer ? (
            <Button tone="ghost" size="sm" onClick={onViewAll} data-testid="home-messages-view-all">
              {t('runtimeConfig.overview.messages.viewAll')}
            </Button>
          ) : null}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <Tooltip content={t('runtimeConfig.overview.messages.filters')} placement="top">
              <PopoverTrigger asChild>
                <IconButton
                  icon={<ListFilter size={16} />}
                  aria-label={t(filtered ? 'runtimeConfig.overview.messages.filtersActive' : 'runtimeConfig.overview.messages.filters')}
                  className={`rounded-full ${filtered ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-home-soft-well)] hover:bg-[var(--nimi-home-soft-well-hover)]'}`}
                  data-testid="home-messages-filter"
                />
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent align="end" sideOffset={8} className="w-44 rounded-2xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-1 shadow-[var(--nimi-home-porcelain-pill-shadow)]!">
              <ActionMenu
                items={(['all', 'unread', 'pending'] as const).map(quickFilterItem)}
                ariaLabel={t('runtimeConfig.overview.messages.filters')}
              />
              <div className="mx-2 my-1 h-px bg-[var(--nimi-home-soft-well)]" role="separator" />
              <ActionMenu
                items={(['message', 'todo'] as const).map(quickFilterItem)}
                ariaLabel={t('runtimeConfig.overview.messages.quickFilterTypeGroup')}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <ScrollArea className={isDrawer ? 'min-h-0 flex-1 min-w-0' : 'min-w-0 lg:max-h-[50vh]'} contentClassName="flex flex-col gap-3">
        {filtered ? (
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--nimi-text-secondary)]" role="status">
            <span>{t(`runtimeConfig.overview.messages.quickFilters.${filter}`)}</span>
            <Button tone="ghost" size="sm" onClick={clearFilters}>{t('runtimeConfig.overview.messages.clearFilters')}</Button>
          </div>
        ) : null}

        <div className="home-message-notices flex flex-col gap-3 empty:hidden">
          <HomeExecutionNotices appArtworkFor={appArtworkForNotice} />
          <HomeMessageSourceNotices messages={messages} systemSources={systemSources} />
        </div>

        <div
          ref={listRef}
          tabIndex={-1}
          aria-label={t('runtimeConfig.overview.messages.title')}
          className="flex flex-col gap-3 outline-none"
          data-testid="home-messages-list"
        >
          {groups?.map(renderGroup)}
          {isDrawer && quiet ? (
            <div className="rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-10 text-center text-xs text-[var(--nimi-text-secondary)] group-has-[.home-message-notices:not(:empty)]/messages:hidden">
              {t('runtimeConfig.overview.messages.empty')}
            </div>
          ) : null}
          {!quiet && !groups?.length && !loading ? (
            <p className="rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-6 text-center text-xs text-[var(--nimi-text-secondary)]">
              {!filtered && messages.offHomeCount > 0
                ? t('runtimeConfig.overview.messages.allHidden')
                : complete
                  ? t(filtered ? 'runtimeConfig.overview.messages.noMatches' : 'runtimeConfig.overview.messages.empty')
                  : t('runtimeConfig.overview.messages.notLoaded')}
            </p>
          ) : null}
          {loading ? (
            <div className="rounded-2xl bg-[var(--nimi-home-soft-well)] px-3.5 py-3">
              <LoadingSkeleton lines={2} label={t('Common.loading')} />
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </>
  );

  if (isDrawer) {
    return (
      <div
        className="group/messages flex min-h-0 flex-1 min-w-0 flex-col gap-3"
        aria-label={t('runtimeConfig.overview.messages.title')}
        data-testid="home-messages"
      >
        {body}
      </div>
    );
  }

  return (
    <AppCardSurface
      as="aside"
      kind="operational-solid"
      className="group/messages flex min-w-0 flex-col gap-2 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! px-5 py-4 shadow-[var(--nimi-home-porcelain-shadow)]!"
      aria-label={t('runtimeConfig.overview.messages.title')}
      data-testid="home-messages"
    >
      {body}
    </AppCardSurface>
  );
}
