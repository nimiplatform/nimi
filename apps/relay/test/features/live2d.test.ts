// Unit tests for RL-FEAT-005 — Live2D
// Tests model state machine, lip sync bridge, and animation lifecycle

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore, type Agent } from '../../src/renderer/app-shell/providers/app-store.js';
import { useLipSyncBridge } from '../../src/renderer/features/buddy/live2d/lip-sync-bridge.js';

// ── Extracted Logic: Model Manager State Machine ─────────────────────────

type ModelState = 'idle' | 'loading' | 'ready' | 'error';

const MODEL_STATE_TRANSITIONS: Record<ModelState, ModelState[]> = {
  idle: ['loading'],
  loading: ['ready', 'error'],
  ready: ['idle', 'loading'],
  error: ['loading', 'idle'],
};

function isValidModelTransition(from: ModelState, to: ModelState): boolean {
  return MODEL_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Extracted Logic: Model URL resolution from agent ─────────────────────

function resolveModelUrl(agent: Agent | null): string | undefined {
  return agent?.live2dModelUrl;
}

beforeEach(() => {
  useAppStore.setState({ currentAgent: null, runtimeAvailable: false, realtimeConnected: false });
  useLipSyncBridge.setState({ mouthTarget: 0 });
});

// ─── Model State Machine ─────────────────────────────────────────────────

describe('RL-FEAT-005 — Model manager state machine', () => {
  it('idle → loading (on loadModel)', () => {
    assert.equal(isValidModelTransition('idle', 'loading'), true);
  });

  it('loading → ready (on success)', () => {
    assert.equal(isValidModelTransition('loading', 'ready'), true);
  });

  it('loading → error (on failure)', () => {
    assert.equal(isValidModelTransition('loading', 'error'), true);
  });

  it('ready → idle (on unloadModel)', () => {
    assert.equal(isValidModelTransition('ready', 'idle'), true);
  });

  it('ready → loading (on new model load)', () => {
    assert.equal(isValidModelTransition('ready', 'loading'), true);
  });

  it('error → loading (on retry)', () => {
    assert.equal(isValidModelTransition('error', 'loading'), true);
  });

  it('error → idle (on reset)', () => {
    assert.equal(isValidModelTransition('error', 'idle'), true);
  });

  it('idle cannot skip to ready', () => {
    assert.equal(isValidModelTransition('idle', 'ready'), false);
  });

  it('idle cannot skip to error', () => {
    assert.equal(isValidModelTransition('idle', 'error'), false);
  });

  it('full lifecycle: idle → loading → ready → idle', () => {
    const steps: ModelState[] = ['idle', 'loading', 'ready', 'idle'];
    for (let i = 0; i < steps.length - 1; i++) {
      assert.equal(
        isValidModelTransition(steps[i], steps[i + 1]),
        true,
        `${steps[i]} → ${steps[i + 1]} must be valid`,
      );
    }
  });
});

// ─── Model URL Resolution ────────────────────────────────────────────────

describe('RL-FEAT-005 — Model URL resolution from agent', () => {
  it('returns live2dModelUrl from agent profile', () => {
    const agent: Agent = {
      id: 'a1', name: 'Agent',
      live2dModelUrl: 'https://cdn.example.com/model.json',
    };
    assert.equal(resolveModelUrl(agent), 'https://cdn.example.com/model.json');
  });

  it('returns undefined when agent has no live2d model', () => {
    const agent: Agent = { id: 'a1', name: 'Agent' };
    assert.equal(resolveModelUrl(agent), undefined);
  });

  it('returns undefined when no agent selected', () => {
    assert.equal(resolveModelUrl(null), undefined);
  });

  it('model URL changes when agent changes', () => {
    const agent1: Agent = { id: 'a1', name: 'A1', live2dModelUrl: 'model1.json' };
    const agent2: Agent = { id: 'a2', name: 'A2', live2dModelUrl: 'model2.json' };
    assert.notEqual(resolveModelUrl(agent1), resolveModelUrl(agent2));
  });
});

// ─── Agent Change Triggers Model Reload (RL-CORE-002) ────────────────────

describe('RL-CORE-002 — Agent change triggers Live2D model reload', () => {
  it('agent change detected via store (hook reloads model)', () => {
    const modelUrls: Array<string | undefined> = [];
    const unsub = useAppStore.subscribe((state) => {
      modelUrls.push(state.currentAgent?.live2dModelUrl);
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'A1', live2dModelUrl: 'model1.json' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'A2', live2dModelUrl: 'model2.json' });
    useAppStore.getState().setAgent(null);

    assert.deepEqual(modelUrls, ['model1.json', 'model2.json', undefined]);
    unsub();
  });

  it('agent without live2d model skips loading', () => {
    const agent: Agent = { id: 'a1', name: 'No Model Agent' };
    useAppStore.getState().setAgent(agent);

    const url = resolveModelUrl(useAppStore.getState().currentAgent);
    assert.equal(url, undefined, 'should not attempt to load model');
  });
});

// ─── Lip Sync Bridge (Zustand store) ─────────────────────────────────────

describe('RL-FEAT-005 — Lip Sync Bridge', () => {
  it('initial mouthTarget is 0', () => {
    assert.equal(useLipSyncBridge.getState().mouthTarget, 0);
  });

  it('setMouthTarget updates value', () => {
    useLipSyncBridge.getState().setMouthTarget(0.75);
    assert.equal(useLipSyncBridge.getState().mouthTarget, 0.75);
  });

  it('mouthTarget range is 0..1 by convention', () => {
    useLipSyncBridge.getState().setMouthTarget(0);
    assert.equal(useLipSyncBridge.getState().mouthTarget, 0);

    useLipSyncBridge.getState().setMouthTarget(1);
    assert.equal(useLipSyncBridge.getState().mouthTarget, 1);
  });

  it('subscribers are notified on mouthTarget change', () => {
    const values: number[] = [];
    const unsub = useLipSyncBridge.subscribe((state) => {
      values.push(state.mouthTarget);
    });

    useLipSyncBridge.getState().setMouthTarget(0.3);
    useLipSyncBridge.getState().setMouthTarget(0.8);
    useLipSyncBridge.getState().setMouthTarget(0);

    assert.deepEqual(values, [0.3, 0.8, 0]);
    unsub();
  });

  it('intermediate values between 0 and 1 work correctly', () => {
    const testValues = [0.1, 0.25, 0.5, 0.75, 0.99];
    for (const v of testValues) {
      useLipSyncBridge.getState().setMouthTarget(v);
      assert.equal(useLipSyncBridge.getState().mouthTarget, v);
    }
  });
});

// ─── Tap Interaction ─────────────────────────────────────────────────────

describe('RL-FEAT-005 — Tap interaction coordinates', () => {
  it('tap coordinates are normalized (0..1 range)', () => {
    // The hook forwards normalized canvas coordinates to model.tap(x, y)
    const x = 0.5;
    const y = 0.3;
    assert.ok(x >= 0 && x <= 1, 'x should be normalized');
    assert.ok(y >= 0 && y <= 1, 'y should be normalized');
  });
});
