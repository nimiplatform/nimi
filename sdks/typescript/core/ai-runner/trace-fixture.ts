import assert from 'node:assert/strict';

import type { NimiAiRunnerEvent } from './index';

export const NIMI_AI_RUNNER_GOLDEN_EVENT_ORDER = [
  'ai-runner-start',
  'model-request',
  'reasoning',
  'text',
  'warning',
  'artifact',
  'tool-call',
  'tool-result',
  'approval-requested',
  'external-execution-requested',
  'finish',
] as const;

export function eventTypes(events: readonly NimiAiRunnerEvent[]): readonly NimiAiRunnerEvent['type'][] {
  return events.map((event) => event.type);
}

export function assertNimiAiRunnerEventOrder(
  events: readonly NimiAiRunnerEvent[],
  expected: readonly NimiAiRunnerEvent['type'][],
): void {
  assert.deepEqual(eventTypes(events), expected);
}

export function assertNimiAiRunnerEventSubsequence(
  events: readonly NimiAiRunnerEvent[],
  expected: readonly NimiAiRunnerEvent['type'][],
): void {
  const actual = eventTypes(events);
  let cursor = 0;
  for (const eventType of actual) {
    if (eventType === expected[cursor]) {
      cursor += 1;
    }
  }
  assert.equal(cursor, expected.length, `missing expected event subsequence: ${expected.join(' -> ')}`);
}
