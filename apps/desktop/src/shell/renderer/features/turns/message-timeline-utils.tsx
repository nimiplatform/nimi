import { useEffect, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { formatLocaleDate, i18n } from '@renderer/i18n';
import { resolveCanonicalChatMediaUrl } from './chat-media-contract.js';

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
  return resolveCanonicalChatMediaUrl(message.payload, realmBaseUrl);
}

export function resolveVideoMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  return resolveCanonicalChatMediaUrl(message.payload, realmBaseUrl);
}

export function ChatMessageImage(input: {
  src: string;
  alt: string;
  realmBaseUrl: string;
  authToken: string;
}) {
  const [resolvedSrc, setResolvedSrc] = useState(input.src);

  useEffect(() => {
    setResolvedSrc(input.src);
    const normalizedSrc = String(input.src || '').trim();
    const normalizedBase = String(input.realmBaseUrl || '').trim().replace(/\/$/, '');
    const token = String(input.authToken || '').trim();
    if (!normalizedSrc || !normalizedBase || !token || !normalizedSrc.startsWith(`${normalizedBase}/`)) {
      return;
    }

    let revokedUrl = '';
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch(normalizedSrc, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        revokedUrl = URL.createObjectURL(blob);
        setResolvedSrc(revokedUrl);
      } catch {
        // Keep original URL fallback when authenticated fetch is unavailable.
      }
    };
    void run();

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [input.src, input.realmBaseUrl, input.authToken]);

  return (
    <img
      src={resolvedSrc}
      alt={input.alt}
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
  isAgent: boolean;
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
    isAgent: source.isAgent === true || fallback.isAgent === true,
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
