import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import test from 'node:test';

const landingRoot = fileURLToPath(new URL('../src/landing', import.meta.url));
const heroSectionSource = readFileSync(new URL('../src/landing/components/hero-section.tsx', import.meta.url), 'utf8');
const mediaExtensions = new Set(['.gif', '.ico', '.jpeg', '.jpg', '.mp4', '.png', '.svg', '.webm']);

function collectMediaPaths(root: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...collectMediaPaths(fullPath));
      continue;
    }

    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (entry.isFile() && mediaExtensions.has(extension) && statSync(fullPath).size > 0) {
      paths.push(relative(landingRoot, fullPath).replaceAll('\\', '/'));
    }
  }
  return paths;
}

test('landing media asset paths do not expose retired Mod naming', () => {
  const mediaPaths = collectMediaPaths(landingRoot);
  assert.ok(mediaPaths.length > 0);
  assert.deepEqual(
    mediaPaths.filter((path) => /\bmod\b|mod-/i.test(path)),
    [],
  );
});

test('hero preview renders from current content instead of a stale quickstart gif', () => {
  assert.doesNotMatch(heroSectionSource, /nimi-quickstart\.gif|quickstartPreview/);
  assert.match(heroSectionSource, /currentTab\.command/);
});
