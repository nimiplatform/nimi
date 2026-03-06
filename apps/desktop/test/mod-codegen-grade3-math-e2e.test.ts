import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodegenRuntimeModRegistration,
  generateCodegenArtifacts,
  resolveCodegenConsentDecision,
} from '../src/runtime/mod/codegen';
import {
  listRegisteredRuntimeModIds,
  registerRuntimeMod,
  resetRuntimeHostForTesting,
  unregisterRuntimeMod,
} from '../src/runtime/mod/host';

test('grade3 math prompt can generate/install/register in codegen happy path', async () => {
  resetRuntimeHostForTesting();

  const artifacts = generateCodegenArtifacts({
    modId: 'world.nimi.user-math-quiz',
    slug: 'math-quiz',
    prompt: '给我三年级孩子做一个每日数学题测试',
    capabilities: [
      'runtime.ai.text.generate',
      'runtime.ai.text.stream',
      'ui.register.ui-extension.app.content.routes',
      'data.register.data-api.user-math-quiz.records.upsert',
      'data.query.data-api.user-math-quiz.records.list',
    ],
    modelUsed: 'deepseek-v3',
    routePolicy: 'token-api',
  });

  assert.equal(artifacts.preflight.ok, true);

  const consent = resolveCodegenConsentDecision({
    preflight: artifacts.preflight,
    approvedCapabilities: [],
  });

  const registration = buildCodegenRuntimeModRegistration({
    artifacts,
    consent,
    setup: () => {},
    teardown: () => {},
  });

  await registerRuntimeMod(registration, { replaceExisting: true });

  assert.ok(listRegisteredRuntimeModIds().includes('world.nimi.user-math-quiz'));

  unregisterRuntimeMod('world.nimi.user-math-quiz');
  resetRuntimeHostForTesting();
});
