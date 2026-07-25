import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'repair-runtime-local-models.mjs');

async function makeRepairFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-repair-local-models-'));
  const modelsRoot = path.join(root, 'models');
  const localStatePath = path.join(root, 'local-state.json');
  await fs.mkdir(modelsRoot, { recursive: true });
  await fs.writeFile(path.join(modelsRoot, 'model.gguf'), 'model-bytes');
  await fs.writeFile(localStatePath, `${JSON.stringify({
    schemaVersion: 2,
    savedAt: '2026-05-08T00:00:00Z',
    assets: [{
      localAssetId: 'local-asset-1',
      assetId: 'local-import/test-model',
      logicalModelId: 'local/test-model',
      entry: 'model.gguf',
      engine: 'llama',
      capabilities: ['text.generate'],
      status: 4,
      healthDetail: 'model removed',
      hashes: {},
    }],
  }, null, 2)}\n`);
  return { root, modelsRoot, localStatePath };
}

function runRepair(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('repair-runtime-local-models --help is non-mutating help output', () => {
  const result = runRepair(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node scripts\/repair-runtime-local-models\.mjs/);
  assert.doesNotMatch(result.stdout, /assets_examined=/);
});

test('repair-runtime-local-models write refuses local_unverified repair without admission', async () => {
  const { modelsRoot, localStatePath } = await makeRepairFixture();
  const result = runRepair([
    '--write',
    '--local-state-path', localStatePath,
    '--models-root', modelsRoot,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without explicit integrity evidence or --integrity-admission-ref/);
});

test('repair-runtime-local-models write records explicit local_unverified admission ref', async () => {
  const { modelsRoot, localStatePath } = await makeRepairFixture();
  const admissionRef = '.nimi/spec/desktop/shell-runtime.authority.yaml#rule.nimi.desktop.shell-runtime.r029';
  const result = runRepair([
    '--write',
    '--integrity-admission-ref', admissionRef,
    '--local-state-path', localStatePath,
    '--models-root', modelsRoot,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mode=write/);
  assert.match(result.stdout, /assets_repaired=1/);

  const manifestPath = path.join(modelsRoot, 'resolved', 'local', 'test-model', 'asset.manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.integrity_mode, 'local_unverified');
  assert.equal(manifest.repair_admission_ref, admissionRef);

  const state = JSON.parse(await fs.readFile(localStatePath, 'utf8'));
  assert.equal(state.assets[0].status, 1);
});
