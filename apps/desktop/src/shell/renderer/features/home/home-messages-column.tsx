import { Button, IconButton, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { ArrowRight, Bell, ListTodo, SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HomeMessageCard,
  HomeMessageGroupPanel,
  HomeMessageStack,
  type HomeMessageCardContext,
} from './home-message-card.js';
import type { HomeMessages } from './home-messages-controller.js';
import { homePreviewGroups, isPendingMessage, type HomeMessageGroup } from './home-messages-model.js';

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

function SectionLabel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h3 className="text-xs font-semibold tracking-wide text-[var(--nimi-text-secondary)]">{title}</h3>
      {children}
    </div>
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
 * Home's Messages column: a Pending strip, then two decoupled preview
 * sections — items (system, App and Runtime Agent messages) and Activity
 * (Realm agent Posts) with its own feed entry. Everything else stays
 * reachable in the Message center.
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
  // Apply each section's preview limit after partitioning so one cannot crowd out the other.
  const groups = messages.homeMessages ? {
    items: homePreviewGroups(messages.homeMessages.filter((message) => message.sourceKind !== 'realm-post')),
    posts: homePreviewGroups(messages.homeMessages.filter((message) => message.sourceKind === 'realm-post')),
  } : null;
  const itemGroups = groups?.items ?? [];
  const postGroups = groups?.posts ?? [];
  const columnContext: HomeMessageCardContext = {
    ...context,
    // A hidden card leaves the list; keep keyboard focus in the list.
    onHide: (targets) => Promise.resolve(context.onHide(targets)).then((hidden) => {
      if (hidden) listRef.current?.focus();
      return Boolean(hidden);
    }),
  };
  const pending = pendingSummary(messages);
  const hasPending = pending.known && pending.count > 0;
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

      <button
        type="button"
        onClick={onViewPending}
        className="group flex w-full items-center gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2.5 text-left shadow-[var(--nimi-elevation-base)] transition-colors hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        data-testid="home-messages-pending"
      >
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
            hasPending
              ? 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning)]'
              : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)]'
          }`}
        >
          <ListTodo size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {pending.known
            ? t(pending.more ? 'runtimeConfig.overview.messages.pendingEntryMore' : 'runtimeConfig.overview.messages.pendingEntry', { count: pending.count })
            : t('runtimeConfig.overview.messages.pendingEntryUnknown')}
        </span>
        <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-[var(--nimi-text-muted)] transition-transform group-hover:translate-x-0.5" />
      </button>

      <HomeMessageSourceNotices messages={messages} realm={false} />

      <div
        ref={listRef}
        tabIndex={-1}
        aria-label={t('runtimeConfig.overview.messages.title')}
        className="flex flex-col gap-5 outline-none"
        data-testid="home-messages-list"
      >
        <section aria-label={t('runtimeConfig.overview.messages.sectionItems')} className="flex flex-col gap-2.5" data-testid="home-messages-section-items">
          <SectionLabel title={t('runtimeConfig.overview.messages.sectionItems')} />
          {itemGroups.map(renderGroup)}
          {!itemGroups.length && !loading ? (
            <EmptyHint>
              <Bell size={18} aria-hidden="true" className="text-[var(--nimi-text-muted)]" />
              <p>
                {messages.offHomeCount > 0
                  ? t('runtimeConfig.overview.messages.allHidden')
                  : complete
                    ? t('runtimeConfig.overview.messages.emptyItems')
                    : t('runtimeConfig.overview.messages.notLoaded')}
              </p>
            </EmptyHint>
          ) : null}
        </section>

        <section aria-label={t('runtimeConfig.overview.messages.sectionActivity')} className="flex flex-col gap-2.5" data-testid="home-messages-section-activity">
          <SectionLabel title={t('runtimeConfig.overview.messages.sectionActivity')}>
            <button
              type="button"
              onClick={onViewActivity}
              className="flex items-center gap-1 rounded-md text-xs font-medium text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              data-testid="home-messages-view-activity"
            >
              {t('runtimeConfig.overview.messages.viewActivity')}
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          </SectionLabel>
          <HomeMessageSourceNotices messages={messages} app={false} preferences={false} />
          {postGroups.map(renderGroup)}
          {!postGroups.length && !loading && messages.realm.status === 'ready' ? (
            <p className="px-1 text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.overview.messages.emptyActivity')}</p>
          ) : null}
        </section>
        {loading ? (
          <div className="rounded-[20px] px-3.5 py-3">
            <LoadingSkeleton lines={2} label={t('Common.loading')} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center pt-1">
        <Button tone="secondary" size="md" onClick={onViewAll} trailingIcon={<ArrowRight size={14} />} data-testid="home-messages-view-all">
          {t('runtimeConfig.overview.messages.viewAll')}
        </Button>
      </div>
    </aside>
  );
}
