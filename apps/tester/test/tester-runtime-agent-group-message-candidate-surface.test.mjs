import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-agent-group-message-candidate-surface-'));
  execFileSync('pnpm', [
    'exec',
    'tsc',
    '--outDir',
    behaviorBuildDir,
    '--rootDir',
    'src',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'src/tester/tester-runtime-agent-group-message-candidate-surface.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importProjection() {
  return import(pathToFileURL(path.join(
    buildBehaviorModules(),
    'tester/tester-runtime-agent-group-message-candidate-surface.js',
  )).href);
}

test('Tester consumes SDK host Runtime Realm group message candidate surface as second app proof', async () => {
  const projection = await importProjection();
  const result = await projection.inspectTesterRuntimeAgentGroupMessageCandidateSurface();
  assert.deepEqual(result, {
    createScope: 'runtime.agent.create_realm_group_message_candidate',
    evidenceScope: 'runtime.agent.get_realm_group_message_candidate_evidence',
    candidateId: 'tester-candidate',
    commitDisposition: 'MESSAGE_CANDIDATE',
    body: 'tester body',
  });
});
