import assert from 'node:assert/strict';

import type { NimiAgentEvent } from './index';

export const NIMI_AGENT_GOLDEN_EVENT_ORDER = [
  'agent-start',
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

export function eventTypes(events: readonly NimiAgentEvent[]): readonly NimiAgentEvent['type'][] {
  return events.map((event) => event.type);
}

export function assertNimiAgentEventOrder(
  events: readonly NimiAgentEvent[],
  expected: readonly NimiAgentEvent['type'][],
): void {
  assert.deepEqual(eventTypes(events), expected);
}

export function assertNimiAgentEventSubsequence(
  events: readonly NimiAgentEvent[],
  expected: readonly NimiAgentEvent['type'][],
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
