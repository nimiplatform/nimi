import { describe, expect, it } from 'vitest';
import { planConversationTextReplay, planAppAiChatReplay } from '../src/runtime/text-replay.js';

const carrier = { type: 'reasoning-continuity' as const, kind: 'example.signed', version: 1, payloadBase64: 'AAECAw==' };
const history = [
  { id: 'u', role: 'user' as const, text: 'Remember: blue mug.' },
  { id: 'a', role: 'assistant' as const, text: 'Saved.', outputItems: [carrier, { type: 'text' as const, text: 'Saved.' }] },
];
const compatible = { acceptedCarriers: [{ kind: carrier.kind, version: 1, executionModes: ['stream' as const] }] };

describe('App-owned text replay context', () => {
  it('replays compatible opaque bytes and order exactly', () => {
    const result = planConversationTextReplay({ history, compatibility: compatible });
    expect(result.continuity).toBe('retained');
    expect(result.history[1]).toBe(history[1]);
    expect(result.history[1].outputItems?.[0]).toBe(carrier);
  });
  it('preserves original data, persists a reset, and never resurrects it on switch-back', () => {
    const original = JSON.stringify(history);
    const result = planConversationTextReplay({ history, compatibility: { acceptedCarriers: [] } });
    expect(result.continuity).toBe('reset');
    expect(result.contextStart).toBe(2);
    expect(result.history[1].outputItems).toEqual([{ type: 'text', text: 'Saved.' }]);
    expect(JSON.stringify(history)).toBe(original);
    const saved = JSON.parse(JSON.stringify({ history, contextStart: result.contextStart }));
    const back = planConversationTextReplay({ ...saved, compatibility: compatible });
    expect(back.continuity).toBe('retained');
    expect(back.history[1].outputItems).toEqual([{ type: 'text', text: 'Saved.' }]);
  });
  it('requires exact kind, version and execution mode; unknown facts cannot reset a record', () => {
    for (const acceptedCarriers of [
      [{ kind: 'other.signed', version: 1, executionModes: ['stream' as const] }],
      [{ kind: carrier.kind, version: 2, executionModes: ['stream' as const] }],
      [{ kind: carrier.kind, version: 1, executionModes: ['sync' as const] }],
    ]) expect(planConversationTextReplay({ history, compatibility: { acceptedCarriers } }).continuity).toBe('reset');
    expect(() => planConversationTextReplay({ history, compatibility: undefined })).toThrow(/unavailable/);
    expect(() => planConversationTextReplay({ history, compatibility: compatible, executionMode: 'async' as never })).toThrow(/Unsupported/);
  });
  it('a reset does not conceal damaged source output or change the visible reply', () => {
    expect(() => planConversationTextReplay({ history: [{ ...history[1], text: 'Changed.' }], compatibility: { acceptedCarriers: [] } })).toThrow(/unchanged/);
  });
});

it('a common Host transcript preserves ordered tools and results without re-execution on reset', () => {
  const call = { type: 'output' as const, output: { type: 'tool-call' as const, toolCall: { id: 'call-1', name: 'lookup', arguments: {} } } };
  const result = { type: 'tool-result' as const, toolResult: { toolCallId: 'call-1', toolName: 'lookup', result: { value: 'blue' } } };
  const history = [{ role: 'assistant' as const, content: [], turnItems: [
    { type: 'output' as const, output: { type: 'reasoning-continuity' as const, carrier: { kind: carrier.kind, version: 1, payload: new Uint8Array([0, 1, 2, 3]) } } }, call, result,
  ] }];
  const plan = planAppAiChatReplay({ history, selection: { capabilityContract: 'text.generate', state: 'ready', resource: null, reasons: [], textReplay: { acceptedCarriers: [] } } });
  expect(plan.history[0].turnItems).toEqual([call, result]);
  expect(plan.history[0].turnItems?.[0]).toBe(call);
  expect(history[0].turnItems).toHaveLength(3);
});

it('unsupported historical media requires an explicit action and preserves its source', () => {
  const history = [{ role: 'user' as const, content: [{ type: 'file' as const, mediaType: 'image/png', data: 'https://example.com/mug.png' }] }];
  expect(() => planAppAiChatReplay({ history, selection: { capabilityContract: 'text.generate', state: 'ready', resource: null, reasons: [], textReplay: { acceptedCarriers: [] } } })).toThrow(/Choose an image-capable model/);
  expect(history[0].content[0].data).toBe('https://example.com/mug.png');
});
