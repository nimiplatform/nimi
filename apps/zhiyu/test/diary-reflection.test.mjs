import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/agent/diary-reflection.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function localAgentReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'local-agent-discovered',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was discovered.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  };
}

test('projects diary and reflection artifacts as deferred until upstream authority exists', async () => {
  const { projectZhiyuDiaryReflectionArtifacts } = await loadModule();
  const diary = projectZhiyuDiaryReflectionArtifacts(localAgentReady());

  assert.equal(diary.ready, false);
  assert.equal(diary.state, 'deferred');
  assert.equal(diary.reasonCode, 'zhiyu-diary-reflection-artifact-authority-not-admitted');
  assert.equal(diary.actionHint, 'admit_diary_reflection_artifact_projection');
  assert.equal(diary.ownerUserId, 'user-1');
  assert.equal(diary.runtimeSourceRef, 'runtime-source:opaque');
  assert.equal(diary.localAgentRef, 'local-agent:opaque');
  assert.equal(diary.missingOwner, 'cognition-runtime-diary-reflection-artifact-owner');
  assert.equal(diary.missingStoragePolicyRef, 'platform-diary-reflection-retention-export-policy');
  assert.equal(diary.missingSdkProjection, 'sdk-runtime-diary-reflection-artifact-projection');
  assert.deepEqual(diary.artifactClasses, [
    'user-authored-note',
    'agent-generated-reflection',
    'memory-derived-summary',
    'system-generated-audit-summary',
  ]);
  assert.deepEqual(diary.requiredFields, [
    'artifact_id',
    'artifact_class',
    'owner_domain',
    'created_timestamp',
    'generated_approved_reviewed_status',
    'source_anchor',
    'storage_policy_ref',
    'retention_or_export_state',
  ]);
  assert.deepEqual(diary.artifacts, []);
  assert.deepEqual(diary.unsupportedFields, ['diary_reflection_artifact_projection']);
});

test('diary reflection projection does not create local diary truth', () => {
  const source = readFileSync(path.join(root, 'src/shell/agent/diary-reflection.ts'), 'utf8');
  assert.match(source, /zhiyu-diary-reflection-artifact-authority-not-admitted/);
  assert.doesNotMatch(source, /writeFile|readFile|localStorage|indexedDB|diaryWriter|markdown|\.md|\.json/);
  assert.doesNotMatch(source, /createdAt:\s*new Date|approvedAt|reviewedAt|approvalState|reviewStatus:\s*['"][^'"]+['"]|storagePolicyRef:\s*['"][^'"]+['"]/);
  assert.doesNotMatch(source, /queryMemory|writeMemory|getCanonicalMemoryStatus|bindCanonicalMemoryStandard|runtime\.memory/);
  assert.doesNotMatch(source, /runtime\/internal|apps\/desktop|apiKey|providerId/);
});
