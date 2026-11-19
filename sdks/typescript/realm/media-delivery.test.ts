import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRealmChatAttachment } from '../core/app/local-app-runtime-platform-realm-realtime.js';
import { parseRealmMediaDelivery } from './media-delivery.js';

test('an optional width-bounded family is validated and kept separate from complete families', () => {
  const family = (mimeType: string, width: number) => ({ mimeType,
    sources: [{ mimeType, width, height: 300, url: 'https://media.example/issued' }] });
  const full = family('image/webp', 1536);
  const bounded = family('image/avif', 448);
  const raw = { resourceId: 'picture', contentVersion: 'a'.repeat(64), publicationGeneration: 1,
    policyVersion: 'v2', expiresAt: null, previewUrl: null, originalUrl: null, video: null,
    images: [{ purpose: 'hero', families: [full], boundedFamily: bounded }] };
  assert.deepEqual(parseRealmMediaDelivery(raw)?.images, raw.images);
  assert.throws(() => parseRealmMediaDelivery({ ...raw, images: [{ ...raw.images[0],
    boundedFamily: family('image/avif', 0) }] }), /REALM_MEDIA_DELIVERY_INVALID/);
  const old = [{ purpose: 'hero', families: [full] }];
  assert.deepEqual(parseRealmMediaDelivery({ ...raw, images: old })?.images, old);
});

test('malformed media in a protected message preserves the typed projection failure', () => {
  assert.throws(() => projectRealmChatAttachment({ targetType: 'resource', targetId: 'r1', displayKind: 'image', title: null, subtitle: null,
    delivery: { resourceId: 'r1', contentVersion: 'unverified' }, externalUrl: null, unavailable: false, width: 20, height: 20, duration: 0, preview: null,
  }), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
});
