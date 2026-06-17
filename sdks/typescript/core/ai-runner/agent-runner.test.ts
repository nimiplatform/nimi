import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiGenerateTextRequest } from '../ai';
import { createNimiMockModel, createNimiToolCall, userTextMessage } from '../testing';
import { createNimiAiRunner } from './runner';
import { assertNimiAiRunnerEventOrder, assertNimiAiRunnerEventSubsequence } from './trace-fixture';

test('AI runner materializes instructions and context before model execution', async () => {
  const seen: NimiGenerateTextRequest[] = [];
  const model = createNimiMockModel({
    onGenerateText(request) {
      seen.push(request);
      return { text: 'done', finishReason: 'stop' };
    },
  });

  const result = await createNimiAiRunner().run({
    runner: {
      id: 'planner',
      name: 'Planner',
      instructions: 'Base instruction',
      instructionPacks: [{ id: 'safety', content: 'Use cited facts.' }],
      contextProviders: [{ id: 'memory', load: () => 'Known user preference.' }],
    },
    model,
    messages: [userTextMessage('plan')],
  });

  assert.equal(seen[0]?.messages[0]?.role, 'system');
  assert.match(seen[0]?.messages[0]?.content[0]?.type === 'text' ? seen[0].messages[0].content[0].text : '', /Base instruction/);
  assert.equal(seen[0]?.messages[1]?.role, 'user');
  assert.equal(result.events.at(-1)?.type, 'finish');
});

test('AI runner emits local tool, approval, external execution, artifact, warning, and trace events', async () => {
  const localToolCall = createNimiToolCall('localLookup', { query: 'nimi' }, 'tool-local');
  const approvalToolCall = createNimiToolCall('approvalTool', { risk: 'write' }, 'tool-approval');
  const externalToolCall = createNimiToolCall('externalTool', { job: 'long' }, 'tool-external');
  const model = createNimiMockModel({
    text: 'answer',
    finishReason: 'tool-calls',
    toolCalls: [localToolCall, approvalToolCall, externalToolCall],
    warnings: [{ code: 'partial_context', message: 'context was truncated' }],
    raw: {
      reasoning: 'Need tools.',
      artifacts: [{ id: 'artifact-1', kind: 'text' }],
    },
  });

  const result = await createNimiAiRunner().run({
    runner: {
      id: 'tool-runner',
      name: 'Tool Runner',
      tools: [
        {
          name: 'localLookup',
          inputSchema: { type: 'object' },
          execute: (input) => ({ ok: true, input }),
        },
        { name: 'approvalTool', inputSchema: { type: 'object' }, policy: 'approval-required' },
        { name: 'externalTool', inputSchema: { type: 'object' }, policy: 'external-execution' },
      ],
    },
    model,
    messages: [userTextMessage('use tools')],
  });

  assertNimiAiRunnerEventOrder(result.events, [
    'ai-runner-start',
    'model-request',
    'reasoning',
    'text',
    'warning',
    'artifact',
    'tool-call',
    'tool-call',
    'tool-call',
    'tool-result',
    'approval-requested',
    'external-execution-requested',
    'finish',
  ]);
  assertNimiAiRunnerEventSubsequence(result.events, ['tool-call', 'tool-result', 'finish']);
  assert.equal(result.trace.steps.some((step) => step.kind === 'approval'), true);
  assert.equal(result.trace.steps.some((step) => step.kind === 'external-execution'), true);
});

test('AI runner fails visibly for missing local tool executors', async () => {
  const model = createNimiMockModel({
    finishReason: 'tool-calls',
    toolCalls: [createNimiToolCall('missingExecute', {}, 'tool-missing')],
  });

  await assert.rejects(
    createNimiAiRunner().run({
      runner: {
        id: 'failure-runner',
        name: 'Failure Runner',
        tools: [{ name: 'missingExecute', inputSchema: { type: 'object' } }],
      },
      model,
      messages: [userTextMessage('fail visibly')],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNNER_TOOL_EXECUTOR_MISSING',
  );
});
