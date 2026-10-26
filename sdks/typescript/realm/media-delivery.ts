import type { MediaDeliveryDto, MediaImageSetDto } from '../core-generated/realm-typed-client.js';

const purposes = new Set(['avatar', 'card', 'hero', 'detail', 'chat', 'poster']);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
  return value as number;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
  return value;
}
function url(value: unknown): string {
  const result = text(value); const parsed = new URL(result);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
  return result;
}
function nullable(value: unknown, read: (value: unknown) => string): string | null { return value === null ? null : read(value); }
function date(value: unknown): string { const result = text(value); if (!Number.isFinite(Date.parse(result))) throw new Error('REALM_MEDIA_DELIVERY_INVALID'); return result; }

/** Validate owner-issued delivery data at a typed transport boundary. Never constructs a URL. */
export function parseRealmMediaDelivery(value: unknown): MediaDeliveryDto | null {
  if (value === null) return null;
  const row = object(value);
  const resourceId = text(row.resourceId); const contentVersion = text(row.contentVersion);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(resourceId) || !/^[a-f0-9]{64}$/u.test(contentVersion)) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
  return {
    resourceId, contentVersion, publicationGeneration: integer(row.publicationGeneration), policyVersion: text(row.policyVersion),
    expiresAt: nullable(row.expiresAt, date), previewUrl: nullable(row.previewUrl, url), originalUrl: nullable(row.originalUrl, url),
    images: list(row.images).map((value) => {
      const set = object(value); const purpose = text(set.purpose);
      if (!purposes.has(purpose)) throw new Error('REALM_MEDIA_DELIVERY_INVALID');
      return { purpose: purpose as MediaImageSetDto['purpose'], families: list(set.families).map((value) => {
        const family = object(value);
        return { mimeType: text(family.mimeType), sources: list(family.sources).map((value) => {
          const source = object(value);
          return { url: url(source.url), width: integer(source.width), height: integer(source.height), mimeType: text(source.mimeType) };
        }) };
      }) };
    }),
    video: row.video === null ? null : (() => { const video = object(row.video); return {
      hlsUrl: url(video.hlsUrl), dashUrl: url(video.dashUrl), posterUrl: url(video.posterUrl), expiresAt: date(video.expiresAt),
    }; })(),
  };
}
