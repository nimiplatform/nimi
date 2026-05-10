// Tests for workflow-resolver.mjs (W4 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
//
// Strategy: assemble a synthetic root dir on tmpfs with a pnpm-workspace.yaml,
// a root package.json, a workspace package.json, and a few synthetic
// .github/workflows/*.yml files. Run the resolver against the synthetic root.
// This avoids depending on the live repo state (which evolves between waves).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  findWorkflowFiles,
  extractPnpmReferences,
  loadAvailableScripts,
  resolveWorkflowReferences,
  checkWorkflowReferences,
} from './workflow-resolver.mjs';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolver-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'desktop'), { recursive: true });
  fs.mkdirSync(path.join(root, 'kit'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\n  - 'kit'\n"
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'root-pkg',
        scripts: {
          build: 'echo build',
          'check:foo': 'echo foo',
          'proto:lint': 'echo proto-lint',
          preflight: 'echo preflight',
        },
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(root, 'apps', 'desktop', 'package.json'),
    JSON.stringify(
      {
        name: '@nimiplatform/desktop',
        scripts: {
          test: 'echo test',
          typecheck: 'echo typecheck',
          lint: 'echo lint',
        },
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(root, 'kit', 'package.json'),
    JSON.stringify(
      {
        name: '@nimiplatform/kit',
        scripts: {
          test: 'echo test',
        },
      },
      null,
      2
    )
  );

  return root;
}

function writeWorkflow(root, name, body) {
  fs.writeFileSync(path.join(root, '.github', 'workflows', name), body);
}

test('findWorkflowFiles: returns yml + yaml, sorted, abs paths', () => {
  const root = makeRoot();
  try {
    writeWorkflow(root, 'b.yml', 'jobs: {}');
    writeWorkflow(root, 'a.yaml', 'jobs: {}');
    writeWorkflow(root, 'README.md', 'not yaml');
    const found = findWorkflowFiles(root);
    assert.equal(found.length, 2);
    assert.equal(path.basename(found[0]), 'a.yaml');
    assert.equal(path.basename(found[1]), 'b.yml');
    assert.equal(path.isAbsolute(found[0]), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findWorkflowFiles: missing dir returns empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolver-empty-'));
  try {
    assert.deepEqual(findWorkflowFiles(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: bare script name', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      ['jobs:', '  j:', '    steps:', '      - run: pnpm check:foo'].join('\n')
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 1);
    assert.equal(refs[0].script, 'check:foo');
    assert.equal(refs[0].line, 4);
    assert.equal(refs[0].filterPkg, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: script with trailing flags', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm check:foo --flag arg\n'
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 1);
    assert.equal(refs[0].script, 'check:foo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: --filter @pkg <script>', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --filter @nimiplatform/desktop test\n'
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 1);
    assert.equal(refs[0].script, 'test');
    assert.equal(refs[0].filterPkg, '@nimiplatform/desktop');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: --filter @pkg run <script>', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --filter @nimiplatform/desktop run typecheck\n'
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 1);
    assert.equal(refs[0].script, 'typecheck');
    assert.equal(refs[0].filterPkg, '@nimiplatform/desktop');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: --dir <path> run <script>', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --dir apps/desktop run lint\n'
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 1);
    assert.equal(refs[0].script, 'lint');
    assert.equal(refs[0].dirPath, 'apps/desktop');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: pnpm install / audit / exec / dlx are NOT script refs', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: pnpm install --no-frozen-lockfile',
        '      - run: pnpm audit --prod',
        '      - run: pnpm exec nimicoding --help',
        '      - run: pnpm dlx markdownlint-cli2',
        '      - run: pnpm --dir foo install',
      ].join('\n')
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPnpmReferences: lines without pnpm are skipped', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: echo hello',
        '      - run: node scripts/foo.mjs',
        '      - run: pnpm check:foo',
      ].join('\n')
    );
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    assert.equal(refs.length, 1);
    assert.equal(refs[0].script, 'check:foo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadAvailableScripts: collects root + workspaces by name and dir', () => {
  const root = makeRoot();
  try {
    const cat = loadAvailableScripts(root);
    assert.equal(cat.root.has('check:foo'), true);
    assert.equal(cat.root.has('preflight'), true);
    assert.equal(cat.byPkgName.get('@nimiplatform/desktop')?.has('lint'), true);
    assert.equal(cat.byPkgName.get('@nimiplatform/kit')?.has('test'), true);
    assert.equal(cat.byPkgDir.get('apps/desktop')?.has('typecheck'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkflowReferences: bare resolved + bare unresolved', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      ['jobs:', '  j:', '    steps:', '      - run: pnpm check:foo', '      - run: pnpm check:obviously-not-defined'].join('\n')
    );
    const cat = loadAvailableScripts(root);
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    const unresolved = resolveWorkflowReferences(refs, cat, root);
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].script, 'check:obviously-not-defined');
    assert.equal(unresolved[0].reason, 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkflowReferences: --filter resolved + --filter unresolved', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: pnpm --filter @nimiplatform/desktop test',
        '      - run: pnpm --filter @nimiplatform/desktop nonexistent-script',
        '      - run: pnpm --filter @nimiplatform/unknown-pkg test',
      ].join('\n')
    );
    const cat = loadAvailableScripts(root);
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    const unresolved = resolveWorkflowReferences(refs, cat, root);
    assert.equal(unresolved.length, 2);
    const reasons = unresolved.map((u) => u.reason).sort();
    assert.deepEqual(reasons, [
      'WORKFLOW_PNPM_FILTER_PACKAGE_UNKNOWN',
      'WORKFLOW_PNPM_REFERENCE_UNRESOLVED',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkflowReferences: --dir resolved + --dir unresolved', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: pnpm --dir apps/desktop run test',
        '      - run: pnpm --dir apps/desktop run nope',
        '      - run: pnpm --dir nonexistent run test',
      ].join('\n')
    );
    const cat = loadAvailableScripts(root);
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    const unresolved = resolveWorkflowReferences(refs, cat, root);
    assert.equal(unresolved.length, 2);
    const reasons = unresolved.map((u) => u.reason).sort();
    assert.deepEqual(reasons, [
      'WORKFLOW_PNPM_DIR_PATH_UNKNOWN',
      'WORKFLOW_PNPM_REFERENCE_UNRESOLVED',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkflowReferences: GitHub Actions ${{ }} expression in dirPath is skipped', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --dir nimi-mods/${{ matrix.path }} run verify\n'
    );
    const cat = loadAvailableScripts(root);
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    const unresolved = resolveWorkflowReferences(refs, cat, root);
    assert.equal(unresolved.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkflowReferences: shell variable ${VAR} in dirPath is skipped', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --dir "nimi-mods/${MOD_PATH}" run verify\n'
    );
    const cat = loadAvailableScripts(root);
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    const unresolved = resolveWorkflowReferences(refs, cat, root);
    assert.equal(unresolved.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveWorkflowReferences: dynamic script name is skipped', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm $TASK_NAME\n'
    );
    const cat = loadAvailableScripts(root);
    const refs = extractPnpmReferences(path.join(root, '.github', 'workflows', 'a.yml'));
    const unresolved = resolveWorkflowReferences(refs, cat, root);
    assert.equal(unresolved.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorkflowReferences: green when all references resolve', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: pnpm check:foo',
        '      - run: pnpm --filter @nimiplatform/desktop test',
        '      - run: pnpm install',
      ].join('\n')
    );
    const result = checkWorkflowReferences(root);
    assert.equal(result.ok, true);
    assert.equal(result.scanned, 1);
    assert.equal(result.references.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorkflowReferences: fail-close on synthetic unresolvable ref (W4 negative test)', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      [
        'jobs:',
        '  j:',
        '    steps:',
        '      - run: pnpm check:foo',
        '      - run: pnpm check:obviously-not-defined',
      ].join('\n')
    );
    const result = checkWorkflowReferences(root);
    assert.equal(result.ok, false);
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0].script, 'check:obviously-not-defined');
    assert.equal(result.unresolved[0].reason, 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED');
    assert.equal(typeof result.unresolved[0].line, 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorkflowReferences: --recursive resolves against any workspace', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --recursive test\n'
    );
    const result = checkWorkflowReferences(root);
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorkflowReferences: --recursive fail when no workspace defines script', () => {
  const root = makeRoot();
  try {
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --recursive missing-everywhere\n'
    );
    const result = checkWorkflowReferences(root);
    assert.equal(result.ok, false);
    assert.equal(result.unresolved[0].reason, 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED_RECURSIVE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkWorkflowReferences: ad-hoc dir (non-workspace) with package.json resolves', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'nimi-mods', 'local-chat'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'nimi-mods', 'local-chat', 'package.json'),
      JSON.stringify({ name: 'local-chat', scripts: { verify: 'echo verify' } }, null, 2)
    );
    writeWorkflow(
      root,
      'a.yml',
      'jobs:\n  j:\n    steps:\n      - run: pnpm --dir nimi-mods/local-chat run verify\n'
    );
    const result = checkWorkflowReferences(root);
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
