import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const desktopRendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walkFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(entryPath);
    }
    if (/\.(?:ts|tsx)$/.test(entry.name)) {
      return [entryPath];
    }
    return [];
  });
}

test('Desktop does not retain local Kit UI forwarding shells', () => {
  for (const removed of [
    'apps/desktop/src/shell/renderer/components/action.tsx',
    'apps/desktop/src/shell/renderer/components/surface.tsx',
    'apps/desktop/src/shell/renderer/components/scroll-shell.tsx',
    'apps/desktop/src/shell/renderer/components/design-tokens.ts',
    'apps/desktop/src/shell/renderer/components/sidebar.tsx',
    'apps/desktop/src/shell/renderer/components/tooltip.tsx',
    'apps/desktop/src/shell/renderer/components/overlay/index.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, removed)), false, `${removed} must stay owned by Kit`);
  }
});

test('Desktop app-surface consumers import shared primitives from Kit', () => {
  const offenders = walkFiles(desktopRendererRoot).filter((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    return /@renderer\/components\/(?:action|surface|scroll-shell|design-tokens|sidebar|tooltip|overlay)/.test(source);
  });

  assert.deepEqual(offenders.map((filePath) => path.relative(repoRoot, filePath)), []);

  const sideSheet = read('apps/desktop/src/shell/renderer/features/chat/chat-shared-side-sheet.tsx');
  const profile = read('apps/desktop/src/shell/renderer/features/profile/posts-tab.tsx');
  assert.match(sideSheet, /from '@nimiplatform\/kit\/ui'/);
  assert.match(sideSheet, /AppCardSurface/);
  assert.match(sideSheet, /IconToggleAction/);
  assert.match(sideSheet, /ScrollShell/);
  assert.match(profile, /from '@nimiplatform\/kit\/ui'/);
  assert.match(profile, /CompactAction/);
});
