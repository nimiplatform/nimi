import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const source = readFileSync(path.join(root, 'src/tester/tester-artifact-persistence.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
const { shouldPersistTesterArtifactRecord } = await import(moduleUrl);

test('artifact persistence gate accepts only real non-world runtime artifacts', () => {
  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'image.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 1,
      jobId: 'job-1',
      jobState: 'ready',
    },
  }), true);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'video.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 0,
      jobId: 'job-2',
      jobState: 'ready',
    },
  }), false);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: false,
    capabilityId: 'image.generate',
  }), false);

  assert.equal(shouldPersistTesterArtifactRecord({
    ok: true,
    capabilityId: 'world.generate',
    output: {
      kind: 'artifacts',
      artifactCount: 2,
      jobId: 'world-fixture',
      jobState: 'ready',
    },
  }), false);
});
