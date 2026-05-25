import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(next);
    return /\.(ts|tsx)$/.test(entry.name) ? [next] : [];
  });
}

test('tester workbench is app-owned and rejects Desktop private imports', () => {
  const sources = listSourceFiles(path.join(root, 'src')).map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
  assert.match(sources, /TesterWorkbench/);
  assert.match(sources, /KitComponentGallery/);
  assert.match(sources, /typed unavailable/i);
  assert.doesNotMatch(sources, /from ['"]@renderer\//);
  assert.doesNotMatch(sources, /from ['"]@runtime\//);
  assert.doesNotMatch(sources, /getDesktopAIConfigService/);
  assert.doesNotMatch(sources, /runtime-config-profile-library/);
  assert.doesNotMatch(sources, /mock.*success/i);
  assert.doesNotMatch(sources, /pseudo/i);
});

test('tester kit gallery covers required component families', () => {
  const gallery = read('src/tester/kit-component-gallery.tsx');
  for (const required of [
    'Button',
    'IconButton',
    'TextField',
    'TextareaField',
    'SelectField',
    'Toggle',
    'NimiTabs',
    'Slider',
    'ProgressIndicator',
    'InlineAlert',
    'Dialog',
    'Popover',
    'ActionMenu',
    'StatusBadge',
    'Surface',
    'ScrollArea',
    'EmptyState',
    'LoadingSkeleton',
  ]) {
    assert.match(gallery, new RegExp(`\\b${required}\\b`));
  }
  assert.match(gallery, /Runtime projection blocked/);
});

test('tester app-owned Tauri commands are registered in standalone shell', () => {
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /tester_run_history_load/);
  assert.match(main, /tester_image_history_save/);
  assert.match(main, /open_world_tour_window/);
  assert.match(main, /claim_world_tour_viewer_launch/);
});

test('tester scaffold boundary expands beyond the product route', () => {
  const lock = JSON.parse(read('.nimi/app-scaffold/lock.json'));
  assert.ok(lock.managedFileTaxonomy.appOwnedProductCode.includes('src/tester/tester-workbench.tsx'));
  assert.ok(lock.managedFileTaxonomy.appOwnedProductCode.includes('src-tauri/src/tester_storage.rs'));
  assert.ok(lock.managedFileTaxonomy.appOwnedProductCode.includes('test/tester-contract.test.mjs'));
});
