import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAgentResolvedMessageActionEnvelope,
} from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver-envelope.js';
import {
  resolveAgentModelOutputEnvelope,
} from '../src/shell/renderer/features/chat/chat-agent-behavior-resolver-diagnostics.js';
import {
  stripBeatActionEnvelopeIfPresent,
} from '../src/shell/renderer/features/chat/chat-nimi-shell-core.js';

test('parses APML message, status cue, and immediate media action', () => {
  const envelope = parseAgentResolvedMessageActionEnvelope([
    '<message id="message-0">',
    '  <emotion>joy</emotion>',
    '  <activity>greet</activity>',
    '  你好，我在。',
    '</message>',
    '<action id="image-0" kind="image" source-message="message-0" coupling="after-message">',
    '  <prompt-payload kind="image"><prompt-text>soft daylight portrait</prompt-text></prompt-payload>',
    '</action>',
  ].join(''));

  assert.equal(envelope.schemaId, 'nimi.agent.chat.message-action.v1');
  assert.deepEqual(envelope.message, {
    messageId: 'message-0',
    text: '你好，我在。',
  });
  assert.deepEqual(envelope.statusCue, {
    sourceMessageId: 'message-0',
    mood: 'joy',
    actionCue: 'greet',
  });
  assert.equal(envelope.actions.length, 1);
  assert.deepEqual(envelope.actions[0], {
    actionId: 'image-0',
    actionIndex: 0,
    actionCount: 1,
    modality: 'image',
    operation: 'image.generate',
    promptPayload: {
      kind: 'image-prompt',
      promptText: 'soft daylight portrait',
    },
    sourceMessageId: 'message-0',
    deliveryCoupling: 'after-message',
  });
});

test('classifies strict APML output in local diagnostics', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: '<message id="message-0"><emotion>calm</emotion>Ready.</message>',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    throw new Error('expected APML output to resolve');
  }
  assert.equal(resolved.diagnostics.classification, 'strict-apml');
  assert.equal(resolved.envelope.message.text, 'Ready.');
});

test('classifies natural-language contract drift as invalid APML', () => {
  const resolved = resolveAgentModelOutputEnvelope({
    modelOutput: '我是 Gemma，可以帮你。',
    contextWindowSource: 'default-estimate',
    promptOverflow: false,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    throw new Error('expected natural-language output to fail');
  }
  assert.equal(resolved.diagnostics.classification, 'invalid-apml');
  assert.match(resolved.diagnostics.parseErrorDetail || '', /APML/u);
});

test('rejects APML video and runtime-owned hook tags in the Desktop local parser', () => {
  assert.throws(
    () => parseAgentResolvedMessageActionEnvelope(
      '<message id="message-0">Hello.</message><action id="video-0" kind="video"><prompt-payload kind="video"><prompt-text>clip</prompt-text></prompt-payload></action>',
    ),
    /video action/u,
  );
  assert.throws(
    () => parseAgentResolvedMessageActionEnvelope(
      '<message id="message-0">Hello.</message><time-hook id="hook-0"><delay-ms>100</delay-ms><effect kind="follow-up-turn"><prompt-text>continue</prompt-text></effect></time-hook>',
    ),
    /HookIntent-owned/u,
  );
});

test('strips APML envelopes from assistant history text', () => {
  assert.equal(
    stripBeatActionEnvelopeIfPresent('<message id="message-0"><emotion>focus</emotion>Visible text.</message>'),
    'Visible text.',
  );
});
