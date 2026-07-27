import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGroupSourceMentionSelection,
  shouldOpenGroupSourceMentionPicker,
} from '../src/shell/renderer/features/chat/chat-group-composer';

test('group mention helpers preserve trigger and insertion behavior', () => {
  assert.equal(shouldOpenGroupSourceMentionPicker('@', 1), true);
  assert.equal(shouldOpenGroupSourceMentionPicker('hello @', 7), true);
  assert.equal(shouldOpenGroupSourceMentionPicker('email@test', 10), false);

  assert.equal(applyGroupSourceMentionSelection('@', 'Sage'), '@Sage ');
  assert.equal(applyGroupSourceMentionSelection('hello @sa', 'Sage'), 'hello @Sage ');
  assert.equal(applyGroupSourceMentionSelection('hello', 'Sage'), 'hello@Sage ');
});
