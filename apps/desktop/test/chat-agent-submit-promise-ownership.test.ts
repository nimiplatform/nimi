import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ActiveAgentSubmit,
} from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-types.js';
import type {
  AgentSubmitDriverState,
} from '../src/shell/renderer/features/chat/chat-agent-shell-submit-driver.js';
import {
  bindActiveAgentSubmitPromise,
} from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.js';

test('active Agent submit registry owns the same Promise consumed by the submit flow', async () => {
  const placeholder: ActiveAgentSubmit = {
    threadId: 'thread-1',
    turnId: 'turn-1',
    interruptible: false,
    overrideRequested: false,
    abort: () => undefined,
    promise: Promise.resolve(),
  };
  const terminalError = new Error('canonical provider terminal');
  const consumedPromise = Promise.reject<AgentSubmitDriverState>(terminalError);

  bindActiveAgentSubmitPromise(placeholder, consumedPromise);

  assert.equal(placeholder.promise, consumedPromise);
  await assert.rejects(consumedPromise, terminalError);
});
