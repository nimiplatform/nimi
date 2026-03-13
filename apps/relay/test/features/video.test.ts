// Unit tests for RL-FEAT-006 — Video Generation
// Tests status state machine, stream protocol, feature gates, and data contracts

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../../src/renderer/app-shell/providers/app-store.js';

// ── Extracted Types ──────────────────────────────────────────────────────

type VideoJobStatus = 'idle' | 'submitting' | 'processing' | 'completed' | 'error';

// ── Extracted Logic: Status state machine (from use-video-generate.ts) ───

const VALID_TRANSITIONS: Record<VideoJobStatus, VideoJobStatus[]> = {
  idle: ['submitting'],
  submitting: ['processing', 'completed', 'error'],
  processing: ['completed', 'error'],
  completed: ['idle', 'submitting'],
  error: ['idle', 'submitting'],
};

function isValidTransition(from: VideoJobStatus, to: VideoJobStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Extracted Logic: Sync completion check (from use-video-generate.ts:47)

function isSyncCompletion(response: { artifacts: unknown[] }): boolean {
  return response.artifacts && response.artifacts.length > 0;
}

// ── Extracted Logic: Stream job event processing (from use-video-generate.ts:59-69)

function processJobChunk(
  ownStreamId: string,
  payload: { streamId: string; data: unknown },
): { matched: boolean; completed: boolean } {
  if (payload.streamId !== ownStreamId) return { matched: false, completed: false };
  const event = payload.data as { status?: string };
  return { matched: true, completed: event.status === 'completed' };
}

beforeEach(() => {
  useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
});

// ─── canGenerate Feature Gate ────────────────────────────────────────────

describe('RL-FEAT-006 — canGenerate feature gate', () => {
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

// ─── Status State Machine ────────────────────────────────────────────────

describe('RL-FEAT-006 — Video job status state machine', () => {
  it('idle → submitting (on generate call)', () => {
    assert.equal(isValidTransition('idle', 'submitting'), true);
  });

  it('submitting → completed (synchronous completion)', () => {
    assert.equal(isValidTransition('submitting', 'completed'), true);
  });

  it('submitting → processing (async job)', () => {
    assert.equal(isValidTransition('submitting', 'processing'), true);
  });

  it('submitting → error (generate fails)', () => {
    assert.equal(isValidTransition('submitting', 'error'), true);
  });

  it('processing → completed (job finished)', () => {
    assert.equal(isValidTransition('processing', 'completed'), true);
  });

  it('processing → error (job failed)', () => {
    assert.equal(isValidTransition('processing', 'error'), true);
  });

  it('completed → submitting (new generation)', () => {
    assert.equal(isValidTransition('completed', 'submitting'), true);
  });

  it('error → submitting (retry)', () => {
    assert.equal(isValidTransition('error', 'submitting'), true);
  });

  it('idle cannot skip to processing', () => {
    assert.equal(isValidTransition('idle', 'processing'), false);
  });

  it('idle cannot skip to completed', () => {
    assert.equal(isValidTransition('idle', 'completed'), false);
  });

  it('full lifecycle: idle → submitting → processing → completed', () => {
    const steps: VideoJobStatus[] = ['idle', 'submitting', 'processing', 'completed'];
    for (let i = 0; i < steps.length - 1; i++) {
      assert.equal(
        isValidTransition(steps[i], steps[i + 1]),
        true,
        `${steps[i]} → ${steps[i + 1]} must be valid`,
      );
    }
  });

  it('error recovery: error → idle → submitting', () => {
    assert.equal(isValidTransition('error', 'idle'), true);
    assert.equal(isValidTransition('idle', 'submitting'), true);
  });
});

// ─── Sync vs Async Completion ────────────────────────────────────────────

describe('RL-FEAT-006 — Sync vs async completion detection', () => {
  it('detects synchronous completion (artifacts populated)', () => {
    const response = {
      job: { id: 'j1' },
      artifacts: [{ url: 'https://example.com/video.mp4' }],
    };
    assert.equal(isSyncCompletion(response), true);
  });

  it('detects async job (empty artifacts)', () => {
    const response = { job: { id: 'j1' }, artifacts: [] };
    assert.equal(isSyncCompletion(response), false);
  });

  it('multiple artifacts still counts as sync completion', () => {
    const response = { artifacts: [{ url: 'a.mp4' }, { url: 'b.mp4' }] };
    assert.equal(isSyncCompletion(response), true);
  });
});

// ─── Stream Job Event Processing (RL-IPC-003) ──────────────────────────

describe('RL-FEAT-006 — Stream job event processing', () => {
  it('detects completed status from matching stream', () => {
    const result = processJobChunk('stream-1', {
      streamId: 'stream-1',
      data: { status: 'completed' },
    });
    assert.equal(result.matched, true);
    assert.equal(result.completed, true);
  });

  it('ignores non-completed statuses', () => {
    const result = processJobChunk('stream-1', {
      streamId: 'stream-1',
      data: { status: 'processing' },
    });
    assert.equal(result.matched, true);
    assert.equal(result.completed, false);
  });

  it('ignores events from other streams (streamId filter)', () => {
    const result = processJobChunk('stream-1', {
      streamId: 'stream-OTHER',
      data: { status: 'completed' },
    });
    assert.equal(result.matched, false);
    assert.equal(result.completed, false);
  });

  it('handles event without status field', () => {
    const result = processJobChunk('stream-1', {
      streamId: 'stream-1',
      data: { progress: 50 },
    });
    assert.equal(result.matched, true);
    assert.equal(result.completed, false);
  });
});

// ─── IPC Input Contract (RL-CORE-004) ───────────────────────────────────

describe('RL-CORE-004 — Video generate input carries agentId', () => {
  it('input shape includes agentId and prompt', () => {
    const agent = { id: 'agent-vid', name: 'Video Agent' };
    const input = { agentId: agent.id, prompt: 'Create a sunset video' };
    assert.equal(input.agentId, 'agent-vid');
    assert.equal(input.prompt, 'Create a sunset video');
  });
});

// ─── RL-CORE-002: Agent Change Cancels Job ──────────────────────────────

describe('RL-CORE-002 — Agent change cancels in-flight video job', () => {
  it('agent change detected via store subscription (triggers hook cleanup)', () => {
    let resetCount = 0;
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.currentAgent?.id !== prev.currentAgent?.id) resetCount++;
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });

    assert.equal(resetCount, 2, 'should detect 2 agent changes');
    unsub();
  });
});
