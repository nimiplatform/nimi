import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneEnvelopeWithCommittedMessage,
  toResolvedEnvelope,
} from '../src/shell/renderer/features/chat/chat-agent-runtime-agent-utils.js';

const validRuntimePayload = {
  message: {
    message_id: 'runtime-message-1',
    text: 'Here is the plan.',
  },
  status_cue: {
    source_message_id: 'runtime-message-1',
    mood: 'focus',
  },
  actions: [{
    action_id: 'image-0',
    action_index: 0,
    action_count: 1,
    modality: 'image',
    operation: 'generate',
    prompt_payload: {
      prompt_text: 'A quiet lake at sunrise.',
    },
    source_message_id: 'runtime-message-1',
    delivery_coupling: 'after-message',
  }],
};

test('runtime agent structured projection requires explicit action fields', () => {
  assert.throws(
    () => toResolvedEnvelope({
      ...validRuntimePayload,
      actions: [{
        ...validRuntimePayload.actions[0],
        action_id: '',
      }],
    }),
    /action_id is required/u,
  );
  assert.throws(
    () => toResolvedEnvelope({
      ...validRuntimePayload,
      actions: [{
        ...validRuntimePayload.actions[0],
        delivery_coupling: '',
      }],
    }),
    /delivery_coupling is required/u,
  );
  assert.throws(
    () => toResolvedEnvelope({
      ...validRuntimePayload,
      actions: [{
        ...validRuntimePayload.actions[0],
        prompt_payload: {},
      }],
    }),
    /prompt_text is required/u,
  );
});

test('runtime agent structured projection validates message/action relations after commit', () => {
  const envelope = toResolvedEnvelope(validRuntimePayload);
  const committed = cloneEnvelopeWithCommittedMessage({
    envelope,
    messageId: 'committed-message-1',
    text: 'Committed text.',
  });

  assert.equal(committed.message.messageId, 'committed-message-1');
  assert.equal(committed.statusCue?.sourceMessageId, 'committed-message-1');
  assert.equal(committed.actions[0]?.sourceMessageId, 'committed-message-1');
  assert.equal(committed.actions[0]?.actionId, 'image-0');
});

test('runtime agent structured projection fails closed on inconsistent source message ids', () => {
  assert.throws(
    () => toResolvedEnvelope({
      ...validRuntimePayload,
      actions: [{
        ...validRuntimePayload.actions[0],
        source_message_id: 'different-message',
      }],
    }),
    /source message reference is inconsistent/u,
  );
});
