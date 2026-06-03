import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Desktop runtime bootstrap consumes Kit runtime telemetry sink', () => {
  const runtimeBootstrap = read('apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');

  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/desktop/src/runtime/telemetry/logger.ts')), false);
  assert.match(runtimeBootstrap, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(runtimeBootstrap, /setRuntimeLogger/);
});
