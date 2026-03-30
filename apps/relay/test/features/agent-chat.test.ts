import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { useAppStore } from '../../src/renderer/app-shell/providers/app-store.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(
  testDir,
  '..',
  '..',
  'src',
  'renderer',
  'features',
  'chat',
  'hooks',
  'use-pipeline-chat.ts',
), 'utf8');

beforeEach(() => {
  useAppStore.setState({
    currentAgent: null,
    runtimeAvailable: false,
    realtimeConnected: false,
    authState: 'pending',
    authError: null,
    currentUser: null,
    detailMode: 'none',
  });
});

describe('RL-FEAT-001 — canChat feature gate', () => {
  it('false when no agent selected', () => {
    useAppStore.setState({ runtimeAvailable: true });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false);
  });

  it('false when runtime unavailable', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'Agent' }, runtimeAvailable: false });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, false);
  });

  it('true when agent selected AND runtime available', () => {
    useAppStore.setState({ currentAgent: { id: 'a1', name: 'Agent' }, runtimeAvailable: true });
    const { currentAgent, runtimeAvailable } = useAppStore.getState();
    assert.equal(!!currentAgent && runtimeAvailable, true);
  });

  it('hook exposes the same gate from currentAgent and runtimeAvailable', () => {
    assert.match(source, /canChat:\s*!!currentAgent\s*&&\s*runtimeAvailable/, 'usePipelineChat must gate chat on both currentAgent and runtime availability');
  });
});

describe('RL-CORE-004 — chat bridge payloads carry agent context', () => {
  it('sendMessage trims text and sends agentId through bridge.chat.send', () => {
    assert.match(source, /await getBridge\(\)\.chat\.send\(\{\s*agentId:\s*currentAgent\.id,\s*text:\s*text\.trim\(\),/s, 'sendMessage must send trimmed text with the selected agentId');
  });

  it('cancelTurn uses bridge.chat.cancel with the resolved turn transaction id', () => {
    assert.match(source, /await getBridge\(\)\.chat\.cancel\(\{\s*turnTxnId:\s*transactionId\s*\}\)/s, 'cancelTurn must forward the active turnTxnId to the bridge');
  });
});

describe('RL-CORE-002 — agent change resets chat state', () => {
  it('setAgent updates store subscribers and setAgent(null) clears currentAgent', () => {
    const agentIds: string[] = [];
    const unsub = useAppStore.subscribe((state) => {
      if (state.currentAgent) agentIds.push(state.currentAgent.id);
    });

    useAppStore.getState().setAgent({ id: 'a1', name: 'First' });
    useAppStore.getState().setAgent({ id: 'a2', name: 'Second' });
    useAppStore.getState().setAgent(null);

    assert.deepEqual(agentIds, ['a1', 'a2']);
    assert.equal(useAppStore.getState().currentAgent, null);
    unsub();
  });

  it('hook clears chat state and reloads agent history on agent changes', () => {
    assert.match(source, /clearChat\(\);/, 'usePipelineChat must clear chat state before loading the next agent session');
    assert.match(source, /getBridge\(\)\.chat\.history\(\{\s*agentId:\s*requestAgentId\s*\}\)/s, 'usePipelineChat must reload history for the newly selected agent');
  });
});
