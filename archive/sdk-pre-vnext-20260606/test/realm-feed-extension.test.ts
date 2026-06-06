import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRealmFeedScope,
  REALM_FEED_SCOPES,
  type RealmFeedScope,
} from '../src/realm/index.js';

test('Realm feed scope projection exposes the canonical scope catalog', () => {
  assert.deepEqual([...REALM_FEED_SCOPES], ['personal', 'friends', 'agent_activity']);
  assert.equal(isRealmFeedScope('personal'), true);
  assert.equal(isRealmFeedScope('friends'), true);
  assert.equal(isRealmFeedScope('agent_activity'), true);
  assert.equal(isRealmFeedScope('local_agent_activity'), false);
  assert.equal(isRealmFeedScope(''), false);
  const scope: RealmFeedScope = REALM_FEED_SCOPES[1];
  assert.equal(scope, 'friends');
});
