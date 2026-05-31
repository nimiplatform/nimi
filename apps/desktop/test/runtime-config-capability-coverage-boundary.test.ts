import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeConfigDir = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config',
);

function readRuntimeConfigSource(name: string): string {
  return readFileSync(path.join(runtimeConfigDir, name), 'utf8');
}

test('Runtime Config capability coverage consumes SDK projection in both views', () => {
  for (const fileName of ['runtime-config-page-overview.tsx', 'runtime-config-page-runtime.tsx']) {
    const source = readRuntimeConfigSource(fileName);
    assert.match(source, /projectRuntimeRouteCapabilityCoverageList/);
    assert.match(source, /from '@nimiplatform\/sdk\/ai'/);
    assert.doesNotMatch(source, /CAPABILITIES_V11\.map/);
    assert.doesNotMatch(source, /state\.connectors\.some\(\(c\) => c\.status === 'healthy'\)/);
  }
});
