import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentCenter,
  createAgentCenterI18n,
  createFirstPartyAgentCenterSession,
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
  const projectSharedAIConfig = () => ({
    aiConfig,
    capabilities: aiConfig.capabilities.map((intent) => intent.capabilityContract),
    intents: aiConfig.capabilities.map((intent) => ({
      capability: intent.capabilityContract,
      route: intent.route.oneofKind,
      requiredFeatures: [...intent.requiredFeatures],
    })),
  });
  const session = createFirstPartyAgentCenterSession({
    identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
    sharedAIConfig: {
      async get() {
        return projectSharedAIConfig();
      },
      async overwrite(input) {
        aiConfig = { ...aiConfig, capabilities: [...input.capabilities] };
        return projectSharedAIConfig();
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
