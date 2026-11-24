import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTranscriptItems, parseToolCallOutcome } from '../src/product/transcript-format.ts';

test('groupTranscriptItems merges consecutive assistant steps in one turn into a single assistant-turn', () => {
  const entries = [
    { id: 'u1', role: 'user', text: 'Write L-A6.txt' },
    {
      id: 'a1',
      role: 'assistant',
      text: '',
      hasRedactedThinking: true,
      toolCalls: [
        {
          id: 'tc1',
          name: 'write',
          args: { path: 'L-A6.txt', content: '南桥' },
          status: 'error',
          toolFailure: 'blocked',
          output: 'Tool call blocked: The user declined this proposal and requested changes:\n实际收货仓改为东港',
        },
      ],
    },
    { id: 'r1', role: 'toolResult', toolCallId: 'tc1', text: 'blocked' },
    {
      id: 'a2',
      role: 'assistant',
      text: '',
      hasRedactedThinking: true,
      toolCalls: [
        {
          id: 'tc2',
          name: 'write',
          args: { path: 'L-A6.txt', content: '东港' },
          status: 'done',
          fileRef: 'L-A6.txt',
          output: 'ok',
        },
      ],
    },
    { id: 'r2', role: 'toolResult', toolCallId: 'tc2', text: 'ok' },
    { id: 'a3', role: 'assistant', text: '已按审阅意见将正文改为“收货仓：东港”。' },
  ];

  const groups = groupTranscriptItems(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'user');
  assert.equal(groups[1].kind, 'assistant-turn');
  if (groups[1].kind !== 'assistant-turn') throw new Error('expected assistant-turn');
  assert.equal(groups[1].hasRedactedThinking, true);
  assert.deepEqual(
    groups[1].items.map(item => item.kind),
    ['tool', 'tool', 'text'],
  );
  assert.equal(groups[1].items[2].kind === 'text' ? groups[1].items[2].text : '', '已按审阅意见将正文改为“收货仓：东港”。');
});

test('groupTranscriptItems skips empty redacted-only assistant turns with no content or tools', () => {
  const groups = groupTranscriptItems([
    { id: 'u1', role: 'user', text: 'First prompt' },
    { id: 'a1', role: 'assistant', text: '', hasRedactedThinking: true },
    { id: 'u2', role: 'user', text: 'Second prompt' },
  ]);
  assert.deepEqual(groups.map(g => g.kind), ['user', 'user']);
});

test('groupTranscriptItems preserves Home-to-Harness divider boundary', () => {
  const groups = groupTranscriptItems([
    { id: 'h1', role: 'assistant', text: 'From Home', fromHome: true },
    { id: 'n1', role: 'assistant', text: 'In Harness', fromHome: false },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].fromHome, true);
  assert.equal(groups[1].fromHome, false);
});

test('parseToolCallOutcome extracts localized feedback from declined-with-changes output', () => {
  const res = parseToolCallOutcome({
    status: 'error',
    toolFailure: 'blocked',
    output: 'Tool call blocked: The user declined this proposal and requested changes:\n实际收货仓改为东港，正文请改为“收货仓：东港”。',
  });
  assert.deepEqual(res, {
    kind: 'changes-requested',
    feedback: '实际收货仓改为东港，正文请改为“收货仓：东港”。',
  });

  assert.deepEqual(
    parseToolCallOutcome({
      status: 'error',
      toolFailure: 'blocked',
      output: 'Tool call blocked: The user declined this operation.',
    }),
    { kind: 'declined' },
  );

  assert.deepEqual(
    parseToolCallOutcome({
      status: 'error',
      toolFailure: 'blocked',
      output: 'Blocked by Plan Read-Only mode: "write" modifies files or runs commands.',
    }),
    { kind: 'readonly-blocked', detail: '"write" modifies files or runs commands.' },
  );
});
