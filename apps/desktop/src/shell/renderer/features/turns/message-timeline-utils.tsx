import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useEffect, useState } from 'react';
import { resolveRealmChatMediaUrl } from '@nimiplatform/kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';

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
  const i18n = useDesktopI18nResource().instance;
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
  isOnline: boolean;
  bio: string;
  presenceText: string;
  createdAt: string;
};

export function toChatProfileSummary(input: {
  fallback?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  i18n: DesktopI18nResource;
}): ChatProfileSummary {
  const source = (input.profile && Object.keys(input.profile).length > 0 ? input.profile : input.fallback) || {};
  const fallback = input.fallback || {};
  const displayName = String(
    source.displayName
      || fallback.displayName
      || source.handle
      || fallback.handle
      || input.i18n.instance.t('Common.unknown', { defaultValue: 'Unknown' }),
  ).trim();
  const handleValue = String(source.handle || fallback.handle || '').trim();
  return {
    id: String(source.id || fallback.id || '').trim(),
    displayName: displayName || input.i18n.instance.t('Common.unknown', { defaultValue: 'Unknown' }),
    handle: handleValue ? (handleValue.startsWith('@') ? handleValue : `@${handleValue}`) : '@unknown',
    avatarUrl: typeof source.avatarUrl === 'string'
      ? source.avatarUrl
      : typeof fallback.avatarUrl === 'string'
        ? String(fallback.avatarUrl)
        : null,
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
