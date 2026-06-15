import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  applyGroupAgentMentionSelection,
  shouldOpenGroupAgentMentionPicker,
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
  assert.equal(shouldOpenGroupAgentMentionPicker('@', 1), true);
  assert.equal(shouldOpenGroupAgentMentionPicker('hello @', 7), true);
  assert.equal(shouldOpenGroupAgentMentionPicker('email@test', 10), false);

  assert.equal(applyGroupAgentMentionSelection('@', 'Sage'), '@Sage ');
  assert.equal(applyGroupAgentMentionSelection('hello @sa', 'Sage'), 'hello @Sage ');
  assert.equal(applyGroupAgentMentionSelection('hello', 'Sage'), 'hello@Sage ');
});
