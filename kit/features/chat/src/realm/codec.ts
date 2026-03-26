import type { RealmModel } from '@nimiplatform/sdk/realm';

export type RealmSendMessageInputDto = RealmModel<'SendMessageInputDto'>;
export type RealmMessageViewDto = RealmModel<'MessageViewDto'>;
export type RealmMessagePayload = Exclude<RealmMessageViewDto['payload'], null>;
export type RealmMessageInputPayload = NonNullable<RealmSendMessageInputDto['payload']>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type RealmAttachmentPayload = Extract<RealmMessagePayload, { attachment: unknown }>;
type RealmAttachmentEnvelope = RealmAttachmentPayload['attachment'];
type RealmAttachmentTargetType = RealmAttachmentEnvelope['targetType'];
type RealmAttachmentDisplayKind = NonNullable<RealmAttachmentEnvelope['displayKind']>;

function normalizeAttachmentTargetType(value: unknown): RealmAttachmentTargetType | null {
  const normalized = normalizeString(value).toUpperCase();
  if (normalized === 'RESOURCE' || normalized === 'ASSET' || normalized === 'BUNDLE') {
    return normalized as RealmAttachmentTargetType;
  }
  return null;
}

function normalizeAttachmentDisplayKind(value: unknown): RealmAttachmentDisplayKind | undefined {
  const normalized = normalizeString(value).toUpperCase();
  if (
    normalized === 'IMAGE'
    || normalized === 'VIDEO'
    || normalized === 'AUDIO'
    || normalized === 'TEXT'
    || normalized === 'CARD'
  ) {
    return normalized as RealmAttachmentDisplayKind;
  }
  return undefined;
}

function normalizeAttachmentEnvelope(input: unknown): RealmAttachmentEnvelope | null {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const targetType = normalizeAttachmentTargetType(record.targetType);
  const targetId = normalizeString(record.targetId);
  if (!targetType || !targetId) {
    return null;
  }

  const normalized: RealmAttachmentEnvelope = {
    targetType,
    targetId,
  };
  const displayKind = normalizeAttachmentDisplayKind(record.displayKind);
  if (displayKind) {
    normalized.displayKind = displayKind;
  }
  const url = normalizeString(record.url);
  if (url) {
    normalized.url = url;
  }
  const thumbnail = normalizeString(record.thumbnail);
  if (thumbnail) {
    normalized.thumbnail = thumbnail;
  }
  const title = normalizeString(record.title);
  if (title) {
    normalized.title = title;
  }
  const subtitle = normalizeString(record.subtitle);
  if (subtitle) {
    normalized.subtitle = subtitle;
  }
  const width = normalizeFiniteNumber(record.width);
  if (width !== undefined) {
    normalized.width = width;
  }
  const height = normalizeFiniteNumber(record.height);
  if (height !== undefined) {
    normalized.height = height;
  }
  const duration = normalizeFiniteNumber(record.duration);
  if (duration !== undefined) {
    normalized.duration = duration;
  }
  const preview = normalizeAttachmentEnvelope(record.preview);
  if (preview) {
    normalized.preview = preview;
  }
  return normalized;
}

export function normalizeRealmMessagePayload(input: unknown): RealmMessageViewDto['payload'] {
  if (input === null || input === undefined) {
    return null;
  }
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const content = normalizeString(record.content);
  if (content) {
    return { content };
  }

  const attachment = normalizeAttachmentEnvelope(record.attachment);
  if (attachment) {
    return { attachment };
  }

  const postId = normalizeString(record.postId);
  if (postId) {
    return { postId };
  }

  const userId = normalizeString(record.userId);
  if (userId) {
    const snapshot = asRecord(record.snapshot);
    return snapshot ? { userId, snapshot } : { userId };
  }

  const url = normalizeString(record.url);
  if (url) {
    const title = normalizeString(record.title);
    return title ? { url, title } : { url };
  }

  const interactionId = normalizeString(record.interactionId);
  if (interactionId) {
    const normalized: Extract<RealmMessagePayload, { interactionId: string }> = { interactionId };
    const amount = normalizeFiniteNumber(record.amount);
    if (amount !== undefined) {
      normalized.amount = amount;
    }
    const tokenSymbol = normalizeString(record.tokenSymbol);
    if (tokenSymbol) {
      normalized.tokenSymbol = tokenSymbol;
    }
    const status = normalizeString(record.status);
    if (status) {
      normalized.status = status;
    }
    return normalized;
  }

  const requestId = normalizeString(record.requestId);
  const status = normalizeString(record.status);
  if (requestId && status) {
    const normalized: Extract<RealmMessagePayload, { requestId: string }> = {
      requestId,
      status,
    };
    const requestMessage = normalizeString(record.requestMessage);
    if (requestMessage) {
      normalized.requestMessage = requestMessage;
    }
    return normalized;
  }

  return null;
}
