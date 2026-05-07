import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const rendererE2eIdsPath = path.join(desktopRoot, 'src/shell/renderer/testability/e2e-ids.ts');
const e2eSelectorsPath = path.join(desktopRoot, 'e2e/helpers/selectors.mjs');
const runtimePanelViewPath = path.join(
  desktopRoot,
  'src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx',
);

const rendererE2eIdsSource = fs.readFileSync(rendererE2eIdsPath, 'utf8');
const e2eSelectorsSource = fs.readFileSync(e2eSelectorsPath, 'utf8');
const runtimePanelViewSource = fs.readFileSync(runtimePanelViewPath, 'utf8');

function extractRendererRuntimeSidebarPrefix(): string {
  const match = rendererE2eIdsSource.match(
    /runtimeSidebarPage:\s*\(pageId:\s*string\)\s*=>\s*`([^`$]+)\$\{pageId\}`/,
  );
  assert.ok(match?.[1], 'renderer runtimeSidebarPage selector truth must be explicit');
  return match[1];
}

test('runtime sidebar E2E helper derives selector truth from renderer E2E_IDS', async () => {
  const { E2E_IDS } = await import('../e2e/helpers/selectors.mjs') as {
    E2E_IDS: { runtimeSidebarPage: (pageId: string) => string };
  };
  const rendererPrefix = extractRendererRuntimeSidebarPrefix();

  assert.equal(E2E_IDS.runtimeSidebarPage('runtime'), `${rendererPrefix}runtime`);
  assert.equal(E2E_IDS.runtimeSidebarPage('local'), `${rendererPrefix}local`);
  assert.match(e2eSelectorsSource, /readRendererRuntimeSidebarSelectorFactory/);
  assert.doesNotMatch(e2eSelectorsSource, /runtime-sidebar-page:/);
  assert.doesNotMatch(
    e2eSelectorsSource,
    /runtimeSidebarPage:\s*\(pageId\)\s*=>\s*`runtime-sidebar:/,
  );
});

test('runtime config sidebar renders renderer-owned runtime sidebar test ids', () => {
  assert.match(
    rendererE2eIdsSource,
    /runtimeSidebarPage:\s*\(pageId:\s*string\)\s*=>\s*`runtime-sidebar:\$\{pageId\}`/,
  );
  assert.match(runtimePanelViewSource, /data-testid=\{E2E_IDS\.runtimeSidebarPage\(item\.id\)\}/);
});
