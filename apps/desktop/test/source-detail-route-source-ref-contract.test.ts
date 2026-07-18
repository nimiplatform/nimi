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

  assert.match(storeTypes, /selectedSourceRef:\s*CharacterSourceRefV3 \| null/);
  assert.match(storeTypes, /navigateToSourceDetail:\s*\(sourceRef:\s*CharacterSourceRefV3\) => void/);
  assert.match(uiSlice, /selectedSourceRef:\s*null/);
  assert.match(uiSlice, /navigateToSourceDetail:\s*\(sourceRef\) =>/);
  assert.match(sourcePanel, /const selectedSourceRef = useAppStore\(\(state\) => state\.selectedSourceRef\);/);
  assert.match(sourcePanel, /fetchSourceDisplayDetail\(selectedSourceRef\)/);
  assert.match(sourcePanel, /sourceDisplayDetailQueryKey\(selectedSourceRef\)/);
  assert.match(sourcePanel, /materializeSourceContactLaunchTarget\(source, ownerUserId\)/);
  assert.match(sourcePanel, /ensureRuntimeAgentExists\(target\)/);
  assert.doesNotMatch(sourcePanel, /invalidateQueries\(\{ queryKey: sourceDisplayDetailQueryKey\(selectedSourceRef\) \}\)/);
  assert.match(sourceQueries, /loadRealmSourceDetailsBySourceRef\(normalizedSourceRef/);
  assert.doesNotMatch(sourcePanel, /fetchSourceDisplayDetail\(sourceIdentifier\)/);
  assert.doesNotMatch(sourcePanel, /sourceDisplayDetailQueryKey\(sourceIdentifier\)/);
});

test('world character source detail loads relationship neighborhood through Realm SDK', () => {
  const sourceDetailData = readRepo('apps/desktop/src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');

  assert.match(sourceDetailData, /worldCoreControllerListWorldRelationships\(\{/);
  assert.match(sourceDetailData, /path:\s*\{\s*worldId\s*\}/);
  assert.match(sourceDetailData, /query:\s*\{\s*entityId,\s*take:\s*500\s*\}/);
  assert.match(sourceDetailData, /relationships\.map\(projectWorldRelationshipCore\)/);
  assert.match(sourceDetailData, /relationships,/);
  assert.doesNotMatch(sourceDetailData, /fetch\(/);
  assert.doesNotMatch(sourceDetailData, /axios/);
  assert.doesNotMatch(sourceDetailData, /BIOG_TEXT_DATA/);
  assert.doesNotMatch(sourceDetailData, /POSTED_TO_OFFICE_DATA/);
});
