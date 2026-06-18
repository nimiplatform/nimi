#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function usage() {
  return [
    'Usage:',
    '  node experiments/image-to-layer-input/workflows/codex-orchestrated-atlas.mjs \\',
    '    --atlas-spec <atlas-spec.yaml> --report <workflow-report.yaml> --out <next-prompt.md> [--run]',
    '',
    'Default mode writes a Codex-ready repair prompt.',
    '--run additionally requires @openai/codex-sdk to be installed and authorized.',
  ].join('\n');
}

function getFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function buildRepairPrompt(input) {
  const atlasPrompt = await readFile(path.join(root, 'prompts/atlas-prompt-v1.md'), 'utf8');
  const repairPrompt = await readFile(path.join(root, 'prompts/repair-prompt-v1.md'), 'utf8');
  const atlasSpec = await readFile(path.resolve(input.atlasSpecPath), 'utf8');
  const workflowReport = await readFile(path.resolve(input.reportPath), 'utf8');
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
    generatedLayerInput
      ? ['## Generated Layer Input', '', '```yaml', generatedLayerInput.trim(), '```'].join('\n')
      : '## Generated Layer Input\n\nNot available.',
    '',
  ].join('\n');
}

async function runCodexSdk(prompt) {
  let sdk;
  try {
    sdk = await import('@openai/codex-sdk');
  } catch (error) {
    throw new Error(`NIMI2D_CODEX_SDK_UNAVAILABLE: install @openai/codex-sdk to use --run (${error instanceof Error ? error.message : String(error)})`);
  }
  const { Codex } = sdk;
  const codex = new Codex();
  const thread = codex.startThread();
  return await thread.run(prompt);
}

async function main() {
  const args = process.argv.slice(2);
  const atlasSpecPath = getFlag(args, '--atlas-spec');
  const reportPath = getFlag(args, '--report');
  const outPath = getFlag(args, '--out');
  const shouldRun = args.includes('--run');
  if (!atlasSpecPath || !reportPath || !outPath) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const prompt = await buildRepairPrompt({ atlasSpecPath, reportPath });
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
  const result = await runCodexSdk(prompt);
  const text = typeof result === 'string' ? result : result.final_response ?? JSON.stringify(result, null, 2);
  await writeFile(outPath, text, 'utf8');
  process.stdout.write(JSON.stringify({
    status: 'ok',
    kind: 'codex_orchestrated_atlas_prompt',
    mode: 'codex_sdk_run',
    outPath: path.resolve(outPath),
  }, null, 2));
  process.stdout.write('\n');
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
