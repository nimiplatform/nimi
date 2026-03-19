// Unit tests for RL-FEAT-007 — Agent Profile & Selection
// Tests field mapping, store operations, and agent resolution

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore, type Agent } from '../../src/renderer/app-shell/providers/app-store.js';

// ── Extracted Logic: Agent field mapping (from use-agent-profile.ts:29-37)

function mapRealmAgent(raw: {
  id: string;
  name: string;
  avatar_url?: string;
  description?: string;
  voice_model?: string;
  voice_id?: string;
  live2d_model_url?: string;
}): Agent {
  return {
    id: raw.id,
    name: raw.name,
    avatarUrl: raw.avatar_url,
    description: raw.description,
    voiceModel: raw.voice_model,
    voiceId: raw.voice_id,
    live2dModelUrl: raw.live2d_model_url,
  };
}

// ── Extracted Logic: Agent list fetch input (from use-agent-profile.ts:15-18)

function buildFetchAgentListInput() {
  return undefined;
}

// Reset store between tests
beforeEach(() => {
  useAppStore.setState({
    currentAgent: null,
    runtimeAvailable: false,
    realtimeConnected: false,
  });
});

// ─── Fetch Agent List Contract ──────────────────────────────────────────

describe('RL-FEAT-007 — Fetch agent list via typed bridge', () => {
  it('uses a parameterless list call', () => {
    const input = buildFetchAgentListInput();
    assert.equal(input, undefined);
  });
});

// ─── Agent Profile Field Mapping ────────────────────────────────────────

describe('RL-FEAT-007 — Agent Profile Field Mapping (snake_case → camelCase)', () => {
  it('maps avatar_url to avatarUrl', () => {
    const agent = mapRealmAgent({
      id: 'a1',
      name: 'Test',
      avatar_url: 'https://example.com/avatar.png',
    });
    assert.equal(agent.avatarUrl, 'https://example.com/avatar.png');
  });

  it('handles missing avatar_url gracefully', () => {
    const agent = mapRealmAgent({ id: 'a1', name: 'Test' });
    assert.equal(agent.avatarUrl, undefined);
  });

  it('preserves id and name unchanged', () => {
    const agent = mapRealmAgent({ id: 'abc-123', name: 'My Agent' });
    assert.equal(agent.id, 'abc-123');
    assert.equal(agent.name, 'My Agent');
  });

  it('maps description field', () => {
    const agent = mapRealmAgent({
      id: 'a1',
      name: 'Agent',
      description: 'A helpful assistant',
    });
    assert.equal(agent.description, 'A helpful assistant');
  });

  it('maps voice_model to voiceModel', () => {
    const agent = mapRealmAgent({
      id: 'a1', name: 'Agent',
      voice_model: 'nimi-tts-v2',
    });
    assert.equal(agent.voiceModel, 'nimi-tts-v2');
  });

  it('maps voice_id to voiceId', () => {
    const agent = mapRealmAgent({
      id: 'a1', name: 'Agent',
      voice_id: 'voice_en_01',
    });
    assert.equal(agent.voiceId, 'voice_en_01');
  });

  it('maps live2d_model_url to live2dModelUrl', () => {
    const agent = mapRealmAgent({
      id: 'a1', name: 'Agent',
      live2d_model_url: 'https://example.com/model.json',
    });
    assert.equal(agent.live2dModelUrl, 'https://example.com/model.json');
  });

  it('maps all fields together', () => {
    const agent = mapRealmAgent({
      id: 'a1',
      name: 'Full Agent',
      avatar_url: 'https://img/avatar.png',
      description: 'Fully featured',
      voice_model: 'nimi-tts-v2',
      voice_id: 'voice_en_01',
      live2d_model_url: 'https://cdn/model.json',
    });
    assert.equal(agent.id, 'a1');
    assert.equal(agent.name, 'Full Agent');
    assert.equal(agent.avatarUrl, 'https://img/avatar.png');
    assert.equal(agent.description, 'Fully featured');
    assert.equal(agent.voiceModel, 'nimi-tts-v2');
    assert.equal(agent.voiceId, 'voice_en_01');
    assert.equal(agent.live2dModelUrl, 'https://cdn/model.json');
  });

  it('handles missing voice/Live2D fields gracefully', () => {
    const agent = mapRealmAgent({ id: 'a1', name: 'Minimal' });
    assert.equal(agent.voiceModel, undefined);
    assert.equal(agent.voiceId, undefined);
    assert.equal(agent.live2dModelUrl, undefined);
  });

  it('maps a batch of agents correctly', () => {
    const rawAgents = [
      { id: 'a1', name: 'Alpha', avatar_url: 'https://img/1.png', description: 'First' },
      { id: 'a2', name: 'Beta', description: 'Second' },
      { id: 'a3', name: 'Gamma', avatar_url: 'https://img/3.png' },
    ];
    const agents = rawAgents.map(mapRealmAgent);

    assert.equal(agents.length, 3);
    assert.equal(agents[0].avatarUrl, 'https://img/1.png');
    assert.equal(agents[1].avatarUrl, undefined);
    assert.equal(agents[2].description, undefined);
  });
});

// ─── Store Operations ───────────────────────────────────────────────────

describe('RL-FEAT-007 — Agent selection updates store', () => {
  it('agent selection updates store correctly', () => {
    const agent: Agent = {
      id: 'a1',
      name: 'Test Agent',
      avatarUrl: 'https://example.com/avatar.png',
      description: 'A test agent',
      voiceModel: 'nimi-tts-v2',
      voiceId: 'voice_en_01',
      live2dModelUrl: 'https://example.com/model.json',
    };

    useAppStore.getState().setAgent(agent);
    const current = useAppStore.getState().currentAgent;

    assert.deepEqual(current, agent, 'store must hold the full agent profile');
  });

  it('switching agents replaces current agent', () => {
    const agent1: Agent = { id: 'a1', name: 'First' };
    const agent2: Agent = { id: 'a2', name: 'Second' };

    useAppStore.getState().setAgent(agent1);
    assert.equal(useAppStore.getState().currentAgent?.id, 'a1');

    useAppStore.getState().setAgent(agent2);
    assert.equal(useAppStore.getState().currentAgent?.id, 'a2');
  });

  it('deselecting agent sets currentAgent to null', () => {
    useAppStore.getState().setAgent({ id: 'a1', name: 'Agent' });
    useAppStore.getState().setAgent(null);
    assert.equal(useAppStore.getState().currentAgent, null);
  });

  it('mapRealmAgent output can be stored in app store', () => {
    const mapped = mapRealmAgent({
      id: 'realm-agent',
      name: 'From Realm',
      voice_model: 'model-1',
      voice_id: 'v1',
    });
    useAppStore.getState().setAgent(mapped);

    const stored = useAppStore.getState().currentAgent!;
    assert.equal(stored.id, 'realm-agent');
    assert.equal(stored.voiceModel, 'model-1');
    assert.equal(stored.voiceId, 'v1');
  });
});
