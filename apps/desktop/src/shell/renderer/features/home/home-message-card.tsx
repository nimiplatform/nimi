import { AppCardSurface, Button, ProgressIndicator, StatusBadge } from '@nimiplatform/kit/ui';
import { NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE } from '@nimiplatform/sdk/app';
import { ArrowUpCircle, ArrowUpRight, CircleAlert, Download, Play, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { isOpenable } from './home-app-activity-model.js';
import type { HomeMessageNotice } from './home-app-activity.js';
import type { HomeMessagePlacement } from './home-messages-controller.js';
import {
  isHideableMessage,
  isPendingMessage,
  type HomeMessage,
  type HomeMessageGroup,
} from './home-messages-model.js';

type Translate = ReturnType<typeof useTranslation>['t'];

export type HomeMessageCardContext = Readonly<{
  now: Date;
  /** Per activityId: an open or mark-read call in flight. */
  busy: Readonly<Record<string, 'open' | 'read'>>;
  notices: Readonly<Record<string, HomeMessageNotice>>;
  appIconUrl: (appId: string | null) => string | null;
  /** Hiding is offered only while display preferences are ready and idle. */
  canHide: boolean;
  onOpen: (message: HomeMessage) => void;
  onMarkRead: (message: HomeMessage) => void;
  /** Resolves true once the hide was saved. */
  onHide: (messages: readonly HomeMessage[]) => Promise<boolean> | void;
}>;

const CARD_CLASS = 'relative flex gap-3 rounded-[20px] px-3.5 py-3';

export function messageSourceLabel(message: HomeMessage, t: Translate): string {
  switch (message.sourceKind) {
    case 'app':
      return message.record.source.displayName || message.record.source.appId || t('runtimeConfig.overview.appActivity.unknownSource');
    case 'runtime-agent':
      return message.record.agent
        ? t('runtimeConfig.overview.messages.sourceRuntime', { name: message.record.agent.displayName })
        : t('runtimeConfig.overview.messages.sourceRuntimeUnknown');
    case 'realm-post':
      return t('runtimeConfig.overview.messages.sourceRealm', { name: message.post.authorName });
    case 'system':
      return t(`runtimeConfig.overview.messages.system.${message.system.kind}`);
  }
}

export function messageTitle(message: HomeMessage, t: Translate): string {
  switch (message.sourceKind) {
    case 'app':
    case 'runtime-agent':
      return message.sourceKind === 'runtime-agent' && message.record.type === NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE
        ? t('runtimeConfig.overview.appActivity.runtimeTurnTitle')
        : message.record.title;
    case 'realm-post':
      return t('runtimeConfig.overview.messages.postedTitle', { author: message.post.authorName });
    case 'system':
      return message.system.title;
  }
}

function messageSummary(message: HomeMessage, t: Translate): string | null {
  switch (message.sourceKind) {
    case 'app':
    case 'runtime-agent':
      return message.record.summary;
    case 'realm-post':
      if (message.post.caption) return message.post.caption;
      return message.post.media.length ? null : t('runtimeConfig.overview.messages.noCaption');
    case 'system':
      return message.system.detail || null;
  }
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Owner time as today's clock, yesterday's clock, or a date; never a delivery time. */
export function formatMessageTime(
  time: string,
  now: Date,
  i18n: Pick<DesktopI18nResource, 'formatDate'>,
  t: Translate,
): string {
  const date = new Date(time);
  const clock = i18n.formatDate(date, { hour: '2-digit', minute: '2-digit' });
  if (localDayKey(date) === localDayKey(now)) return clock;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (localDayKey(date) === localDayKey(yesterday)) return t('runtimeConfig.overview.messages.yesterdayAt', { time: clock });
  return date.getFullYear() === now.getFullYear()
    ? i18n.formatDate(date, { month: 'short', day: 'numeric' })
    : i18n.formatDate(date, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Initial({ name, tone }: { name: string; tone: 'info' | 'neutral' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-base font-semibold ${
        tone === 'info'
          ? 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]'
          : 'bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]'
      }`}
    >
      {name.trim().slice(0, 1) || '?'}
    </span>
  );
}

function SystemTile({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${
        alert
          ? 'border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning)]'
          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-status-info)]'
      }`}
    >
      {children}
    </span>
  );
}

export function MessageSourceIcon({ message, context }: { message: HomeMessage; context: HomeMessageCardContext }) {
  const { t } = useTranslation();
  switch (message.sourceKind) {
    case 'app': {
      const { appId, sourceRef } = message.record.source;
      return (
        <AppArtworkIcon
          appId={appId || sourceRef}
          displayName={messageSourceLabel(message, t)}
          iconUrl={context.appIconUrl(appId)}
          size="md"
        />
      );
    }
    case 'runtime-agent':
      return <Initial name={message.record.agent?.displayName || 'Runtime'} tone="info" />;
    case 'realm-post':
      return message.post.authorAvatarUrl ? (
        <img src={message.post.authorAvatarUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" />
      ) : (
        <Initial name={message.post.authorName} tone="info" />
      );
    case 'system':
      if (message.system.kind === 'update' && message.system.app) {
        return (
          <AppArtworkIcon
            appId={message.system.app.appId}
            displayName={message.system.app.displayName}
            iconUrl={message.system.app.iconUrl}
            size="md"
          />
        );
      }
      return message.system.kind === 'download' ? (
        <SystemTile><Download size={18} /></SystemTile>
      ) : message.system.kind === 'setup' ? (
        <SystemTile alert><CircleAlert size={18} /></SystemTile>
      ) : (
        <SystemTile><ArrowUpCircle size={18} /></SystemTile>
      );
  }
}

function StateBadges({ message }: { message: HomeMessage }) {
  const { t } = useTranslation();
  if (message.sourceKind === 'system') {
    const tone = message.system.kind === 'setup' ? 'warning' : message.system.kind === 'download' ? 'info' : 'neutral';
    return <StatusBadge tone={tone}>{t(`runtimeConfig.overview.messages.system.${message.system.kind}State`)}</StatusBadge>;
  }
  if (message.sourceKind === 'realm-post') return null;
  const { record } = message;
  return (
    <>
      {record.kind === 'todo' && record.todoState ? (
        <StatusBadge tone={record.todoState === 'completed' ? 'success' : record.todoState === 'open' ? 'info' : 'neutral'}>
          {t(`runtimeConfig.overview.appActivity.state.${record.todoState}`)}
        </StatusBadge>
      ) : null}
      {record.userView.needsAttention ? (
        <StatusBadge tone="neutral" shape="dot">{t('runtimeConfig.overview.appActivity.needsAttention')}</StatusBadge>
      ) : null}
    </>
  );
}

function openLabel(message: HomeMessage, busy: 'open' | 'read' | undefined, t: Translate): string | null {
  if (message.sourceKind === 'system') return t('runtimeConfig.overview.messages.view');
  if (message.sourceKind === 'realm-post') return t('runtimeConfig.overview.messages.viewPost');
  // Runtime summaries and records without an App source object have no target.
  if (!isOpenable(message.record)) return null;
  return t(busy === 'open' ? 'runtimeConfig.overview.appActivity.opening' : 'runtimeConfig.overview.appActivity.open');
}

function isUnread(message: HomeMessage): boolean {
  return (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent') && message.record.userView.unread;
}

function HideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute right-1.5 top-1.5 z-10 flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] group-hover/message:opacity-100 group-focus-within/message:opacity-100"
    >
      <span className="flex size-[22px] items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-base)] hover:text-[var(--nimi-text-primary)]">
        <X size={12} strokeWidth={2.5} aria-hidden="true" />
      </span>
    </button>
  );
}

function MediaThumb({ message }: { message: HomeMessage }) {
  if (message.sourceKind !== 'realm-post' || !message.post.media.length) return null;
  const [first] = message.post.media;
  const more = message.post.media.length - 1;
  return (
    <span className="relative size-11 shrink-0 self-start overflow-hidden rounded-xl bg-[var(--nimi-surface-active)]" aria-hidden="true">
      <img src={first!.url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      {first!.kind === 'VIDEO' ? (
        <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">
          <Play size={14} fill="currentColor" />
        </span>
      ) : null}
      {more > 0 ? (
        <span className="absolute bottom-0.5 right-0.5 rounded-md bg-[var(--nimi-text-primary)] px-1 text-[10px] font-medium text-[var(--nimi-text-inverse)]">
          {`+${more}`}
        </span>
      ) : null}
    </span>
  );
}

/** Owner fact time, or real download progress; nothing when the owner has neither. */
function MessageTime({ message, now }: { message: HomeMessage; now: Date }) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const progress = message.sourceKind === 'system' ? message.system.progress : null;
  if (progress && progress.max > 0) {
    return <span className="shrink-0 text-xs tabular-nums text-[var(--nimi-text-muted)]">{`${Math.floor((progress.value / progress.max) * 100)}%`}</span>;
  }
  if (!message.time) return null;
  return (
    <time dateTime={message.time} className="shrink-0 text-xs tabular-nums text-[var(--nimi-text-muted)]">
      {formatMessageTime(message.time, now, i18n, t)}
    </time>
  );
}

function MessageHeading({ message, variant, context }: {
  message: HomeMessage;
  variant: 'home' | 'center';
  context: HomeMessageCardContext;
}) {
  const { t } = useTranslation();
  const title = messageTitle(message, t);
  const unread = isUnread(message);
  const association = message.sourceKind === 'app' && message.record.agent
    ? t('runtimeConfig.overview.appActivity.withAgent', { agent: message.record.agent.displayName })
    : null;
  return (
    <>
      <p className="flex min-w-0 items-center gap-1.5 pr-6 text-xs text-[var(--nimi-text-muted)]">
        {unread ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--nimi-status-info)]" aria-hidden="true" /> : null}
        <span className="truncate">{association ? `${messageSourceLabel(message, t)} · ${association}` : messageSourceLabel(message, t)}</span>
      </p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <h3
          className={`min-w-0 flex-1 text-sm ${unread ? 'font-semibold' : 'font-medium'} ${variant === 'home' ? 'truncate' : 'break-words'}`}
          title={variant === 'home' ? title : undefined}
        >
          {unread ? <span className="sr-only">{`${t('runtimeConfig.overview.appActivity.unread')} `}</span> : null}
          {title}
        </h3>
        <MessageTime message={message} now={context.now} />
      </div>
    </>
  );
}

export function HomeMessageCard({ message, variant, context, placement, onShowOnHome, onOpenSettings }: {
  message: HomeMessage;
  variant: 'home' | 'center';
  context: HomeMessageCardContext;
  /** Center only: where the message stands relative to the Home preview. */
  placement?: HomeMessagePlacement;
  onShowOnHome?: () => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation();
  const activityId = message.sourceKind === 'app' || message.sourceKind === 'runtime-agent' ? message.record.activityId : null;
  const busy = activityId ? context.busy[activityId] : undefined;
  const notice = activityId ? context.notices[activityId] : undefined;
  const summary = messageSummary(message, t);
  const open = openLabel(message, busy, t);
  const progress = message.sourceKind === 'system' ? message.system.progress : null;
  const title = messageTitle(message, t);
  return (
    <AppCardSurface
      kind="promoted-glass"
      as="article"
      aria-label={title}
      className={`group/message ${CARD_CLASS}`}
      data-testid={`home-message:${message.key}`}
      data-unread={isUnread(message) ? 'true' : 'false'}
    >
      {variant === 'home' && context.canHide && isHideableMessage(message) ? (
        <HideButton label={t('runtimeConfig.overview.messages.hide')} onClick={() => context.onHide([message])} />
      ) : null}
      <MessageSourceIcon message={message} context={context} />
      <div className="min-w-0 flex-1">
        <MessageHeading message={message} variant={variant} context={context} />
        {summary ? (
          <p className={`mt-0.5 text-[13px] text-[var(--nimi-text-secondary)] ${variant === 'home' ? 'line-clamp-3' : 'whitespace-pre-line break-words'}`}>
            {summary}
          </p>
        ) : null}
        {progress && progress.max > 0 ? (
          <ProgressIndicator value={progress.value} max={progress.max} className="mt-2" aria-label={title} />
        ) : null}
        {message.sourceKind === 'app' && !message.record.source.available ? (
          <p className="mt-1 text-xs text-[var(--nimi-status-warning)]">
            {t('runtimeConfig.overview.appActivity.sourceUnavailable', { source: messageSourceLabel(message, t) })}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StateBadges message={message} />
          <span className="min-w-2 flex-1" />
          {isUnread(message) ? (
            <Button tone="ghost" size="sm" disabled={Boolean(busy)} onClick={() => context.onMarkRead(message)}>
              {t('runtimeConfig.overview.appActivity.markRead')}
            </Button>
          ) : null}
          {open ? (
            <Button
              tone="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => context.onOpen(message)}
              trailingIcon={message.sourceKind === 'app' ? <ArrowUpRight size={13} /> : undefined}
              className="text-[var(--nimi-action-primary-bg)]"
            >
              {open}
            </Button>
          ) : null}
        </div>
        {notice ? (
          <p
            role="status"
            className={`mt-1 text-xs ${notice.tone === 'warning' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}
          >
            {notice.text}
          </p>
        ) : null}
        {variant === 'center' && placement === 'hidden' ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.overview.messages.hiddenFromHome')}
            {onShowOnHome ? (
              <button
                type="button"
                className="rounded text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                onClick={onShowOnHome}
              >
                {t('runtimeConfig.overview.messages.showOnHome')}
              </button>
            ) : null}
          </p>
        ) : null}
        {variant === 'center' && placement === 'source-off' ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.overview.messages.sourceOffHome')}
            {onOpenSettings ? (
              <button
                type="button"
                className="rounded text-[var(--nimi-action-primary-bg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                onClick={onOpenSettings}
              >
                {t('runtimeConfig.overview.messages.settings')}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
      <MediaThumb message={message} />
    </AppCardSurface>
  );
}

/** Moves focus to the element once when a toggle replaced the focused control. */
function useFocusOnMount<T extends HTMLElement>(focus: boolean | undefined, onFocused: (() => void) | undefined) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.focus();
    onFocused?.();
    // Mount-only: later renders never steal focus.
  }, []);
  return ref;
}

/** A collapsed source group: the leading card with up to two layers behind it; clicking only expands. */
export function HomeMessageStack({ group, context, onExpand, autoFocus, onAutoFocused }: {
  group: HomeMessageGroup;
  context: HomeMessageCardContext;
  onExpand: () => void;
  /** Focus the expand control on mount (after a keyboard or pointer collapse). */
  autoFocus?: boolean;
  onAutoFocused?: () => void;
}) {
  const { t } = useTranslation();
  const expandRef = useFocusOnMount<HTMLButtonElement>(autoFocus, onAutoFocused);
  const lead = group.messages[0]!;
  const others = group.messages.length - 1;
  const label = messageSourceLabel(lead, t);
  const summary = messageSummary(lead, t);
  const hideable = context.canHide && group.messages.every(isHideableMessage);
  const pending = group.sourceKind !== 'system' && group.messages.some(isPendingMessage);
  return (
    <div className="relative pb-3" data-testid={`home-message-stack:${group.key}`}>
      {/* Layers only peek out below the glass card, so nothing shows through it. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-2.5 bottom-1.5 h-1.5 rounded-b-[14px] border border-t-0 border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card-promoted-glass-elevated)] shadow-[var(--nimi-elevation-base)]"
      />
      {others > 1 ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-5 bottom-0 h-1.5 rounded-b-[12px] border border-t-0 border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card-promoted-glass-elevated)] opacity-80 shadow-[var(--nimi-elevation-base)]"
        />
      ) : null}
      <AppCardSurface kind="promoted-glass" as="article" aria-label={label} className="group/message relative rounded-[20px]">
        {hideable ? (
          <HideButton
            label={t('runtimeConfig.overview.messages.hideGroup', { count: group.messages.length })}
            onClick={() => context.onHide(group.messages)}
          />
        ) : null}
        <button
          ref={expandRef}
          type="button"
          aria-expanded={false}
          onClick={onExpand}
          className="flex w-full gap-3 rounded-[20px] px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          <MessageSourceIcon message={lead} context={context} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 pr-6 text-xs text-[var(--nimi-text-muted)]">
              {group.messages.some(isUnread) ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--nimi-status-info)]" aria-hidden="true" /> : null}
              <span className="truncate">{label}</span>
              {pending ? <StatusBadge tone="info">{t('runtimeConfig.overview.appActivity.state.open')}</StatusBadge> : null}
            </span>
            <span className="mt-0.5 flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{messageTitle(lead, t)}</span>
              <MessageTime message={lead} now={context.now} />
            </span>
            {summary ? <span className="mt-0.5 line-clamp-2 block text-[13px] text-[var(--nimi-text-secondary)]">{summary}</span> : null}
            <span className="mt-1.5 block text-xs font-medium text-[var(--nimi-action-primary-bg)]">
              {t('runtimeConfig.overview.messages.moreInGroup', { count: others })}
            </span>
          </span>
        </button>
      </AppCardSurface>
    </div>
  );
}

/** An expanded source group with its header, collapse and group hide actions. */
export function HomeMessageGroupPanel({ group, context, onCollapse, autoFocus, onAutoFocused }: {
  group: HomeMessageGroup;
  context: HomeMessageCardContext;
  onCollapse: () => void;
  /** Focus the collapse control on mount (after the group was expanded). */
  autoFocus?: boolean;
  onAutoFocused?: () => void;
}) {
  const { t } = useTranslation();
  const collapseRef = useFocusOnMount<HTMLButtonElement>(autoFocus, onAutoFocused);
  const label = messageSourceLabel(group.messages[0]!, t);
  const hideable = context.canHide && group.messages.every(isHideableMessage);
  return (
    <section aria-label={label} className="flex flex-col gap-2.5" data-testid={`home-message-group:${group.key}`}>
      <div className="flex flex-wrap items-center gap-1 px-1">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</h3>
        <Button ref={collapseRef} tone="ghost" size="sm" aria-expanded onClick={onCollapse}>
          {t('runtimeConfig.overview.messages.collapse')}
        </Button>
        {hideable ? (
          <Button tone="ghost" size="sm" onClick={() => context.onHide(group.messages)}>
            {t('runtimeConfig.overview.messages.hideGroup', { count: group.messages.length })}
          </Button>
        ) : null}
      </div>
      {group.messages.map((message) => (
        <HomeMessageCard key={message.key} message={message} variant="home" context={context} />
      ))}
    </section>
  );
}
