import { HomeExecutionNotices, type ExecutionNoticeAppArtworkResolver } from './execution-notices.js';
import { Button, LoadingSkeleton, PillTabs } from '@nimiplatform/kit/ui';
import { ArrowLeft, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { HomeMessageCard, type HomeMessageCardContext } from './home-message-card.js';
import { HomeMessageSourceFilter, messageSourceOptions } from './home-message-source-filter.js';
import type { HomeMessages } from './home-messages-controller.js';
import { HomeMessageSourceNotices, pendingSummary } from './home-messages-column.js';
import {
  filterCenterMessages,
  messageDomainOfGroup,
  type HomeMessageFilter,
} from './home-messages-model.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r036
/**
 * The full-width Message center inside Home. It lists every loaded message
 * (Home hiding and source display choices do not apply), continues each
 * owner's listing separately, and claims an empty or complete result only
 * once the relevant listing is complete.
 */
export function HomeMessageCenter({ messages, context, filter, sourceKey, onFilterChange, onSourceChange, onBack, onOpenSettings, appArtworkForNotice }: {
  messages: HomeMessages;
  context: HomeMessageCardContext;
  appArtworkForNotice?: ExecutionNoticeAppArtworkResolver;
  filter: HomeMessageFilter;
  sourceKey: string | null;
  onFilterChange: (filter: HomeMessageFilter) => void;
  onSourceChange: (sourceKey: string | null) => void;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const sourceOptions = messageSourceOptions(messages.messages, t);
  const list = filterCenterMessages(messages.messages, filter, sourceKey);
  const [visibleLimit, setVisibleLimit] = useState(100);
  const pending = pendingSummary(messages, sourceKey);
  const domain = messageDomainOfGroup(sourceKey);
  const appView = filter === 'pending' ? messages.app.pending : messages.app.recent;
  // Runtime summaries are never pending.
  const appRelevant = domain === null || domain === 'app' || (domain === 'runtime-agent' && filter !== 'pending');
  const realmRelevant = domain === null || domain === 'realm';
  const realmNotificationsRelevant = realmRelevant && filter !== 'pending';
  const systemSources = filter === 'all'
    ? messages.systemSources.filter(source => !sourceKey || sourceKey === `system:${source.kind}`)
    : [];
  const incomplete = systemSources.some(source => source.status !== 'ready')
    || appRelevant && !appView.complete || realmRelevant && !messages.realm.requests.complete
    || realmNotificationsRelevant && !messages.realm.notifications.complete;
  const loading = !list.length && (systemSources.some(source => source.status === 'loading')
    || appRelevant && appView.status === 'loading' || realmRelevant && messages.realm.requests.loading
    || realmNotificationsRelevant && messages.realm.notifications.loading);
  const canLoadApp = appRelevant && appView.hasMore;
  const canLoadRequests = realmRelevant && messages.realm.requests.hasMore;
  const canLoadNotifications = realmNotificationsRelevant && messages.realm.notifications.hasMore;
  const canLoadMore = list.length > visibleLimit || canLoadApp || canLoadRequests || canLoadNotifications;
  const loadingMore = appRelevant && appView.status === 'loading' || messages.realm.requests.loadingMore || messages.realm.notifications.loadingMore;
  return (
    <section className="mx-auto flex w-full max-w-[1060px] flex-col gap-4 pb-6" aria-labelledby="home-message-center-title" data-testid="home-message-center">
      <div>
        <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={14} />} onClick={onBack} data-testid="home-message-center-back">
          {t('runtimeConfig.overview.messages.back')}
        </Button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="home-message-center-title" className="text-[28px] font-semibold leading-tight tracking-tight">
            {t('runtimeConfig.overview.messages.centerTitle')}
          </h1>
        </div>
        <Button tone="secondary" size="sm" onClick={onOpenSettings}>{t('runtimeConfig.overview.messages.settings')}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--nimi-border-subtle)] pb-4">
        <PillTabs
          ariaLabel={t('runtimeConfig.overview.messages.filterLabel')}
          size="sm"
          value={filter}
          onValueChange={(value) => onFilterChange(value as HomeMessageFilter)}
          items={[
            { value: 'all', label: t('runtimeConfig.overview.messages.filterAll') },
            { value: 'unread', label: t('runtimeConfig.overview.messages.filterUnread') },
            {
              value: 'pending',
              label: pending.known
                ? t(pending.more ? 'runtimeConfig.overview.messages.filterPendingCountMore' : 'runtimeConfig.overview.messages.filterPendingCount', { count: pending.count })
                : t('runtimeConfig.overview.messages.filterPending'),
            },
          ]}
        />
        <HomeMessageSourceFilter options={sourceOptions} value={sourceKey} onChange={onSourceChange} appIconUrl={context.appIconUrl} />
      </div>

      <HomeExecutionNotices appArtworkFor={appArtworkForNotice} />
      <HomeMessageSourceNotices messages={messages} app={appRelevant} realm={realmRelevant} systemSources={systemSources} />

      <div className="flex flex-col gap-2.5" data-testid="home-message-center-list">
        {list.slice(0, visibleLimit).map((message) => (
          <HomeMessageCard
            key={message.key}
            message={message}
            variant="center"
            context={context}
            placement={messages.placement(message)}
            onShowOnHome={messages.preferences.state.status === 'ready' && !messages.preferences.saving
              ? () => messages.showOnHome(message)
              : undefined}
            onOpenSettings={onOpenSettings}
          />
        ))}
        {loading ? <LoadingSkeleton lines={2} label={t('Common.loading')} className="px-3.5 py-3" /> : null}
        {!list.length && !loading ? (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-[var(--nimi-text-secondary)]" data-testid="home-message-center-empty">
            <Inbox size={20} aria-hidden="true" className="text-[var(--nimi-text-muted)]" />
            {incomplete
              ? t('runtimeConfig.overview.messages.notLoaded')
              : filter === 'pending'
                ? t('runtimeConfig.overview.messages.pendingEmpty')
                : filter === 'unread' ? t('runtimeConfig.overview.messages.unreadEmpty')
                  : t('runtimeConfig.overview.messages.empty')}
          </div>
        ) : null}
      </div>

      {incomplete && list.length > 0 ? <p className="text-center text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.messages.partialListing')}</p> : null}
      {canLoadMore ? <div className="flex justify-center">
        <Button tone="secondary" size="sm" loading={loadingMore} onClick={() => {
          if (list.length > visibleLimit) { setVisibleLimit(limit => limit + 100); return; }
          if (canLoadApp) messages.app.loadMore(filter === 'pending' ? 'pending' : 'recent');
          if (canLoadNotifications) messages.realm.notifications.loadMore();
          if (canLoadRequests) messages.realm.requests.loadMore();
        }} data-testid="home-message-center-more">{t('Relationship.contacts.loadMore')}</Button>
      </div> : null}
    </section>
  );
}
