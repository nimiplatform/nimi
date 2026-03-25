import type { RealmSendMessageInputDto } from '@nimiplatform/nimi-kit/features/chat/realm';

type UnknownRecord = Record<string, unknown>;

type CanonicalChatAttachmentPayload = Extract<
  NonNullable<RealmSendMessageInputDto['payload']>,
  { attachment: unknown }
>;

function toRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

export function extractChatAttachmentTargetId(session: { resourceId?: unknown } | null | undefined): string {
  const targetId = String(session?.resourceId || '').trim();
  if (!targetId) {
    throw new Error('chat-attachment-target-id-required');
  }
  return targetId;
}

export function createCanonicalChatAttachmentPayload(targetId: string): CanonicalChatAttachmentPayload {
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) {
    throw new Error('chat-attachment-target-id-required');
  }
  return {
    attachment: {
      targetType: 'RESOURCE',
      targetId: normalizedTargetId,
    },
  };
}

function resolveCanonicalChatAttachmentRecords(payload: unknown): {
  attachment: UnknownRecord | null;
  preview: UnknownRecord | null;
} {
  const record = toRecord(payload);
  const attachment = toRecord(record?.attachment);
  const preview = toRecord(attachment?.preview);
  return { attachment, preview };
}

function resolveRealmAttachmentUrl(url: string, realmBaseUrl: string): string {
  if (!url) {
    return '';
  }
  if (url.startsWith('/')) {
    const normalizedBaseUrl = String(realmBaseUrl || '').trim().replace(/\/$/, '');
    return normalizedBaseUrl ? `${normalizedBaseUrl}${url}` : url;
  }
  return url;
}

export function resolveCanonicalChatAttachmentUrl(payload: unknown, realmBaseUrl: string): string {
  const { attachment, preview } = resolveCanonicalChatAttachmentRecords(payload);
  const url = String(attachment?.url || preview?.url || '').trim();
  return resolveRealmAttachmentUrl(url, realmBaseUrl);
}

export function resolveCanonicalChatAttachmentPreviewText(payload: unknown): string {
  const { attachment, preview } = resolveCanonicalChatAttachmentRecords(payload);
  const explicitText = String(attachment?.title || attachment?.subtitle || '').trim();
  if (explicitText) {
    return explicitText;
  }
  const previewText = String(preview?.title || preview?.subtitle || '').trim();
  if (previewText) {
    return previewText;
  }
  const displayKind = String(preview?.displayKind || attachment?.displayKind || '').trim().toUpperCase();
  switch (displayKind) {
    case 'IMAGE':
      return 'Image';
    case 'VIDEO':
      return 'Video';
    case 'AUDIO':
      return 'Audio';
    case 'TEXT':
      return 'Text';
    case 'CARD':
      return 'Attachment';
    default:
      return '';
  }
}
