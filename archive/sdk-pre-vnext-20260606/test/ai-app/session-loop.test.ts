import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleAppAiSessionRuntimeTextStream,
  buildAppAiSessionHistoryMessages,
} from '../../src/ai-app/index.js';
import { ReasonCode, type NimiError } from '../../src/types/index.js';
import type { TextStreamPart } from '../../src/runtime/index.js';

type SourceMessage = {
  id: string;
  role: string;
  status: 'pending' | 'complete';
  text: string;
};

async function* streamParts(parts: readonly TextStreamPart[]): AsyncIterable<TextStreamPart> {
  for (const part of parts) {
    yield part;
  }
}

test('app AI session history builder keeps committed supported-role text only', () => {
  const history = buildAppAiSessionHistoryMessages<SourceMessage>({
    messages: [
      { id: 'pending-user', role: 'user', status: 'pending', text: 'draft' },
      { id: 'system', role: 'system', status: 'complete', text: '  system prompt  ' },
      { id: 'assistant-empty', role: 'assistant', status: 'complete', text: ' ' },
      { id: 'tool', role: 'tool', status: 'complete', text: ' tool result ' },
      { id: 'unknown', role: 'critic', status: 'complete', text: 'skip' },
      { id: 'assistant', role: 'assistant', status: 'complete', text: '[beat] answer' },
    ],
    isCommitted: (message) => message.status === 'complete',
    getId: (message) => message.id,
    getRole: (message) => message.role,
    getText: (message) => message.text,
    mapAssistantText: (text) => text.replace('[beat] ', ''),
  });

  assert.deepEqual(history, [
    { id: 'system', role: 'system', text: 'system prompt', name: undefined, metadata: undefined },
    { id: 'tool', role: 'tool', text: 'tool result', name: undefined, metadata: undefined },
    { id: 'assistant', role: 'assistant', text: 'answer', name: undefined, metadata: undefined },
  ]);
});

test('app AI session runtime text stream assembler accumulates text, reasoning, usage, and trace', async () => {
  const partials: string[] = [];
  const result = await assembleAppAiSessionRuntimeTextStream(streamParts([
    { type: 'start' },
    { type: 'reasoning-delta', text: 'think ' },
    { type: 'delta', text: 'hel' },
    { type: 'delta', text: 'lo' },
    {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      trace: { traceId: 'trace-1', modelResolved: 'model-a', routeDecision: 'local' },
    },
  ]), {
    onTextDelta: (_delta, snapshot) => {
      partials.push(snapshot.text);
    },
  });

  assert.equal(result.terminal, 'completed');
  assert.equal(result.text, 'hello');
  assert.equal(result.reasoningText, 'think ');
  assert.deepEqual(partials, ['hel', 'hello']);
  assert.equal(result.usage?.totalTokens, 3);
  assert.equal(result.trace?.traceId, 'trace-1');
});

test('app AI session runtime text stream assembler preserves typed stream errors', async () => {
  const error = Object.assign(new Error('denied'), {
    code: ReasonCode.PRINCIPAL_UNAUTHORIZED,
    reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
    actionHint: 'login',
    traceId: 'trace-error',
    retryable: false,
    source: 'runtime',
  }) as NimiError;

  const result = await assembleAppAiSessionRuntimeTextStream(streamParts([
    { type: 'delta', text: 'partial' },
    { type: 'error', error },
  ]));

  assert.equal(result.terminal, 'failed');
  assert.equal(result.text, 'partial');
  assert.equal(result.error, error);
});
