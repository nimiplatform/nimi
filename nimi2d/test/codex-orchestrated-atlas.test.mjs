import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const workflowPath = path.join(packageRoot, 'experiments/image-to-layer-input/workflows/codex-orchestrated-atlas.mjs');

async function writeRepairInputs(tempDir) {
  const outputDir = path.join(tempDir, 'output');
  const qualityDir = path.join(tempDir, 'quality');
  await mkdir(outputDir, { recursive: true });
  await mkdir(qualityDir, { recursive: true });

  const atlasSpecPath = path.join(tempDir, 'atlas-spec.yaml');
  const reportPath = path.join(outputDir, 'workflow-report.yaml');
  const upstreamQualityPath = path.join(qualityDir, 'upstream-quality.yaml');
  const producerManifestPath = path.join(tempDir, 'source', 'codex-image2-producer-manifest.yaml');

  await writeFile(atlasSpecPath, [
    'kind: nimi2d.atlas_spec.v1',
    'columns: 3',
    'rows: 2',
  ].join('\n'), 'utf8');
  await writeFile(reportPath, [
    'decision:',
    '  verdict: pass',
    '  reason: downstream layer workflow passed',
  ].join('\n'), 'utf8');
  await writeFile(upstreamQualityPath, [
    'kind: nimi2d.codex_image2.upstream_atlas_quality.v1',
    'decision:',
    '  verdict: fail',
    'gates:',
    '  pure_chroma_key_background:',
    '    status: fail',
    '    metrics:',
    '      exactKeyPct: 0',
    '  no_visible_grid_lines:',
    '    status: fail',
  ].join('\n'), 'utf8');
  await mkdir(path.dirname(producerManifestPath), { recursive: true });
  await writeFile(producerManifestPath, [
    'manifest_kind: nimi.nimi2d.codex-image2.artifact',
    'schema_version: 1',
    'verdict: admit',
    'producer:',
    '  family: codex_image2',
    '  surface: codex_cli',
    'artifact:',
    '  file_sha256: abc123',
    'evidence:',
    '  pixel_identity:',
    '    status: pass',
  ].join('\n'), 'utf8');

  return {
    atlasSpecPath,
    reportPath,
    upstreamQualityPath,
    producerManifestPath,
  };
}

test('Codex atlas orchestration includes upstream image quality failures in repair prompt', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-codex-orchestrated-atlas-'));
  const outPath = path.join(tempDir, 'repair-prompt.md');
  const {
    atlasSpecPath,
    reportPath,
    upstreamQualityPath,
  } = await writeRepairInputs(tempDir);

  const { stdout } = await execFileAsync(process.execPath, [
    workflowPath,
    '--atlas-spec', atlasSpecPath,
    '--report', reportPath,
    '--out', outPath,
  ], { cwd: packageRoot });

  const result = JSON.parse(stdout);
  assert.equal(result.status, 'ok');
  assert.equal(result.mode, 'dry_run_prompt');

  const prompt = await readFile(outPath, 'utf8');
  assert.match(prompt, /## Upstream Image Quality Report/);
  assert.match(prompt, /## Upstream Producer Manifest/);
  assert.match(prompt, /pixel_identity:/);
  assert.match(prompt, /status: pass/);
  assert.match(prompt, /pure_chroma_key_background/);
  assert.match(prompt, /exactKeyPct: 0/);
  assert.match(prompt, /no_visible_grid_lines/);
  assert.match(prompt, /next_image_prompt/);
  assert.match(prompt, /continuous uninterrupted green field/);
});

test('Codex atlas orchestration refuses direct SDK execution bypass', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-codex-orchestrated-atlas-bypass-'));
  const outPath = path.join(tempDir, 'repair-response.md');
  const {
    atlasSpecPath,
    reportPath,
    upstreamQualityPath,
  } = await writeRepairInputs(tempDir);

  try {
    await execFileAsync(process.execPath, [
      workflowPath,
      '--atlas-spec', atlasSpecPath,
      '--report', reportPath,
      '--upstream-quality', upstreamQualityPath,
      '--out', outPath,
      '--run',
    ], { cwd: packageRoot });
    assert.fail('expected direct SDK execution to be rejected');
  } catch (error) {
    const result = JSON.parse(error.stdout);
    assert.equal(result.status, 'error');
    assert.match(result.message, /NIMI2D_CODEX_SDK_BYPASS_DISABLED/);
  }
});
