import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Package boundary tests: the Mastra adapter is its own product adapter. It must
// not import a sibling adapter (notably vercel-ai), declare it as a dependency, or
// copy its build output into this package's dist. The shared LanguageModelV3
// protocol mapping is owned here (mappers.ts / raw-metadata.ts); a common bridge
// package is deliberately deferred, so duplication is controlled and self-owned.

const adapterDir = fileURLToPath(new URL('.', import.meta.url));

// Matches a static or dynamic import specifier that references a vercel-ai path or
// the sibling adapter package, ignoring comments/prose that merely mention Vercel.
const VERCEL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"][^'"]*vercel-ai[^'"]*['"]/;

// This boundary spec itself names the forbidden specifier as its check target, so
// it is excluded from the scan; every other source file is checked.
const SELF = path.basename(fileURLToPath(import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(adapterDir)
    .filter((name) => name.endsWith('.ts') && name !== SELF)
    .sort();
}

test('boundary: no Mastra adapter source imports the vercel-ai sibling adapter', () => {
  for (const name of sourceFiles()) {
    const contents = readFileSync(path.join(adapterDir, name), 'utf8');
    assert.ok(
      !VERCEL_IMPORT.test(contents),
      `${name} must not import a vercel-ai sibling adapter; found a vercel-ai import specifier`,
    );
    assert.ok(
      !contents.includes('@nimiplatform/sdk-adapter-vercel-ai'),
      `${name} must not reference @nimiplatform/sdk-adapter-vercel-ai`,
    );
  }
});

test('boundary: package.json declares no vercel-ai dependency', () => {
  const pkg = JSON.parse(readFileSync(path.join(adapterDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    nimi?: Record<string, unknown>;
  };
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  for (const dependency of Object.keys(allDeps)) {
    assert.ok(!dependency.includes('vercel-ai'), `package.json must not depend on ${dependency}`);
  }
  assert.ok(
    !JSON.stringify(pkg.nimi ?? {}).includes('vercel-ai'),
    'package.json nimi block must not reference a vercel-ai sibling adapter',
  );
});

test('boundary: built dist contains no vercel-ai directory or import', () => {
  const distDir = path.join(adapterDir, 'dist');
  if (!existsSync(distDir)) {
    // dist is a build artifact; when present (after build) it must stay self-contained.
    return;
  }
  const entries = readdirSync(distDir);
  assert.ok(!entries.includes('vercel-ai'), 'dist must not contain a vercel-ai directory');

  for (const name of readdirSync(distDir)) {
    if (!name.endsWith('.js') && !name.endsWith('.d.ts')) {
      continue;
    }
    const contents = readFileSync(path.join(distDir, name), 'utf8');
    assert.ok(
      !VERCEL_IMPORT.test(contents),
      `dist/${name} must not import a vercel-ai sibling adapter`,
    );
  }
});
