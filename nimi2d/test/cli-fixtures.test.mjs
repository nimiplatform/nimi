import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { rgbaPng, unverifiedCharacterPackage, wardrobePackage } from './package-fixture.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const fixtureDir = path.join(packageRoot, 'fixtures/basic-character');
const layerInputPath = path.join(fixtureDir, 'layer-input.yaml');

async function runCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd: packageRoot });
    return { exitCode: 0, result: JSON.parse(stdout) };
  } catch (error) {
    assert.equal(error.code, 1);
    return { exitCode: error.code, result: JSON.parse(error.stdout) };
  }
}

test('CLI validates real layers and refuses to publish an unsolved character package', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-cli-'));
  const packagePath = path.join(tempDir, 'package.yaml');
  const layerValidation = await runCli(['validate-layer-input', layerInputPath]);
  assert.equal(layerValidation.exitCode, 0);
  assert.equal(layerValidation.result.status, 'ok');

  const solved = await runCli(['solve-package', layerInputPath, '--out', packagePath]);
  assert.equal(solved.exitCode, 1);
  assert.equal(solved.result.status, 'reject');
  assert.ok(solved.result.codes.includes('NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE'));
  assert.equal(solved.result.manifest, undefined);
  await assert.rejects(access(packagePath), { code: 'ENOENT' });
  await writeFile(packagePath, 'existing output');
  await runCli(['solve-package', layerInputPath, '--out', packagePath]);
  assert.equal(await readFile(packagePath, 'utf8'), 'existing output');
});

test('CLI package, render and proof commands all require actual character admission', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-cli-admission-'));
  const packagePath = path.join(tempDir, 'package.yaml');
  await writeFile(path.join(tempDir, 'pixel.png'), rgbaPng);
  await writeFile(packagePath, JSON.stringify(await unverifiedCharacterPackage()));
  for (const command of ['validate-package', 'render-plan', 'prove-visual-frame', 'run-reference-action-bench', 'run-reference-action-stress']) {
    const { exitCode, result } = await runCli([command, packagePath]);
    assert.equal(exitCode, 1, command);
    assert.equal(result.status, 'reject', command);
    assert.ok(result.codes.includes('NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE'), command);
    assert.equal(result.renderPlan, undefined, command);
  }
  await writeFile(packagePath, JSON.stringify(await wardrobePackage()));
  const admittedWardrobe = await runCli(['validate-package', packagePath]);
  assert.equal(admittedWardrobe.exitCode, 1);
  assert.equal(admittedWardrobe.result.status, 'reject');
  assert.ok(admittedWardrobe.result.codes.includes('NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED'));
});
