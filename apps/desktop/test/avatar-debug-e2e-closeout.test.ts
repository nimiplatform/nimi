import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const avatarFixturePath = resolve(
  workspaceRoot,
  'apps/avatar/fixtures/vrm-debug/VRM1_Constraint_Twist_Sample.vrm',
);
const desktopPackageRoot = resolve(
  workspaceRoot,
  'apps/desktop/e2e/fixtures/avatar-debug/vrm-package',
);
const desktopPackageFilePath = resolve(
  desktopPackageRoot,
  'files/VRM1_Constraint_Twist_Sample.vrm',
);
const desktopPackageManifestPath = resolve(desktopPackageRoot, 'manifest.json');

const EXPECTED_SHA256 = '12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2';
const EXPECTED_CONTENT_DIGEST = '601945ec0495676c3b686ee3dbeace53910d0ae692ae37a5cf09049b28934876';
const EXPECTED_PACKAGE_ID = 'vrm_601945ec0495';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function aggregateContentDigest(input: { path: string; bytes: number; sha256: string }): string {
  const hash = createHash('sha256');
  hash.update(input.path);
  hash.update(Buffer.from([0]));
  hash.update(String(input.bytes));
  hash.update(Buffer.from([0]));
  hash.update(input.sha256);
  hash.update(Buffer.from([0]));
  return hash.digest('hex');
}

test('avatar debug closeout uses the pinned real VRM fixture in Avatar and Desktop package custody', () => {
  const avatarBytes = statSync(avatarFixturePath).size;
  const desktopBytes = statSync(desktopPackageFilePath).size;

  assert.equal(avatarBytes, 10776032);
  assert.equal(desktopBytes, avatarBytes);
  assert.equal(sha256File(avatarFixturePath), EXPECTED_SHA256);
  assert.equal(sha256File(desktopPackageFilePath), EXPECTED_SHA256);
});

test('desktop avatar debug package manifest mirrors imported-package validation truth', () => {
  const manifest = JSON.parse(readFileSync(desktopPackageManifestPath, 'utf8')) as {
    manifest_version: number;
    package_version: string;
    package_id: string;
    kind: string;
    loader_min_version: string;
    entry_file: string;
    required_files: string[];
    content_digest: string;
    files: Array<{ path: string; sha256: string; bytes: number; mime: string }>;
    limits: {
      max_manifest_bytes: number;
      max_package_bytes: number;
      max_file_bytes: number;
      max_file_count: number;
    };
    capabilities?: {
      backend_kind?: string;
      generated_motion_routes?: string[];
      profile_source?: string;
    };
    import: {
      source_fingerprint: string;
      source_label: string;
    };
    validation?: unknown;
  };
  const file = manifest.files[0];

  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.package_version, '1.0.0');
  assert.equal(manifest.package_id, EXPECTED_PACKAGE_ID);
  assert.equal(manifest.kind, 'vrm');
  assert.equal(manifest.loader_min_version, '1.0.0');
  assert.equal(manifest.entry_file, 'files/VRM1_Constraint_Twist_Sample.vrm');
  assert.deepEqual(manifest.required_files, [manifest.entry_file]);
  assert.equal(manifest.validation, undefined);
  assert.ok(file, 'manifest must list the VRM file');
  assert.equal(file.path, manifest.entry_file);
  assert.equal(file.sha256, EXPECTED_SHA256);
  assert.equal(file.bytes, 10776032);
  assert.equal(file.mime, 'model/vrm');
  assert.equal(aggregateContentDigest(file), EXPECTED_CONTENT_DIGEST);
  assert.equal(manifest.content_digest, `sha256:${EXPECTED_CONTENT_DIGEST}`);
  assert.equal(manifest.import.source_fingerprint, `sha256:${EXPECTED_CONTENT_DIGEST}`);
  assert.equal(manifest.import.source_label, 'VRM1_Constraint_Twist_Sample.vrm');
  assert.deepEqual(manifest.limits, {
    max_manifest_bytes: 262144,
    max_package_bytes: 524288000,
    max_file_bytes: 104857600,
    max_file_count: 2048,
  });
  assert.equal(manifest.capabilities?.backend_kind, 'vrm');
  assert.equal(manifest.capabilities?.profile_source, 'real_vrm_fixture');
  assert.ok(manifest.capabilities?.generated_motion_routes?.includes('generated_motion.vrm.pose'));
});
