import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('fresh carrier-4 helper has a closed four-file privileged TCB', async () => {
  const build = await read('scripts/build-macos-dev-security-helper.mjs');
  assert.match(build, /FreshCarrier4Support\.swift/);
  assert.match(build, /FreshCarrier4Installer\.swift/);
  assert.doesNotMatch(build, /readdir|glob|RetiredMigration|CertificateAuthority|SigningKeychain/);
  const sources = [...build.matchAll(/path\.join\(source, '([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(sources, ['FreshCarrier4Support.swift', 'FreshCarrier4Installer.swift', 'main.swift']);
});

test('production rollback consumes the exhaustively tested observed-effect order without shadow phase flags', async () => {
  const installer=await read('apps/desktop/macos/dev-security/FreshCarrier4Installer.swift');
  assert.match(installer,/for effect in freshRollbackOrder\(effective\)/u);
  assert.match(installer,/freshObservedEffects\(plan\)/u);
  assert.doesNotMatch(installer,/FreshInstallEffects|effects\.(?:staging|principal|payload|desktop|helper|plist|custody|launchd)/u);
  for(const effect of ['bootstrap','journal','staging','principal','payload','desktop','helper','plist','custody','launchd','ledger'])assert.match(installer,new RegExp(`case \\.${effect}:`,'u'));
});

test('pre-journal privileged staging proves exact cleanup without recursively deleting shared parents', async () => {
  const service=await read('scripts/macos-dev-runtime-service.mjs');
  assert.match(service,/\[staged,bootstrapRoot,path\.dirname\(bootstrapRoot\)\]\.filter\(existsSync\)/u);
  assert.match(service,/\['\/bin\/rmdir',directory\]/u);
  assert.doesNotMatch(service,/rm', '-rf', (?:bootstrapRoot|path\.dirname\(bootstrapRoot\))/u);
});

test('helper dispatch has no signing, migration, repair, or rotation verb', async () => {
  const main = await read('apps/desktop/macos/dev-security/main.swift');
  assert.match(main, /case "status"/);
  assert.match(main, /case "verify-candidate"/);
  assert.match(main, /case "install-candidate"/);
  assert.match(main, /case "restart-service"/);
  assert.match(main, /case "reset-service-state"/);
  assert.match(main, /case "uninstall-service"/);
  assert.doesNotMatch(main, /case "reset-current"/);
  assert.doesNotMatch(main, /provision-signing|sign-release|unprovision-signing|repair|rotation|carrier-2/i);
});

test('user-domain signing commands are real native transactions rather than pending pseudo-success', async () => {
  const provision = await read('scripts/provision-macos-dev-signing.mjs');
  const unprovision = await read('scripts/unprovision-macos-dev-signing.mjs');
  const tool = await read('apps/desktop/macos/dev-signing/NimiMacOSDevSigningTool.swift');
  assert.doesNotMatch(`${provision}\n${unprovision}`, /implementation-pending/u);
  assert.match(tool, /SecKeyGeneratePair/);
  assert.match(tool, /SecKeyCreateSignature/);
  assert.match(tool, /SecKeychainDelete/);
  assert.match(tool, /profileSignature/);
  assert.match(provision, /nativeMutationStarted/);
  assert.match(unprovision, /Signing recovery tool is absent while authority residue remains/);
  assert.doesNotMatch(unprovision, /rm\(profileRoot,\{recursive:true/);
});

test('fresh profile separates user signing authority from Runtime custody', async () => {
  const profile = await read('.nimi/spec/runtime/kernel/tables/protected-local-custody-profiles.yaml');
  assert.match(profile, /dedicated_user-domain_development_signing_Keychain/);
  assert.match(profile, /Runtime-only_non-synchronizing_System-Keychain-items/);
  assert.match(profile, /tracked_profile_migration: forbidden/);
  assert.match(profile, /legacy-local-dev-profile-not-supported/);
});

test('generated projections contain no rotation protocol', async () => {
  for (const path of [
    'apps/desktop/macos/generated/macos_local_development_profile.swift',
    'apps/desktop/scripts/generated/macos-local-development-profile.mjs',
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /RetiredMigration|retiredMigration|sourceCarrier|rotationCoordinator/);
  }
});
