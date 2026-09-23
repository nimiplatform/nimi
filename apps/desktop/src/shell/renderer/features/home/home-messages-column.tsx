import { Button, IconButton, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { ArrowRight, Bell, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HomeMessageCard,
  HomeMessageGroupPanel,
  HomeMessageStack,
  type HomeMessageCardContext,
} from './home-message-card.js';
import type { HomeMessages } from './home-messages-controller.js';
import { homePreviewGroups, isPendingMessage } from './home-messages-model.js';

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
export function HomeMessageSourceNotices({ messages, app = true, realm = true }: {
  messages: HomeMessages;
  app?: boolean;
  realm?: boolean;
}) {
  const { t } = useTranslation();
  const { preferences } = messages;
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
      {preferences.state.status === 'unavailable' ? (
        <InlineAlert
          tone="warning"
          action={retry(preferences.reload, t('runtimeConfig.overview.messages.reload'))}
          data-testid="home-messages-preferences-unavailable"
        >
          {t('runtimeConfig.overview.messages.preferencesUnavailable')}
        </InlineAlert>
      ) : null}
      {preferences.saveFailed ? (
        <InlineAlert tone="warning" action={retry(preferences.retrySave)} data-testid="home-messages-save-failed">
          <p className="font-medium">{t('runtimeConfig.overview.messages.saveFailed')}</p>
          <p>{t('runtimeConfig.overview.messages.saveFailedBody')}</p>
        </InlineAlert>
      ) : null}
    </>
  );
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
/**
 * Home's Messages column: system items, then up to five source groups as
 * stacks. Everything else stays reachable in the Message center.
 */
export function HomeMessagesColumn({ messages, context, onViewAll, onViewPending, onViewActivity, onOpenSettings }: {
  messages: HomeMessages;
  context: HomeMessageCardContext;
  onViewAll: () => void;
  onViewPending: () => void;
  onViewActivity: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Expanding or collapsing replaces the focused control; focus follows it.
  const [focusRequest, setFocusRequest] = useState<Readonly<{ key: string; target: 'group' | 'stack' }> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = messages.homeMessages ? homePreviewGroups(messages.homeMessages) : null;
  const columnContext: HomeMessageCardContext = {
    ...context,
    // A hidden card leaves the list; keep keyboard focus in the list.
    onHide: (targets) => Promise.resolve(context.onHide(targets)).then((hidden) => {
      if (hidden) listRef.current?.focus();
      return Boolean(hidden);
    }),
  };
  const pending = pendingSummary(messages);
  const loading = !groups || appLoading(messages) || messages.realm.status === 'loading';
  const complete = messages.app.pending.complete && messages.app.recent.complete
    && messages.realm.status === 'ready' && !messages.realm.hasMore;
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
  return (
    <aside className="flex min-w-0 flex-col gap-3" aria-label={t('runtimeConfig.overview.messages.title')} data-testid="home-messages">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('runtimeConfig.overview.messages.title')}</h2>
        <IconButton
          icon={<SlidersHorizontal size={16} />}
          aria-label={t('runtimeConfig.overview.messages.settings')}
          title={t('runtimeConfig.overview.messages.settings')}
          onClick={onOpenSettings}
          className="rounded-full"
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <button
          type="button"
          onClick={onViewPending}
          className="flex items-center gap-1 rounded-md text-sm font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          data-testid="home-messages-pending"
        >
          {pending.known
            ? t(pending.more ? 'runtimeConfig.overview.messages.pendingEntryMore' : 'runtimeConfig.overview.messages.pendingEntry', { count: pending.count })
            : t('runtimeConfig.overview.messages.pendingEntryUnknown')}
          <ArrowRight size={13} aria-hidden="true" />
        </button>
        <span className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.overview.messages.subtitle')}</span>
      </div>

      <HomeMessageSourceNotices messages={messages} />

      <div
        ref={listRef}
        tabIndex={-1}
        aria-label={t('runtimeConfig.overview.messages.title')}
        className="flex flex-col gap-2.5 rounded-[20px] outline-none"
        data-testid="home-messages-list"
      >
        {groups?.map((group) => {
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
        })}
        {groups && !groups.length && !loading ? (
          <div className="flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-[var(--nimi-border-subtle)] px-4 py-6 text-center text-sm text-[var(--nimi-text-secondary)]">
            <Bell size={18} aria-hidden="true" className="text-[var(--nimi-text-muted)]" />
            <p>
              {messages.offHomeCount > 0
                ? t('runtimeConfig.overview.messages.allHidden')
                : complete
                  ? t('runtimeConfig.overview.messages.empty')
                  : t('runtimeConfig.overview.messages.notLoaded')}
            </p>
          </div>
        ) : null}
        {loading ? (
          <div className="rounded-[20px] px-3.5 py-3">
            <LoadingSkeleton lines={2} label={t('Common.loading')} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-2 pt-1">
        <Button tone="secondary" size="md" onClick={onViewAll} trailingIcon={<ArrowRight size={14} />} data-testid="home-messages-view-all">
          {t('runtimeConfig.overview.messages.viewAll')}
        </Button>
        <Button tone="ghost" size="sm" onClick={onViewActivity} trailingIcon={<ArrowRight size={13} />} data-testid="home-messages-view-activity">
          {t('runtimeConfig.overview.messages.viewActivity')}
        </Button>
      </div>
    </aside>
  );
}
