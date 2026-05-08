import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRuntimeHookRuntime,
  listRegisteredRuntimeModIds,
  registerRuntimeMod,
  resetRuntimeHostForTesting,
} from '../src/runtime/mod/host';

test('runtime mod setup failure leaves no committed hook capability state', async () => {
  resetRuntimeHostForTesting();

  const modId = 'world.nimi.test.failed-hydration';
  const dataCapability = 'data-api.user-failed-hydration.records.list';
  const actionId = 'failed-hydration.read';

  await assert.rejects(
    () => registerRuntimeMod({
      modId,
      sourceType: 'sideload',
      capabilities: [
        `data.register.${dataCapability}`,
        `data.query.${dataCapability}`,
        'runtime.ai.text.generate',
      ],
      manifestCapabilities: [
        `data.register.${dataCapability}`,
        `data.query.${dataCapability}`,
        'runtime.ai.text.generate',
      ],
      grantCapabilities: ['runtime.ai.text.stream'],
      denialCapabilities: ['runtime.media.image.generate'],
      setup: async ({ hookRuntime }) => {
        await hookRuntime.registerDataProvider({
          modId,
          capability: dataCapability,
          handler: () => ({ ok: true }),
        });
        hookRuntime.registerActionV1({
          modId,
          descriptor: {
            actionId,
            inputSchema: {},
            outputSchema: {},
            operation: 'read',
            riskLevel: 'low',
            executionMode: 'guarded',
            idempotent: true,
            supportsDryRun: true,
            verifyPolicy: 'optional',
          },
          handler: () => ({
            ok: true,
            reasonCode: 'OK',
            actionHint: 'done',
            output: {},
          }),
        });
        throw new Error('setup failed after hook mutation');
      },
    }),
    /setup failed after hook mutation/,
  );

  const hookRuntime = getRuntimeHookRuntime();
  assert.ok(!listRegisteredRuntimeModIds().includes(modId));
  assert.deepEqual(hookRuntime.getPermissionDeclaration(modId), {
    modId,
    sourceType: 'sideload',
    baseline: [],
    grants: [],
    denials: [],
  });
  assert.ok(!hookRuntime.listDataCapabilities().includes(dataCapability));
  assert.equal(
    hookRuntime.listRegistrations(modId).filter((registration) => registration.status === 'ACTIVE').length,
    0,
  );
  assert.ok(!hookRuntime.discoverActions({ modId }).some((action) => action.actionId === actionId));

  resetRuntimeHostForTesting();
});
