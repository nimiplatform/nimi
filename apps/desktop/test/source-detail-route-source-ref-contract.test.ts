import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

test('source detail route state carries typed sourceRef instead of bare profile id for Realm sources', () => {
  const storeTypes = readRepo('apps/desktop/src/shell/renderer/app-shell/providers/store-types.ts');
  const uiSlice = readRepo('apps/desktop/src/shell/renderer/app-shell/providers/ui-slice.ts');
  const sourcePanel = readRepo('apps/desktop/src/shell/renderer/features/source-detail/source-detail-panel.tsx');
  const sourceQueries = readRepo('apps/desktop/src/shell/renderer/features/source-detail/source-detail-queries.ts');

  assert.match(storeTypes, /selectedSourceRef:\s*NimiRealmCoreSourceRef \| null/);
  assert.match(storeTypes, /navigateToSourceDetail:\s*\(sourceRef:\s*NimiRealmCoreSourceRef\) => void/);
  assert.match(uiSlice, /selectedSourceRef:\s*null/);
  assert.match(uiSlice, /navigateToSourceDetail:\s*\(sourceRef\) =>/);
  assert.match(sourcePanel, /const selectedSourceRef = useAppStore\(\(state\) => state\.selectedSourceRef\);/);
  assert.match(sourcePanel, /fetchSourceDisplayDetail\(selectedSourceRef \?\? sourceIdentifier\)/);
  assert.match(sourcePanel, /invalidateQueries\(\{ queryKey: sourceDisplayDetailQueryKey\(sourceSelection\) \}\)/);
  assert.match(sourceQueries, /loadRealmSourceDetailsBySourceRef\(normalizedSourceRef/);
  assert.doesNotMatch(sourcePanel, /fetchSourceDisplayDetail\(sourceIdentifier\)/);
  assert.doesNotMatch(sourcePanel, /sourceDisplayDetailQueryKey\(sourceIdentifier\)/);
});
