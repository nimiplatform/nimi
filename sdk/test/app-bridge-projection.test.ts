import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNimiAppBridgeProjection } from '../src/app/index.js';

function projectionPayload() {
  return {
    registryPath: '/Users/test/.nimi/apps/registry.json',
    packagesPath: '/Users/test/.nimi/apps/packages.json',
    registryRows: [{
      appId: 'nimi.notes',
      appKind: 'nimi-app',
      displayName: 'Notes',
      publisher: 'Nimi',
      trustTier: 'nimi-first-party',
      ordinaryVisibility: 'ordinary-visible',
      releaseDescriptorRef: 'nimi.notes.bundled',
      installStoragePolicyRef: 'policy.notes',
      sourceRule: 'bundled',
      admissionStatus: 'admitted',
      installedVersion: '1.0.0',
    }],
    releaseDescriptors: [{
      descriptorId: 'nimi.notes.bundled',
      appId: 'nimi.notes',
      version: '1.0.0',
      descriptorClass: 'bundled-with-nimi',
      sourceKind: 'nimi-bundle',
      sourceRef: 'bundle://notes',
      artifactLocator: 'bundle://notes/app',
      digestAlgorithm: 'sha256',
      sha256: 'a'.repeat(64),
      size: '42',
      provenanceRef: 'provenance.notes',
      packageKind: 'nimi-app',
      entryRef: 'index.html',
      sandboxRef: 'sandbox.notes',
      permissionsRef: 'permissions.notes',
      storagePolicyRef: 'policy.notes',
      admissionPath: 'platform-registry',
      mutableSourceAllowed: false,
      installDigestVerificationRequired: 'required',
      sourceRule: 'bundled',
    }],
    installEvidence: [{
      appId: 'nimi.notes',
      releaseDescriptorRef: 'nimi.notes.bundled',
      storagePolicyRef: 'policy.notes',
      installedVersion: '1.0.0',
      sha256: 'a'.repeat(64),
      verificationState: 'digest-verified',
    }],
  };
}

test('parseNimiAppBridgeProjection decodes registry loader payloads', () => {
  const parsed = parseNimiAppBridgeProjection(projectionPayload());

  assert.equal(parsed.registryRows[0]?.appId, 'nimi.notes');
  assert.equal(parsed.releaseDescriptors[0]?.digestAlgorithm, 'sha256');
  assert.equal(parsed.installEvidence[0]?.verificationState, 'digest-verified');
});

test('parseNimiAppBridgeProjection fails closed for invalid admission values', () => {
  const payload = projectionPayload();
  payload.registryRows[0].admissionStatus = 'locally-approved';

  assert.throws(
    () => parseNimiAppBridgeProjection(payload),
    /admissionStatus is invalid: locally-approved/,
  );
});

test('parseNimiAppBridgeProjection fails closed for invalid descriptor digest algorithm', () => {
  const payload = projectionPayload();
  payload.releaseDescriptors[0].digestAlgorithm = 'md5';

  assert.throws(
    () => parseNimiAppBridgeProjection(payload),
    /digestAlgorithm must be sha256/,
  );
});
