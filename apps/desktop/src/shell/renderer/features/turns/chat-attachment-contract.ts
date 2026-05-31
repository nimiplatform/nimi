import {
  createRealmChatResourceAttachmentPayload,
  extractRealmChatAttachmentTargetId,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
  type RealmSendMessageInputDto,
} from '@nimiplatform/kit/features/chat/realm';

type CanonicalChatAttachmentPayload = Extract<
  NonNullable<RealmSendMessageInputDto['payload']>,
  { attachment: unknown }
>;

export function extractChatAttachmentTargetId(session: { resourceId?: unknown } | null | undefined): string {
  return extractRealmChatAttachmentTargetId(session);
}

export function createCanonicalChatAttachmentPayload(targetId: string): CanonicalChatAttachmentPayload {
  return createRealmChatResourceAttachmentPayload(targetId) as CanonicalChatAttachmentPayload;
}

export function resolveCanonicalChatAttachmentUrl(payload: unknown, realmBaseUrl: string): string {
  return resolveRealmChatMediaUrl(payload, realmBaseUrl);
}

export function resolveCanonicalChatAttachmentPreviewText(payload: unknown): string {
  return resolveRealmChatAttachmentPreviewText(payload);
}
