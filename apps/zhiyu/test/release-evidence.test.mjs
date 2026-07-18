import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(appRoot, 'scripts', 'pack-release-evidence.mjs');

async function loadPacker() {
  if (!fs.existsSync(scriptPath)) {
    assert.fail('Zhiyu PP12 release evidence packer script is missing');
  }
  return import(`${pathToFileURL(scriptPath).href}?cacheBust=${Date.now()}`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-release-evidence-'));
  writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@nimiplatform/zhiyu', version: '0.1.0', private: true }, null, 2),
  );
  writeFile(path.join(root, 'dist', 'index.html'), '<main id="root"></main>');
  writeFile(path.join(root, 'dist', 'assets', 'index.js'), 'console.log("zhiyu");');
  writeFile(path.join(root, 'dist-electron', 'main.js'), 'export {};');
  writeFile(path.join(root, 'dist-electron', 'preload.cjs'), 'module.exports = {};');
  writeFile(path.join(root, 'dist-electron', 'runtime-auth.js'), 'export const runtimeAuth = true;');
  return root;
}

test('package exposes a PP12 release evidence pack command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['pack:release-evidence'],
    'corepack pnpm run build && corepack pnpm run build:electron && node scripts/pack-release-evidence.mjs',
  );
});

test('release evidence packer writes non-admission artifact evidence from real build outputs', async () => {
  const { buildZhiyuReleaseEvidence } = await loadPacker();
  const root = createFixtureRoot();
  const evidenceDir = path.join(root, '.nimi', 'local', 'evidence', 'zhiyu', 'pp12');

  const result = await buildZhiyuReleaseEvidence({
    rootDir: root,
    repoRoot: root,
    evidenceDir,
    now: new Date('2026-07-02T00:00:00.000Z'),
  });

  assert.ok(fs.existsSync(result.artifactPath), 'artifact tar should be written');
  assert.ok(fs.existsSync(result.evidencePath), 'artifact evidence should be written');

  const artifactBytes = fs.readFileSync(result.artifactPath);
  const evidence = JSON.parse(fs.readFileSync(result.evidencePath, 'utf8'));
  assert.equal(evidence.evidenceRole, 'developer-submitted-input');
  assert.equal(evidence.checkpoint, 'PP12');
  assert.equal(evidence.productReadinessClaimAllowed, false);
  assert.equal(evidence.ordinaryCatalogDiscovery, false);
  assert.equal(evidence.registryAdmissionTruth, 'not-generated');
  assert.equal(evidence.releaseDescriptorTruth, 'not-generated');
  assert.equal(evidence.ordinaryVisibilityTruth, 'not-generated');
  assert.equal(evidence.permissionDecisionTruth, 'not-generated');
  assert.equal(evidence.signingTruth, 'not-generated');
  assert.equal(evidence.notarizationTruth, 'not-generated');
  assert.equal(evidence.mirrorLicenseClearanceTruth, 'not-generated');
  assert.equal(evidence.reviewDecisionTruth, 'not-generated');
  assert.equal(evidence.artifact.digest_algorithm, 'sha256');
  assert.equal(evidence.artifact.sha256, createHash('sha256').update(artifactBytes).digest('hex'));
  assert.equal(evidence.artifact.size.download, String(artifactBytes.length));
  assert.equal(evidence.artifact.size.user_data, 'not-generated');
  assert.equal(evidence.artifact.size.cache, 'not-generated');
  assert.equal(evidence.artifact.size.shared_deps, 'not-generated');
  assert.ok(evidence.artifact.files.some((file) => file.path === 'dist/index.html'));
  assert.ok(evidence.artifact.files.some((file) => file.path === 'dist-electron/main.js'));
  assert.ok(evidence.missingPlatformAdmissionFields.includes('admitted registry row'));
  assert.ok(evidence.missingPlatformAdmissionFields.includes('admitted release descriptor row'));
  assert.ok(evidence.missingPlatformAdmissionFields.includes('public permission requirements set'));
});

test('release evidence packer fails closed when renderer build output is missing', async () => {
  const { buildZhiyuReleaseEvidence } = await loadPacker();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-release-evidence-missing-'));
  writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@nimiplatform/zhiyu', version: '0.1.0', private: true }, null, 2),
  );
  writeFile(path.join(root, 'dist-electron', 'main.js'), 'export {};');

  await assert.rejects(
    () => buildZhiyuReleaseEvidence({ rootDir: root, repoRoot: root }),
    /renderer build output missing/,
  );
});
