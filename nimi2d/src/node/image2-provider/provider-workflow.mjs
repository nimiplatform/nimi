import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from '../common-utils.mjs';
import { layerInputKinds, slotKinds, wardrobeKinds } from '../common-constants.mjs';
import { registerCodexImage2Artifact } from './artifact.mjs';

const CODEX_IMAGE2_REQUEST_KIND = 'nimi.nimi2d.codex-image2.request';
const CODEX_IMAGE2_RUN_KIND = 'nimi.nimi2d.codex-image2.run';

const workflowAliases = new Map([
  ['prompt-to-image', 'prompt_to_image'],
  ['source-image', 'prompt_to_image'],
  ['image-prompt-to-image', 'image_prompt_to_image'],
  ['improve-image', 'image_prompt_to_image'],
  ['image-to-layer-atlas', 'image_to_layer_atlas'],
  ['atlas', 'image_to_layer_atlas'],
  ['companion-asset', 'companion_asset'],
  ['companion', 'companion_asset'],
]);
const admittedWorkflows = new Set(workflowAliases.values());

const workflowLabels = {
  prompt_to_image: 'description to Nimi2D source image',
  image_prompt_to_image: 'image plus description to improved Nimi2D source image',
  image_to_layer_atlas: 'high quality source image to Nimi2D layer atlas',
  companion_asset: 'description or image to Nimi2D companion asset image',
};

const workflowRequiredImage = new Set([
  'image_prompt_to_image',
  'image_to_layer_atlas',
]);

function getFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function requireFlag(args, name) {
  const value = getFlag(args, name);
  if (!value) throw new Error(`Missing required flag: ${name}`);
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function normalizeWorkflow(raw) {
  const workflow = workflowAliases.get(raw) ?? raw;
  if (!admittedWorkflows.has(workflow)) {
    throw new Error(`Unsupported Codex Image2 workflow: ${raw}`);
  }
  return workflow;
}

async function readDescription(args) {
  const descriptionFile = getFlag(args, '--description-file');
  if (descriptionFile) return (await readFile(path.resolve(descriptionFile), 'utf8')).trim();
  const description = getFlag(args, '--description');
  if (description) return description.trim();
  return '';
}

function outputSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['status', 'image_path', 'summary'],
    properties: {
      status: { enum: ['ok', 'fail'] },
      image_path: { type: ['string', 'null'] },
      evidence_image_path: { type: ['string', 'null'] },
      summary: { type: 'string' },
      failure_reason: { type: ['string', 'null'] },
    },
  };
}

function workflowRequirements(input) {
  const common = [
    'Use Codex Image2 / Image Gen, not a hand-drawn SVG, CSS render, screenshot crop, or semantic redraw from local code.',
    'Persist the generated PNG to the exact requested image path.',
    'Return only the JSON object required by the output schema.',
    'If image generation, persistence, or policy admission fails, return status "fail" and do not invent an image path.',
    'No text, watermark, signature, frame, labels, or checkerboard transparency preview.',
    'Keep output SFW, fully clothed for human characters, and suitable for first-party Nimi2D asset generation.',
  ];
  if (input.workflow === 'prompt_to_image') {
    return [
      ...common,
      'Create a high quality Nimi2D source image for later layer extraction.',
      'The full character must be visible with margin around hair, hands, and feet.',
      'Use a plain matte background that can be removed deterministically.',
      'Prioritize crisp edges, readable eyes, mouth, hands, shoes, outfit boundaries, and stable proportions.',
    ];
  }
  if (input.workflow === 'image_prompt_to_image') {
    return [
      ...common,
      'Use the attached image as the identity, pose, and design reference.',
      'Improve image quality for Nimi2D layer extraction without changing the character identity.',
      'Repair blur, muddy boundaries, unclear hands, unreadable mouth/eyes, and weak outfit separation.',
      'Keep the subject fully visible on a plain removable background.',
    ];
  }
  if (input.workflow === 'image_to_layer_atlas') {
    return [
      ...common,
      'Use the attached high quality source image as the character reference.',
      'Create one PNG atlas for the Nimi2D image-input workflow.',
      'Required canvas: exactly 1536 x 1024 px, 3 columns x 2 rows, no visible grid lines.',
      'Use one continuous flat #00ff00 background in all empty areas; do not use near-green gradients.',
      'Cells: row0 col0 clothed registration body silhouette, row0 col1 head/face, row0 col2 hair, row1 col0 eyes/brows, row1 col1 mouth, row1 col2 default outfit.',
      'Every cell must preserve identical registration, scale, and canvas position.',
      'Do not create clothing-removed base textures or hidden body regions under clothing.',
    ];
  }
  return [
    ...common,
    'Create a companion asset image for Nimi2D wardrobe, accessory, prop, hair variant, or scene workflows.',
    'The asset must fit the requested Nimi2D target kind, companion kind, and slot kind.',
    'Use a plain removable background and crisp silhouettes suitable for downstream cutting.',
    'Do not redefine the main character rig; companion assets must bind to existing slots later.',
  ];
}

function buildPrompt(input) {
  const generatedImagePath = path.join(input.outDir, 'generated', 'codex-image2.png');
  const lines = [
    '# Nimi2D Codex Image2 Provider Request',
    '',
    `Workflow: ${workflowLabels[input.workflow]}`,
    `Target input kind: ${input.targetKind}`,
    `Companion kind: ${input.companionKind ?? 'not_applicable'}`,
    `Slot kind: ${input.slotKind ?? 'not_applicable'}`,
    `Required output image path: ${generatedImagePath}`,
    '',
    '## User Description',
    '',
    input.description || 'No additional free-form description was supplied.',
    '',
    '## Requirements',
    '',
    ...workflowRequirements(input).map((item) => `- ${item}`),
    '',
    '## Output Contract',
    '',
    'Return JSON with:',
    '- status: "ok" only after a PNG exists at the required path',
    '- image_path: absolute path to the requested generated PNG, or null on failure',
    '- evidence_image_path: optional absolute path to an official output/evidence PNG if separate',
    '- summary: concise generation summary',
    '- failure_reason: null on success, otherwise exact blocker',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function buildRequest(input) {
  return {
    manifest_kind: CODEX_IMAGE2_REQUEST_KIND,
    schema_version: 1,
    request_id: `codex_image2_${input.workflow}_${input.requestToken}`,
    provider: {
      family: 'codex_image2',
      required_surface: 'codex_cli',
      model_hint: 'gpt-image-2',
      execution: 'codex exec',
    },
    execution: {
      cwd: process.cwd(),
    },
    workflow: {
      kind: input.workflow,
      label: workflowLabels[input.workflow],
      target_input_kind: input.targetKind,
      companion_kind: input.companionKind ?? null,
      slot_kind: input.slotKind ?? null,
    },
    inputs: {
      description_sha256: sha256(input.description),
      source_image_ref: input.sourceImageRef ?? null,
      source_image_sha256: input.sourceImageSha256 ?? null,
    },
    artifacts: {
      prompt_ref: 'prompt.md',
      output_schema_ref: 'codex-image2-output.schema.json',
      expected_image_ref: 'generated/codex-image2.png',
      response_ref: 'codex-response.json',
      artifact_manifest_ref: 'codex-image2.artifact.yaml',
    },
    authority_boundary: {
      provider_output: 'upstream_image_resource_evidence',
      formal_nimi2d_admission: 'layer_input_or_package_gates_only',
      raw_image_direct_package_input: 'forbidden',
    },
  };
}

function buildRunScript() {
  return [
    'param(',
    '  [string]$CodexBin = "codex",',
    '  [string]$Model = ""',
    ')',
    '$ErrorActionPreference = "Stop"',
    '$Root = Split-Path -Parent $PSCommandPath',
    '$Request = Join-Path $Root "provider-request.yaml"',
    '$Prompt = Join-Path $Root "prompt.md"',
    '$Schema = Join-Path $Root "codex-image2-output.schema.json"',
    '$Response = Join-Path $Root "codex-response.json"',
    '$RequestYaml = Get-Content -Raw (Join-Path $Root "provider-request.yaml")',
    '$Cwd = if ($RequestYaml -match "cwd: (.+)") { $Matches[1].Trim() } else { (Get-Location).Path }',
    '$SourceImageRef = if ($RequestYaml -match "source_image_ref: (.+)") { $Matches[1].Trim() } else { "" }',
    '$Args = @("exec", "--cd", $Cwd, "--sandbox", "danger-full-access", "--ask-for-approval", "never", "--output-schema", $Schema, "-o", $Response)',
    'if ($Model.Length -gt 0) { $Args = @("exec", "-m", $Model, "--cd", $Cwd, "--sandbox", "danger-full-access", "--ask-for-approval", "never", "--output-schema", $Schema, "-o", $Response) }',
    'if ($SourceImageRef.Length -gt 0 -and $SourceImageRef -ne "null") { $Args += @("-i", (Join-Path $Root $SourceImageRef)) }',
    '$Args += "-"',
    'Get-Content -Raw $Prompt | & $CodexBin @Args',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'Write-Output "Codex Image2 response written to $Response for request $Request"',
    '',
  ].join('\n');
}

function assertAdmittedProviderTarget(input) {
  if (!layerInputKinds.has(input.targetKind)) {
    throw new Error(`Unsupported Nimi2D target input kind for Codex Image2 provider: ${input.targetKind}`);
  }
  if (input.companionKind && !wardrobeKinds.has(input.companionKind)) {
    throw new Error(`Unsupported Nimi2D companion kind for Codex Image2 provider: ${input.companionKind}`);
  }
  if (input.slotKind && !slotKinds.has(input.slotKind)) {
    throw new Error(`Unsupported Nimi2D slot kind for Codex Image2 provider: ${input.slotKind}`);
  }
}

async function writeCodexImage2Plan(args) {
  const workflow = normalizeWorkflow(requireFlag(args, '--workflow'));
  const outDir = path.resolve(requireFlag(args, '--out-dir'));
  const description = await readDescription(args);
  const sourceImagePath = getFlag(args, '--image');
  if (workflowRequiredImage.has(workflow) && !sourceImagePath) {
    throw new Error(`Workflow ${workflow} requires --image.`);
  }
  if (!description && !sourceImagePath) {
    throw new Error(`Workflow ${workflow} requires --description/--description-file or --image.`);
  }
  const sourceImageAbsolutePath = sourceImagePath ? path.resolve(sourceImagePath) : null;
  const sourceImageRef = sourceImageAbsolutePath ? 'inputs/source.png' : null;
  const sourceImageSha256 = sourceImageAbsolutePath ? sha256(await readFile(sourceImageAbsolutePath)) : null;
  const input = {
    workflow,
    outDir,
    description,
    sourceImagePath: sourceImageAbsolutePath,
    sourceImageRef,
    sourceImageSha256,
    targetKind: getFlag(args, '--target-kind', workflow === 'companion_asset' ? 'accessory_item' : 'character_skin'),
    companionKind: getFlag(args, '--companion-kind', workflow === 'companion_asset' ? 'accessory' : null),
    slotKind: getFlag(args, '--slot-kind', workflow === 'companion_asset' ? 'accessory_head' : null),
    requestToken: sha256(`${workflow}\n${description}\n${sourceImagePath ?? ''}`).slice(0, 12),
  };
  assertAdmittedProviderTarget(input);
  await mkdir(path.join(outDir, 'generated'), { recursive: true });
  if (sourceImageAbsolutePath) {
    await mkdir(path.join(outDir, 'inputs'), { recursive: true });
    await copyFile(sourceImageAbsolutePath, path.join(outDir, 'inputs', 'source.png'));
  }
  const prompt = buildPrompt(input);
  const request = buildRequest(input);
  const promptPath = path.join(outDir, 'prompt.md');
  const requestPath = path.join(outDir, 'provider-request.yaml');
  const schemaPath = path.join(outDir, 'codex-image2-output.schema.json');
  const scriptPath = path.join(outDir, 'run-codex-image2.ps1');
  await writeFile(promptPath, prompt, 'utf8');
  await writeFile(requestPath, YAML.stringify(request), 'utf8');
  await writeFile(schemaPath, `${JSON.stringify(outputSchema(), null, 2)}\n`, 'utf8');
  await writeFile(scriptPath, buildRunScript(), 'utf8');
  return {
    status: 'ok',
    kind: 'codex_image2_provider_plan',
    workflow,
    outDir,
    requestPath,
    promptPath,
    schemaPath,
    scriptPath,
    expectedImagePath: path.join(outDir, 'generated', 'codex-image2.png'),
  };
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(path.resolve(filePath), 'utf8'));
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value, pathLabel) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: ${pathLabel} must be a non-empty string.`);
  }
  return value;
}

function requireRelativeArtifactRef(ref, pathLabel) {
  const value = requireNonEmptyString(ref, pathLabel);
  if (path.isAbsolute(value)) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: ${pathLabel} must be a relative artifact ref inside the provider request directory.`);
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: ${pathLabel} must stay inside the provider request directory.`);
  }
  return value;
}

function resolveRequestArtifactRef(requestPath, ref, pathLabel) {
  const baseDir = path.dirname(path.resolve(requestPath));
  const value = requireRelativeArtifactRef(ref, pathLabel);
  const resolved = path.resolve(baseDir, value);
  const relative = path.relative(baseDir, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: ${pathLabel} must stay inside the provider request directory.`);
  }
  return resolved;
}

function validateCodexImage2Request(request) {
  if (!isObject(request)) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: request manifest must be an object.');
  }
  if (request.manifest_kind !== CODEX_IMAGE2_REQUEST_KIND || request.schema_version !== 1) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: request manifest kind/schema mismatch.');
  }
  if (!isObject(request.workflow)) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: workflow must be an object.');
  }
  const workflowKind = requireNonEmptyString(request.workflow.kind, '$.workflow.kind');
  if (!admittedWorkflows.has(workflowKind)) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: unsupported workflow kind ${workflowKind}.`);
  }
  assertAdmittedProviderTarget({
    targetKind: request.workflow.target_input_kind,
    companionKind: request.workflow.companion_kind,
    slotKind: request.workflow.slot_kind,
  });
  if (!isObject(request.execution) || typeof request.execution.cwd !== 'string' || request.execution.cwd.length === 0) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: $.execution.cwd must be a non-empty string.');
  }
  if (!isObject(request.inputs)) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: inputs must be an object.');
  }
  if (request.inputs.source_image_ref !== null && typeof request.inputs.source_image_ref !== 'string') {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: $.inputs.source_image_ref must be a string or null.');
  }
  if (request.inputs.source_image_ref) {
    requireRelativeArtifactRef(request.inputs.source_image_ref, '$.inputs.source_image_ref');
    if (typeof request.inputs.source_image_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(request.inputs.source_image_sha256)) {
      throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: $.inputs.source_image_sha256 must be lowercase sha256 hex when $.inputs.source_image_ref is present.');
    }
  }
  if (!isObject(request.artifacts)) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: artifacts must be an object.');
  }
  requireRelativeArtifactRef(request.artifacts.prompt_ref, '$.artifacts.prompt_ref');
  requireRelativeArtifactRef(request.artifacts.output_schema_ref, '$.artifacts.output_schema_ref');
  requireRelativeArtifactRef(request.artifacts.expected_image_ref, '$.artifacts.expected_image_ref');
  requireRelativeArtifactRef(request.artifacts.response_ref, '$.artifacts.response_ref');
  requireRelativeArtifactRef(request.artifacts.artifact_manifest_ref, '$.artifacts.artifact_manifest_ref');
  return request;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseCodexResponse(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Codex Image2 response file is empty.');
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    throw new Error('Codex Image2 response is not valid JSON.');
  }
}

function validateCodexResponse(response) {
  if (!isObject(response)) {
    throw new Error('NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID: response must be an object.');
  }
  if (!['ok', 'fail'].includes(response.status)) {
    throw new Error('NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID: response.status must be "ok" or "fail".');
  }
  if (typeof response.summary !== 'string') {
    throw new Error('NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID: response.summary must be a string.');
  }
  if (response.failure_reason !== null && typeof response.failure_reason !== 'string') {
    throw new Error('NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID: response.failure_reason must be a string or null.');
  }
  if (response.image_path !== null && typeof response.image_path !== 'string') {
    throw new Error('NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID: response.image_path must be a string or null.');
  }
  if (response.evidence_image_path !== null && typeof response.evidence_image_path !== 'string') {
    throw new Error('NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID: response.evidence_image_path must be a string or null.');
  }
  return response;
}

function sameResolvedPath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (process.platform === 'win32') {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }
  return resolvedLeft === resolvedRight;
}

function codexExecArgs({ request, requestPath, model }) {
  const baseDir = path.dirname(path.resolve(requestPath));
  const args = [
    'exec',
    '--cd',
    request.execution?.cwd ?? process.cwd(),
    '--sandbox',
    'danger-full-access',
    '--ask-for-approval',
    'never',
    '--output-schema',
    resolveRequestArtifactRef(requestPath, request.artifacts.output_schema_ref, '$.artifacts.output_schema_ref'),
    '-o',
    resolveRequestArtifactRef(requestPath, request.artifacts.response_ref, '$.artifacts.response_ref'),
  ];
  if (model) args.splice(1, 0, '-m', model);
  const sourceImage = request.inputs.source_image_ref
    ? resolveRequestArtifactRef(requestPath, request.inputs.source_image_ref, '$.inputs.source_image_ref')
    : null;
  if (sourceImage) args.push('-i', sourceImage);
  args.push('-');
  return args;
}

async function runProcess(command, args, stdin) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      resolve({ status: 'error', exitCode: null, stdout, stderr, error });
    });
    child.on('close', (code) => {
      resolve({ status: code === 0 ? 'ok' : 'error', exitCode: code, stdout, stderr });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function consumeProviderResponse({
  requestPath,
  request,
  responsePath,
  surface = 'codex_cli',
  selectedModel = null,
  selectedModelSource = 'not_recorded',
}) {
  const response = validateCodexResponse(parseCodexResponse(await readFile(responsePath, 'utf8')));
  if (response.status !== 'ok') {
    throw new Error(`NIMI2D_CODEX_IMAGE2_FAILED: ${response.failure_reason ?? response.summary ?? 'unknown failure'}`);
  }
  if (typeof response.image_path !== 'string' || response.image_path.length === 0) {
    throw new Error('NIMI2D_CODEX_IMAGE2_NO_IMAGE: response.image_path is required on success.');
  }
  const imagePath = path.resolve(response.image_path);
  const expectedImagePath = resolveRequestArtifactRef(requestPath, request.artifacts.expected_image_ref, '$.artifacts.expected_image_ref');
  if (!sameResolvedPath(imagePath, expectedImagePath)) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_UNEXPECTED_IMAGE_PATH: response.image_path must match expected image path ${expectedImagePath}`);
  }
  if (!(await fileExists(imagePath))) {
    throw new Error(`NIMI2D_CODEX_IMAGE2_IMAGE_MISSING: ${imagePath}`);
  }
  const baseDir = path.dirname(path.resolve(requestPath));
  const promptPath = resolveRequestArtifactRef(requestPath, request.artifacts.prompt_ref, '$.artifacts.prompt_ref');
  const artifactManifestPath = resolveRequestArtifactRef(requestPath, request.artifacts.artifact_manifest_ref, '$.artifacts.artifact_manifest_ref');
  return await registerCodexImage2Artifact({
    imagePath,
    evidenceImagePath: response.evidence_image_path ?? imagePath,
    promptFile: promptPath,
    requestPath,
    surface,
    modelHint: request.provider?.model_hint ?? null,
    selectedModel,
    selectedModelSource,
    sourceNote: `codex image2 provider workflow ${request.workflow.kind}: ${response.summary}`,
    outPath: artifactManifestPath,
    baseDir,
  });
}

async function runCodexImage2Provider(args) {
  const requestPath = path.resolve(requireFlag(args, '--request'));
  const request = validateCodexImage2Request(await readYaml(requestPath));
  const promptPath = resolveRequestArtifactRef(requestPath, request.artifacts.prompt_ref, '$.artifacts.prompt_ref');
  const responsePath = getFlag(args, '--response-file')
    ? path.resolve(getFlag(args, '--response-file'))
    : resolveRequestArtifactRef(requestPath, request.artifacts.response_ref, '$.artifacts.response_ref');
  const prompt = await readFile(promptPath, 'utf8');
  const codexBin = getFlag(args, '--codex-bin', 'codex');
  const model = getFlag(args, '--model');
  const execArgs = codexExecArgs({ request, requestPath, model });
  if (hasFlag(args, '--dry-run')) {
    return {
      status: 'ok',
      kind: 'codex_image2_provider_run',
      mode: 'dry_run',
      command: codexBin,
      args: execArgs,
      promptPath,
      responsePath,
    };
  }
  let execution = null;
  if (hasFlag(args, '--execute')) {
    execution = await runProcess(codexBin, execArgs, prompt);
    if (execution.status !== 'ok') {
      return {
        status: 'reject',
        kind: 'codex_image2_provider_run',
        mode: 'execute',
        codes: ['NIMI2D_CODEX_IMAGE2_CLI_FAILED'],
        issues: [{
          code: 'NIMI2D_CODEX_IMAGE2_CLI_FAILED',
          path: '$.execution',
          message: execution.stderr || execution.stdout || `Codex CLI exited with ${execution.exitCode}`,
        }],
      };
    }
  } else if (!(await fileExists(responsePath))) {
    throw new Error('Missing --execute or --response-file; no provider response is available to consume.');
  }
  const registered = await consumeProviderResponse({
    requestPath,
    request,
    responsePath,
    surface: hasFlag(args, '--demo-fixture') ? 'demo_fixture' : 'codex_cli',
    selectedModel: model ?? null,
    selectedModelSource: model ? 'cli_argument' : 'not_recorded',
  });
  return {
    status: registered.verdict === 'reject' ? 'reject' : 'ok',
    kind: 'codex_image2_provider_run',
    manifest_kind: CODEX_IMAGE2_RUN_KIND,
    schema_version: 1,
    mode: execution ? 'execute' : 'consume_response',
    requestPath,
    responsePath,
    artifactManifestPath: registered.outPath,
    artifactVerdict: registered.verdict,
    execution: execution ? {
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
    } : null,
    codes: registered.verdict === 'reject' ? ['NIMI2D_CODEX_IMAGE2_ARTIFACT_REJECTED'] : [],
    issues: [],
  };
}

async function runCodexImage2ProviderCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  let result;
  if (command === 'plan') {
    result = await writeCodexImage2Plan(args);
  } else if (command === 'run') {
    result = await runCodexImage2Provider(args);
  } else {
    throw new Error('Expected image2-provider command: plan or run.');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'ok') process.exitCode = 1;
}

export {
  CODEX_IMAGE2_REQUEST_KIND,
  CODEX_IMAGE2_RUN_KIND,
  buildPrompt,
  outputSchema,
  writeCodexImage2Plan,
  runCodexImage2Provider,
  runCodexImage2ProviderCli,
};
