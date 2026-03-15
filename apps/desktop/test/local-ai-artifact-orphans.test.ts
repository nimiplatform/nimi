import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeCommandsPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts');
const runtimeIndexPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/index.ts');
const installActionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions.ts',
);
const localModelCenterPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center.tsx',
);
const localModelCenterRuntimeStatePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.ts',
);
const localModelCenterCardPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-catalog-card.tsx',
);
const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);

const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');
const runtimeIndexSource = readFileSync(runtimeIndexPath, 'utf-8');
const installActionsSource = readFileSync(installActionsPath, 'utf-8');
const localModelCenterSource = [
  localModelCenterPath,
  localModelCenterRuntimeStatePath,
]
  .map((filePath) => readFileSync(filePath, 'utf-8'))
  .join('\n');
const localModelCenterCardSource = readFileSync(localModelCenterCardPath, 'utf-8');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');

test('companion orphan runtime commands use dedicated Tauri command names', () => {
  assert.match(runtimeCommandsSource, /runtime_local_artifacts_scan_orphans/);
  assert.match(runtimeCommandsSource, /runtime_local_artifacts_scaffold_orphan/);
  assert.match(runtimeCommandsSource, /export async function scanLocalRuntimeArtifactOrphans/);
  assert.match(runtimeCommandsSource, /export async function scaffoldLocalRuntimeArtifactOrphan/);
});

test('local runtime facade exports dedicated companion orphan methods', () => {
  assert.match(runtimeIndexSource, /scanArtifactOrphans:\s*\(\)\s*=>\s*Promise<OrphanArtifactFile\[]>/);
  assert.match(runtimeIndexSource, /scaffoldArtifactOrphan:\s*\(\s*payload: LocalRuntimeScaffoldArtifactPayload/);
  assert.match(runtimeIndexSource, /scanArtifactOrphans:\s*scanLocalRuntimeArtifactOrphans/);
  assert.match(runtimeIndexSource, /scaffoldArtifactOrphan:\s*scaffoldLocalRuntimeArtifactOrphan/);
});

test('artifact orphan controller scaffolds first, then imports through runtime local artifact import', () => {
  const match = installActionsSource.match(
    /const scaffoldLocalArtifactOrphan = useCallback\(async \(path: string, kind: LocalRuntimeArtifactKind\) => \{([\s\S]*?)\n\s*\}, \[[\s\S]*?\]\);/,
  );
  assert.ok(match, 'expected scaffoldLocalArtifactOrphan callback in install actions source');
  const body = String(match?.[1] || '');
  assert.match(body, /scaffoldArtifactOrphan\(\{\s*path,\s*kind,\s*\}, \{ caller: 'core' \}\)/);
  assert.match(body, /importArtifact\(\{\s*manifestPath: scaffolded\.manifestPath,\s*\}, \{ caller: 'core' \}\)/);
});

test('local model center keeps companion orphan lane separated from model orphan lane', () => {
  assert.match(localModelCenterCardSource, /Unregistered Companion Assets/);
  assert.match(localModelCenterCardSource, /Unregistered Models Found/);
  assert.match(localModelCenterCardSource, /ARTIFACT_KIND_OPTIONS\.map/);
  assert.match(localModelCenterCardSource, /onArtifactOrphanKindChange/);
});

test('local model center state refreshes both orphan lanes after companion scaffold', () => {
  assert.match(localModelCenterSource, /scanArtifactOrphans\(\)/);
  assert.match(localModelCenterSource, /refreshAllOrphanFiles/);
  assert.match(localModelCenterSource, /scaffoldArtifactOrphanImport\(orphanPath\)|props\.onScaffoldArtifactOrphan\(orphanPath, kind\)/);
});

test('artifact tasks expose retry only through failed verified companion installs', () => {
  assert.match(localModelCenterSectionsSource, /task\.taskKind === 'verified-install'/);
  assert.match(localModelCenterSectionsSource, /Retry/);
  assert.match(localModelCenterSectionsSource, /props\.onRetryTask\(task\.templateId\)/);
});
