import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  aggregateAppTargetCandidates,
  hashAppArchive,
  packAppTarget,
  readNimiAppArchive,
  writeNimiAppArchive,
} from '../lib/app-pack.mjs';
import { validateManifestDesktop } from '../lib/desktop-window.mjs';
import { SCAFFOLD_INTENT_PATH, SCAFFOLD_LOCK_PATH } from '../lib/app-scaffold.mjs';
import { isManagedWebProject } from '../scripts/dev-shell.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(testDir, '..', 'bin', 'nimi-app.mjs');

function runCli(args, cwd, env = process.env) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

function writeFakeNimicodingAndLock(target) {
  const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  const codingPackage = path.join(target, 'node_modules', '@nimiplatform', 'nimi-coding');
  mkdirSync(path.join(codingPackage, 'bin'), { recursive: true });
  writeFileSync(
    path.join(codingPackage, 'package.json'),
    JSON.stringify({
      name: '@nimiplatform/nimi-coding',
      version: pkg.devDependencies['@nimiplatform/nimi-coding'],
      bin: { nimicoding: 'bin/nimicoding.mjs' },
    }),
  );
  writeFileSync(
    path.join(codingPackage, 'bin', 'nimicoding.mjs'),
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'if (process.argv.slice(2).join(" ") === "sync --apply --json") {',
      '  mkdirSync(".nimi/methodology", { recursive: true });',
      '  writeFileSync(".nimi/methodology/authority-authoring.yaml", "source: test\\n");',
      '}',
      'process.stdout.write(JSON.stringify({ ok: true, summary: { total: 1, created: 1 } }) + "\\n");',
      '',
    ].join('\n'),
  );
  const importer = {};
  for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const entries = Object.entries(pkg[sectionName] || {});
    if (entries.length === 0) continue;
    importer[sectionName] = Object.fromEntries(
      entries.map(([name, specifier]) => [name, { specifier, version: specifier.replace(/^[~^]/u, '') }]),
    );
  }
  writeFileSync(
    path.join(target, 'pnpm-lock.yaml'),
    stringifyYaml({ lockfileVersion: '9.0', importers: { '.': importer } }),
  );
}

function createManagedWebPackFixture(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-managed-web-pack-'));
  mkdirSync(path.join(root, '.nimi', 'config'), { recursive: true });
  mkdirSync(path.join(root, 'dist', 'renderer', 'assets'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'example-managed-web', version: '0.1.12', license: 'Apache-2.0', private: true }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'LICENSE'), 'Apache License 2.0\n');
  writeFileSync(path.join(root, 'icon.png'), PNG.sync.write({ width: 128, height: 128, data: Buffer.alloc(128 * 128 * 4, 255) }));
  writeFileSync(path.join(root, 'NIMI_APP.md'), '# Example Managed Web App\nUse the app.\n');
  writeFileSync(path.join(root, 'RELEASE_NOTES.md'), 'Release 0.1.12.\n');
  const manifestDoc = {
    app_id: 'example.managed-web',
    display_name: 'Example Managed Web',
    version: '0.1.12',
    profile: 'standalone',
    manifest_role: 'submitted-input',
    app_access: [],
    capability_contract_refs: [],
    required_standardized_feature_refs: [],
    storage_policy: options.storagePolicy || { kind: 'nimi-mediated-default' },
    ...(options.desktop === undefined ? {
      desktop: {
        window: {
          width: 1320,
          height: 900,
          min_width: 390,
          min_height: 620,
          title_bar_style: 'hidden',
        },
      },
    } : options.desktop === null ? {} : { desktop: options.desktop }),
    metadata: {
      summary: 'A lightweight managed-web App.',
      icon: 'icon.png',
      release_notes: 'RELEASE_NOTES.md',
    },
  };
  writeFileSync(path.join(root, 'nimi.app.yaml'), stringifyYaml(manifestDoc));
  writeFileSync(
    path.join(root, '.nimi', 'config', 'build-profile.yaml'),
    stringifyYaml({
      build_profile_ref: 'managed-web-pnpm-vite',
      test_command: 'node --test',
      build_command: 'pnpm run build',
      output_path: options.payloadPath || 'dist/renderer',
      targets: {
        'desktop-universal': {
          os: 'any',
          arch: 'any',
          build_command: 'pnpm run build',
          payload_path: options.payloadPath || 'dist/renderer',
          runtime_entry: options.runtimeEntry || 'payload/index.html',
        },
      },
      profile_role: 'developer-workflow-input',
    }),
  );
  writeFileSync(path.join(root, 'dist', 'renderer', 'index.html'), '<!doctype html><html><body>ok</body></html>\n');
  writeFileSync(path.join(root, 'dist', 'renderer', 'assets', 'app.js'), 'export const ready = true;\n');
  return root;
}

test('default desktop create produces managed-web-pnpm-vite without Electron host files and survives init/sync/check with custom desktop.window', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-managed-web-create-'));
  const target = path.join(tempRoot, 'app');
  try {
    const created = runCli([
      'create', '--dir', target, '--platform', 'desktop', '--app-id', 'acme.shijing-like', '--title', 'Shijing Like',
    ], tempRoot);
    assert.equal(created.status, 0, created.stderr);

    assert.equal(existsSync(path.join(target, 'src-electron')), false);
    assert.equal(existsSync(path.join(target, 'tsconfig.electron.json')), false);
    assert.equal(existsSync(path.join(target, 'scripts', 'package-electron-production.mjs')), false);

    const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.main, undefined);
    assert.equal(pkg.devDependencies.electron, undefined);
    assert.equal(pkg.devDependencies['@electron/packager'], undefined);
    assert.equal(pkg.scripts.postinstall, undefined);
    assert.equal(pkg.scripts['build:electron'], undefined);
    assert.equal(pkg.scripts.build, 'tsc --noEmit && vite build');
    assert.equal(pkg.scripts.dev, 'nimi-app dev --shell electron');

    const viteConfig = readFileSync(path.join(target, 'vite.config.ts'), 'utf8');
    assert.match(viteConfig, /outDir: 'dist\/renderer'/);
    assert.match(viteConfig, /emptyOutDir: true/);

    const buildProfile = parseYaml(readFileSync(path.join(target, '.nimi/config/build-profile.yaml'), 'utf8'));
    const readme = readFileSync(path.join(target, 'README.md'), 'utf8');
    assert.match(readme, /nimi-app pack --target desktop-universal/u);
    assert.doesNotMatch(readme, /dist-electron-package|--target windows-x86_64|<!-- carrier:/u);
    assert.equal(buildProfile.build_profile_ref, 'managed-web-pnpm-vite');
    assert.equal(buildProfile.output_path, 'dist/renderer');
    assert.deepEqual(Object.keys(buildProfile.targets), ['desktop-universal']);
    assert.deepEqual(buildProfile.targets['desktop-universal'], {
      os: 'any',
      arch: 'any',
      build_command: 'pnpm run build',
      payload_path: 'dist/renderer',
      runtime_entry: 'payload/index.html',
    });

    const manifest = parseYaml(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'));
    assert.deepEqual(manifest.desktop, { window: { title_bar_style: 'hidden' } });

    const workflow = readFileSync(path.join(target, '.github/workflows/nimi-app-release.yml'), 'utf8');
    assert.match(workflow, /if \. == "desktop-universal" then "ubuntu-latest"/);

    const intent = JSON.parse(readFileSync(path.join(target, SCAFFOLD_INTENT_PATH), 'utf8'));
    assert.equal(intent.carrier, 'managed-web');

    writeFakeNimicodingAndLock(target);
    const initialized = runCli(['init', '--dir', target], tempRoot);
    assert.equal(initialized.status, 0, initialized.stderr);

    const lock = JSON.parse(readFileSync(path.join(target, SCAFFOLD_LOCK_PATH), 'utf8'));
    assert.equal(lock.carrier, 'managed-web');

    // Author customizes desktop.window; sync & check preserve it without scaffold drift.
    manifest.desktop = {
      window: { width: 1320, height: 900, min_width: 390, min_height: 620, title_bar_style: 'hidden' },
    };
    writeFileSync(path.join(target, 'nimi.app.yaml'), stringifyYaml(manifest));
    const synced = runCli(['sync', '--dir', target], tempRoot);
    assert.equal(synced.status, 0, synced.stderr);
    const checked = runCli(['check', '--dir', target], tempRoot);
    assert.equal(checked.status, 0, checked.stderr);
    const afterSync = parseYaml(readFileSync(path.join(target, 'nimi.app.yaml'), 'utf8'));
    assert.deepEqual(afterSync.desktop, manifest.desktop);

    // Invalid desktop.window fails check closed.
    manifest.desktop = { window: { width: 500, min_width: 600 } };
    writeFileSync(path.join(target, 'nimi.app.yaml'), stringifyYaml(manifest));
    const invalidCheck = runCli(['check', '--dir', target], tempRoot);
    assert.notEqual(invalidCheck.status, 0);
    assert.match(invalidCheck.stderr, /min_width/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('managed-web --features all keeps text-only agent-conversation, passes hostMechanics={null} to agent-center, and rejects native-only agent-realtime prewrite', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-managed-web-features-'));
  const allTarget = path.join(tempRoot, 'all-app');
  const rejectedTarget = path.join(tempRoot, 'rejected-app');
  try {
    const ok = runCli(['create', '--dir', allTarget, '--platform', 'desktop', '--features', 'all'], tempRoot);
    assert.equal(ok.status, 0, ok.stderr);
    const intent = JSON.parse(readFileSync(path.join(allTarget, SCAFFOLD_INTENT_PATH), 'utf8'));
    assert.deepEqual(intent.directFeatures, [
      'studio-create',
      'studio-media',
      'studio-voice',
      'kit-recipes',
      'agent-center',
      'agent-conversation',
    ]);
    const agentCenter = readFileSync(path.join(allTarget, 'src/capabilities/agent-center/index.tsx'), 'utf8');
    assert.match(agentCenter, /hostMechanics=\{null\}/);
    assert.doesNotMatch(agentCenter, /createAgentCenterShellBridge|hasElectronInvoke/);

    const agentConversation = readFileSync(path.join(allTarget, 'src/capabilities/agent-conversation/index.tsx'), 'utf8');
    assert.match(agentConversation, /CanonicalTranscriptView/);
    assert.match(agentConversation, /CanonicalComposer/);
    assert.match(agentConversation, /createAppConversationEntrySession/);
    assert.match(agentConversation, /reference\.agentHandle/);
    assert.doesNotMatch(agentConversation, /recordVoice|recordAndTranscribe|<AppConversationEntry\b/);

    const denied = runCli(['create', '--dir', rejectedTarget, '--platform', 'desktop', '--features', 'agent-realtime'], tempRoot);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /--carrier native/u);
    assert.equal(existsSync(rejectedTarget), false, 'must fail before writing files');

    const webCarrier = runCli(['create', '--dir', rejectedTarget, '--platform', 'web', '--carrier', 'managed-web'], tempRoot);
    assert.notEqual(webCarrier.status, 0);
    assert.match(webCarrier.stderr, /only for desktop Apps/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('managed-web pack is byte-identical across consecutive runs, emits 0o644 payload/index.html, preserves desktop.window, and enforces all SEC-4 red lines', async () => {
  const root = createManagedWebPackFixture();
  try {
    const first = await packAppTarget(root, { target: 'desktop-universal', production: true });
    const firstBytes = readFileSync(first.artifactPath);
    const second = await packAppTarget(root, { target: 'desktop-universal', production: true });
    const secondBytes = readFileSync(second.artifactPath);
    assert.equal(first.sha256, second.sha256);
    assert.equal(Buffer.compare(firstBytes, secondBytes), 0, 'consecutive packs must produce identical bytes');

    const entries = readNimiAppArchive(firstBytes);
    assert.equal(entries.get('payload/index.html')?.mode, 0o644);
    assert.equal([...entries.keys()].some((name) => name.includes('nimi-app/')), false, 'must never self-nest dist/nimi-app');
    const manifest = JSON.parse(entries.get('manifest.json').bytes.toString('utf8'));
    assert.equal(manifest.target_id, 'desktop-universal');
    assert.equal(manifest.os, 'any');
    assert.equal(manifest.arch, 'any');
    assert.deepEqual(manifest.native_trust, { posture: 'nimi-managed-carrier', certificate_subject: null });
    assert.deepEqual(manifest.execution_profile, { launch_mode: 'nimi-managed-web-v1' });
    const declaration = parseYaml(entries.get('nimi.app.yaml').bytes.toString('utf8'));
    assert.deepEqual(declaration.desktop, {
      window: { width: 1320, height: 900, min_width: 390, min_height: 620, title_bar_style: 'hidden' },
    });
    const appInfo = JSON.parse(entries.get('app-info.json').bytes.toString('utf8'));
    const mediatedStorage = { kind: 'nimi-mediated-default', os_storage_disclosure: null };
    assert.deepEqual(appInfo.storage_policy, mediatedStorage);
    assert.deepEqual(declaration.storage_policy, mediatedStorage);
    assert.equal(Object.hasOwn(appInfo, 'desktop'), false, 'app-info.json must remain unchanged');

    const aggregate = await aggregateAppTargetCandidates(root);
    assert.equal(aggregate.targets.length, 1);
    assert.equal(aggregate.targets[0].target_id, 'desktop-universal');

    // Tampering payload/index.html to 0o755 fails aggregate verification.
    const tampered = new Map([...entries.entries()]);
    tampered.set('payload/index.html', { bytes: entries.get('payload/index.html').bytes, mode: 0o755 });
    const tamperedArchive = writeNimiAppArchive([...tampered.entries()].map(([name, value]) => ({ name, ...value })));
    writeFileSync(first.artifactPath, tamperedArchive);
    const targetMeta = JSON.parse(readFileSync(first.metadataPath, 'utf8'));
    targetMeta.size = tamperedArchive.length;
    targetMeta.sha256 = hashAppArchive(tamperedArchive);
    writeFileSync(first.metadataPath, JSON.stringify(targetMeta));
    await assert.rejects(() => aggregateAppTargetCandidates(root), /missing or not 0644/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('managed-web pack and aggregation enforce snapshot path and directory constraints', async (t) => {
  const root = createManagedWebPackFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const deepest = path.join(root, 'dist', 'renderer', ...Array(63).fill('d'));
  mkdirSync(deepest, { recursive: true });
  writeFileSync(path.join(deepest, 'asset.txt'), 'boundary');
  const packaged = await packAppTarget(root, { target: 'desktop-universal' });
  assert.equal((await aggregateAppTargetCandidates(root)).targets.length, 1);

  mkdirSync(path.join(deepest, 'extra'));
  writeFileSync(path.join(deepest, 'extra', 'asset.txt'), 'over depth');
  await assert.rejects(() => packAppTarget(root, { target: 'desktop-universal' }), /directory depth exceeds 64/u);

  const entries = [...readNimiAppArchive(readFileSync(packaged.artifactPath))]
    .map(([name, entry]) => ({ name, ...entry }));
  const metadata = JSON.parse(readFileSync(packaged.metadataPath, 'utf8'));
  async function checkAggregate(extra, expectedError) {
    const bytes = writeNimiAppArchive([...entries, ...extra]);
    writeFileSync(packaged.artifactPath, bytes);
    writeFileSync(packaged.metadataPath, JSON.stringify({ ...metadata, size: bytes.length, sha256: hashAppArchive(bytes) }));
    await assert.rejects(() => aggregateAppTargetCandidates(root), expectedError);
  }
  // Write the two spellings into the archive directly. A case-insensitive
  // volume would overwrite the first file while creating an on-disk fixture.
  await checkAggregate([
    { name: 'payload/Straße.txt', mode: 0o644, bytes: Buffer.from('lower') },
    { name: 'payload/STRAẞE.txt', mode: 0o644, bytes: Buffer.from('upper') },
  ], /path collision/u);

  assert.throws(
    () => writeNimiAppArchive([...entries, { name: `payload/${'d/'.repeat(64)}asset.txt`, mode: 0o644, bytes: Buffer.alloc(0) }]),
    /directory depth exceeds 64/u,
  );
  const wideTree = Array.from({ length: 160 }, (_, group) => ({
    name: `payload/group${group}/${'d/'.repeat(62)}asset.txt`, mode: 0o644, bytes: Buffer.alloc(0),
  }));
  await checkAggregate(wideTree, /exceeds 10000 directories/u);
});

test('managed-web pack rejects overlapping output directory, app-owned-os-storage, Windows reserved names, and >64 MiB payloads', async () => {
  // Overlapping payload_path: dist contains dist/nimi-app
  const overlapRoot = createManagedWebPackFixture({ payloadPath: 'dist' });
  try {
    writeFileSync(path.join(overlapRoot, 'dist', 'index.html'), '<html></html>');
    await assert.rejects(() => packAppTarget(overlapRoot, { target: 'desktop-universal' }), /must not overlap dist\/nimi-app/u);
  } finally {
    rmSync(overlapRoot, { recursive: true, force: true });
  }

  // app-owned-os-storage rejected
  const storageRoot = createManagedWebPackFixture({
    storagePolicy: {
      kind: 'app-owned-os-storage',
      os_storage_disclosure: [{ path_pattern: '~/data', purpose: 'cache', expected_size_band: '<10MiB' }],
    },
  });
  try {
    await assert.rejects(() => packAppTarget(storageRoot, { target: 'desktop-universal' }), /nimi-mediated-default/u);
  } finally {
    rmSync(storageRoot, { recursive: true, force: true });
  }

  // Invalid desktop.window bounds, unknown key, and float YAML integer syntax
  assert.throws(() => validateManifestDesktop({ extra: true }), /unsupported field/u);
  assert.throws(() => validateManifestDesktop({ window: { title_bar_style: 'frameless' } }), /native.*hidden/u);
  assert.throws(() => validateManifestDesktop({ window: { width: 399 } }), /400 and 2560/u);
  assert.throws(() => validateManifestDesktop({ window: { width: 420 } }), /min_width/u);
  assert.throws(
    () => validateManifestDesktop({ window: { width: 1280 } }, 'nimi.app.yaml', 'desktop:\n  window:\n    width: 1280.0\n'),
    /base-10 YAML integer/u,
  );

  // Windows reserved segment check on archive entries
  const badRoot = createManagedWebPackFixture();
  try {
    writeFileSync(path.join(badRoot, 'dist', 'renderer', 'CON.js'), 'bad');
    await assert.rejects(() => packAppTarget(badRoot, { target: 'desktop-universal' }), /invalid Windows segment/u);
  } finally {
    rmSync(badRoot, { recursive: true, force: true });
  }

  // Leading-zero numeric prerelease SemVer (0.1.12-01) rejected
  const badSemverRoot = createManagedWebPackFixture();
  try {
    const manifestPath = path.join(badSemverRoot, 'nimi.app.yaml');
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('version: 0.1.12', 'version: 0.1.12-01'));
    const pkgPath = path.join(badSemverRoot, 'package.json');
    writeFileSync(pkgPath, readFileSync(pkgPath, 'utf8').replace('"0.1.12"', '"0.1.12-01"'));
    await assert.rejects(() => packAppTarget(badSemverRoot, { target: 'desktop-universal' }), /exact and lockstep/u);
  } finally {
    rmSync(badSemverRoot, { recursive: true, force: true });
  }

  // > 64 MiB payload rejected
  const hugeRoot = createManagedWebPackFixture();
  try {
    writeFileSync(path.join(hugeRoot, 'dist', 'renderer', 'huge.bin'), Buffer.alloc(64 * 1024 * 1024 + 1));
    await assert.rejects(() => packAppTarget(hugeRoot, { target: 'desktop-universal' }), /exceeds 67108864 bytes/u);
  } finally {
    rmSync(hugeRoot, { recursive: true, force: true });
  }
});

test('dev-shell detects managed-web projects to bypass project-local Electron requirement', async () => {
  const managedRoot = createManagedWebPackFixture();
  const nativeRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-native-dev-check-'));
  try {
    mkdirSync(path.join(nativeRoot, '.nimi', 'config'), { recursive: true });
    writeFileSync(
      path.join(nativeRoot, '.nimi', 'config', 'build-profile.yaml'),
      'build_profile_ref: electron-packager-pnpm-vite\n',
    );
    assert.equal(await isManagedWebProject(managedRoot), true);
    assert.equal(await isManagedWebProject(nativeRoot), false);
  } finally {
    rmSync(managedRoot, { recursive: true, force: true });
    rmSync(nativeRoot, { recursive: true, force: true });
  }
});
