import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  expandCommandLeaves,
  findDuplicateGateLeavesByTier,
  findDuplicateRegisteredLeaves,
  findUnlockedCargoGateLeaves,
  loadPackageScriptCatalog,
} from './command-expander.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-command-expander-'));
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'root',
    scripts: {
      'check:leaf': 'node scripts/leaf.mjs',
      'check:composite': 'pnpm check:leaf && node scripts/other.mjs',
    },
  }));
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({
    name: '@nimiplatform/web',
    scripts: {
      typecheck: 'tsc --noEmit',
      build: 'pnpm run typecheck && vite build',
      lint: 'pnpm run typecheck',
    },
  }));
  return root;
}

test('expands root and filtered workspace scripts to cwd-qualified leaves', () => {
  const root = fixture();
  try {
    const catalog = loadPackageScriptCatalog(root);
    assert.deepEqual(
      expandCommandLeaves('pnpm check:composite', catalog).map(({ cwd, command }) => [cwd, command]),
      [['.', 'node scripts/leaf.mjs'], ['.', 'node scripts/other.mjs']],
    );
    assert.deepEqual(
      expandCommandLeaves('pnpm --filter @nimiplatform/web build', catalog).map(({ cwd, command }) => [cwd, command]),
      [['apps/web', 'tsc --noEmit'], ['apps/web', 'vite build']],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detects leaf duplication hidden behind different registered composites', () => {
  const root = fixture();
  try {
    const catalog = loadPackageScriptCatalog(root);
    const registry = {
      gates: [
        { id: 'gate.test.composite', command: 'pnpm check:composite' },
        { id: 'gate.test.leaf', command: 'pnpm check:leaf' },
      ],
    };
    const document = {
      jobs: {
        quality: {
          steps: [
            { run: 'pnpm check:composite' },
            { run: 'pnpm check:leaf' },
          ],
        },
      },
    };
    assert.deepEqual(findDuplicateRegisteredLeaves(document, registry, catalog), [
      {
        jobId: 'quality',
        leaf: { cwd: '.', command: 'node scripts/leaf.mjs', key: '.\u0000node scripts/leaf.mjs' },
        steps: [1, 2],
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detects the same expanded leaf registered by multiple gates in one tier', () => {
  const root = fixture();
  try {
    const catalog = loadPackageScriptCatalog(root);
    const registry = {
      gates: [
        {
          id: 'gate.test.composite',
          command: 'pnpm check:composite',
          tiers: ['release'],
        },
        {
          id: 'gate.test.leaf',
          command: 'pnpm check:leaf',
          tiers: ['fast', 'release'],
        },
      ],
    };
    assert.deepEqual(findDuplicateGateLeavesByTier(registry, catalog), [
      {
        tier: 'release',
        leaf: { cwd: '.', command: 'node scripts/leaf.mjs', key: '.\u0000node scripts/leaf.mjs' },
        gateIds: ['gate.test.composite', 'gate.test.leaf'],
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not collapse equal command text executed in different package directories', () => {
  const root = fixture();
  try {
    const catalog = loadPackageScriptCatalog(root);
    const rootLeaf = expandCommandLeaves('pnpm check:leaf', catalog)[0];
    const webLeaf = expandCommandLeaves('pnpm --filter @nimiplatform/web lint', catalog)[0];
    assert.notEqual(rootLeaf.key, webLeaf.key);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release Cargo leaves must use the tracked dependency lock', () => {
  const root = fixture();
  try {
    const packagePath = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.scripts['test:native-unlocked'] = 'cargo test --manifest-path native/Cargo.toml';
    pkg.scripts['test:native-locked'] = 'cargo test --locked --manifest-path native/Cargo.toml';
    fs.writeFileSync(packagePath, JSON.stringify(pkg));
    const catalog = loadPackageScriptCatalog(root);
    const registry = {
      gates: [
        { id: 'gate.test.unlocked', command: 'pnpm test:native-unlocked' },
        { id: 'gate.test.locked', command: 'pnpm test:native-locked' },
      ],
    };
    assert.deepEqual(findUnlockedCargoGateLeaves(registry, catalog), [
      {
        gateId: 'gate.test.unlocked',
        leaf: {
          cwd: '.',
          command: 'cargo test --manifest-path native/Cargo.toml',
          key: '.\u0000cargo test --manifest-path native/Cargo.toml',
        },
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
