import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  applyGroupSourceMentionSelection,
  shouldOpenGroupSourceMentionPicker,
} from '../src/shell/renderer/features/chat/chat-group-composer';

test('group composer renders stacked rows with toolbar and send control', () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer/features/chat/chat-group-composer.tsx'),
    'utf8',
  );

  assert.match(source, /data-chat-group-composer-layout="stacked"/);
  assert.match(source, /data-chat-group-mention-posture="text-insertion-only"/);
  assert.match(source, /<CanonicalComposer/);
  assert.match(source, /layout="stacked"/);
  assert.match(source, /widthClassName=\{CHAT_CONTENT_WIDTH_CLASS\}/);
  assert.match(source, /widthPositionClassName=\{CHAT_CONTENT_POSITION_CLASS\}/);
});

test('group mention helpers preserve trigger and insertion behavior', () => {
  assert.equal(shouldOpenGroupSourceMentionPicker('@', 1), true);
  assert.equal(shouldOpenGroupSourceMentionPicker('hello @', 7), true);
  assert.equal(shouldOpenGroupSourceMentionPicker('email@test', 10), false);

  assert.equal(applyGroupSourceMentionSelection('@', 'Sage'), '@Sage ');
  assert.equal(applyGroupSourceMentionSelection('hello @sa', 'Sage'), 'hello @Sage ');
  assert.equal(applyGroupSourceMentionSelection('hello', 'Sage'), 'hello@Sage ');
});
