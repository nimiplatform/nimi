import assert from 'node:assert/strict';

import { labCapabilities } from '../../../../lab/src/lab/lab-capabilities.ts';
import { createLabSimulatorBindings } from '../../../../lab/src/simulator/bindings.ts';
import { simulatorConformanceFixture } from '../../../../lab/src/simulator/fixture.ts';
import { fixtureCanonicalBindings } from '../fixtures.mjs';

function asset(relativePath: string, body: readonly number[]) {
  return {
    relativePath,
    mediaType: 'application/octet-stream',
    sizeBytes: body.length,
    sha256: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
    body,
  };
}

const projection = {
  protocolRevision: 1,
  scenario: {
    ...simulatorConformanceFixture.catalog.moduleData,
    runtimePlatform: {
      ...simulatorConformanceFixture.catalog.moduleData.runtimePlatform,
      reasonCode: 'fixture-owned-local-app-unavailable',
    },
    aiConfigSummary: {
      ...simulatorConformanceFixture.catalog.moduleData.aiConfigSummary,
      runtime: {
        ...simulatorConformanceFixture.catalog.moduleData.aiConfigSummary.runtime,
        detail: 'fixture-owned-runtime-detail',
      },
    },
  },
  runHistory: {},
  imageHistory: [],
  assets: {
    foo: asset('foo', [1, 2, 3]),
    'foo/child.bin': asset('foo/child.bin', [4]),
    foobar: asset('foobar', [5]),
    '媒体/é.wav': asset('媒体/é.wav', [6, 7]),
  },
  promptDrafts: {},
  ecosystemReference: null,
  personaReference: null,
  aiConfig: {
    owner: {},
    capabilities: {},
  },
};
let rejectedCommandCount = 0;
const bindings = createLabSimulatorBindings({
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'lab',
  instanceId: 'lab-instance-fail-closed',
  surfaceId: 'main',
  epoch: 1,
  abortSignal: new AbortController().signal,
  kit: fixtureCanonicalBindings('lab-fail-closed').kit,
  commands: {
    async invoke() {
      rejectedCommandCount += 1;
      return { ok: false, error: { code: 'TEST_REJECTED_COMMAND' } };
    },
  },
  events: {
    subscribe: () => ({ ok: false, error: { code: 'TEST_UNDECLARED_EVENT' } }),
  },
  cleanup: {
    add: () => ({ ok: true, value: { registrationId: 'unused' } }),
  },
  projection: {
    get: () => projection,
    subscribe: () => () => undefined,
  },
  route: {
    get: () => ({ pathname: '/', search: [], fragment: null }),
    subscribe: () => () => undefined,
    navigate: async () => ({ ok: false, error: { code: 'TEST_ROUTE_REJECTED' } }),
  },
  clock: { now: () => 1_800_000_000_000 },
});

const runtimePlatform = await bindings.app.projection.runtimePlatform();
assert.equal(runtimePlatform.status, 'unavailable');
assert.equal(runtimePlatform.status === 'ready' ? null : runtimePlatform.reasonCode, 'fixture-owned-local-app-unavailable');
const aiConfigSummary = await bindings.app.projection.aiConfigSummary();
assert.equal(aiConfigSummary.runtime.status, 'simulated');
assert.equal(aiConfigSummary.runtime.mode, 'simulated');
assert.equal(aiConfigSummary.runtime.detail, 'fixture-owned-runtime-detail');
assert.deepEqual(await bindings.app.commands.localAppSessionStatus(), {
  state: 'unavailable',
  sessionBound: false,
});

for (const capability of labCapabilities) {
  if (capability.id === 'text.generate') continue;
  const result = await bindings.sdk.runCapability({
    capabilityId: capability.id,
    prompt: 'must fail closed',
  });
  assert.equal(result.ok, false, capability.id);
  if (!result.ok) assert.equal(result.reason, 'sdk-method-unavailable', capability.id);
}
assert.equal(rejectedCommandCount, 0, 'unmodeled capabilities must not enter the State Engine');

assert.deepEqual(await bindings.app.commands.copyText('forbidden'), {
  ok: false,
  error: { disposition: 'effect-forbidden' },
});
assert.deepEqual(await bindings.app.commands.exportText({ filename: 'forbidden.txt', body: 'x' }), {
  ok: false,
  error: { disposition: 'effect-forbidden' },
});
assert.deepEqual(await bindings.app.commands.exportArtifact({ filename: 'forbidden.bin', url: 'data:,' }), {
  ok: false,
  error: { disposition: 'effect-forbidden' },
});
assert.equal(rejectedCommandCount, 0, 'forbidden browser effects must not enter the State Engine');

const draft = await bindings.app.commands.savePromptDraft({
  surfaceId: 'ai-capabilities',
  capabilityId: 'text.generate',
  scenarioId: 'default',
}, 'rejected draft', true);
assert.equal(draft.status.state, 'write-error');
assert.equal(rejectedCommandCount, 1);

assert.deepEqual(await bindings.app.commands.runtimeLog({ message: 'rejected runtime diagnostic' }), {
  ok: false,
  error: { disposition: 'host-unavailable' },
});
assert.deepEqual(await bindings.app.commands.rendererLog({ message: 'rejected renderer diagnostic' }), {
  ok: false,
  error: { disposition: 'host-unavailable' },
});
assert.equal(rejectedCommandCount, 3);

await assert.rejects(
  () => bindings.sdk.storage.assets.write({ relativePath: 'media/x.png', body: Uint8Array.from([1]) }),
  { code: 'LAB_SIMULATED_ACTION_REJECTED' },
);
assert.equal(rejectedCommandCount, 4, 'modeled asset writes must enter the State Engine');

assert.equal((await bindings.sdk.storage.assets.stat('媒体/é.wav')).relativePath, '媒体/é.wav');
const exactPrefix = await bindings.sdk.storage.assets.list({ prefix: 'foo', pageSize: 500 });
assert.deepEqual(exactPrefix.assets.map(({ relativePath }) => relativePath), ['foo']);
const componentPrefix = await bindings.sdk.storage.assets.list({ prefix: 'foo/' });
assert.deepEqual(componentPrefix.assets.map(({ relativePath }) => relativePath), ['foo/child.bin']);
const firstPage = await bindings.sdk.storage.assets.list({ prefix: '', pageSize: 1 });
assert.notEqual(firstPage.nextCursor, '');
await assert.rejects(
  () => bindings.sdk.storage.assets.list({ prefix: 'foo/', cursor: firstPage.nextCursor, pageSize: 1 }),
  { reasonCode: 'invalid-cursor' },
);
const emptyRead = await bindings.sdk.storage.assets.read({ relativePath: 'foo', offset: 3 });
assert.deepEqual(emptyRead.range, { offset: 3, length: 0, totalSize: 3 });
const emptyChunks: number[][] = [];
for await (const chunk of emptyRead.body) emptyChunks.push([...chunk]);
assert.deepEqual(emptyChunks, []);
const clampedRead = await bindings.sdk.storage.assets.read({ relativePath: 'foo', offset: 1, length: 100 });
assert.deepEqual(clampedRead.range, { offset: 1, length: 2, totalSize: 3 });
const clampedChunks: number[] = [];
for await (const chunk of clampedRead.body) clampedChunks.push(...chunk);
assert.deepEqual(clampedChunks, [2, 3]);

for (const operation of [
  () => bindings.app.commands.resolveWorldTourFixture({}),
  () => bindings.app.commands.openWorldTourWindow({ manifestPath: 'fixture.json' }),
  () => bindings.app.commands.claimWorldTourViewerLaunch({ manifestPath: 'fixture.json', launchToken: 'token' }),
  () => bindings.app.commands.saveWorldTourViewerPreset({ manifestPath: 'fixture.json', presetJson: '{}' }),
  () => bindings.app.commands.localAppStorageRoundTrip({ relativePath: 'x.json', value: { value: 1 } }),
]) {
  await assert.rejects(operation, { code: 'LAB_SIMULATED_EFFECT_UNAVAILABLE' });
}

for (const operation of [
  () => bindings.sdk.settings.notificationUnread(),
  () => bindings.sdk.settings.notifications(),
  () => bindings.sdk.settings.creatorEligibility(),
  () => bindings.sdk.settings.humanChats(),
]) {
  await assert.rejects(operation, { code: 'LAB_SIMULATED_SDK_METHOD_UNAVAILABLE' });
}

process.stdout.write('lab-bindings-fail-closed: OK\n');
