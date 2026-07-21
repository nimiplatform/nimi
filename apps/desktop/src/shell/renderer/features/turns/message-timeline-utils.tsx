import { useEffect, useState } from 'react';
import { resolveRealmChatMediaUrl } from '@nimiplatform/kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { formatLocaleDate, i18n } from '../../i18n';

type MessageViewDto = RealmModel<'MessageViewDto'>;

export function resolveMessageText(message: MessageViewDto): string {
  const text = String(message.text || '').trim();
  if (text) return text;

  const payload = message.payload as Record<string, unknown> | null;
  const payloadText = String(payload?.content || payload?.text || '').trim();
  if (payloadText) return payloadText;

  return '';
}

export function resolveImageMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  return resolveRealmChatMediaUrl(message.payload, realmBaseUrl);
}

export function resolveVideoMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  return resolveRealmChatMediaUrl(message.payload, realmBaseUrl);
}

export function ChatMessageImage(input: {
  src: string;
  alt: string;
  realmBaseUrl: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [input.src]);

  if (failed) {
    return (
      <span role="status" className="inline-flex max-w-[260px] rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground">
        {i18n.t('Chat.mediaUnavailable', { defaultValue: 'Media is unavailable through the current authorization path.' })}
      </span>
    );
  }

  return (
    <img
      src={input.src}
      alt={input.alt}
      onError={() => setFailed(true)}
      className="max-h-[320px] max-w-[260px] rounded-xl object-contain"
    />
  );
}

export function toMessageTimestamp(message: MessageViewDto): number {
  const parsed = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDateSeparator(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  const sameYear = date.getFullYear() === now.getFullYear();
  const timeStr = formatLocaleDate(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (diffDays === 0) return timeStr;
  if (diffDays === 1) {
    return `${i18n.t('Chat.yesterday', { defaultValue: 'Yesterday' })} ${timeStr}`;
  }
  if (diffDays < 7) {
    const weekday = formatLocaleDate(date, { weekday: 'long' });
    return `${weekday} ${timeStr}`;
  }
  if (sameYear) {
    const monthDay = formatLocaleDate(date, { month: 'short', day: 'numeric' });
    return `${monthDay}, ${timeStr}`;
  }

  const fullDate = formatLocaleDate(date, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${fullDate}, ${timeStr}`;
}

export function shouldShowTimestamp(currentMessage: MessageViewDto, prevMessage: MessageViewDto | null): boolean {
  if (!prevMessage) return true;

  const currentTime = toMessageTimestamp(currentMessage);
  const prevTime = toMessageTimestamp(prevMessage);
  const currentDateKey = getDateKey(currentMessage.createdAt);
  const prevDateKey = getDateKey(prevMessage.createdAt);
  if (currentDateKey !== prevDateKey) return true;

  return currentTime - prevTime > 300000;
}

function getDateKey(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export type ChatProfileSummary = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  isSource: boolean;
  isOnline: boolean;
  bio: string;
  presenceText: string;
  createdAt: string;
};

export function toChatProfileSummary(input: {
  fallback?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
}): ChatProfileSummary {
  const source = (input.profile && Object.keys(input.profile).length > 0 ? input.profile : input.fallback) || {};
  const fallback = input.fallback || {};
  const displayName = String(
    source.displayName
      || fallback.displayName
      || source.handle
      || fallback.handle
      || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
  ).trim();
  const handleValue = String(source.handle || fallback.handle || '').trim();
  return {
    id: String(source.id || fallback.id || '').trim(),
    displayName: displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
    handle: handleValue ? (handleValue.startsWith('@') ? handleValue : `@${handleValue}`) : '@unknown',
    avatarUrl: typeof source.avatarUrl === 'string'
      ? source.avatarUrl
      : typeof fallback.avatarUrl === 'string'
        ? String(fallback.avatarUrl)
        : null,
    isSource: source.isSource === true || fallback.isSource === true,
    isOnline: source.isOnline === true || fallback.isOnline === true,
    bio: String(source.bio || '').trim(),
    presenceText: String(source.presenceText || fallback.presenceText || '').trim(),
    createdAt: typeof source.createdAt === 'string'
      ? source.createdAt
      : typeof fallback.createdAt === 'string'
        ? String(fallback.createdAt)
        : '',
  };
}
