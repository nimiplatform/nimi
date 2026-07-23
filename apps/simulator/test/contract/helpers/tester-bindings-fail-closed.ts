import assert from 'node:assert/strict';

import { testerCapabilities } from '../../../../tester/src/tester/tester-capabilities.ts';
import { createTesterSimulatorBindings } from '../../../../tester/src/simulator/bindings.ts';
import { simulatorConformanceFixture } from '../../../../tester/src/simulator/fixture.ts';
import { fixtureCanonicalBindings } from '../fixtures.mjs';

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
  promptDrafts: {},
  ecosystemReference: null,
  personaReference: null,
  aiConfig: {
    scopeRef: { kind: 'app', ownerId: 'nimi.tester', surfaceId: 'app-lab' },
    capabilities: { targetRefs: {}, selectedParams: {} },
    profileOrigin: null,
  },
};
let rejectedCommandCount = 0;
const bindings = createTesterSimulatorBindings({
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'tester',
  instanceId: 'tester-instance-fail-closed',
  surfaceId: 'main',
  epoch: 1,
  abortSignal: new AbortController().signal,
  kit: fixtureCanonicalBindings('tester-fail-closed').kit,
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

for (const capability of testerCapabilities) {
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

for (const operation of [
  () => bindings.app.commands.saveArtifact({ filename: 'x.png', dataUrl: 'data:,' }),
  () => bindings.app.commands.resolveWorldTourFixture({}),
  () => bindings.app.commands.openWorldTourWindow({ manifestPath: 'fixture.json' }),
  () => bindings.app.commands.claimWorldTourViewerLaunch({ manifestPath: 'fixture.json', launchToken: 'token' }),
  () => bindings.app.commands.saveWorldTourViewerPreset({ manifestPath: 'fixture.json', presetJson: '{}' }),
  () => bindings.app.commands.saveWorldTourRenderAcceptance({
    manifestPath: 'fixture.json',
    renderer: 'spark-2.0',
    status: 'passed',
    acceptedAt: '2027-01-15T08:00:00.000Z',
  }),
  () => bindings.app.commands.localAppStorageRoundTrip({ relativePath: 'x.json', value: { value: 1 } }),
]) {
  await assert.rejects(operation, { code: 'TESTER_SIMULATED_EFFECT_UNAVAILABLE' });
}

for (const operation of [
  () => bindings.sdk.settings.notificationUnread(),
  () => bindings.sdk.settings.notifications(),
  () => bindings.sdk.settings.requestDataExport(),
  () => bindings.sdk.settings.creatorEligibility(),
  () => bindings.sdk.settings.humanChats(),
  () => bindings.sdk.settings.groupChats(),
]) {
  await assert.rejects(operation, { code: 'TESTER_SIMULATED_SDK_METHOD_UNAVAILABLE' });
}

process.stdout.write('tester-bindings-fail-closed: OK\n');
