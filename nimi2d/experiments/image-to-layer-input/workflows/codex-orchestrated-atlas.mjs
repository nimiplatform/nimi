#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function usage() {
  return [
    'Usage:',
    '  node experiments/image-to-layer-input/workflows/codex-orchestrated-atlas.mjs \\',
    '    --atlas-spec <atlas-spec.yaml> --report <workflow-report.yaml> --out <next-prompt.md> \\',
    '    [--upstream-quality <upstream-quality.yaml>] [--producer-manifest <codex-image2.artifact.yaml>]',
    '',
    'Default mode writes a Codex-ready repair prompt.',
    'Direct Codex SDK execution is disabled; use the standard image2 provider commands for live execution.',
  ].join('\n');
}

function getFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

async function readOptional(filePath) {
  if (!filePath) return '';
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function inferUpstreamQualityPath(reportPath) {
  const outputDir = path.dirname(path.resolve(reportPath));
  const runDir = path.dirname(outputDir);
  return path.join(runDir, 'quality/upstream-quality.yaml');
}

function inferProducerManifestPath(reportPath) {
  const outputDir = path.dirname(path.resolve(reportPath));
  const runDir = path.dirname(outputDir);
  return path.join(runDir, 'source/codex-image2-producer-manifest.yaml');
}

async function buildRepairPrompt(input) {
  const atlasPrompt = await readFile(path.join(root, 'prompts/atlas-prompt-v1.md'), 'utf8');
  const repairPrompt = await readFile(path.join(root, 'prompts/repair-prompt-v1.md'), 'utf8');
  const atlasSpec = await readFile(path.resolve(input.atlasSpecPath), 'utf8');
  const workflowReport = await readFile(path.resolve(input.reportPath), 'utf8');
  const upstreamQuality = await readOptional(input.upstreamQualityPath ?? inferUpstreamQualityPath(input.reportPath));
  const producerManifest = await readOptional(input.producerManifestPath ?? inferProducerManifestPath(input.reportPath));
  const generatedLayerInput = await readOptional(path.join(path.dirname(path.resolve(input.reportPath)), 'layer-input/layer-input.yaml'));
  return [
    '# Nimi2D Codex-Orchestrated Atlas Repair Turn',
    '',
    'You are operating the Nimi2D image-to-layer-input upstream experiment.',
    'Use the repair contract below and return the requested YAML decision only.',
    '',
    '## Base Atlas Prompt',
    '',
    atlasPrompt.trim(),
    '',
    '## Repair Contract',
    '',
    repairPrompt.trim(),
    '',
    '## Atlas Spec',
    '',
    '```yaml',
    atlasSpec.trim(),
    '```',
    '',
    '## Workflow Report',
    '',
    '```yaml',
    workflowReport.trim(),
    '```',
    '',
    upstreamQuality
      ? ['## Upstream Image Quality Report', '', '```yaml', upstreamQuality.trim(), '```'].join('\n')
      : '## Upstream Image Quality Report\n\nNot available.',
    '',
    producerManifest
      ? ['## Upstream Producer Manifest', '', '```yaml', producerManifest.trim(), '```'].join('\n')
      : '## Upstream Producer Manifest\n\nNot available.',
    '',
    generatedLayerInput
      ? ['## Generated Layer Input', '', '```yaml', generatedLayerInput.trim(), '```'].join('\n')
      : '## Generated Layer Input\n\nNot available.',
    '',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const atlasSpecPath = getFlag(args, '--atlas-spec');
  const reportPath = getFlag(args, '--report');
  const upstreamQualityPath = getFlag(args, '--upstream-quality');
  const producerManifestPath = getFlag(args, '--producer-manifest');
  const outPath = getFlag(args, '--out');
  const shouldRun = args.includes('--run');
  if (!atlasSpecPath || !reportPath || !outPath) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const prompt = await buildRepairPrompt({
    atlasSpecPath,
    reportPath,
    upstreamQualityPath,
    producerManifestPath,
  });
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  if (!shouldRun) {
    await writeFile(outPath, prompt, 'utf8');
    process.stdout.write(JSON.stringify({
      status: 'ok',
      kind: 'codex_orchestrated_atlas_prompt',
      mode: 'dry_run_prompt',
      outPath: path.resolve(outPath),
    }, null, 2));
    process.stdout.write('\n');
    return;
  }
  throw new Error('NIMI2D_CODEX_SDK_BYPASS_DISABLED: direct @openai/codex-sdk execution is not an admitted Image2 provider path. Use image2-provider-plan/run/register/layer-workflow.');
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    status: 'error',
    kind: 'codex_orchestrated_atlas_prompt',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.stdout.write('\n');
  process.exitCode = 1;
});
