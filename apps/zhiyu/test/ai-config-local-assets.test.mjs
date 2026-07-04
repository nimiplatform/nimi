import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;
let importCounter = 0;
const builtEntries = new Set();

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu model config local asset source projects Runtime companion assets', async () => {
  const provider = await importProvider();
  assert.equal(typeof provider.listZhiyuRuntimeModelConfigLocalAssetsFromRuntime, 'function');
  assert.equal(typeof provider.createZhiyuModelConfigLocalAssetSource, 'function');

  const calls = [];
  const assets = await provider.listZhiyuRuntimeModelConfigLocalAssetsFromRuntime({
    local: {
      async listLocalAssets(request) {
        calls.push(request);
        return {
          assets: [
            localAssetRecord({
              localAssetId: 'local-z-image-vae',
              assetId: 'local-import/z_image_turbo_vae',
              kind: 'LOCAL_ASSET_KIND_VAE',
              engine: 'media',
              status: 'LOCAL_ASSET_STATUS_ACTIVE',
              family: 'z-image-turbo',
            }),
            localAssetRecord({
              localAssetId: 'local-z-image-llm',
              assetId: 'local-import/qwen-image-llm',
              kind: 'LOCAL_ASSET_KIND_CHAT',
              engine: 'llama',
              status: 'LOCAL_ASSET_STATUS_INSTALLED',
            }),
            localAssetRecord({
              localAssetId: 'local-z-image-uncond',
              assetId: 'local-import/z_image_turbo_uncond',
              kind: 'LOCAL_ASSET_KIND_IMAGE',
              engine: 'media',
              status: 'LOCAL_ASSET_STATUS_INSTALLED',
              artifactRoles: [' uncond_diffusion_model '],
            }),
          ],
          nextPageToken: '',
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].pageSize > 0);
  assert.deepEqual(assets.map((asset) => ({
    localAssetId: asset.localAssetId,
    kind: asset.kind,
    status: asset.status,
    family: asset.family,
    modelFamily: asset.modelFamily,
    artifactRoles: asset.artifactRoles,
  })), [
    {
      localAssetId: 'local-z-image-vae',
      kind: 'vae',
      status: 'active',
      family: 'z-image-turbo',
      modelFamily: 'z-image-turbo',
      artifactRoles: undefined,
    },
    {
      localAssetId: 'local-z-image-llm',
      kind: 'chat',
      status: 'installed',
      family: undefined,
      modelFamily: undefined,
      artifactRoles: undefined,
    },
    {
      localAssetId: 'local-z-image-uncond',
      kind: 'image',
      status: 'installed',
      family: undefined,
      modelFamily: undefined,
      artifactRoles: ['uncond_diffusion_model'],
    },
  ]);

  const source = provider.createZhiyuModelConfigLocalAssetSource({
    loading: false,
    assets,
  });
  assert.equal(source.loading, false);
  assert.deepEqual(source.list().map((asset) => asset.localAssetId), [
    'local-z-image-vae',
    'local-z-image-llm',
    'local-z-image-uncond',
  ]);
});

test('Zhiyu image config companion slots expose Runtime VAE and LLM assets', async () => {
  const provider = await importProvider();
  const constants = await importModelConfigConstants();
  const assets = await provider.listZhiyuRuntimeModelConfigLocalAssetsFromRuntime({
    local: {
      async listLocalAssets() {
        return {
          assets: [
            localAssetRecord({
              localAssetId: 'local-z-image-main',
              assetId: 'local-import/z_image_turbo',
              kind: 'LOCAL_ASSET_KIND_IMAGE',
              engine: 'media',
              family: 'z-image-turbo',
            }),
            localAssetRecord({
              localAssetId: 'local-z-image-vae',
              assetId: 'local-import/z_image_turbo_vae',
              kind: 'LOCAL_ASSET_KIND_VAE',
              engine: 'media',
              family: 'z-image-turbo',
            }),
            localAssetRecord({
              localAssetId: 'local-z-image-llm',
              assetId: 'local-import/qwen-image-llm',
              kind: 'LOCAL_ASSET_KIND_CHAT',
              engine: 'llama',
            }),
            localAssetRecord({
              localAssetId: 'local-z-image-removed-vae',
              assetId: 'local-import/removed_vae',
              kind: 'LOCAL_ASSET_KIND_VAE',
              engine: 'media',
              status: 'LOCAL_ASSET_STATUS_REMOVED',
            }),
          ],
          nextPageToken: '',
        };
      },
    },
  });
  const source = provider.createZhiyuModelConfigLocalAssetSource({
    loading: false,
    assets,
  });
  const companionSlots = constants.resolveImageCompanionSlotsForModelFamily('z-image-turbo');
  const vaeSlot = companionSlots.find((slot) => slot.kind === 'vae');
  const llmSlot = companionSlots.find((slot) => slot.kind === 'chat');
  assert.ok(vaeSlot, 'image config must expose a VAE companion slot');
  assert.ok(llmSlot, 'image config must expose an LLM companion slot');

  assert.deepEqual(
    constants.filterAssetsForCompanionSlot(source.list(), vaeSlot).map((asset) => asset.localAssetId),
    ['local-z-image-vae'],
  );
  assert.deepEqual(
    constants.filterAssetsForCompanionSlot(source.list(), llmSlot).map((asset) => asset.localAssetId),
    ['local-z-image-llm'],
  );
});

async function importProvider() {
  const outputPath = path.join(await buildProvider(), 'zhiyu-runtime-model-provider.mjs');
  importCounter += 1;
  return import(`${pathToFileURL(outputPath).href}?case=${importCounter}`);
}

async function importModelConfigConstants() {
  const outputPath = await buildEntrypoint(
    'model-config-constants',
    path.resolve(root, '..', '..', 'kit/features/model-config/src/constants.ts'),
  );
  importCounter += 1;
  return import(`${pathToFileURL(outputPath).href}?case=${importCounter}`);
}

async function buildProvider() {
  return path.dirname(await buildEntrypoint(
    'zhiyu-runtime-model-provider',
    path.join(root, 'src/shell/ai-config/zhiyu-runtime-model-provider.ts'),
  ));
}

async function buildEntrypoint(name, entryPoint) {
  if (!buildDir) {
    mkdirSync(path.join(root, '.tmp'), { recursive: true });
    buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-runtime-model-provider-'));
  }
  const outputPath = path.join(buildDir, `${name}.mjs`);
  if (builtEntries.has(name)) {
    return outputPath;
  }
  await build({
    entryPoints: [entryPoint],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  builtEntries.add(name);
  return outputPath;
}

function localAssetRecord(overrides = {}) {
  return {
    localAssetId: overrides.localAssetId || 'local-asset',
    assetId: overrides.assetId || 'local-import/model',
    kind: overrides.kind || 'LOCAL_ASSET_KIND_CHAT',
    engine: overrides.engine || 'llama',
    entry: '',
    files: [],
    license: '',
    hashes: {},
    status: overrides.status || 'LOCAL_ASSET_STATUS_ACTIVE',
    installedAt: '',
    updatedAt: '',
    healthDetail: '',
    capabilities: overrides.capabilities || [],
    logicalModelId: '',
    family: overrides.family || '',
    artifactRoles: overrides.artifactRoles || [],
    preferredEngine: '',
    fallbackEngines: [],
    bundleState: 0,
    warmState: 0,
    localInvokeProfileId: '',
    endpoint: '',
    reasonCode: 0,
  };
}
