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
  computeSourceDigestV1,
  sha256Digest,
  validateSimulatorAppSource,
} from '@nimiplatform/app-tools/simulator-conformance';
import {
  buildKitCssExportInventory,
  createSimulatorCssProfileVitePlugin,
} from '@nimiplatform/app-tools/simulator-css-profile';
import { createMaterializedIntegrityVerifier } from '../build/materialized-integrity.mjs';
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

test('materialization evidence binds every selected file path, mode, byte length, and digest', () => withTemporaryRoot(
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
      authority_refs: [{ owner: 'test', rule_id: 'T-SIM' }],
      authority_index_digest: sha256Digest('authority'),
    }, { repositories: [] }, {
      workspaceRoot: root,
      workspaceRepositoryKey: 'fixture',
      stagingRoot,
      targetRoot: path.join(stagingRoot, 'source', 'sample-app', 'app'),
      moduleId: 'sample-app',
      release: true,
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

test('materialized integrity rejects transform drift and any whole-tree mutation', () => withTemporaryRoot(
  'nimi-simulator-materialized-verifier-',
  (root) => {
    const generatedRoot = path.join(root, '.generated');
    const sourceRoot = path.join(generatedRoot, 'materialized', 'source', 'sample-app', 'app');
    const evidenceRoot = path.join(generatedRoot, 'evidence');
    const source = 'export const value = 1;\n';
    const sourcePath = path.join(sourceRoot, 'src', 'main.ts');
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(sourcePath, source);
    const file = {
      path: 'src/main.ts',
      mode: '100644',
      bytes: Buffer.byteLength(source),
      digest: sha256Digest(source),
    };
    const sourceDigest = computeSourceDigestV1([{ path: file.path, mode: file.mode, bytes: Buffer.from(source) }]);
    writeFileSync(path.join(evidenceRoot, 'materialization.json'), `${JSON.stringify([{
      moduleId: 'sample-app',
      sourceLocations: [{
        sourceId: 'app',
        root: 'source/sample-app/app/',
        sourceDigest,
        fileCount: 1,
        files: [file],
      }],
    }], null, 2)}\n`);

    const verifier = createMaterializedIntegrityVerifier({ generatedRoot });
    verifier.verifyAll();
    assert.equal(verifier.verifyTransform(source, sourcePath), true);
    assert.throws(
      () => verifier.verifyTransform(`${source}// injected\n`, sourcePath),
      (error) => error?.code === 'SIM_MATERIALIZED_TRANSFORM_DRIFT',
    );
    writeFileSync(sourcePath, `${source}// drift\n`);
    assert.throws(
      () => verifier.verifyAll(),
      (error) => error?.code === 'SIM_MATERIALIZED_FILE_DRIFT',
    );
    writeFileSync(sourcePath, source);
    writeFileSync(path.join(sourceRoot, 'unqualified.ts'), 'export {};\n');
    assert.throws(
      () => verifier.verifyAll(),
      (error) => error?.code === 'SIM_MATERIALIZED_INVENTORY_DRIFT',
    );
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
    const report = validateSimulatorAppSource(root).report;
    const plugin = createSimulatorCssProfileVitePlugin({
      compilerRoot: SIMULATOR_ROOT,
      foundationEntry: path.join(SIMULATOR_ROOT, 'src', 'styles.css'),
      apps: [{ rootDir: root, report }],
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
