import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applyGroupAgentMentionSelection,
  ChatGroupComposer,
  shouldOpenGroupAgentMentionPicker,
} from '../src/shell/renderer/features/chat/chat-group-composer';

test('group composer renders stacked rows with toolbar and send control', () => {
  const markup = renderToStaticMarkup(
    <ChatGroupComposer
      selectedGroupId="group-1"
      onSendMessage={async () => undefined}
      isSending={false}
    />,
  );

  assert.match(markup, /data-chat-group-composer-layout="stacked"/);
  assert.match(markup, /data-chat-composer-textarea-row="true"/);
  assert.match(markup, /data-chat-group-composer-toolbar="true"/);
  assert.match(markup, /data-chat-composer-send="true"/);
});

test('group mention helpers preserve trigger and insertion behavior', () => {
  assert.equal(shouldOpenGroupAgentMentionPicker('@', 1), true);
  assert.equal(shouldOpenGroupAgentMentionPicker('hello @', 7), true);
  assert.equal(shouldOpenGroupAgentMentionPicker('email@test', 10), false);

  assert.equal(applyGroupAgentMentionSelection('@', 'Sage'), '@Sage ');
  assert.equal(applyGroupAgentMentionSelection('hello @sa', 'Sage'), 'hello @Sage ');
  assert.equal(applyGroupAgentMentionSelection('hello', 'Sage'), 'hello@Sage ');
});
