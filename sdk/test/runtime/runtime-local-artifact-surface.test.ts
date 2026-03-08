import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RuntimeLocalRuntimeAnonymousMethodIds,
  RuntimeMethodIds,
  RuntimeWriteMethodIds,
  isRuntimeLocalRuntimeAnonymousMethod,
  isRuntimeWriteMethod,
} from '../../src/runtime/method-ids.js';
import { buildLocalImageWorkflowExtensions } from '../../src/runtime/runtime-media.js';

test('runtime method groups classify local artifact RPCs correctly', () => {
  const anonymousMethods = [
    RuntimeMethodIds.localRuntime.listLocalArtifacts,
    RuntimeMethodIds.localRuntime.listVerifiedArtifacts,
  ];
  const writeMethods = [
    RuntimeMethodIds.localRuntime.installVerifiedArtifact,
    RuntimeMethodIds.localRuntime.importLocalArtifact,
    RuntimeMethodIds.localRuntime.removeLocalArtifact,
  ];

  for (const methodId of anonymousMethods) {
    assert.equal(RuntimeLocalRuntimeAnonymousMethodIds.includes(methodId), true);
    assert.equal(isRuntimeLocalRuntimeAnonymousMethod(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), false);
  }

  for (const methodId of writeMethods) {
    assert.equal(RuntimeWriteMethodIds.includes(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), true);
    assert.equal(isRuntimeLocalRuntimeAnonymousMethod(methodId), false);
  }
});

test('buildLocalImageWorkflowExtensions normalizes workflow selections and preserves unrelated extensions', () => {
  const extensions = buildLocalImageWorkflowExtensions(
    {
      components: [
        { slot: '  vae  ', localArtifactId: ' artifact-vae ' },
        { slot: 'llm', localArtifactId: 'artifact-llm' },
        { slot: '', localArtifactId: 'ignored-empty-slot' },
        { slot: 'clip', localArtifactId: '' },
      ],
      profileOverrides: {
        step: 8,
        cfg_scale: 1.5,
      },
    },
    {
      preserved: true,
    },
  );

  assert.deepEqual(extensions, {
    preserved: true,
    components: [
      { slot: 'vae', localArtifactId: 'artifact-vae' },
      { slot: 'llm', localArtifactId: 'artifact-llm' },
    ],
    profile_overrides: {
      step: 8,
      cfg_scale: 1.5,
    },
  });
});
