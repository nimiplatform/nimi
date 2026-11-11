import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageControlType } from '../../core-generated/runtime-typed-client';
import { toRuntimeScenario } from './runtime-scenarios';

test('image generation retains the typed owned control map without turning it into a reference image', () => {
  const control = { imageArtifactId: 'owned-control', type: ImageControlType.CANNY, strength: 0.75 };
  const request = toRuntimeScenario({ kind: 'image', prompt: 'yellow cup', size: '1024x1024', controlImage: control });
  assert.equal(request.spec.spec.oneofKind, 'imageGenerate');
  if (request.spec.spec.oneofKind !== 'imageGenerate') throw new Error('image scenario missing');
  assert.deepEqual(request.spec.spec.imageGenerate.controlImage, control);
  assert.deepEqual(request.spec.spec.imageGenerate.referenceImages, []);
  assert.equal(request.spec.spec.imageGenerate.referenceImageArtifactId, '');
  control.imageArtifactId = 'changed';
  assert.equal(request.spec.spec.imageGenerate.controlImage?.imageArtifactId, 'owned-control');
});
