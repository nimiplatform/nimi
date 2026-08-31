import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregateAppTargetCandidates,
  packAppTarget,
  readNimiAppArchive,
} from '../lib/app-pack.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-app-pack-'));
  mkdirSync(path.join(root, '.nimi', 'config'), { recursive: true });
  mkdirSync(path.join(root, 'build', 'windows'), { recursive: true });
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'example-app', version: '0.1.0', private: true }, null, 2)}\n`);
  writeFileSync(path.join(root, 'LICENSE'), 'Example App License\n');
  writeFileSync(path.join(root, 'nimi.app.yaml'), [
    'app_id: example.app',
    'display_name: Example App',
    'version: 0.1.0',
    'profile: standalone',
    'manifest_role: submitted-input',
    'app_access: []',
    '',
  ].join('\n'));
  writeFileSync(path.join(root, '.nimi', 'config', 'build-profile.yaml'), [
    'build_profile_ref: test',
    'test_command: node --test',
    'build_command: node build.mjs',
    'targets:',
    '  windows-x86_64:',
    '    os: windows',
    '    arch: x86_64',
    '    payload_path: build/windows',
    '    runtime_entry: payload/example-app.exe',
    'profile_role: developer-workflow-input',
    '',
  ].join('\n'));
  writeFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname = "example-app"\nversion = "0.1.0"\n');
  writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), '{"version":"0.1.0"}\n');
  writeFileSync(path.join(root, 'build', 'windows', 'example-app.exe'), Buffer.from([0, 1, 2, 3, 4]));
  writeFileSync(path.join(root, 'build', 'windows', 'resource.txt'), 'resource\n');
  return root;
}

test('pack emits one deterministic target archive and canonical target metadata', () => {
  const root = fixture();
  try {
    const first = packAppTarget(root, { target: 'windows-x86_64' });
    const firstBytes = readFileSync(first.artifactPath);
    const second = packAppTarget(root, { target: 'windows-x86_64' });
    const secondBytes = readFileSync(second.artifactPath);
    assert.deepEqual(secondBytes, firstBytes);
    assert.equal(second.sha256, first.sha256);
    assert.equal(second.target_id, 'windows-x86_64');
    assert.deepEqual(second.native_trust, { posture: 'development-unsigned' });

    const entries = readNimiAppArchive(firstBytes);
    assert.deepEqual([...entries.keys()], [
      'LICENSE',
      'manifest.json',
      'nimi.app.yaml',
      'payload/example-app.exe',
      'payload/resource.txt',
    ]);
    assert.equal(entries.get('payload/example-app.exe').mode, 0o755);
    assert.equal(entries.get('LICENSE').bytes.toString('utf8'), 'Example App License\n');
    const manifest = JSON.parse(entries.get('manifest.json').bytes.toString('utf8'));
    assert.deepEqual({ app: manifest.app_id, version: manifest.version, target: manifest.target_id }, {
      app: 'example.app',
      version: '0.1.0',
      target: 'windows-x86_64',
    });
    assert.equal(manifest.runtime_entry, 'payload/example-app.exe');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pack fails when runtime entry is absent and never invents cross-target output', () => {
  const root = fixture();
  try {
    const profilePath = path.join(root, '.nimi', 'config', 'build-profile.yaml');
    writeFileSync(profilePath, readFileSync(profilePath, 'utf8').replace('payload/example-app.exe', 'payload/missing.exe'));
    assert.throws(() => packAppTarget(root, { target: 'windows-x86_64' }), /runtime_entry is missing/u);
    assert.throws(() => packAppTarget(root, { target: 'macos-aarch64' }), /Unsupported App package target/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pack requires the App project license in the immutable archive', () => {
  const root = fixture();
  try {
    rmSync(path.join(root, 'LICENSE'));
    assert.throws(() => packAppTarget(root, { target: 'windows-x86_64' }), /LICENSE is missing/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('aggregate verifies final target bytes and creates one version candidate', () => {
  const root = fixture();
  try {
    const packed = packAppTarget(root, { target: 'windows-x86_64' });
    const aggregate = aggregateAppTargetCandidates(root);
    assert.equal(aggregate.targets.length, 1);
    assert.equal(aggregate.targets[0].sha256, packed.sha256);
    const candidate = JSON.parse(readFileSync(aggregate.candidatePath, 'utf8'));
    assert.equal(candidate.format, 'nimi.app-release-candidate/v1');
    assert.deepEqual(candidate.targets.map((entry) => entry.target_id), ['windows-x86_64']);

    writeFileSync(packed.artifactPath, 'changed');
    assert.throws(() => aggregateAppTargetCandidates(root), /changed after pack/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pack independently enforces package, manifest, Cargo, and Tauri version lockstep', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), '{"version":"0.2.0"}\n');
    assert.throws(
      () => packAppTarget(root, { target: 'windows-x86_64' }),
      /versions must be exact and lockstep/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('archive reader rejects changed bytes', () => {
  const root = fixture();
  try {
    const packed = packAppTarget(root, { target: 'windows-x86_64' });
    const bytes = readFileSync(packed.artifactPath);
    bytes[50] ^= 0xff;
    assert.throws(() => readNimiAppArchive(bytes), /digest mismatch|Invalid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
