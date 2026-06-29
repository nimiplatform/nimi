import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from '../common-utils.mjs';

const ATTEMPT_ROOT_DIR = '.provider-attempts';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function attemptLabel(attemptIndex) {
  return `attempt-${String(attemptIndex).padStart(3, '0')}`;
}

function attemptRequestId(requestId, label) {
  return `${requestId}_${label.replaceAll('-', '_')}`;
}

function attemptRunId() {
  return `run-${Date.now()}-${sha256(`${process.pid}:${Date.now()}:${Math.random()}`).slice(0, 8)}`;
}

function replaceAllLiteral(text, from, to) {
  return text.split(from).join(to);
}

function attemptPlanPaths({ requestPath, runId, attemptIndex }) {
  const baseDir = path.dirname(path.resolve(requestPath));
  const label = attemptLabel(attemptIndex);
  const attemptDir = path.join(baseDir, ATTEMPT_ROOT_DIR, runId, label);
  return {
    attempt: attemptIndex,
    label,
    dir: attemptDir,
    requestPath: path.join(attemptDir, 'provider-request.yaml'),
    promptPath: path.join(attemptDir, 'prompt.md'),
    schemaPath: path.join(attemptDir, 'codex-image2-output.schema.json'),
    responsePath: path.join(attemptDir, 'codex-response.json'),
    expectedImagePath: path.join(attemptDir, 'generated', 'codex-image2.png'),
    artifactManifestPath: path.join(attemptDir, 'codex-image2.artifact.yaml'),
  };
}

async function materializeProviderAttempt({
  requestPath,
  request,
  prompt,
  runId,
  attemptIndex,
  resolveRequestArtifactRef,
  outputSchema,
}) {
  const paths = attemptPlanPaths({ requestPath, runId, attemptIndex });
  const originalExpectedImagePath = resolveRequestArtifactRef(
    requestPath,
    request.artifacts.expected_image_ref,
    '$.artifacts.expected_image_ref',
  );
  const nextRequest = cloneJson(request);
  nextRequest.request_id = attemptRequestId(request.request_id, paths.label);
  nextRequest.artifacts = {
    prompt_ref: 'prompt.md',
    output_schema_ref: 'codex-image2-output.schema.json',
    expected_image_ref: 'generated/codex-image2.png',
    response_ref: 'codex-response.json',
    artifact_manifest_ref: 'codex-image2.artifact.yaml',
  };
  const nextPrompt = replaceAllLiteral(
    replaceAllLiteral(prompt, request.request_id, nextRequest.request_id),
    originalExpectedImagePath,
    paths.expectedImagePath,
  );
  await mkdir(path.join(paths.dir, 'generated'), { recursive: true });
  if (nextRequest.inputs?.source_image_ref) {
    const sourceImagePath = resolveRequestArtifactRef(requestPath, request.inputs.source_image_ref, '$.inputs.source_image_ref');
    const attemptSourcePath = path.join(paths.dir, nextRequest.inputs.source_image_ref);
    await mkdir(path.dirname(attemptSourcePath), { recursive: true });
    await copyFile(sourceImagePath, attemptSourcePath);
  }
  await writeFile(paths.promptPath, nextPrompt, 'utf8');
  await writeFile(paths.requestPath, YAML.stringify(nextRequest), 'utf8');
  await writeFile(paths.schemaPath, `${JSON.stringify(outputSchema(nextRequest.request_id), null, 2)}\n`, 'utf8');
  return {
    ...paths,
    request: nextRequest,
  };
}

function originalProviderAttempt({ requestPath, request, resolveRequestArtifactRef }) {
  return {
    attempt: 1,
    label: 'attempt-001',
    dir: path.dirname(path.resolve(requestPath)),
    requestPath,
    request,
    promptPath: resolveRequestArtifactRef(requestPath, request.artifacts.prompt_ref, '$.artifacts.prompt_ref'),
    schemaPath: resolveRequestArtifactRef(requestPath, request.artifacts.output_schema_ref, '$.artifacts.output_schema_ref'),
    responsePath: resolveRequestArtifactRef(requestPath, request.artifacts.response_ref, '$.artifacts.response_ref'),
    expectedImagePath: resolveRequestArtifactRef(requestPath, request.artifacts.expected_image_ref, '$.artifacts.expected_image_ref'),
    artifactManifestPath: resolveRequestArtifactRef(requestPath, request.artifacts.artifact_manifest_ref, '$.artifacts.artifact_manifest_ref'),
  };
}

async function runProcess(command, args, stdin, { timeoutMs = null } = {}) {
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    const spawnSpec = spawnSpecForCommand(command, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spawnSpec.shell,
    });
    const timeout = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 500);
      }, timeoutMs)
      : null;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({ ...payload, timedOut });
    };
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      finish({ status: 'error', exitCode: null, stdout, stderr, error });
    });
    child.on('close', (code) => {
      finish({ status: code === 0 && !timedOut ? 'ok' : 'error', exitCode: code, stdout, stderr });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function spawnSpecForCommand(command, args) {
  if (process.platform === 'win32' && /\.(?:mjs|js)$/i.test(command)) {
    return {
      command: process.execPath,
      args: [command, ...args],
      shell: false,
    };
  }
  return {
    command,
    args,
    shell: process.platform === 'win32',
  };
}

function providerRunReject({ code, issuePath, message, executionAttempts = [] }) {
  return {
    status: 'reject',
    kind: 'codex_image2_provider_run',
    mode: 'execute',
    codes: [code],
    issues: [{
      code,
      path: issuePath,
      message,
    }],
    executionAttempts,
  };
}

function executionAttemptRecord(plan, fields) {
  return {
    attempt: plan.attempt,
    label: plan.label,
    requestPath: plan.requestPath,
    promptPath: plan.promptPath,
    responsePath: plan.responsePath,
    expectedImagePath: plan.expectedImagePath,
    artifactManifestPath: plan.artifactManifestPath,
    ...fields,
  };
}

export {
  attemptPlanPaths,
  attemptRequestId,
  attemptRunId,
  cloneJson,
  executionAttemptRecord,
  materializeProviderAttempt,
  originalProviderAttempt,
  providerRunReject,
  runProcess,
};
