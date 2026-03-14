import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RuntimeLocalAnonymousMethodIds,
  RuntimeMethodIds,
  RuntimeWriteMethodIds,
  isRuntimeLocalAnonymousMethod,
  isRuntimeWriteMethod,
} from '../../src/runtime/method-ids.js';
import { buildLocalImageWorkflowExtensions } from '../../src/runtime/runtime-media.js';

test('runtime method groups classify local artifact RPCs correctly', () => {
  const anonymousMethods = [
    RuntimeMethodIds.local.listLocalArtifacts,
    RuntimeMethodIds.local.listVerifiedArtifacts,
  ];
  const writeMethods = [
    RuntimeMethodIds.local.installVerifiedArtifact,
    RuntimeMethodIds.local.importLocalArtifact,
    RuntimeMethodIds.local.removeLocalArtifact,
  ];

  for (const methodId of anonymousMethods) {
    assert.equal(RuntimeLocalAnonymousMethodIds.includes(methodId), true);
    assert.equal(isRuntimeLocalAnonymousMethod(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), false);
  }

  for (const methodId of writeMethods) {
    assert.equal(RuntimeWriteMethodIds.includes(methodId), true);
    assert.equal(isRuntimeWriteMethod(methodId), true);
    assert.equal(isRuntimeLocalAnonymousMethod(methodId), false);
  }
});

test('runtime method groups classify local profile RPCs correctly', () => {
  assert.equal(RuntimeLocalAnonymousMethodIds.includes(RuntimeMethodIds.local.resolveProfile), true);
  assert.equal(isRuntimeLocalAnonymousMethod(RuntimeMethodIds.local.resolveProfile), true);
  assert.equal(isRuntimeWriteMethod(RuntimeMethodIds.local.resolveProfile), false);

  assert.equal(RuntimeWriteMethodIds.includes(RuntimeMethodIds.local.applyProfile), true);
  assert.equal(isRuntimeWriteMethod(RuntimeMethodIds.local.applyProfile), true);
  assert.equal(isRuntimeLocalAnonymousMethod(RuntimeMethodIds.local.applyProfile), false);
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
