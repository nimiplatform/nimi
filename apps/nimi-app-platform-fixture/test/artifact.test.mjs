import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildArtifact } from '../scripts/build-artifact.mjs';

test('buildArtifact writes deterministic archive and descriptor evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-app-platform-fixture-'));
  const fixtureRoot = path.join(tmp, 'fixture');
  fs.mkdirSync(path.join(fixtureRoot, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'dist/index.html'), '<!doctype html><div id="root"></div>\n');
  fs.writeFileSync(path.join(fixtureRoot, 'dist/proof.js'), 'window.__NIMI_FIXTURE__ = true;\n');
  fs.writeFileSync(path.join(fixtureRoot, 'nimi-app.manifest.json'), JSON.stringify({
    appId: 'community.nimi.fixture.platform-proof',
    packageKind: 'nimi-app',
    entryRef: 'dist/index.html',
    permissionsRef: 'community.nimi.fixture.platform-proof.permission_scope_ref',
    storagePolicyRef: 'nimi-data-app-roots',
    runtimeRequired: true,
    realmRequired: true,
  }, null, 2));

  const first = await buildArtifact({ rootDir: fixtureRoot });
  const firstEvidence = JSON.parse(fs.readFileSync(first.evidencePath, 'utf8'));
  const second = await buildArtifact({ rootDir: fixtureRoot });
  const secondEvidence = JSON.parse(fs.readFileSync(second.evidencePath, 'utf8'));

  assert.equal(first.sha256, second.sha256);
  assert.equal(firstEvidence.artifact.sha256, secondEvidence.artifact.sha256);
  assert.equal(firstEvidence.artifact.size.download, secondEvidence.artifact.size.download);
  assert.equal(firstEvidence.artifact.size.installed, secondEvidence.artifact.size.installed);
  assert.equal(firstEvidence.admissionTrack, 'admission-sandbox-ci');
  assert.equal(firstEvidence.productReadinessClaimAllowed, false);
  assert.deepEqual(firstEvidence.manifest, {
    appId: 'community.nimi.fixture.platform-proof',
    packageKind: 'nimi-app',
    entryRef: 'dist/index.html',
    permissionsRef: 'community.nimi.fixture.platform-proof.permission_scope_ref',
    storagePolicyRef: 'nimi-data-app-roots',
    runtimeRequired: true,
    realmRequired: true,
  });
});

test('built entry uses relative asset URLs for the declared dist/index.html entry', () => {
  const entry = fs.readFileSync(
    path.resolve(import.meta.dirname, '../dist/index.html'),
    'utf8',
  );
  assert.doesNotMatch(entry, /\b(?:src|href)="\/assets\//);
  assert.match(entry, /\b(?:src|href)="\.\/assets\//);
});
