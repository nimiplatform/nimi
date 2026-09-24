import { describe, expect, it } from 'vitest';
import {
  createNimiAgentRealtimeSessionState,
  type NimiAgentRealtimeEvent,
  type NimiAgentRealtimeSessionState,
  type NimiLocalAppAgentHandle,
} from '@nimiplatform/kit/features/agent-realtime';
import {
  applyRealtimeEvent,
  callPhase,
  initialCallView,
  markTyped,
  MAX_CAPTIONS,
  micProblem,
  shouldListenAgain,
  type CallView,
} from '../src/nimiday/platform/voice-call.js';

const handle = 'agent-handle' as unknown as NimiLocalAppAgentHandle;
const format = { codec: 'pcm-s16le' as const, sampleRateHz: 16_000, channelCount: 1 as const, frameDurationMs: 20, maximumFrameBytes: 640 };

function ready(overrides: Partial<NimiAgentRealtimeSessionState> = {}): NimiAgentRealtimeSessionState {
  return { ...createNimiAgentRealtimeSessionState({ agentHandle: handle }), lifecycle: 'ready', negotiatedInputAudio: format, ...overrides };
}

function run(events: readonly NimiAgentRealtimeEvent[], from: CallView = initialCallView): CallView {
  return events.reduce(applyRealtimeEvent, from);
}

describe('voice call captions', () => {
  it('follows what the user says until the utterance is final', () => {
    const view = run([
      { type: 'speech-status', inputTrackId: 'in', utteranceId: 'u1', state: 'started' },
      { type: 'transcript', inputTrackId: 'in', utteranceId: 'u1', text: '明天', final: false },
      { type: 'transcript', inputTrackId: 'in', utteranceId: 'u1', text: '明天早上', final: false },
    ]);
    expect(view.userSpeaking).toBe(true);
    expect(view.captions).toEqual([{ key: 'you:u1', who: 'you', text: '明天早上', final: false }]);
    const done = applyRealtimeEvent(view, { type: 'transcript', inputTrackId: 'in', utteranceId: 'u1', text: '明天早上提醒我带医保卡', final: true });
    expect(done.captions).toEqual([{ key: 'you:u1', who: 'you', text: '明天早上提醒我带医保卡', final: true }]);
    expect(done.userSpeaking).toBe(false);
    expect(done.turnPending).toBe(true);
  });

  it('joins delta-style partial transcripts', () => {
    const view = run([
      { type: 'transcript', inputTrackId: 'in', utteranceId: 'u2', text: 'remind me ', final: false },
      { type: 'transcript', inputTrackId: 'in', utteranceId: 'u2', text: 'at nine', final: false },
    ]);
    expect(view.captions[0]!.text).toBe('remind me at nine');
  });

  it('drops an empty final utterance without starting a turn', () => {
    const view = run([
      { type: 'transcript', inputTrackId: 'in', utteranceId: 'u3', text: '嗯', final: false },
      { type: 'transcript', inputTrackId: 'in', utteranceId: 'u3', text: '  ', final: true },
    ]);
    expect(view.captions).toEqual([]);
    expect(view.turnPending).toBe(false);
  });

  it('streams the agent reply as deltas and settles on the final text', () => {
    const view = run([
      { type: 'text-output', requestId: 'r', outputTrackId: 'o1', text: '好的，', final: false },
      { type: 'text-output', requestId: 'r', outputTrackId: 'o1', text: '我记下了', final: false },
    ], markTyped(initialCallView, 'typed-1', '帮我记一下'));
    expect(view.captions.map((caption) => [caption.who, caption.text, caption.final])).toEqual([
      ['you', '帮我记一下', true],
      ['agent', '好的，我记下了', false],
    ]);
    const final = applyRealtimeEvent(view, { type: 'text-output', requestId: 'r', outputTrackId: 'o1', text: '好的，我记下了。', final: true });
    expect(final.captions.at(-1)).toEqual({ key: 'agent:o1', who: 'agent', text: '好的，我记下了。', final: true });
    const ended = applyRealtimeEvent(final, { type: 'terminal', reasonCode: 'ACTION_EXECUTED' });
    expect(ended.turnPending).toBe(false);
  });

  it('marks an interrupted reply as settled and keeps a bounded history', () => {
    const view = run([
      { type: 'text-output', requestId: 'r', outputTrackId: 'o2', text: '我来', final: false },
      { type: 'output-track', requestId: 'r', outputTrackId: 'o2', lifecycle: 'interrupted', reasonCode: '' },
    ]);
    expect(view.captions[0]!.final).toBe(true);
    let many = initialCallView;
    for (let index = 0; index < MAX_CAPTIONS + 5; index += 1) many = markTyped(many, `t${index}`, `第 ${index} 句`);
    expect(many.captions).toHaveLength(MAX_CAPTIONS);
    expect(many.captions[0]!.text).toBe('第 5 句');
  });
});

describe('hands-free listening', () => {
  it('listens again only after the agent finished and stopped talking', () => {
    const idle = initialCallView;
    expect(shouldListenAgain({ state: ready(), view: idle, micWanted: true })).toBe(true);
    expect(shouldListenAgain({ state: ready(), view: idle, micWanted: false })).toBe(false);
    expect(shouldListenAgain({ state: ready({ capture: 'active' }), view: idle, micWanted: true })).toBe(false);
    expect(shouldListenAgain({ state: ready(), view: { ...idle, turnPending: true }, micWanted: true })).toBe(false);
    expect(shouldListenAgain({ state: ready({ activeOutputTrackIds: ['o1'] }), view: idle, micWanted: true })).toBe(false);
    expect(shouldListenAgain({ state: ready({ pressure: 'blocked' }), view: idle, micWanted: true })).toBe(false);
    expect(shouldListenAgain({ state: ready({ lifecycle: 'reconnecting' }), view: idle, micWanted: true })).toBe(false);
    expect(shouldListenAgain({ state: ready({ capture: 'stopped' }), view: idle, micWanted: true })).toBe(true);
  });

  it('never retries a microphone the system refused', () => {
    expect(shouldListenAgain({ state: ready({ capture: 'permission-denied' }), view: initialCallView, micWanted: true })).toBe(false);
    expect(micProblem(ready({ capture: 'permission-denied' }))).toBe('permission');
    expect(micProblem(ready({ capture: 'device-unavailable' }))).toBe('missing');
    expect(micProblem(ready({ capture: 'device-lost' }))).toBe('lost');
    expect(micProblem(ready())).toBeNull();
  });

  it('describes the call in the order a person experiences it', () => {
    const base = createNimiAgentRealtimeSessionState({ agentHandle: handle });
    expect(callPhase(base, initialCallView)).toBe('idle');
    expect(callPhase({ ...base, lifecycle: 'opening' }, initialCallView)).toBe('connecting');
    expect(callPhase(ready({ capture: 'active' }), initialCallView)).toBe('listening');
    expect(callPhase(ready({ capture: 'active' }), { ...initialCallView, userSpeaking: true })).toBe('you-speaking');
    expect(callPhase(ready(), { ...initialCallView, turnPending: true })).toBe('thinking');
    expect(callPhase(ready({ activeOutputTrackIds: ['o1'] }), { ...initialCallView, turnPending: true })).toBe('agent-speaking');
    expect(callPhase(ready(), initialCallView)).toBe('muted');
    expect(callPhase({ ...base, lifecycle: 'closed' }, initialCallView)).toBe('ended');
    expect(callPhase({ ...base, lifecycle: 'failed' }, initialCallView)).toBe('failed');
  });
});
