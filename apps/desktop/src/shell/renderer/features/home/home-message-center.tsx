import { Button, LoadingSkeleton, PillTabs, SelectField } from '@nimiplatform/kit/ui';
import { ArrowLeft, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HomeMessageCard, messageSourceLabel, type HomeMessageCardContext } from './home-message-card.js';
import type { HomeMessages } from './home-messages-controller.js';
import { HomeMessageSourceNotices, pendingSummary } from './home-messages-column.js';
import {
  filterCenterMessages,
  groupMessages,
  messageDomainOfGroup,
  type HomeMessage,
  type HomeMessageFilter,
} from './home-messages-model.js';

const ALL_SOURCES = 'all';

type Translate = ReturnType<typeof useTranslation>['t'];

/** One option per loaded source group; same-named registrations stay distinguishable. */
export function messageSourceOptions(messages: readonly HomeMessage[], t: Translate) {
  const options = groupMessages(messages).map((group) => {
    const lead = group.messages[0]!;
    return {
      value: group.key,
      label: messageSourceLabel(lead, t),
      unavailable: lead.sourceKind === 'app' && !lead.record.source.available,
    };
  });
  const seen = new Map<string, number>();
  return options
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value))
    .map((option) => {
      const index = (seen.get(option.label) ?? 0) + 1;
      seen.set(option.label, index);
      const duplicate = options.filter((other) => other.label === option.label).length > 1;
      if (!duplicate) return { value: option.value, label: option.label };
      return {
        value: option.value,
        label: option.unavailable
          ? t('runtimeConfig.overview.messages.sourceUnavailableOption', { source: option.label })
          : t('runtimeConfig.overview.messages.sourceNumberedOption', { source: option.label, index }),
      };
    });
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r036
/**
 * The full-width Message center inside Home. It lists every loaded message
 * (Home hiding and source display choices do not apply), continues each
 * owner's listing separately, and claims an empty or complete result only
 * once the relevant listing is complete.
 */
export function HomeMessageCenter({ messages, context, filter, sourceKey, onFilterChange, onSourceChange, onBack, onOpenSettings }: {
  messages: HomeMessages;
  context: HomeMessageCardContext;
  filter: HomeMessageFilter;
  sourceKey: string | null;
  onFilterChange: (filter: HomeMessageFilter) => void;
  onSourceChange: (sourceKey: string | null) => void;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const sourceOptions = messageSourceOptions(messages.messages, t);
  const selectedSource = sourceKey && sourceOptions.some((option) => option.value === sourceKey) ? sourceKey : null;
  const list = filterCenterMessages(messages.messages, filter, selectedSource);
  const pending = pendingSummary(messages);
  const domain = messageDomainOfGroup(selectedSource);
  const appView = filter === 'pending' ? messages.app.pending : messages.app.recent;
  // Runtime summaries are never pending; the Realm feed never holds pending items.
  const appRelevant = domain === null || domain === 'app' || (domain === 'runtime-agent' && filter === 'all');
  const realmRelevant = filter === 'all' && (domain === null || domain === 'realm-post');
  const appIncomplete = appRelevant && !appView.complete;
  const realmIncomplete = realmRelevant && (messages.realm.status !== 'ready' || messages.realm.hasMore);
  const loading = (appRelevant && appView.status === 'loading' && !appView.records.length)
    || (realmRelevant && messages.realm.status === 'loading');
  const canLoadApp = appRelevant && appView.hasMore;
  const canLoadRealm = realmRelevant && messages.realm.hasMore;
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
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.messages.centerSubtitle')}</p>
        </div>
        <Button tone="secondary" size="sm" onClick={onOpenSettings}>{t('runtimeConfig.overview.messages.settings')}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--nimi-border-subtle)] pb-4">
        <PillTabs
          ariaLabel={t('runtimeConfig.overview.messages.filterLabel')}
          size="sm"
          value={filter}
          onValueChange={(value) => onFilterChange(value === 'pending' ? 'pending' : 'all')}
          items={[
            { value: 'all', label: t('runtimeConfig.overview.messages.filterAll') },
            {
              value: 'pending',
              label: pending.known
                ? t(pending.more ? 'runtimeConfig.overview.messages.filterPendingCountMore' : 'runtimeConfig.overview.messages.filterPendingCount', { count: pending.count })
                : t('runtimeConfig.overview.messages.filterPending'),
            },
          ]}
        />
        <SelectField
          aria-label={t('runtimeConfig.overview.messages.sourceFilterLabel')}
          className="w-full sm:w-64"
          value={selectedSource ?? ALL_SOURCES}
          onValueChange={(value) => onSourceChange(value === ALL_SOURCES ? null : value)}
          options={[{ value: ALL_SOURCES, label: t('runtimeConfig.overview.messages.allSources') }, ...sourceOptions]}
          data-testid="home-message-center-source"
        />
      </div>

      <HomeMessageSourceNotices messages={messages} app={appRelevant} realm={realmRelevant} />

      <div className="flex flex-col gap-2.5" data-testid="home-message-center-list">
        {list.map((message) => (
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
            {appIncomplete || realmIncomplete
              ? t('runtimeConfig.overview.messages.notLoaded')
              : filter === 'pending'
                ? t('runtimeConfig.overview.messages.pendingEmpty')
                : t('runtimeConfig.overview.messages.empty')}
          </div>
        ) : null}
      </div>

      {canLoadApp || canLoadRealm ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap justify-center gap-2">
            {canLoadApp ? (
              <Button tone="secondary" size="sm" onClick={() => messages.app.loadMore(filter === 'pending' ? 'pending' : 'recent')} data-testid="home-message-center-more-app">
                {t('runtimeConfig.overview.messages.loadMoreApp')}
              </Button>
            ) : null}
            {canLoadRealm ? (
              <Button
                tone="secondary"
                size="sm"
                loading={messages.realm.loadingMore}
                onClick={messages.realm.loadMore}
                data-testid="home-message-center-more-posts"
              >
                {t('runtimeConfig.overview.messages.loadMorePosts')}
              </Button>
            ) : null}
          </div>
          {canLoadRealm && messages.realm.loadMoreFailed ? (
            <p role="status" className="text-xs text-[var(--nimi-status-warning)]">{t('runtimeConfig.overview.messages.loadMoreFailed')}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
