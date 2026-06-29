import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import YAML from 'yaml';

import { encodePngRgba } from '../src/node/png-rgba-encode.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(packageRoot, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

function fixturePngBuffer(foreground = [80, 120, 190, 255]) {
  const width = 8;
  const height = 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = foreground[0];
      rgba[offset + 1] = foreground[1];
      rgba[offset + 2] = foreground[2];
      rgba[offset + 3] = foreground[3];
    }
  }
  return encodePngRgba({ width, height, rgba });
}

async function writeFixturePng(filePath, foreground = [80, 120, 190, 255]) {
  await writeFile(filePath, fixturePngBuffer(foreground));
}

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
  });
  return JSON.parse(stdout);
}

async function runCliExpectReject(args) {
  try {
    await runCli(args);
    assert.fail('expected command to reject');
  } catch (error) {
    if (!error.stdout) throw error;
    return JSON.parse(error.stdout);
  }
}

async function runCliExpectRejectWithin(args, timeout = 2000) {
  try {
    await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: packageRoot,
      timeout,
    });
    assert.fail('expected command to reject');
  } catch (error) {
    if (!error.stdout) throw error;
    return JSON.parse(error.stdout);
  }
}

async function writeHangingCodex(filePath) {
  await writeFile(filePath, [
    '#!/usr/bin/env node',
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'), 'utf8');
  await chmod(filePath, 0o755);
}

async function writeNoResponseCodex(filePath) {
  await writeFile(filePath, [
    '#!/usr/bin/env node',
    'process.stdin.resume();',
    'process.stdin.on("end", () => process.exit(0));',
    '',
  ].join('\n'), 'utf8');
  await chmod(filePath, 0o755);
}

async function writeHangThenSuccessCodex(filePath) {
  const pngBase64 = Buffer.from(fixturePngBuffer([32, 96, 180, 255])).toString('base64');
  await writeFile(filePath, [
    '#!/usr/bin/env node',
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    'let stdin = "";',
    'process.stdin.on("data", (chunk) => { stdin += chunk.toString(); });',
    'process.stdin.on("end", () => {',
    '  const responseIndex = process.argv.indexOf("-o");',
    '  const responsePath = process.argv[responseIndex + 1];',
    '  const imagePath = stdin.match(/Required output image path: (.+)/)?.[1]?.trim();',
    '  const requestId = stdin.match(/request_id: exactly "([^"]+)"/)?.[1] ?? stdin.match(/Request id: ([^\\n]+)/)?.[1]?.trim();',
    '  if (requestId?.endsWith("_attempt_001")) { setInterval(() => {}, 1000); return; }',
    '  if (!responsePath || !imagePath || !requestId) process.exit(2);',
    '  mkdirSync(path.dirname(imagePath), { recursive: true });',
    `  writeFileSync(imagePath, Buffer.from(${JSON.stringify(pngBase64)}, "base64"));`,
    '  writeFileSync(responsePath, JSON.stringify({',
    '    request_id: requestId,',
    '    status: "ok",',
    '    image_path: imagePath,',
    '    evidence_image_path: imagePath,',
    '    summary: "fake codex succeeded on retry",',
    '    failure_reason: null,',
    '  }, null, 2));',
    '});',
    '',
  ].join('\n'), 'utf8');
  await chmod(filePath, 0o755);
}

async function writeFailThenSuccessCodex(filePath) {
  const pngBase64 = Buffer.from(fixturePngBuffer([20, 150, 90, 255])).toString('base64');
  await writeFile(filePath, [
    '#!/usr/bin/env node',
    'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    `const statePath = ${JSON.stringify(`${filePath}.state`)};`,
    'const count = existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) + 1 : 1;',
    'writeFileSync(statePath, String(count));',
    'let stdin = "";',
    'process.stdin.on("data", (chunk) => { stdin += chunk.toString(); });',
    'process.stdin.on("end", () => {',
    '  const responseIndex = process.argv.indexOf("-o");',
    '  const responsePath = process.argv[responseIndex + 1];',
    '  const imagePath = stdin.match(/Required output image path: (.+)/)?.[1]?.trim();',
    '  const requestId = stdin.match(/request_id: exactly "([^"]+)"/)?.[1] ?? stdin.match(/Request id: ([^\\n]+)/)?.[1]?.trim();',
    '  if (!responsePath || !imagePath || !requestId) process.exit(2);',
    '  if (count === 1) {',
    '    writeFileSync(responsePath, JSON.stringify({',
    '      request_id: requestId,',
    '      status: "fail",',
    '      image_path: null,',
    '      evidence_image_path: null,',
    '      summary: "fake provider response failed before retry",',
    '      failure_reason: "transient fake provider failure",',
    '    }, null, 2));',
    '    return;',
    '  }',
    '  mkdirSync(path.dirname(imagePath), { recursive: true });',
    `  writeFileSync(imagePath, Buffer.from(${JSON.stringify(pngBase64)}, "base64"));`,
    '  writeFileSync(responsePath, JSON.stringify({',
    '    request_id: requestId,',
    '    status: "ok",',
    '    image_path: imagePath,',
    '    evidence_image_path: imagePath,',
    '    summary: "fake codex succeeded after failed provider response",',
    '    failure_reason: null,',
    '  }, null, 2));',
    '});',
    '',
  ].join('\n'), 'utf8');
  await chmod(filePath, 0o755);
}

test('Codex Image2 provider plans prompt-to-image and registers a consumed response artifact', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-'));
  const outDir = path.join(tempDir, 'plan');

  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  assert.equal(planned.status, 'ok');
  assert.equal(planned.workflow, 'prompt_to_image');

  const request = await readYaml(planned.requestPath);
  assert.equal(request.manifest_kind, 'nimi.nimi2d.codex-image2.request');
  assert.equal(request.workflow.kind, 'prompt_to_image');
  assert.equal(request.authority_boundary.formal_nimi2d_admission, 'layer_input_or_package_gates_only');
  const prompt = await readFile(planned.promptPath, 'utf8');
  assert.match(prompt, /Use Codex Image2 \/ Image Gen/);
  assert.match(prompt, /Do not run shell commands, inspect the local repository/);
  assert.match(prompt, /Required output image path:/);
  const outputSchema = JSON.parse(await readFile(planned.schemaPath, 'utf8'));
  assert.deepEqual(
    [...Object.keys(outputSchema.properties)].sort(),
    [...outputSchema.required].sort(),
  );

  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    request_id: request.request_id,
    status: 'ok',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'test harness consumed an already persisted PNG artifact',
    failure_reason: null,
  }, null, 2), 'utf8');

  const run = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(run.status, 'ok');
  assert.equal(run.artifactVerdict, 'admit');

  const artifact = await readYaml(run.artifactManifestPath);
  assert.equal(artifact.manifest_kind, 'nimi.nimi2d.codex-image2.artifact');
  assert.equal(artifact.producer.request.path, planned.requestPath);
  assert.equal(artifact.producer.model, undefined);
  assert.equal(artifact.producer.model_hint, 'gpt-image-2');
  assert.equal(artifact.producer.selected_model, null);
  assert.equal(artifact.evidence.pixel_identity.status, 'pass');
});

test('Codex Image2 provider records selected CLI model separately from request hint', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-model-truth-'));
  const outDir = path.join(tempDir, 'plan');

  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    request_id: request.request_id,
    status: 'ok',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'test harness consumed an already persisted PNG artifact',
    failure_reason: null,
  }, null, 2), 'utf8');

  const run = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
    '--model', 'codex-image2-quality-test',
  ]);
  assert.equal(run.status, 'ok');
  assert.equal(run.artifactVerdict, 'admit');

  const artifact = await readYaml(run.artifactManifestPath);
  assert.equal(artifact.producer.model, undefined);
  assert.equal(artifact.producer.model_hint, 'gpt-image-2');
  assert.equal(artifact.producer.selected_model, 'codex-image2-quality-test');
  assert.equal(artifact.producer.selected_model_source, 'cli_argument');
});

test('Codex Image2 provider dry-run exposes codex exec image attachment for atlas workflow', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-atlas-'));
  const sourceImage = path.join(tempDir, 'source.png');
  await writeFixturePng(sourceImage);
  const outDir = path.join(tempDir, 'plan');

  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'image-to-layer-atlas',
    '--image', sourceImage,
    '--description', 'preserve the courier design and produce the Nimi2D atlas',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  assert.equal(request.inputs.source_image_ref, 'inputs/source.png');
  assert.equal(typeof request.inputs.source_image_sha256, 'string');
  assert.match(request.inputs.source_image_sha256, /^[0-9a-f]{64}$/);
  const runScript = await readFile(planned.scriptPath, 'utf8');
  assert.equal(runScript.includes('--ask-for-approval'), false);
  assert.equal(runScript.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  const dryRun = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(dryRun.status, 'ok');
  assert.equal(dryRun.mode, 'dry_run');
  assert.equal(dryRun.args.includes('exec'), true);
  assert.equal(dryRun.args.includes('--output-schema'), true);
  assert.equal(dryRun.args.includes('-o'), true);
  assert.equal(dryRun.args.includes('--ask-for-approval'), false);
  assert.equal(dryRun.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(dryRun.args.includes('-i'), true);
  assert.equal(dryRun.args[dryRun.args.indexOf('-i') + 1], path.join(outDir, 'inputs', 'source.png'));
  assert.equal(dryRun.args.at(-1), '-');
});

test('Codex Image2 provider rejects request execution cwd outside the provider directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-cwd-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  request.execution.cwd = tempDir;
  await writeFile(planned.requestPath, YAML.stringify(request), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_REQUEST_INVALID/);
  assert.match(rejected.message, /\$\.execution\.cwd/);
});

test('Codex Image2 provider run rejects non-codex_cli adapters', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-adapter-'));
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', path.join(tempDir, 'plan'),
  ]);

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--adapter', 'direct_image_api',
    '--dry-run',
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_ADAPTER_INVALID/);
});

test('Codex Image2 provider rejects timed out Codex CLI execution', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-timeout-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const fakeCodex = path.join(tempDir, 'fake-codex-hang.mjs');
  await writeHangingCodex(fakeCodex);

  const rejected = await runCliExpectRejectWithin([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--adapter', 'codex_cli',
    '--execute',
    '--codex-bin', fakeCodex,
    '--timeout-ms', '50',
  ]);
  assert.equal(rejected.status, 'reject');
  assert.deepEqual(rejected.codes, ['NIMI2D_CODEX_IMAGE2_CLI_TIMEOUT']);
  assert.equal(rejected.issues[0].code, 'NIMI2D_CODEX_IMAGE2_CLI_TIMEOUT');
  assert.match(rejected.issues[0].message, /timed out after 50ms/);
});

test('live provider invariant guard rejects Nimi2D Image2 direct API key drift', async () => {
  const scriptUrl = pathToFileURL(path.join(repoRoot, 'scripts/check-live-provider-invariants.mjs')).href;
  const { collectNimi2DImage2LiveRouteDriftRefs } = await import(scriptUrl);
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-boundary-guard-'));

  await mkdir(path.join(tempRoot, '.nimi/spec/nimi2d/kernel'), { recursive: true });
  await mkdir(path.join(tempRoot, 'nimi2d/src/node/image2-provider'), { recursive: true });
  await mkdir(path.join(tempRoot, 'nimi2d/test'), { recursive: true });

  await writeFile(
    path.join(tempRoot, '.nimi/spec/nimi2d/kernel/codex-image2-provider-contract.md'),
    `Image2 live path must not use ${'NIMI2D_IMAGE2_' + 'OPENAI_API_KEY'}.`,
    'utf8',
  );
  await writeFile(
    path.join(tempRoot, 'nimi2d/src/node/image2-provider/provider-workflow.mjs'),
    `export const bad = "${'openai_' + 'api_key'}";\n`,
    'utf8',
  );
  await writeFile(
    path.join(tempRoot, 'nimi2d/src/node/image2-provider/provider-openai-image-api.mjs'),
    `export const isolated = "${'openai_' + 'image_api'}";\n`,
    'utf8',
  );

  const driftRefs = collectNimi2DImage2LiveRouteDriftRefs(tempRoot);
  assert.equal(driftRefs.some((ref) => ref.path.endsWith('provider-openai-image-api.mjs')), false);
  assert.equal(driftRefs.some((ref) => ref.path.endsWith('codex-image2-provider-contract.md')), true);
  assert.equal(driftRefs.some((ref) => ref.path.endsWith('provider-workflow.mjs')), true);
});

test('Codex Image2 provider retries Codex CLI attempts in isolated output directories', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-attempts-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const fakeCodex = path.join(tempDir, 'fake-codex-retry.mjs');
  await writeHangThenSuccessCodex(fakeCodex);

  const run = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--adapter', 'codex_cli',
    '--execute',
    '--codex-bin', fakeCodex,
    '--timeout-ms', '2000',
    '--attempts', '2',
  ]);
  assert.equal(run.status, 'ok');
  assert.equal(run.executionAttempts.length, 2);
  assert.equal(run.executionAttempts[0].code, 'NIMI2D_CODEX_IMAGE2_CLI_TIMEOUT');
  assert.equal(run.executionAttempts[1].status, 'ok');
  assert.match(run.executionAttempts[0].responsePath.replaceAll('\\', '/'), /\.provider-attempts\/[^/]+\/attempt-001\/codex-response\.json$/);
  assert.match(run.executionAttempts[1].responsePath.replaceAll('\\', '/'), /\.provider-attempts\/[^/]+\/attempt-002\/codex-response\.json$/);
  assert.notEqual(run.executionAttempts[0].expectedImagePath, run.executionAttempts[1].expectedImagePath);
  assert.equal(run.artifactVerdict, 'admit');
  assert.match(run.requestPath.replaceAll('\\', '/'), /\.provider-attempts\/[^/]+\/attempt-002\/provider-request\.yaml$/);
  assert.equal(path.dirname(run.requestPath), path.dirname(run.responsePath));
  const artifact = await readYaml(run.artifactManifestPath);
  assert.match(artifact.producer.request.path.replaceAll('\\', '/'), /\.provider-attempts\/[^/]+\/attempt-002\/provider-request\.yaml$/);
});

test('Codex Image2 provider rejects request manifests without request_id', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-missing-request-id-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  delete request.request_id;
  await writeFile(planned.requestPath, YAML.stringify(request), 'utf8');
  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    request_id: 'stray_response_id',
    status: 'ok',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'fake provider response with no request binding',
    failure_reason: null,
  }, null, 2));

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_REQUEST_INVALID/);
  assert.match(rejected.message, /request_id/);
});

test('Codex Image2 provider rejects successful CLI execution without a response file', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-missing-response-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const fakeCodex = path.join(tempDir, 'fake-codex-no-response.mjs');
  await writeNoResponseCodex(fakeCodex);

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--adapter', 'codex_cli',
    '--execute',
    '--codex-bin', fakeCodex,
  ]);
  assert.equal(rejected.status, 'reject');
  assert.deepEqual(rejected.codes, ['NIMI2D_CODEX_IMAGE2_RESPONSE_MISSING']);
  assert.equal(rejected.issues[0].code, 'NIMI2D_CODEX_IMAGE2_RESPONSE_MISSING');
  assert.match(rejected.issues[0].message, /did not write provider response/);
});

test('Codex Image2 provider retries failed provider responses before consuming success', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-response-retry-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const fakeCodex = path.join(tempDir, 'fake-codex-response-retry.mjs');
  await writeFailThenSuccessCodex(fakeCodex);

  const run = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--adapter', 'codex_cli',
    '--execute',
    '--codex-bin', fakeCodex,
    '--timeout-ms', '1000',
    '--attempts', '2',
  ]);
  assert.equal(run.status, 'ok');
  assert.equal(run.executionAttempts.length, 2);
  assert.equal(run.executionAttempts[0].code, 'NIMI2D_CODEX_IMAGE2_FAILED');
  assert.match(run.executionAttempts[0].message, /transient fake provider failure/);
  assert.equal(run.executionAttempts[1].status, 'ok');
  assert.equal(run.artifactVerdict, 'admit');
});

test('Codex Image2 provider rejects source image refs outside the provider directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-source-ref-'));
  const sourceImage = path.join(tempDir, 'source.png');
  await writeFixturePng(sourceImage);
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'image-to-layer-atlas',
    '--image', sourceImage,
    '--description', 'preserve the courier design and produce the Nimi2D atlas',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  request.inputs.source_image_ref = '../source.png';
  await writeFile(planned.requestPath, YAML.stringify(request), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_REQUEST_INVALID/);
  assert.match(rejected.message, /\$\.inputs\.source_image_ref/);
});

test('Codex Image2 provider rejects request artifact refs outside the provider directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-request-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  request.artifacts.expected_image_ref = '../outside.png';
  await writeFile(planned.requestPath, YAML.stringify(request), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_REQUEST_INVALID/);
  assert.match(rejected.message, /\$\.artifacts\.expected_image_ref/);
});

test('Codex Image2 provider rejects malformed response status before artifact registration', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-response-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    request_id: request.request_id,
    status: 'complete',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'bad status should not be consumed',
    failure_reason: null,
  }, null, 2), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID/);
});

test('Codex Image2 provider rejects response image paths outside expected output ref', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-unexpected-path-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  const alternateImagePath = path.join(tempDir, 'alternate.png');
  await writeFixturePng(planned.expectedImagePath);
  await writeFixturePng(alternateImagePath, [180, 40, 90, 255]);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    request_id: request.request_id,
    status: 'ok',
    image_path: alternateImagePath,
    evidence_image_path: alternateImagePath,
    summary: 'response pointed at an existing but unrequested PNG',
    failure_reason: null,
  }, null, 2), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_UNEXPECTED_IMAGE_PATH/);
});

test('Codex Image2 provider rejects unknown companion slot taxonomy', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-invalid-slot-'));
  const rejected = await runCliExpectReject([
    'image2-provider-plan',
    '--workflow', 'companion-asset',
    '--description', 'small ribbon accessory',
    '--slot-kind', 'made_up_slot',
    '--out-dir', path.join(tempDir, 'plan'),
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /Unsupported Nimi2D slot kind/);
});

test('Codex Image2 register-output fails closed when pixel identity evidence mismatches', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-pixel-mismatch-'));
  const generatedPath = path.join(tempDir, 'generated.png');
  const evidencePath = path.join(tempDir, 'evidence.png');
  const manifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  await writeFixturePng(generatedPath);
  await writeFixturePng(evidencePath, [180, 40, 90, 255]);

  const rejected = await runCliExpectReject([
    'image2-register-output',
    '--image', generatedPath,
    '--evidence-image', evidencePath,
    '--surface', 'codex_cli',
    '--out', manifestPath,
  ]);
  assert.equal(rejected.status, 'reject');
  assert.equal(rejected.verdict, 'reject');

  const manifest = await readYaml(manifestPath);
  assert.equal(manifest.verdict, 'reject');
  assert.equal(manifest.evidence.pixel_identity.status, 'fail');
});
