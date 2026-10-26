import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRealmChatAttachment } from '../core/app/local-app-runtime-platform-realm-realtime.js';

test('malformed media in a protected message preserves the typed projection failure', () => {
  assert.throws(() => projectRealmChatAttachment({ targetType: 'resource', targetId: 'r1', displayKind: 'image', title: null, subtitle: null,
    delivery: { resourceId: 'r1', contentVersion: 'unverified' }, externalUrl: null, unavailable: false, width: 20, height: 20, duration: 0, preview: null,
  }), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
});
