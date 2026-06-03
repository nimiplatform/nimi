import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';

type KitPackageJson = {
  exports: Record<string, unknown>;
};

const kitRoot = process.cwd();

function readKitFile(relativePath: string): string {
  return fs.readFileSync(path.join(kitRoot, relativePath), 'utf8');
}

function kitPackageJson(): KitPackageJson {
  return JSON.parse(readKitFile('package.json')) as KitPackageJson;
}

function publicExports(): string[] {
  return Object.keys(kitPackageJson().exports);
}

function countExports(exportsList: string[], predicate: (subpath: string) => boolean): number {
  return exportsList.filter(predicate).length;
}

test('Kit README public surface summary tracks package exports', () => {
  const readme = readKitFile('README.md');
  const exportsList = publicExports();
  const counts = {
    total: exportsList.length,
    ui: countExports(exportsList, (subpath) => subpath === './ui' || subpath.startsWith('./ui/')),
    auth: countExports(exportsList, (subpath) => subpath === './auth' || subpath.startsWith('./auth/')),
    core: countExports(exportsList, (subpath) => subpath.startsWith('./core/')),
    shell: countExports(exportsList, (subpath) => subpath.startsWith('./shell/')),
    telemetry: countExports(exportsList, (subpath) => subpath === './telemetry' || subpath.startsWith('./telemetry/')),
    features: countExports(exportsList, (subpath) => subpath.startsWith('./features/')),
  };

  assert.ok(
    readme.includes(`The current package publishes ${counts.total} public subpath exports through`),
    'README total public export count must match kit/package.json exports',
  );
  assert.ok(readme.includes(`- ${counts.ui} UI entries`), 'README UI export count must match package exports');
  assert.ok(readme.includes(`- ${counts.auth} auth entries`), 'README auth export count must match package exports');
  assert.ok(readme.includes(`- ${counts.core} core entries`), 'README core export count must match package exports');
  assert.ok(readme.includes(`- ${counts.shell} renderer-shell entries`), 'README shell export count must match package exports');
  assert.ok(readme.includes(`- ${counts.telemetry} telemetry entries`), 'README telemetry export count must match package exports');
  assert.ok(readme.includes(`- ${counts.features} feature entries`), 'README feature export count must match package exports');
  assert.ok(
    readme.includes('The complete npm subpath inventory is the `exports` object in\n`kit/package.json`.'),
    'README must make kit/package.json exports the active npm subpath inventory',
  );
  assert.doesNotMatch(readme, /\.nimi\/topics\//, 'README must not point active inventory at topic history');
  assert.doesNotMatch(readme, /v0\.1\.0 publishes/, 'README must not present release-history counts as active truth');
  assert.doesNotMatch(readme, /59 public subpath exports|11 UI entries|7 core entries/);
  assert.doesNotMatch(readme, /counting vocabulary/);
});

test('Kit Avatar README tracks published avatar subpaths', () => {
  const readme = readKitFile('features/avatar/README.md');
  const avatarExports = publicExports()
    .filter((subpath) => subpath === './features/avatar' || subpath.startsWith('./features/avatar/'))
    .map((subpath) => `@nimiplatform/kit/${subpath.slice(2)}`);

  assert.deepEqual(avatarExports, [
    '@nimiplatform/kit/features/avatar',
    '@nimiplatform/kit/features/avatar/headless',
    '@nimiplatform/kit/features/avatar/ui',
    '@nimiplatform/kit/features/avatar/runtime',
    '@nimiplatform/kit/features/avatar/vrm',
    '@nimiplatform/kit/features/avatar/live2d',
  ]);
  assert.match(readme, /Reusable agent avatar surface/);
  for (const subpath of avatarExports) {
    assert.ok(readme.includes(`- \`${subpath}\``), `Avatar README must list ${subpath}`);
  }
});
