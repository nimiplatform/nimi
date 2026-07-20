import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  canonicalJSON,
  createMacOSReleaseTrustRecord,
  MACOS_RELEASE_RECORD_SIGNER_PATH,
  MACOS_RELEASE_RECORDS,
  readMacOSProductionReleaseInputs,
  verifyMacOSReleaseTrustRecordSignature,
} from '../scripts/lib/macos-release-contract.mjs';

function releaseKeys() {
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  return { pair, publicKey: spki.subarray(-32).toString('base64url') };
}

test('macOS release records are canonical, externally signed, and role exact', () => {
  const keys = releaseKeys();
  const role = MACOS_RELEASE_RECORDS[0]!;
  const record = createMacOSReleaseTrustRecord({
    buildId: 'build-1',
    codeIdentity: {
      architecture: 'arm64',
      artifactSha256: 'a'.repeat(64),
      cdhash: 'b'.repeat(40),
      designatedRequirement: 'identifier "ai.nimi.runtime" and anchor apple generic',
      entitlementsSHA256: 'c'.repeat(64),
      signingIdentifier: role.signingIdentifier,
      teamId: 'ABCDE12345', // pragma: allowlist secret -- public synthetic Apple Team ID fixture
    },
    expiresAt: '2026-07-20T00:00:00Z',
    generation: 7,
    releaseId: 'nimi-macos-0.1.0',
    role,
    rootKeyId: 'nimi-release-root-1',
    signRecord: (payload: string) => sign(null, Buffer.from(payload), keys.pair.privateKey).toString('base64url'),
    validFrom: '2026-07-19T00:00:00Z',
  });
  assert.equal(record.encoded, canonicalJSON(record.record));
  assert.equal(record.encoded.endsWith('\n'), false);
  assert.equal(verifyMacOSReleaseTrustRecordSignature(record.encoded, keys.publicKey), true);
  const tampered = record.encoded.replace('build-1', 'build-2');
  assert.equal(verifyMacOSReleaseTrustRecordSignature(tampered, keys.publicKey), false);
  assert.throws(() => createMacOSReleaseTrustRecord({
    ...record.record,
    role: { ...role },
  }), /role is not canonical/u);
});

test('macOS production release inputs contain no private key transport', () => {
  const keys = releaseKeys();
  const env = {
    NIMI_MACOS_APPLICATION_SIGNING_IDENTITY: 'Developer ID Application: Nimi Test (ABCDE12345)',
    NIMI_MACOS_BUILD_ID: 'build-1',
    NIMI_MACOS_RELEASE_EXPIRES_AT: '2026-07-20T00:00:00Z',
    NIMI_MACOS_INSTALLER_SIGNING_IDENTITY: 'Developer ID Installer: Nimi Test (ABCDE12345)',
    NIMI_MACOS_RELEASE_GENERATION: '7',
    NIMI_MACOS_RELEASE_ID: 'nimi-macos-0.1.0',
    NIMI_MACOS_RELEASE_VALID_FROM: '2026-07-19T00:00:00Z',
    NIMI_MACOS_TEAM_ID: 'ABCDE12345',
    NIMI_NOTARYTOOL_KEYCHAIN_PROFILE: 'nimi-notary',
    NIMI_PLATFORM_RELEASE_ROOT_KEY_ID: 'nimi-release-root-1',
    NIMI_PLATFORM_RELEASE_ROOT_PUBLIC_KEY_B64URL: keys.publicKey,
  };
  const release = readMacOSProductionReleaseInputs(env, new Date('2026-07-19T12:00:00Z'));
  assert.equal(release.recordSignerPath, MACOS_RELEASE_RECORD_SIGNER_PATH);
  assert.equal(Object.keys(release).some((key) => /private|secret|password/u.test(key)), false);
  assert.equal(JSON.stringify(release).includes('PRIVATE_KEY'), false);
  assert.throws(() => readMacOSProductionReleaseInputs({}, new Date('2026-07-19T12:00:00Z')), /missing required/u);
});
