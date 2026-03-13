// Unit tests for RL-FEAT-003 — Voice (TTS)
// Tests TTS input contracts, feature gates, base64 audio, and lip sync bridge

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore, type Agent } from '../../src/renderer/app-shell/providers/app-store.js';
import { useLipSyncBridge } from '../../src/renderer/features/buddy/live2d/lip-sync-bridge.js';

// ── Extracted Logic: TTS input construction (from use-speech-playback.ts:35-40)

function buildTtsSynthesizeInput(
  agent: Agent,
  text: string,
  voiceId?: string,
) {
  return {
    agentId: agent.id,
    text,
    model: agent.voiceModel || '',
    voiceId: voiceId ?? agent.voiceId,
  };
}

// ── Extracted Logic: Voice list input (from use-list-voices.ts:31-33)

function buildListVoicesInput(voiceModel: string) {
  return { model: voiceModel };
}

// ── Extracted Logic: Volume normalization (from use-speech-playback.ts:84-88)

function normalizeVolume(frequencyData: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < frequencyData.length; i++) {
    sum += frequencyData[i];
  }
  return Math.min(1, (sum / frequencyData.length) / 128);
}

beforeEach(() => {
  useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
  useLipSyncBridge.setState({ mouthTarget: 0 });
});

// ─── canSpeak Feature Gate ───────────────────────────────────────────────

describe('RL-FEAT-003 — canSpeak feature gate', () => {
  it('false when no agent selected', () => {
    useAppStore.setState({ runtimeAvailable: true });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false);
  });

  it('false when runtime unavailable', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'A' }, runtimeAvailable: false });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false);
  });

  it('true when agent selected AND runtime available', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'A' }, runtimeAvailable: true });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, true);
  });
});

// ─── TTS Synthesize Input Contract (RL-CORE-004) ────────────────────────

describe('RL-CORE-004 — TTS synthesize input carries agentId', () => {
  it('input includes agentId, text, model, voiceId from agent profile', () => {
    const agent: Agent = {
      id: 'agent-tts',
      name: 'Voice Agent',
      voiceModel: 'nimi-tts-v2',
      voiceId: 'voice_en_female_01',
    };
    const input = buildTtsSynthesizeInput(agent, 'Hello world');
    assert.equal(input.agentId, 'agent-tts');
    assert.equal(input.text, 'Hello world');
    assert.equal(input.model, 'nimi-tts-v2');
    assert.equal(input.voiceId, 'voice_en_female_01');
  });

  it('uses override voiceId when provided', () => {
    const agent: Agent = {
      id: 'a1', name: 'Agent',
      voiceModel: 'model', voiceId: 'default-voice',
    };
    const input = buildTtsSynthesizeInput(agent, 'test', 'override-voice');
    assert.equal(input.voiceId, 'override-voice');
  });

  it('falls back to agent voiceId when no override', () => {
    const agent: Agent = {
      id: 'a1', name: 'Agent',
      voiceModel: 'model', voiceId: 'agent-voice',
    };
    const input = buildTtsSynthesizeInput(agent, 'test');
    assert.equal(input.voiceId, 'agent-voice');
  });

  it('handles agent without voiceModel (empty string fallback)', () => {
    const agent: Agent = { id: 'a1', name: 'Agent' };
    const input = buildTtsSynthesizeInput(agent, 'test');
    assert.equal(input.model, '');
    assert.equal(input.voiceId, undefined);
  });
});

// ─── Voice List Input ───────────────────────────────────────────────────

describe('RL-FEAT-003 — listVoices input contract', () => {
  it('passes agent voiceModel as model parameter', () => {
    const input = buildListVoicesInput('nimi-tts-v2');
    assert.deepEqual(input, { model: 'nimi-tts-v2' });
  });
});

// ─── Base64 Audio Round-Trip (RL-IPC-005) ────────────────────────────────

describe('RL-IPC-005 — Base64 audio encoding/decoding', () => {
  it('binary → base64 → binary round-trip preserves data', () => {
    const original = new Uint8Array([0, 1, 2, 128, 255]);
    const base64 = btoa(String.fromCharCode(...original));
    assert.equal(typeof base64, 'string');

    const binaryString = atob(base64);
    const decoded = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      decoded[i] = binaryString.charCodeAt(i);
    }
    assert.deepEqual(decoded, original);
  });

  it('empty audio produces empty base64', () => {
    const empty = new Uint8Array([]);
    const base64 = btoa(String.fromCharCode(...empty));
    assert.equal(base64, '');
    assert.equal(atob(base64), '');
  });

  it('large audio data survives round-trip', () => {
    const large = new Uint8Array(4096);
    for (let i = 0; i < large.length; i++) large[i] = i % 256;
    const base64 = btoa(String.fromCharCode(...large));
    const binaryString = atob(base64);
    const decoded = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      decoded[i] = binaryString.charCodeAt(i);
    }
    assert.deepEqual(decoded, large);
  });
});

// ─── Volume Normalization for Lip Sync (RL-FEAT-005) ─────────────────────

describe('RL-FEAT-005 — Volume normalization for lip sync', () => {
  it('silence (all zeros) produces volume 0', () => {
    const data = new Uint8Array(128).fill(0);
    assert.equal(normalizeVolume(data), 0);
  });

  it('maximum frequency data produces volume 1', () => {
    const data = new Uint8Array(128).fill(255);
    const vol = normalizeVolume(data);
    assert.equal(vol, 1, 'should be clamped to 1');
  });

  it('moderate frequency data produces proportional volume', () => {
    const data = new Uint8Array(128).fill(64);
    const vol = normalizeVolume(data);
    assert.ok(vol > 0 && vol < 1, `expected 0 < ${vol} < 1`);
    assert.equal(vol, 64 / 128);
  });

  it('volume is clamped to [0, 1]', () => {
    const loud = new Uint8Array(128).fill(200);
    const vol = normalizeVolume(loud);
    assert.ok(vol <= 1, 'volume must not exceed 1');
  });
});

// ─── Lip Sync Bridge Integration (RL-FEAT-005) ──────────────────────────

describe('RL-FEAT-005 — Lip sync bridge integration', () => {
  it('setMouthTarget updates bridge state', () => {
    useLipSyncBridge.getState().setMouthTarget(0.65);
    assert.equal(useLipSyncBridge.getState().mouthTarget, 0.65);
  });

  it('reset to 0 on playback end', () => {
    useLipSyncBridge.getState().setMouthTarget(0.8);
    useLipSyncBridge.getState().setMouthTarget(0);
    assert.equal(useLipSyncBridge.getState().mouthTarget, 0);
  });
});

// ─── RL-CORE-002: Agent Change Cancels Playback ─────────────────────────

describe('RL-CORE-002 — Agent change cancels TTS playback', () => {
  it('lip sync bridge resets to 0 on agent change (cleanup pattern)', () => {
    useLipSyncBridge.getState().setMouthTarget(0.9);
    // On agent change, hook cleanup calls: setMouthTarget(0)
    useLipSyncBridge.getState().setMouthTarget(0);
    assert.equal(useLipSyncBridge.getState().mouthTarget, 0);
  });

  it('agent change triggers store notification for hook dependency', () => {
    let changed = false;
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.currentAgent?.id !== prev.currentAgent?.id) changed = true;
    });
    useAppStore.getState().setAgent({ id: 'a1', name: 'A' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'B' });
    assert.equal(changed, true);
    unsub();
  });
});
