import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/app/image-studio-state.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function failedBindingMissing() {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'failed',
    reasonCode: 'ai-config-binding-missing',
    actionHint: 'inspect_runtime_image_generate_failure',
    source: 'runtime',
    message: 'AIConfig targetRef is required for image.generate; runtime invocation failed closed before request dispatch.',
    promptLength: 42,
    jobId: null,
    jobStatus: null,
    artifactCount: 0,
    firstArtifact: null,
    artifacts: [],
    traceId: null,
  };
}

function routeWithImageBinding() {
  return {
    ready: true,
    reasonCode: 'runtime-route-ready',
    targetRefKinds: {
      'text.generate': 'local-runtime',
      'image.generate': 'cloud-connector',
    },
  };
}

function routeWithoutImageBinding() {
  return {
    ready: false,
    reasonCode: 'zhiyu-ai-config-route-selection-required',
    targetRefKinds: {},
  };
}

test('clears a stale binding-missing failure once the route binds image.generate', async () => {
  const { reconcileZhiyuImageStudioWithRoute } = await loadModule();
  const next = reconcileZhiyuImageStudioWithRoute(failedBindingMissing(), routeWithImageBinding());

  assert.equal(next.state, 'idle');
  assert.equal(next.ready, false);
  assert.equal(next.reasonCode, 'zhiyu-image-studio-idle');
  assert.equal(next.actionHint, 'enter_image_generation_prompt');
  assert.equal(next.artifactCount, 0);
  assert.equal(next.jobId, null);
});

test('keeps a binding-missing failure while image.generate is still unbound', async () => {
  const { reconcileZhiyuImageStudioWithRoute } = await loadModule();
  const current = failedBindingMissing();
  const next = reconcileZhiyuImageStudioWithRoute(current, routeWithoutImageBinding());

  assert.equal(next, current);
});

test('keeps non-binding failures even when the route is bound', async () => {
  const { reconcileZhiyuImageStudioWithRoute } = await loadModule();
  const current = {
    ...failedBindingMissing(),
    reasonCode: 'runtime-call-failed',
    message: 'Runtime image generation failed.',
  };
  const next = reconcileZhiyuImageStudioWithRoute(current, routeWithImageBinding());

  assert.equal(next, current);
});

test('keeps succeeded results untouched', async () => {
  const { reconcileZhiyuImageStudioWithRoute } = await loadModule();
  const current = {
    ...failedBindingMissing(),
    ready: true,
    state: 'succeeded',
    reasonCode: 'zhiyu-image-studio-artifacts-ready',
    artifactCount: 1,
  };
  const next = reconcileZhiyuImageStudioWithRoute(current, routeWithImageBinding());

  assert.equal(next, current);
});
