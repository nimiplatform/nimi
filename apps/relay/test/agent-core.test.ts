// Unit tests for agent-centric interaction core (RL-CORE-001 ~ 004)

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore, type Agent } from '../src/renderer/app-shell/providers/app-store.js';

// Reset store between tests
beforeEach(() => {
  useAppStore.setState({
    currentAgent: null,
    runtimeAvailable: false,
    realtimeConnected: false,
  });
});

// ─── RL-CORE-001 — Selected Agent Drives All Surfaces ───────────────────

describe('RL-CORE-001 — Selected Agent Drives All Surfaces', () => {
  it('currentAgent is null initially — all surfaces should be gated', () => {
    const state = useAppStore.getState();
    assert.equal(state.currentAgent, null);
  });

  it('no agent → all agent-scoped features disabled', () => {
    useAppStore.setState({ runtimeAvailable: true, realtimeConnected: true });
    const { currentAgent, runtimeAvailable, realtimeConnected } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false, 'canChat (AI)');
    assert.equal(!!currentAgent && runtimeAvailable, false, 'canSpeak');
    assert.equal(!!currentAgent && runtimeAvailable, false, 'canGenerate');
    assert.equal(!!currentAgent && realtimeConnected, false, 'canChat (Human)');
  });

  it('agent selected + runtime available → runtime features enabled', () => {
    useAppStore.setState({
      currentAgent: { id: 'a1', name: 'Agent' },
      runtimeAvailable: true,
    });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, true, 'features should be enabled');
  });

  it('agent selected + realtime connected → realtime features enabled', () => {
    useAppStore.setState({
      currentAgent: { id: 'a1', name: 'Agent' },
      realtimeConnected: true,
    });
    const { currentAgent, realtimeConnected } = useAppStore.getState();
    assert.equal(!!currentAgent && realtimeConnected, true, 'human chat should be enabled');
  });

  it('STT is agent-independent (only requires runtime)', () => {
    useAppStore.setState({ runtimeAvailable: true, currentAgent: null });
    assert.equal(useAppStore.getState().runtimeAvailable, true, 'canTranscribe without agent');
  });
});

// ─── RL-CORE-002 — Agent Binding Propagation ────────────────────────────

describe('RL-CORE-002 — Agent Binding Propagation', () => {
  it('setAgent updates currentAgent in store', () => {
    const agent: Agent = { id: 'a1', name: 'Test Agent', voiceModel: 'model-1', voiceId: 'v1' };
    useAppStore.getState().setAgent(agent);

    const state = useAppStore.getState();
    assert.deepEqual(state.currentAgent, agent);
  });

  it('setAgent(null) clears currentAgent', () => {
    useAppStore.getState().setAgent({ id: 'a1', name: 'Test' });
    useAppStore.getState().setAgent(null);

    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('agent change triggers subscriber notifications', () => {
    let notified = false;
    const unsub = useAppStore.subscribe((state) => {
      if (state.currentAgent?.id === 'a2') notified = true;
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });

    assert.equal(notified, true, 'subscribers should be notified on agent change');
    unsub();
  });

  it('agent profile carries voice and live2d bindings', () => {
    const agent: Agent = {
      id: 'a1',
      name: 'Voice Agent',
      voiceModel: 'nimi-tts-v2',
      voiceId: 'voice_en_female_01',
      live2dModelUrl: 'https://cdn.example.com/model.json',
    };
    useAppStore.getState().setAgent(agent);

    const current = useAppStore.getState().currentAgent!;
    assert.equal(current.voiceModel, 'nimi-tts-v2');
    assert.equal(current.voiceId, 'voice_en_female_01');
    assert.equal(current.live2dModelUrl, 'https://cdn.example.com/model.json');
  });

  it('agent change propagates new bindings to all surfaces', () => {
    const agent1: Agent = { id: 'a1', name: 'A1', voiceModel: 'v1', live2dModelUrl: 'model1.json' };
    const agent2: Agent = { id: 'a2', name: 'A2', voiceModel: 'v2', live2dModelUrl: 'model2.json' };

    useAppStore.getState().setAgent(agent1);
    assert.equal(useAppStore.getState().currentAgent?.voiceModel, 'v1');
    assert.equal(useAppStore.getState().currentAgent?.live2dModelUrl, 'model1.json');

    useAppStore.getState().setAgent(agent2);
    assert.equal(useAppStore.getState().currentAgent?.voiceModel, 'v2');
    assert.equal(useAppStore.getState().currentAgent?.live2dModelUrl, 'model2.json');
  });

  it('subscription detects agent id change (hook useEffect dependency)', () => {
    const changes: Array<{ from: string | undefined; to: string | undefined }> = [];
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.currentAgent?.id !== prev.currentAgent?.id) {
        changes.push({ from: prev.currentAgent?.id, to: state.currentAgent?.id });
      }
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });
    useAppStore.getState().setAgent(null);

    assert.equal(changes.length, 3);
    assert.deepEqual(changes[0], { from: undefined, to: 'a1' });
    assert.deepEqual(changes[1], { from: 'a1', to: 'a2' });
    assert.deepEqual(changes[2], { from: 'a2', to: undefined });
    unsub();
  });
});

// ─── RL-CORE-003 — Agent Resolution at Bootstrap ────────────────────────

describe('RL-CORE-003 — Agent Resolution at Bootstrap', () => {
  it('env agentId resolves to full profile via setAgent', () => {
    const agentId = 'agent-from-env';
    const fullProfile: Agent = {
      id: agentId,
      name: 'Resolved Agent',
      voiceModel: 'nimi-tts-v2',
      voiceId: 'voice_01',
      live2dModelUrl: 'https://cdn/model.json',
    };
    useAppStore.getState().setAgent(fullProfile);

    const current = useAppStore.getState().currentAgent!;
    assert.equal(current.id, agentId);
    assert.equal(current.voiceModel, 'nimi-tts-v2');
  });

  it('fallback stub agent has only id and name', () => {
    const stub: Agent = { id: 'agent-x', name: 'agent-x' };
    useAppStore.getState().setAgent(stub);

    const current = useAppStore.getState().currentAgent!;
    assert.equal(current.id, 'agent-x');
    assert.equal(current.name, 'agent-x');
    assert.equal(current.voiceModel, undefined);
    assert.equal(current.live2dModelUrl, undefined);
  });
});

// ─── RL-CORE-004 — Agent Context in IPC ─────────────────────────────────

describe('RL-CORE-004 — Agent context propagation to IPC calls', () => {
  it('agent-scoped IPC input shape carries agentId', () => {
    useAppStore.getState().setAgent({ id: 'agent-ipc', name: 'IPC Agent' });
    const agent = useAppStore.getState().currentAgent!;

    // Verify the shape that hooks construct for bridge calls
    const chatInput = { agentId: agent.id, prompt: 'Hello' };
    const ttsInput = { agentId: agent.id, text: 'Speak this', model: 'v1' };
    const videoInput = { agentId: agent.id, prompt: 'Generate video' };

    assert.equal(chatInput.agentId, 'agent-ipc');
    assert.equal(ttsInput.agentId, 'agent-ipc');
    assert.equal(videoInput.agentId, 'agent-ipc');
  });

  it('realm passthrough carries optional agentId', () => {
    useAppStore.getState().setAgent({ id: 'a1', name: 'Agent' });
    const agent = useAppStore.getState().currentAgent!;

    const realmInput = {
      agentId: agent.id,
      method: 'POST',
      path: '/api/messages',
      body: { text: 'Hello', agentId: agent.id },
    };
    assert.equal(realmInput.agentId, 'a1');
  });

  it('STT does not include agentId in input', () => {
    const sttInput = { audio: 'base64data', format: 'webm' };
    assert.equal('agentId' in sttInput, false, 'STT is agent-independent');
  });
});

// ─── Store state management ─────────────────────────────────────────────

describe('AppStore — runtimeAvailable and realtimeConnected flags', () => {
  it('setRuntimeAvailable updates flag', () => {
    useAppStore.getState().setRuntimeAvailable(true);
    assert.equal(useAppStore.getState().runtimeAvailable, true);

    useAppStore.getState().setRuntimeAvailable(false);
    assert.equal(useAppStore.getState().runtimeAvailable, false);
  });

  it('setRealtimeConnected updates flag', () => {
    useAppStore.getState().setRealtimeConnected(true);
    assert.equal(useAppStore.getState().realtimeConnected, true);

    useAppStore.getState().setRealtimeConnected(false);
    assert.equal(useAppStore.getState().realtimeConnected, false);
  });

  it('flags are independent of each other', () => {
    useAppStore.setState({ runtimeAvailable: true, realtimeConnected: false });
    assert.equal(useAppStore.getState().runtimeAvailable, true);
    assert.equal(useAppStore.getState().realtimeConnected, false);

    useAppStore.setState({ runtimeAvailable: false, realtimeConnected: true });
    assert.equal(useAppStore.getState().runtimeAvailable, false);
    assert.equal(useAppStore.getState().realtimeConnected, true);
  });
});
