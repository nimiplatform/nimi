import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu Image Studio delegates image.generate to the shared Kit helper', async () => {
  const module = await importImageStudioGenerate();
  const captured = [];
  const runtime = { ai: {}, artifacts: {}, scheduling: {} };
  const result = await module.runZhiyuImageStudioGenerate({
    runtime,
    config: createAIConfig(),
    prompt: 'generate a runtime-owned artifact',
    negativePrompt: 'low quality',
    scenarioId: 'zhiyu-image-studio-test',
    subjectUserId: 'subject-user-1',
    onJobUpdate: (job) => captured.push(['job', job]),
    withScopes: async (scopes, operation) => {
      captured.push(['scopes', scopes]);
      return operation({ metadata: { 'x-nimi-access-token-id': 'token-1' } });
    },
    generate: async (input) => {
      captured.push(['generate', input]);
      input.onJobUpdate?.({ jobId: 'job-image-1', status: 2 });
      return {
        ok: true,
        capabilityId: 'image.generate',
        message: 'image complete',
        output: {
          kind: 'image-artifacts',
          jobId: 'job-image-1',
          jobStatus: 'COMPLETED',
          artifactCount: 1,
          firstArtifact: {
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
            previewSource: 'runtime-artifact-read',
            previewUrl: 'data:image/png;base64,AQID',
          },
          artifacts: [{
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
            previewSource: 'runtime-artifact-read',
            previewUrl: 'data:image/png;base64,AQID',
          }],
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(captured[0][0], 'generate');
  const delegated = captured[0][1];
  assert.equal(delegated.runtime, runtime);
  assert.equal(delegated.appId, 'nimi.zhiyu');
  assert.deepEqual(delegated.config, createAIConfig());
  assert.equal(delegated.prompt, 'generate a runtime-owned artifact');
  assert.equal(delegated.negativePrompt, 'low quality');
  assert.equal(delegated.scenarioId, 'zhiyu-image-studio-test');
  assert.equal(delegated.subjectUserId, 'subject-user-1');
  assert.equal(delegated.surfaceId, 'zhiyu.image-studio.image.generate');
  assert.deepEqual(delegated.metadata, {
    productSurface: 'image-studio',
    zhiyuSurface: 'agent-home',
  });
  assert.equal(typeof delegated.onJobUpdate, 'function');
  assert.equal(typeof delegated.withScopes, 'function');
  assert.deepEqual(captured[1], ['job', { jobId: 'job-image-1', status: 2 }]);
});

test('Zhiyu Image Studio source imports the Kit generation runtime helper and no private app source', async () => {
  const source = await readFile(path.join(root, 'src/shell/image-studio/zhiyu-image-generate.ts'), 'utf8');
  assert.match(source, /@nimiplatform\/kit\/features\/generation\/runtime/);
  assert.doesNotMatch(source, /apps\/tester|apps\/desktop|runtime\/internal/);
  assert.doesNotMatch(source, /submitScenarioJob\(|getScenarioArtifacts\(|readArtifactBytes\(|fetch\(/);
});

async function importImageStudioGenerate() {
  const outputPath = path.join(await buildImageStudioGenerate(), 'zhiyu-image-generate.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildImageStudioGenerate() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-image-studio-generate-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/image-studio/zhiyu-image-generate.ts')],
    outfile: path.join(buildDir, 'zhiyu-image-generate.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch(async (error) => {
    const source = await readFile(path.join(root, 'src/shell/image-studio/zhiyu-image-generate.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu Image Studio generate wrapper: ${error.message}\nsource length=${source.length}`);
  });
  return buildDir;
}

function createAIConfig() {
  return {
    scopeRef: {
      kind: 'app',
      ownerId: 'nimi.zhiyu',
      surfaceId: 'zhiyu-agent-home',
    },
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'runtime-agent-live-e2e-image',
        },
      },
      selectedParams: {
        'image.generate': {
          size: '1024x1024',
        },
      },
    },
    profileOrigin: null,
  };
}
