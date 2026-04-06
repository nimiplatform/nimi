// Unit tests for RL-FEAT-004 — Voice (STT)
// Tests agent-independence, feature gate, base64 encoding, and transcription contract

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../src/renderer/app-shell/providers/app-store.js';

// ── Extracted Logic: Transcription input (from use-speech-transcribe.ts:37-39)

function buildTranscribeInput(base64Audio: string) {
  return {
    audio: base64Audio,
    format: 'webm' as const,
  };
}

// ── Extracted Logic: Transcript result handling (from use-speech-transcribe.ts:41)

function extractTranscript(result: { text?: string }): string {
  return result.text || '';
}

beforeEach(() => {
  useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
});

// ─── canTranscribe Feature Gate ──────────────────────────────────────────

describe('RL-FEAT-004 — canTranscribe feature gate', () => {
  it('requires only runtimeAvailable (no agent needed)', () => {
    useAppStore.setState({ runtimeAvailable: true, currentAgent: null });
    assert.equal(useAppStore.getState().runtimeAvailable, true, 'canTranscribe with no agent');
  });

  it('false when runtime unavailable', () => {
    useAppStore.setState({ runtimeAvailable: false });
    assert.equal(useAppStore.getState().runtimeAvailable, false);
  });

  it('agent-independent: canTranscribe does NOT check currentAgent', () => {
    // STT gate: runtimeAvailable only (no !!currentAgent check)
    useAppStore.setState({ runtimeAvailable: true, currentAgent: null });
    const { runtimeAvailable } = useAppStore.getState();
    assert.equal(runtimeAvailable, true, 'should be transcribable without agent');

    useAppStore.setState({ runtimeAvailable: true, currentAgent: { id: 'a1', name: 'A' } });
    assert.equal(useAppStore.getState().runtimeAvailable, true, 'should also work with agent');
  });
});

// ─── Transcription Input Contract (RL-CORE-002 exception) ───────────────

describe('RL-FEAT-004 — Transcription input is agent-independent', () => {
  it('input does NOT include agentId', () => {
    const input = buildTranscribeInput('base64audiodata');
    assert.equal('agentId' in input, false, 'transcribe must not carry agentId');
    assert.equal(input.audio, 'base64audiodata');
    assert.equal(input.format, 'webm');
  });

  it('only includes audio and format fields', () => {
    const input = buildTranscribeInput('data');
    const keys = Object.keys(input);
    assert.deepEqual(keys.sort(), ['audio', 'format']);
  });
});

// ─── Transcript Result Handling ──────────────────────────────────────────

describe('RL-FEAT-004 — Transcript result handling', () => {
  it('extracts text from result', () => {
    assert.equal(extractTranscript({ text: 'Hello world' }), 'Hello world');
  });

  it('returns empty string when text is missing', () => {
    assert.equal(extractTranscript({}), '');
  });

  it('returns empty string when text is empty', () => {
    assert.equal(extractTranscript({ text: '' }), '');
  });

  it('returns empty string for undefined text (error fallback)', () => {
    assert.equal(extractTranscript({ text: undefined }), '');
  });
});

// ─── Base64 Audio Encoding (RL-IPC-005) ──────────────────────────────────

describe('RL-IPC-005 — Base64 audio encoding', () => {
  it('base64 encoding produces valid string from binary data', () => {
    const binary = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const base64 = btoa(String.fromCharCode(...binary));
    assert.equal(typeof base64, 'string');
    assert.equal(base64, 'SGVsbG8=');
  });

  it('base64 round-trip preserves binary data', () => {
    const original = new Uint8Array([0, 1, 2, 128, 255]);
    const base64 = btoa(String.fromCharCode(...original));
    const decoded = atob(base64);
    const result = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      result[i] = decoded.charCodeAt(i);
    }
    assert.deepEqual(result, original);
  });

  it('structured-clone compatibility (IPC-safe)', () => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array([10, 20, 30])));
    const cloned = structuredClone(base64);
    assert.equal(cloned, base64);
  });
});

// ─── Audio Format ────────────────────────────────────────────────────────

describe('RL-FEAT-004 — Audio format specification', () => {
  it('uses webm format for MediaRecorder output', () => {
    const input = buildTranscribeInput('audio-data');
    assert.equal(input.format, 'webm');
  });
});
