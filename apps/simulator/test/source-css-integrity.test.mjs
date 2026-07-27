import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSimulatorSourceInventory,
  sha256Digest,
  validateSimulatorAppSource,
} from '@nimiplatform/app-tools/simulator-conformance';
import {
  buildKitCssExportInventory,
  createSimulatorCssProfileVitePlugin,
} from '@nimiplatform/app-tools/simulator-css-profile';
import { materializeSourceLocation } from '../build/materialize.mjs';
import { REPO_ROOT, SIMULATOR_ROOT } from '../build/paths.mjs';

const VALID_APP = path.join(REPO_ROOT, 'app-tools', 'test', 'fixtures', 'simulator-valid');

function git(repository, ...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function withTemporaryRoot(prefix, run) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('materialization reads the selected Git tree bytes and modes without running source scripts', () => withTemporaryRoot(
  'nimi-simulator-materialize-integrity-',
  (root) => {
    const appRoot = path.join(root, 'app');
    const stagingRoot = path.join(root, 'staging');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(path.join(appRoot, 'main.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(appRoot, 'run.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(appRoot, 'run.sh'), 0o755);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '.');
    git(root, 'update-index', '--chmod=+x', 'app/run.sh');
    git(root, '-c', 'user.name=Nimi Simulator Test', '-c', 'user.email=simulator@example.invalid', 'commit', '-q', '-m', 'fixture');
    const objectId = git(root, 'rev-parse', 'HEAD');
    const expectedDigest = buildSimulatorSourceInventory(appRoot).digest;
    const result = materializeSourceLocation({
      id: 'app',
      kind: 'workspace',
      repository_key: 'fixture',
      object_format: 'git-sha1',
      object_id: objectId,
      root: 'app',
      expected_digest: expectedDigest,
    }, { repositories: [] }, {
      workspaceRoot: root,
      workspaceRepositoryKey: 'fixture',
      stagingRoot,
      targetRoot: path.join(stagingRoot, 'source', 'sample-app', 'app'),
      moduleId: 'sample-app',
    });

    assert.deepEqual(result.files.map(({ path: filePath, mode, bytes, digest }) => ({ filePath, mode, bytes, digest })), [
      {
        filePath: 'main.ts',
        mode: '100644',
        bytes: Buffer.byteLength('export const value = 1;\n'),
        digest: sha256Digest('export const value = 1;\n'),
      },
      {
        filePath: 'run.sh',
        mode: '100755',
        bytes: Buffer.byteLength('#!/bin/sh\nexit 0\n'),
        digest: sha256Digest('#!/bin/sh\nexit 0\n'),
      },
    ]);
  },
));

test('Kit CSS export identity includes every transitive local import', () => withTemporaryRoot(
  'nimi-simulator-kit-css-',
  (root) => {
    mkdirSync(path.join(root, 'dist', 'generated'), { recursive: true });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: '@nimiplatform/kit',
      version: '1.0.0',
      exports: { './ui/styles.css': './dist/styles.css' },
    }));
    writeFileSync(path.join(root, 'dist', 'styles.css'), '@import "./generated/theme.css";\n.root { color: red; }\n');
    writeFileSync(path.join(root, 'dist', 'generated', 'theme.css'), ':root { --color: red; }\n');
    const first = buildKitCssExportInventory(root)[0];
    assert.deepEqual(first.closure.map((entry) => entry.path), [
      'dist/generated/theme.css',
      'dist/styles.css',
    ]);
    writeFileSync(path.join(root, 'dist', 'generated', 'theme.css'), ':root { --color: blue; }\n');
    const second = buildKitCssExportInventory(root)[0];
    assert.notEqual(first.closure_digest, second.closure_digest);
    assert.equal(first.digest, second.digest);
  },
));

test('CSS build plugin revalidates App style inputs and exact transitive Kit transform bytes', () => withTemporaryRoot(
  'nimi-simulator-css-plugin-',
  (root) => {
    cpSync(VALID_APP, root, { recursive: true });
    const validation = validateSimulatorAppSource(root);
    const plugin = createSimulatorCssProfileVitePlugin({
      compilerRoot: SIMULATOR_ROOT,
      foundationEntry: path.join(SIMULATOR_ROOT, 'src', 'styles.css'),
      apps: [{ rootDir: root, style: validation.style }],
    });
    plugin.buildStart.call({});

    const transitiveKitCss = path.join(
      SIMULATOR_ROOT,
      'node_modules',
      '@nimiplatform',
      'kit',
      'dist',
      'ui',
      'generated',
      'theme-base.css',
    );
    const kitCode = readFileSync(transitiveKitCss, 'utf8');
    assert.ok(plugin.transform.call({}, kitCode, transitiveKitCss));
    assert.throws(
      () => plugin.transform.call({}, `${kitCode}\n/* drift */\n`, transitiveKitCss),
      (error) => error?.code === 'SIM_CSS_KIT_CLOSURE_STALE',
    );

    const appStyle = path.join(root, 'src', 'renderer', 'styles.css');
    writeFileSync(appStyle, `${readFileSync(appStyle, 'utf8')}\n.nimi-ui-module--sample-app { color: red; }\n`);
    assert.throws(
      () => plugin.buildStart.call({}),
      (error) => error?.code === 'SIM_CSS_APP_INPUT_STALE',
    );
  },
));
