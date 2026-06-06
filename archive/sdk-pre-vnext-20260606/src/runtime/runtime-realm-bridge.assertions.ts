import type { RuntimeRealmBridgeHelpers } from './types.js';

declare const helpers: RuntimeRealmBridgeHelpers;

helpers.fetchRealmGrant({
  subjectUserId: 'subject-1',
  scopes: ['app.nimi.test.chat.read'],
});

helpers.fetchRealmGrant({
  // @ts-expect-error runtime realm grant bridge no longer accepts deployment-specific paths
  path: '/api/runtime/realm-grants/issue',
  subjectUserId: 'subject-1',
  scopes: ['app.nimi.test.chat.read'],
});
