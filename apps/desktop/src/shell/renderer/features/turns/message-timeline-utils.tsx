import { useEffect, useState } from 'react';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';
import { formatLocaleDate, i18n } from '@renderer/i18n';

export function resolveMessageText(message: MessageViewDto): string {
  const text = String(message.text || '').trim();
  if (text) return text;

  const payload = message.payload as Record<string, unknown> | null;
  const payloadText = String(payload?.content || payload?.text || '').trim();
  if (payloadText) return payloadText;

  return '';
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveMediaUrl(
  payload: Record<string, unknown> | null,
  realmBaseUrl: string,
  keys: string[],
): string {
  if (!payload) {
    return '';
  }
  for (const key of keys) {
    const value = String(payload[key] || '').trim();
    if (!value) {
      continue;
    }
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    if (value.startsWith('/')) {
      return `${realmBaseUrl}${value}`;
    }
  }
  return '';
}

export function resolveImageMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  const payload = toRecord(message.payload);
  const directUrl = resolveMediaUrl(
    payload,
    realmBaseUrl,
    ['url', 'imageUrl', 'imageURL', 'src', 'mediaUrl', 'mediaURL'],
  );
  if (directUrl) {
    return directUrl;
  }
  const imageId = String(payload?.imageId || payload?.id || '').trim();
  if (!imageId || !realmBaseUrl) {
    return '';
  }
  return `${realmBaseUrl}/api/media/images/${encodeURIComponent(imageId)}`;
}

export function resolveVideoMessageUrl(message: MessageViewDto, realmBaseUrl: string): string {
  const payload = toRecord(message.payload);
  const directUrl = resolveMediaUrl(
    payload,
    realmBaseUrl,
    ['url', 'videoUrl', 'videoURL', 'streamUrl', 'streamURL', 'mediaUrl', 'mediaURL'],
  );
  if (directUrl) {
    return directUrl;
  }
  const videoId = String(payload?.videoId || payload?.uid || payload?.id || '').trim();
  if (!videoId || !realmBaseUrl) {
    return '';
  }
  return `${realmBaseUrl}/api/media/videos/${encodeURIComponent(videoId)}`;
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

export type ChatMessageDiagnostics = {
  interactionKind: string;
  reasonCode: string;
  actionHint: string;
  turnAudit: Array<{ key: string; value: string }>;
};

type UnknownRecord = Record<string, unknown>;

function readRecordField(input: UnknownRecord | null, key: string): UnknownRecord | null {
  if (!input) {
    return null;
  }
  const value = input[key];
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
}

function readStringField(input: UnknownRecord | null, key: string): string {
  if (!input) {
    return '';
  }
  const value = input[key];
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function extractMessageDiagnostics(message: MessageViewDto): ChatMessageDiagnostics {
  const payload =
    message.payload && typeof message.payload === 'object'
      ? (message.payload as Record<string, unknown>)
      : null;
  const diagnostics = readRecordField(payload, 'diagnostics');
  const interaction = readRecordField(payload, 'interaction');

  const interactionKindRaw =
    (interaction?.kind as string | undefined)
    || (interaction?.type as string | undefined)
    || (interaction?.eventKind as string | undefined);
  const interactionKind =
    typeof interactionKindRaw === 'string' && interactionKindRaw.trim().length > 0
      ? interactionKindRaw.trim().toLowerCase().replace('interaction.', '')
      : '';

  const reasonCode =
    readStringField(diagnostics, 'reasonCode')
    || readStringField(payload, 'reasonCode');
  const actionHint =
    readStringField(diagnostics, 'actionHint')
    || readStringField(payload, 'actionHint');

  const turnAuditRecord =
    readRecordField(diagnostics, 'turnAudit')
    || readRecordField(payload, 'turnAudit');
  const turnAudit = turnAuditRecord
    ? Object.entries(turnAuditRecord)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
      .map(([key, value]) => ({
        key,
        value: String(value),
      }))
    : [];

  return {
    interactionKind,
    reasonCode,
    actionHint,
    turnAudit,
  };
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
    isAgent: source.isAgent === true || fallback.isAgent === true || String(source.handle || fallback.handle || '').startsWith('~'),
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
