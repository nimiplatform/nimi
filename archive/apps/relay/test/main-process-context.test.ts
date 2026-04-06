import assert from 'node:assert/strict';
import test from 'node:test';

import { createMainProcessChatContext } from '../src/main/chat-pipeline/main-process-context.js';

test('createMainProcessChatContext skips sends when webContents is destroyed', () => {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  let destroyed = true;
  const webContents = {
    isDestroyed: () => destroyed,
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
  };

  const context = createMainProcessChatContext(webContents as never);
  context.setInputText('ignored');
  assert.equal(sent.length, 0);

  destroyed = false;
  context.setInputText('hello');
  assert.deepEqual(sent, [{ channel: 'relay:chat:input-text', payload: 'hello' }]);
});

test('createMainProcessChatContext tolerates destroy race during send', () => {
  const webContents = {
    isDestroyed: () => false,
    send: () => {
      throw new Error('WebContents was destroyed');
    },
  };

  const context = createMainProcessChatContext(webContents as never);
  assert.doesNotThrow(() => {
    context.setStatusBanner({ kind: 'warning', message: 'test' });
  });
});
