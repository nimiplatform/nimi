import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';
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

test('Zhiyu route projection reads selected NimiAIConfig target refs for required product capabilities', async () => {
  const module = await importRouteModule();
  const scopeRef = module.createZhiyuAgentHomeAIScopeRef();
  const targetRef = {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: 'local-runtime:text-ready',
  };
  const config = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': targetRef,
        'text.embed': targetRef,
        'image.generate': targetRef,
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const seen = [];
  const routeRuntime = {
    async resolve(input) {
      seen.push(['resolve', input.capability, input.targetRef]);
      return {
        capability: input.capability,
        source: 'local-runtime',
        targetRef: input.targetRef,
        resolvedBindingRef: `local:${input.capability}:text-ready`,
        provider: 'local',
        model: 'runtime-text-model',
        localAssetId: 'local-text-asset',
      };
    },
    async checkHealth(input) {
      seen.push(['health', input.capability, input.targetRef]);
      return {
        healthy: true,
        status: 'healthy',
        provider: 'local',
        detail: '',
        actionHint: 'none',
      };
    },
    async describe(input) {
      seen.push(['describe', input.capability, input.resolvedBindingRef]);
      return {
        capability: input.capability,
        metadataKind: input.capability,
        metadataVersion: 'v1',
        resolvedBindingRef: input.resolvedBindingRef,
        metadata: input.capability === 'text.generate'
          ? {
              supportsThinking: true,
              traceModeSupport: 'separate',
              supportsImageInput: false,
              supportsAudioInput: false,
              supportsVideoInput: false,
              supportsArtifactRefInput: false,
            }
          : {},
      };
    },
  };

  const route = await module.probeZhiyuRuntimeRouteProjection({
    config,
    routeRuntime,
  });

  assert.equal(route.ready, true);
  assert.equal(route.reasonCode, 'runtime-route-ready');
  assert.equal(route.capability, 'text.generate');
  assert.equal(route.aiConfigScopeOwnerId, 'nimi.zhiyu');
  assert.deepEqual(route.enabledCapabilities, ['text.generate', 'chat.stream', 'text.embed', 'image.generate']);
  assert.deepEqual(route.bindingCapabilities, {
    'text.generate': 'text.generate',
    'chat.stream': 'text.generate',
    'text.embed': 'text.embed',
    'image.generate': 'image.generate',
  });
  assert.deepEqual(route.targetRefKinds, {
    'text.generate': 'local-runtime',
    'chat.stream': 'local-runtime',
    'text.embed': 'local-runtime',
    'image.generate': 'local-runtime',
  });
  assert.equal(route.executionBinding.route, 'local');
  assert.equal(route.executionBinding.modelId, 'runtime-text-model');
  assert.deepEqual(route.executionBinding.targetRef, targetRef);
  assert.deepEqual(seen.find((entry) => entry[0] === 'resolve' && entry[1] === 'text.generate')?.[2], targetRef);
});

test('Zhiyu route projection fails closed until AIConfig text target is selected', async () => {
  const module = await importRouteModule();
  const config = {
    scopeRef: module.createZhiyuAgentHomeAIScopeRef(),
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-runtime:image-ready',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };

  const route = await module.probeZhiyuRuntimeRouteProjection({
    config,
    routeRuntime: {
      async resolve() {
        throw new Error('route runtime must not be called without text.generate selection');
      },
      async checkHealth() {
        throw new Error('route runtime must not be called without text.generate selection');
      },
      async describe() {
        throw new Error('route runtime must not be called without text.generate selection');
      },
    },
  });

  assert.equal(route.ready, false);
  assert.equal(route.reasonCode, 'zhiyu-ai-config-route-selection-required');
  assert.equal(route.executionBinding, null);
  assert.equal(route.targetRefKinds['text.generate'], null);
  assert.equal(route.targetRefKinds['chat.stream'], null);
  assert.equal(route.targetRefKinds['image.generate'], 'local-runtime');
});

async function importRouteModule() {
  const outputPath = path.join(await buildRouteModule(), 'route-projection.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildRouteModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-ai-config-route-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent/route-projection.ts')],
    outfile: path.join(buildDir, 'route-projection.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch(async (error) => {
    const text = await readFile(path.join(root, 'src/shell/agent/route-projection.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu route projection: ${error.message}\nsource length=${text.length}`);
  });
  return buildDir;
}
