import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { withFixtureRuntimeLocalAgent } from './e2e/electron-real-local-agent-fixture.mjs';

const fixturePath = new URL('./e2e/electron-real-local-agent-fixture.mjs', import.meta.url);
const electronMainPath = new URL('../src-electron/main.ts', import.meta.url);

test('real local-app fixture consumes only the shared Desktop handoff truth', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nimi-zhiyu-local-app-handoff-'));
  const handoffPath = path.join(root, 'desktop-handoff.json');
  const previous = process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH;
  const handoff = {
    schemaVersion: 'nimi.local-agent-product-desktop-handoff/v2',
    runtimeEndpoint: '127.0.0.1:46371',
    realmBaseUrl: 'http://127.0.0.1:49100',
    standardDataRoot: path.join(root, 'standard-data'),
    ownerUserId: 'owner-a',
    runtimeSourceRef: 'runtime-source-a',
    localAgentRef: 'local-agent-a',
    sourceKind: 'worldCharacter',
    sourceRef: { kind: 'worldCharacter', worldId: 'world-a', sourceId: 'character-a' },
    displayName: '真实伙伴 A',
    agents: [{
      sourceKind: 'worldCharacter',
      runtimeSourceRef: 'runtime-source-a',
      localAgentRef: 'local-agent-a',
      displayName: '真实伙伴 A',
    }],
  };
  await writeFile(handoffPath, `${JSON.stringify(handoff)}\n`);
  process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH = handoffPath;
  try {
    let observed;
    await withFixtureRuntimeLocalAgent(async (context) => {
      observed = context;
    });
    assert.equal(observed.handoff.schemaVersion, handoff.schemaVersion);
    assert.equal(observed.targetAgent.ownerUserId, handoff.ownerUserId);
    assert.equal(observed.targetAgent.runtimeSourceRef, handoff.runtimeSourceRef);
    assert.equal(observed.targetAgent.localAgentRef, handoff.localAgentRef);
    assert.equal(Object.hasOwn(observed, 'runtime'), false);
    assert.equal(Object.hasOwn(observed, 'agentClient'), false);
    assert.equal(Object.hasOwn(observed, 'inspect'), false);
    assert.equal(Object.hasOwn(observed, 'setPresentationProfile'), false);
  } finally {
    if (previous === undefined) delete process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH;
    else process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('real local-app fixture contains no retired bearer or Node Runtime setup carrier', async () => {
  const source = await readFile(fixturePath, 'utf8');
  assert.doesNotMatch(source, /local-first-party-agent-presentation|createRuntimeForEndpoint|admitLocalFirstPartyRuntimeAccountCaller/u);
  assert.doesNotMatch(source, /createFixtureRuntimeAgentClient|createNimiHostRuntimeAgentInspectSurface/u);
  assert.match(source, /shared Desktop-to-Zhiyu product runner handoff/u);
});

test('Zhiyu local-development build consumes only the final Kit Electron app bridge', async () => {
  const source = await readFile(electronMainPath, 'utf8');
  assert.match(
    source,
    /if \(isLocalDevelopmentBuild\) \{\s*registerNimiElectronAppBridge\(\{\s*appId: APP_ID,\s*allowedRendererUrls: allowedRendererUrls\(\),\s*ipcMain,\s*\}\);\s*\} else \{/u,
  );
  assert.doesNotMatch(source, /createNimiElectronLocalAppHost/u);
  const appBridgeCall = source.match(/registerNimiElectronAppBridge\(\{([\s\S]*?)\}\);/u)?.[1] || '';
  assert.doesNotMatch(appBridgeCall, /endpoint|runtimeEndpoint|trustedRuntimeMetadataProvider|standardShellHost/u);
});
