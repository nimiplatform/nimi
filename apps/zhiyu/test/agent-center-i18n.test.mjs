import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentCenter,
  createAgentCenterI18n,
  createFirstPartyAgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';
import { createNimiRuntimeAgentModelSettingsScopeRef } from '@nimiplatform/sdk/runtime';

(globalThis).React = React;
const zh = createAgentCenterI18n({ language: 'zh' });

async function createSession() {
  const session = createFirstPartyAgentCenterSession({
    identity: { ownerUserId: 'owner', runtimeSourceRef: 'source', localAgentRef: 'agent' },
    modelSettings: {
      async snapshot() {
        return {
          scopeRef: createNimiRuntimeAgentModelSettingsScopeRef('agent'), capabilities: [],
          routeIntents: [], readiness: [], configurationRevision: '1',
        };
      },
      async update(input) {
        return {
          scopeRef: createNimiRuntimeAgentModelSettingsScopeRef('agent'), capabilities: [],
          routeIntents: input.routeIntents, readiness: [], configurationRevision: '2',
        };
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
  assert.match(appearance, /尚未(?:导入|配置).*Avatar/u);
  assert.match(behavior, /让伙伴在合适的时候出现/u);
  assert.match(cognition, /认知状态/u);
  assert.doesNotMatch(appearance, /Configure this partner avatar/u);
});
