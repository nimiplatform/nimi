import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { startDesktopAgentRealtimeVoice, type DesktopAgentRealtimeVoiceSession } from '../src/shell/renderer/features/chat/chat-agent-realtime-voice.js';
import { useAgentConversationVoiceInput } from '../src/shell/renderer/features/chat/chat-agent-voice-input.js';

// Device/owner substitutes exercise the real hook and session lifecycle. These
// tests do not establish microphone permission, actual sound or product acceptance.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const target = { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', conversationAnchorId: 'anchor' } as never;
const opened = { realtimeSessionId: 'realtime', generation: '7',
  negotiatedInputAudio: { codec: 'pcm-s16le', sampleRateHz: 16000, channelCount: 1, frameDurationMs: 100, maximumFrameBytes: 3200 },
  negotiatedOutputAudio: { codec: 'pcm-s16le', sampleRateHz: 24000, channelCount: 1, frameDurationMs: 100, maximumFrameBytes: 4800 } };
const closed = { ack: { ok: true }, control: { lifecycle: 'closed', realtimeSessionId: 'realtime', generation: '7' } };

function installDevices() {
  let contexts = 0;
  let stops = 0;
  const track = { onended: null, stop: () => { stops++; } };
  const node = () => ({ connect() {}, disconnect() {} });
  class FakeAudioContext {
    sampleRate = 48000;
    currentTime = 0;
    destination = {};
    constructor() { contexts++; }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return { ...node(), onaudioprocess: null }; }
    createGain() { return { ...node(), gain: { value: 0 } }; }
  }
  const previous = new Map(['navigator', 'AudioContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node-test', mediaDevices: {
    async getUserMedia() { return { getTracks: () => [track], getAudioTracks: () => [track] }; },
  } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  return { get contexts() { return contexts; }, get stops() { return stops; }, restore() {
    for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  } };
}

function silentSubscription() {
  const done = deferred<void>();
  return { cancel: async () => done.resolve(), async *[Symbol.asyncIterator]() { await done.promise; } };
}
const callbacks = () => ({ onAmplitude() {}, onTranscript() {}, onOutputActive() {}, onClosed() {}, onError() {} });
const flush = async () => { for (let n = 0; n < 5; n++) await new Promise(resolve => setImmediate(resolve)); };

test('Realtime close failure preserves the same session for explicit retry and reports closed only after owner confirmation', async () => {
  const devices = installDevices();
  const calls: unknown[] = [];
  let confirmed = 0;
  const client = { open: async () => opened, subscribe: async () => silentSubscription(), close: async (input: unknown) => {
    calls.push(input);
    if (calls.length === 1) throw new Error('close receipt lost');
    if (calls.length === 2) return { ...closed, control: { ...closed.control, lifecycle: 'ready' } };
    return closed;
  } } as never;
  try {
    const session = await startDesktopAgentRealtimeVoice({ client, target, conversationAnchorId: 'anchor', callbacks: { ...callbacks(), onClosed: () => { confirmed++; } } });
    await assert.rejects(session.close(), /receipt lost/);
    assert.equal(confirmed, 0);
    assert.ok(devices.stops > 0, 'local microphone stops even though remote closure is unknown');
    await assert.rejects(session.stop(), /not confirmed/);
    assert.equal(confirmed, 0);
    await session.stop();
    assert.equal(confirmed, 1);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], calls[2], 'retry uses the same owner session and generation');
  } finally { devices.restore(); }
});

test('canceling an in-flight Realtime open prevents capture setup and retains a failed late close for retry', async () => {
  const devices = installDevices();
  const opening = deferred<typeof opened>();
  const controller = new AbortController();
  let retained: DesktopAgentRealtimeVoiceSession | null = null;
  let attempts = 0;
  let confirmed = 0;
  const client = { open: () => opening.promise, close: async () => { if (++attempts === 1) throw new Error('late close failed'); return closed; } } as never;
  try {
    const pending = startDesktopAgentRealtimeVoice({ client, target, conversationAnchorId: 'anchor', signal: controller.signal,
      onSession: value => { retained = value; }, callbacks: { ...callbacks(), onClosed: () => { confirmed++; } } });
    await flush();
    controller.abort();
    opening.resolve(opened);
    await assert.rejects(pending, /late close failed/);
    assert.equal(devices.contexts, 0, 'a late open cannot initialize playback/capture');
    assert.ok(retained);
    assert.equal(attempts, 1, 'failed close must not silently retry during startup cleanup');
    assert.equal(confirmed, 0);
    await (retained as unknown as DesktopAgentRealtimeVoiceSession).close();
    assert.equal(confirmed, 1);
  } finally { devices.restore(); }
});

test('Home playback stays blocked through connecting, failed close and explicit retry', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const devices = installDevices();
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const opening = deferred<typeof opened>();
  const errors: unknown[] = [];
  let attempts = 0;
  let nextOpen = opening;
  let selectedTarget = target;
  let view!: ReturnType<typeof useAgentConversationVoiceInput>;
  const realtime = { open: () => nextOpen.promise, subscribe: async () => silentSubscription(), close: async () => {
    if (++attempts === 1) throw new Error('close not acknowledged'); return closed;
  } };
  const input = { enabled: true, target, voiceCapture: {} as never, runtime: { appProduct: () => ({ agentRealtime: realtime }), conversation: () => ({}) } as never,
    ensureConversationAnchor: async () => 'anchor', getCurrentConversationAnchorId: () => 'anchor', handleSubmit: async () => {},
    reportError: (error: unknown) => { errors.push(error); }, failureMessage: 'Voice failed' };
  function Probe() { view = useAgentConversationVoiceInput({ ...input, target: selectedTarget }); return <span>{String(view.playbackBlocked)}</span>; }
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => { view.realtimeAction.onToggle(); await flush(); });
    assert.equal(view.playbackBlocked, true);
    await act(async () => { opening.resolve(opened); await flush(); });
    assert.equal(view.state.status, 'listening');
    await act(async () => { view.onCancel(); await flush(); });
    assert.equal(view.playbackBlocked, true);
    assert.equal(view.state.status, 'failed');
    assert.equal(view.realtimeAction.disabled, false, 'the explicit close retry remains reachable');
    assert.equal(errors.length, 1);
    await act(async () => { view.realtimeAction.onToggle(); await flush(); });
    assert.equal(attempts, 2);
    assert.equal(view.playbackBlocked, false);
    assert.equal(view.state.status, 'idle');
    nextOpen = deferred<typeof opened>();
    const contextsBeforeSwitch = devices.contexts;
    await act(async () => { view.realtimeAction.onToggle(); await flush(); });
    selectedTarget = { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', conversationAnchorId: 'other-anchor' } as never;
    await act(async () => { root.render(<Probe />); await flush(); });
    assert.equal(view.playbackBlocked, true, 'an unresolved open remains blocked while its owner selector is pending');
    await act(async () => { nextOpen.resolve(opened); await flush(); });
    assert.equal(devices.contexts, contextsBeforeSwitch, 'late old-scope open cannot set up new capture or playback');
    assert.equal(view.playbackBlocked, false);
    assert.equal(view.state.status, 'idle');
  } finally {
    await act(async () => root.unmount()); devices.restore(); dom.window.close();
    for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});
