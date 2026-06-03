import { resolveRealmMediaUrl } from '@nimiplatform/kit/core/sdk-contract';
import type { RealmMessageInputPayload, RealmMessageViewDto } from './codec.js';
import type { RealmChatTimelineDisplayModel, RealmChatTimelineMessage } from './types.js';
import { asRecord, normalizeString } from './shared.js';

type RealmAttachmentInputPayload = Extract<RealmMessageInputPayload, { attachment: unknown }>;

export function extractRealmChatAttachmentTargetId(session: { resourceId?: unknown } | null | undefined): string {
  const targetId = normalizeString(session?.resourceId);
  if (!targetId) {
    throw new Error('chat-attachment-target-id-required');
  }
  return targetId;
}

export function createRealmChatResourceAttachmentPayload(targetId: string): RealmAttachmentInputPayload {
  const normalizedTargetId = normalizeString(targetId);
  if (!normalizedTargetId) {
    throw new Error('chat-attachment-target-id-required');
  }
  return {
    attachment: {
      targetType: 'RESOURCE',
      targetId: normalizedTargetId,
    },
  } as RealmAttachmentInputPayload;
}

export function resolveRealmMessageText(message: Pick<RealmMessageViewDto, 'text' | 'payload'>): string {
  const text = normalizeString(message.text);
  if (text) {
    return text;
  }
  const payload = asRecord(message.payload);
  const payloadText = normalizeString(payload?.content || payload?.text || '');
  if (payloadText) {
    return payloadText;
  }
  return resolveRealmChatAttachmentPreviewText(payload);
}

export function resolveRealmChatAttachmentPreviewText(payload: unknown): string {
  const record = asRecord(payload);
  const attachment = asRecord(record?.attachment);
  const preview = asRecord(attachment?.preview);
  const attachmentTitle = normalizeString(attachment?.title || attachment?.subtitle);
  if (attachmentTitle) {
    return attachmentTitle;
  }
  const previewTitle = normalizeString(preview?.title || preview?.subtitle);
  if (previewTitle) {
    return previewTitle;
  }
  const displayKind = normalizeString(preview?.displayKind || attachment?.displayKind).toUpperCase();
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

function resolveTimelineAttachmentRecord(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  const attachment = asRecord(record?.attachment);
  if (!attachment) {
    return null;
  }
  const attachmentDisplayKind = normalizeString(attachment.displayKind).toUpperCase();
  if (attachmentDisplayKind === 'IMAGE' || attachmentDisplayKind === 'VIDEO') {
    return attachment;
  }
  const preview = asRecord(attachment.preview);
  const previewDisplayKind = normalizeString(preview?.displayKind).toUpperCase();
  if (preview && (previewDisplayKind === 'IMAGE' || previewDisplayKind === 'VIDEO')) {
    return preview;
  }
  return attachment;
}

export function resolveRealmChatMediaUrl(payload: unknown, realmBaseUrl: string): string {
  const record = asRecord(payload);
  const attachment = asRecord(record?.attachment);
  const preview = asRecord(attachment?.preview);
  const timelineAttachment = resolveTimelineAttachmentRecord(payload);
  const url = normalizeString(timelineAttachment?.url || attachment?.url || preview?.url || record?.url);
  if (!url) {
    return '';
  }
  return resolveRealmMediaUrl({ realmBaseUrl, mediaUrl: url }) || '';
}

export function getRealmChatTimelineDisplayModel(
  message: RealmChatTimelineMessage,
  currentUserId: string,
): RealmChatTimelineDisplayModel {
  const type = normalizeString(message.type).toUpperCase();
  const attachment = resolveTimelineAttachmentRecord(message.payload);
  const displayKind = normalizeString(attachment?.displayKind).toUpperCase();
  const isGiftMessage = type === 'GIFT';
  const isAttachmentMessage = type === 'ATTACHMENT';
  const isImageMessage = type === 'IMAGE' || (isAttachmentMessage && displayKind === 'IMAGE');
  const isVideoMessage = type === 'VIDEO' || (isAttachmentMessage && displayKind === 'VIDEO');
  const isMediaMessage = isImageMessage || isVideoMessage;
  return {
    isMe: message.deliveryState !== 'sent' || message.senderId === currentUserId,
    kind: isGiftMessage ? 'gift' : isImageMessage ? 'image' : isVideoMessage ? 'video' : 'text',
    isGiftMessage,
    isImageMessage,
    isVideoMessage,
    isMediaMessage,
    resolvedText: resolveRealmMessageText(message),
    localPreviewUrl: message.localPreviewUrl || null,
    isUploadingMedia: message.localUploadState === 'uploading',
    showDeliveryState: message.deliveryState !== 'sent',
    deliveryState: message.deliveryState,
    deliveryError: message.deliveryError || null,
  };
}
