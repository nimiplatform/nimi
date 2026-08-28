import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentCenter,
  createAgentCenterI18n,
  createAppAgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';

(globalThis).React = React;
const zh = createAgentCenterI18n({ language: 'zh' });

async function createSession() {
  let aiConfig = {
    owner: {
      owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
    },
    capabilities: [],
  };
  const memory = {
    outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
    currentCount: 0, supersededCount: 0, forgottenCount: 0,
  };
  const session = createAppAgentCenterSession({
    handle: `agent_ref_${'A'.repeat(43)}`,
    client: {
    sharedAIConfig: {
      async get() {
        return { config: aiConfig, revision: '1', effectiveSelections: [], participation: [] };
      },
      async overwrite(input) {
        aiConfig = { ...aiConfig, capabilities: [...input.capabilities] };
        return { outcome: 'committed', config: aiConfig, revision: '2', participation: [] };
      },
      async listOptions(query) {
        return query.kind === 'preset-voices'
          ? { kind: 'preset-voices', options: [], truncated: false }
          : { kind: 'local-loadouts', options: [], truncated: false };
      },
    },
    autonomy: {
      async snapshot() {
        return { enabled: true, config: { mode: 'low', dailyTokenBudget: 100, maxTokensPerHook: 10 }, usedTokensInWindow: 0, budgetExhausted: false, autonomyRevision: '1' };
      },
      async update(input) {
        return { enabled: input.intent.enabled ?? true, config: input.intent.config ?? null, usedTokensInWindow: 0, budgetExhausted: false, autonomyRevision: '2' };
      },
    },
    presentation: {
      async snapshot() {
        return { profile: null, previousProfile: null, defaultVoiceReference: '', avatarAutoplay: false, presentationRevision: '0' };
      },
      async commit() {
        return { profile: null, previousProfile: null, defaultVoiceReference: '', avatarAutoplay: false, presentationRevision: '1' };
      },
    },
    memory: {
      async inspect() { return memory; },
      async correct() { return { outcome: 'committed', affectedMemoryIds: [], projection: memory }; },
      async forget() { return { outcome: 'forgotten', affectedMemoryIds: [], projection: memory }; },
      async setEnabled() { return { outcome: 'committed', affectedMemoryIds: [], projection: memory }; },
      async deleteAll() { return { outcome: 'deleted', affectedMemoryIds: [], projection: memory }; },
    },
    manager: {
      async snapshot() {
        return { lifecycleStatus: 'active', executionState: 'idle', statusText: 'Ready', currentEmotion: '', source: null, context: null };
      },
    },
    },
  });
  await session.refresh();
  return session;
}

function renderSection(activeSection, session) {
  return renderToStaticMarkup(React.createElement(AgentCenter, {
    activeSection, chrome: 'embedded', i18n: zh, session,
  }));
}

test('Zhiyu can render Kit Agent Center sections from the shipped Chinese catalog', async () => {
  const session = await createSession();
  const appearance = renderSection('appearance', session);
  const behavior = renderSection('behavior', session);
  const cognition = renderSection('cognition', session);
  assert.match(appearance, />外观</u);
  assert.match(appearance, /尚未设置伙伴形象/u);
  assert.match(behavior, /让伙伴主动联系你/u);
  assert.match(cognition, /状态与记忆/u);
  assert.doesNotMatch(appearance, /Configure this partner avatar/u);
});
