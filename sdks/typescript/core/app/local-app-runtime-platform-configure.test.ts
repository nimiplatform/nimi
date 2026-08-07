import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureShell,
} from './local-app-runtime-platform-configure.js';

function shell(calls: string[]): NimiLocalAppAgentConfigureShell {
  const touched = (name: string) => async (): Promise<never> => {
    calls.push(name);
    throw new Error(name);
  };
  return {
    sharedAgentAIConfigGet: touched('sharedAgentAIConfigGet'),
    sharedAgentAIConfigOverwrite: touched('sharedAgentAIConfigOverwrite'),
    sharedAgentAIProfilePreview: touched('sharedAgentAIProfilePreview'),
    sharedAgentAIProfileApply: touched('sharedAgentAIProfileApply'),
    autonomySnapshot: touched('autonomySnapshot'),
    updateAutonomy: touched('updateAutonomy'),
    presentationSnapshot: touched('presentationSnapshot'),
    commitPresentation: touched('commitPresentation'),
  };
}

test('Agent configure remains typed unavailable without invoking its carrier', async () => {
  const calls: string[] = [];
  const client = createNimiLocalAppAgentConfigureClient(shell(calls));
  await assert.rejects(
    client.sharedAIConfig.get(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
  );
  await assert.rejects(
    client.autonomySnapshot({ agentHandle: 'agent-selector' as never }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
  );
  assert.deepEqual(calls, []);
});

test('Agent configure rejects expanded host methods', () => {
  const carrier = shell([]) as NimiLocalAppAgentConfigureShell & Record<string, unknown>;
  carrier.genericInvoke = async () => ({});
  assert.throws(
    () => createNimiLocalAppAgentConfigureClient(carrier),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CARRIER_REQUIRED',
  );
});
