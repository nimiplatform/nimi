import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

async function source(relative) {
  return readFile(path.join(repoRoot, relative), 'utf8');
}

test('local-development CA key is non-durable and persistent signing identities use fixed custody', async () => {
  const [profile, authority, support] = await Promise.all([
    source('apps/desktop/scripts/generated/macos-local-development-profile.mjs'),
    source('apps/desktop/macos/dev-security/CertificateAuthority.swift'),
    source('apps/desktop/macos/dev-security/DevSecuritySupport.swift'),
  ]);

  assert.match(profile, /"signingKeychainPath": "\/Library\/Application Support\/Nimi\/RuntimeDev\/custody\/local-development-signing\.keychain-db"/u);
  assert.match(profile, /"signingKeychainPasswordService": "ai\.nimi\.runtime\.local-development\.signing-keychain-password\.v1"/u);
  assert.match(profile, /"signingKeychainPasswordCommitPolicy": "bootstrap_signing_keychain_password_exists_in_memory_only/u);
  assert.match(profile, /"bootstrapHelperPath": "\/usr\/local\/libexec\/nimi-macos-dev-security-bootstrap"/u);
  assert.match(profile, /"signingHelperIdentityTransitionPolicy": "immutable_root_owned_linker_signed_bootstrap/u);
  assert.match(support, /let signingKeychainPath = generatedSigningKeychainPath/u);
  assert.match(support, /let bootstrapHelperInstallPath = generatedBootstrapHelperPath/u);
  assert.match(support, /let signingKeychainPasswordCommitPolicy = generatedSigningKeychainPasswordCommitPolicy/u);
  assert.match(profile, /"signingACLIdentityDigestPolicy": "[^"]*public_profile_v4/u);
  assert.match(profile, /one_non-durable_P256_CA_private_key_exists_only_in_bootstrap_process_memory/u);
  assert.match(profile, /record-signer_Runtime_Desktop_and_local-host_role_keys[^"\n]*same_unlocked_signing_Keychain/u);
  assert.match(profile, /zero_profile_private_keys_are_admitted_in_System_Keychain/u);
  assert.match(profile, /System_Keychain_profile_private_keys_and_any_post-insert_SecKeychainItemSetAccess_on_System_items_are_forbidden/u);
  assert.match(authority, /let rootPair = try generateEphemeralRootKeyPair\(\)/u);
  assert.doesNotMatch(authority, /let roleKeychain = codeSigningRole \? signingKeychain : systemKeychain/u);
  assert.match(authority, /chmod\(signingKeychainPath, 0o600\)/u);
  assert.match(authority, /secureMetadata\(signingKeychainPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1\)/u);
  assert.match(authority, /for suffix in \["root-ca"\] \+ roleSpecifications\.map/u);
  assert.doesNotMatch(profile, /Team ID|Developer ID/u);
});

test('only the root helper can unlock signing custody and every transaction relocks it', async () => {
  const [authority, signing, certificateProfile, cleanupRecord, trustSettings, signedCode, searchList, keychainAccess, support, main, build, nativeIntegration] = await Promise.all([
    source('apps/desktop/macos/dev-security/CertificateAuthority.swift'),
    source('apps/desktop/macos/dev-security/SigningTransaction.swift'),
    source('apps/desktop/macos/dev-security/DevelopmentCertificateProfile.swift'),
    source('apps/desktop/macos/dev-security/SigningProfileCleanupRecord.swift'),
    source('apps/desktop/macos/dev-security/TrustSettingsValidation.swift'),
    source('apps/desktop/macos/dev-security/SignedCode.swift'),
    source('apps/desktop/macos/dev-security/CodeSigningSearchList.swift'),
    source('apps/desktop/macos/dev-security/KeychainAccessControl.swift'),
    source('apps/desktop/macos/dev-security/DevSecuritySupport.swift'),
    source('apps/desktop/macos/dev-security/main.swift'),
    source('scripts/build-macos-dev-security-helper.mjs'),
    source('scripts/macos-dev-keychain-access-integration.swift'),
  ]);

  assert.match(authority, /func withCodeSigningCustody<T>/u);
  assert.match(authority, /validateInstalledProfile\(requirePrivateCustody: Bool\)/u);
  assert.match(authority, /guard requirePrivateCustody else \{ return \}/u);
  assert.match(authority, /try requireSigningKeychainLocked\(signingKeychain\)/u);
  assert.match(authority, /private var helperApplication: SecTrustedApplication/u);
  assert.match(authority, /let transitionalOwners = \[helperApplication, signedHelperApplication\]/u);
  assert.match(authority, /ownerApplications: transitionalOwners/u);
  assert.match(authority, /private func generateEphemeralRootKeyPair\(\) throws -> KeyPair \{[\s\S]*kSecAttrIsPermanent: false[\s\S]*SecKeyCreateRandomKey/u);
  assert.match(authority, /schemaVersion: "nimi\.macos-local-development-signing-profile\/v4"/u);
  assert.match(authority, /aclIdentityDigestAlgorithm: "sha256_opaque_sectrustedapplication_data"/u);
  assert.match(authority, /rootPrivateKeyPersistence: "non_durable_destroyed_after_leaf_issuance"/u);
  assert.match(authority, /rolePrivateKeyCustody: "all_five_roles_root_owned_locked_system_domain_signing_keychain"/u);
  assert.match(authority, /systemKeychainPrivateKeyPolicy: "forbidden_zero_profile_private_keys"/u);
  assert.match(authority, /systemUnlockSecretMutationPolicy: "born_final_exact_final_helper_decrypt_delete_changeACL_partition_no_post_insert_mutation"/u);
  assert.match(authority, /try finalizeInstalledSigningCustodyWithSignedHelper\(\)\s+try verifyInstalledSigningProfileWithSignedHelper\(\)/u);
  assert.match(authority, /func finalizeProvisioningCustody\(\)/u);
  assert.match(authority, /closeKeychainOwnerTransitionPreservingFinalApplication/u);
  assert.match(authority, /try requireRootMutationContext\(\)/u);
  assert.match(authority, /readSigningKeychainPassword\(\)/u);
  assert.match(authority, /SecKeychainUnlock/u);
  assert.equal((authority.match(/SecKeychainLock\(keychain\)/gu) ?? []).length, 2);
  assert.match(authority, /kSecUseKeychain: keychain,\s+kSecAttrAccess: access,\s+kSecPrivateKeyAttrs:/u);
  assert.match(authority, /validateExactGenericPasswordAccess/u);
  assert.match(authority, /restrictedAuthorization: kSecACLAuthorizationSign/u);
  assert.match(keychainAccess, /kSecACLAuthorizationPartitionID/u);
  assert.match(keychainAccess, /authorization: kSecACLAuthorizationDelete/u);
  assert.match(keychainAccess, /func validateExactGenericPasswordAccess/u);
  assert.match(keychainAccess, /func validateStrandedGenericPasswordCleanupBinding/u);
  assert.match(keychainAccess, /ownerAuthorization = kSecACLAuthorizationChangeACL/u);
  assert.match(keychainAccess, /partitions\.allSatisfy/u);
  assert.match(keychainAccess, /value == "apple:"/u);
  assert.match(keychainAccess, /\^cdhash:\[a-f0-9\]\{40\}\$/u);
  assert.match(main, /SecKeychainSetUserInteractionAllowed\(false\)/u);
  assert.match(main, /case "verify-signing-profile":/u);
  assert.match(main, /case "finalize-signing-custody":/u);
  assert.match(main, /try requireProvisioningFinalizerMutationContext\(\)/u);
  assert.match(main, /try requireRootMutationContext\(\)/u);
  assert.match(main, /validateInstalledProfile\(\s*requirePrivateCustody: true\s*\)/u);
  assert.match(certificateProfile, /runFixedCommand\(helperInstallPath, \["verify-signing-profile"\]\)/u);
  assert.match(certificateProfile, /runFixedCommand\(helperInstallPath, \["finalize-signing-custody"\]\)/u);
  assert.match(certificateProfile, /profile\.aclIdentityDigestAlgorithm == "sha256_opaque_sectrustedapplication_data"/u);
  assert.match(certificateProfile, /profile\.rootPrivateKeyPersistence == "non_durable_destroyed_after_leaf_issuance"/u);
  assert.match(certificateProfile, /profile\.rolePrivateKeyCustody == "all_five_roles_root_owned_locked_system_domain_signing_keychain"/u);
  assert.match(certificateProfile, /profile\.systemKeychainPrivateKeyPolicy == "forbidden_zero_profile_private_keys"/u);
  assert.match(certificateProfile, /profile\.systemUnlockSecretMutationPolicy == "born_final_exact_final_helper_decrypt_delete_changeACL_partition_no_post_insert_mutation"/u);
  assert.doesNotMatch(certificateProfile, /runFixedCommand\(helperInstallPath, \["status"\]\)/u);
  assert.match(authority, /withEphemeralCodeSigningSearchList\(signingKeychain: signingKeychainPath\)/u);
  assert.match(authority, /try withProvisioningCodeSigningCustody\(password: signingKeychainPassword\) \{ keychainPath, homeDirectory in\s+try signInstalledHelper/u);
  assert.match(authority, /defer \{ password\.resetBytes\(in: 0\.\.<password\.count\) \}/u);
  assert.match(authority, /defer \{ signingKeychainPassword\.resetBytes\(in: 0\.\.<signingKeychainPassword\.count\) \}/u);
  assert.match(authority, /createExactGenericPasswordAccess/u);
  assert.doesNotMatch(authority, /replaceSigningKeychainPasswordAccess/u);
  assert.match(signing, /certificateAuthority\.withCodeSigningCustody \{ keychainPath, homeDirectory in/u);
  assert.match(signing, /"--keychain", signingKeychain/u);
  assert.match(signing, /runFixedCommand\("\/usr\/bin\/codesign", arguments, homeDirectory: homeDirectory\)/u);
  assert.match(certificateProfile, /func signInstalledHelper\(identitySHA1: String, keychainPath: String, homeDirectory: String\)/u);
  assert.match(certificateProfile, /"--keychain", keychainPath/u);
  assert.match(certificateProfile, /homeDirectory: homeDirectory/u);
  assert.match(signedCode, /kSecCSSigningInformation \| kSecCSRequirementInformation/u);
  assert.match(signedCode, /Signed code identity is missing required fields/u);
  assert.match(signedCode, /func inspectBootstrapCode/u);
  assert.match(signedCode, /func inspectRunningBootstrapCode/u);
  assert.match(signedCode, /codeSignatureAdHocFlag: UInt32 = 0x0002/u);
  assert.match(signedCode, /codeSignatureRuntimeFlag: UInt32 = 0x10000/u);
  assert.match(signedCode, /codeSignatureLinkerSignedFlag: UInt32 = 0x20000/u);
  assert.match(signedCode, /values\[kSecCodeInfoCertificates\] == nil/u);
  assert.match(signedCode, /Bootstrap designated requirement is not bound to its exact CDHash/u);
  assert.match(authority, /inspectBootstrapCode\(bootstrapHelperInstallPath\)/u);
  assert.match(authority, /bootstrapHelperIdentity\.identifier == "nimi-macos-dev-security"/u);
  assert.match(main, /requireProvisioningBootstrapMutationContext\(unsignedFinalCandidateRequired: true\)/u);
  assert.match(main, /authorizingHelperPath: bootstrapHelperInstallPath/u);
  assert.match(main, /try retireProvisioningBootstrapHelper\(\)/u);
  assert.match(support, /requireExactRunningHelperPath\(bootstrapHelperInstallPath\)/u);
  assert.match(support, /sameBootstrapIdentity\(running, installed\)/u);
  assert.match(support, /func requireProvisioningFinalizerMutationContext\(\)/u);
  assert.match(support, /processExecutablePath\(parent\) == bootstrapHelperInstallPath/u);
  assert.match(support, /inspectRunningBootstrapCode\(parent\)/u);
  assert.match(support, /kill\(parent, 0\) == 0/u);
  assert.match(support, /sha256File\(bootstrapHelperInstallPath\) == sha256File\(helperInstallPath\)/u);
  assert.match(support, /unlink\(bootstrapHelperInstallPath\)/u);
  assert.doesNotMatch(certificateProfile, /codesign[\s\S]*bootstrapHelperInstallPath/u);
  assert.match(searchList, /"\/private\/tmp\/nimi-dev-codesign-home\.XXXXXX"/u);
  assert.match(searchList, /\["list-keychains", "-d", "user", "-s", signingKeychain, systemKeychainPath\]/u);
  assert.match(searchList, /paths == \[signingKeychain, systemKeychainPath\]/u);
  assert.match(searchList, /removeEphemeralCodeSigningHome\(homeDirectory\)/u);
  assert.match(authority, /try removeProfileItems\(\)/u);
  assert.match(authority, /Provisioning failed .* and its rollback was incomplete/u);
  assert.match(authority, /recordSystemCertificateForCleanup/u);
  assert.match(authority, /signingProfileCleanupFingerprints\(\)/u);
  assert.match(authority, /certificateIfPresent\(sha256:/u);
  assert.match(authority, /certificateMatchingPublicKeyIfPresent/u);
  assert.match(authority, /loadKeyIfPresent/u);
  assert.match(authority, /SecTrustSettingsCopyCertificates\(\.admin/u);
  assert.match(authority, /if trustSettingsCopyCertificatesReportsEmptyDomain\(status\) \{ return nil \}/u);
  assert.doesNotMatch(
    authority.slice(
      authority.indexOf('private func adminTrustCertificateIfPresent'),
      authority.indexOf('private func certificateMatchingPublicKeyIfPresent'),
    ),
    /status == errSecItemNotFound/u,
  );
  assert.match(trustSettings, /func trustSettingsCopyCertificatesReportsEmptyDomain\(_ status: OSStatus\) -> Bool \{\s*status == errSecNoTrustSettings\s*\}/u);
  assert.match(nativeIntegration, /trustSettingsCopyCertificatesReportsEmptyDomain\(errSecNoTrustSettings\)/u);
  assert.match(nativeIntegration, /!trustSettingsCopyCertificatesReportsEmptyDomain\(errSecSuccess\)/u);
  assert.match(nativeIntegration, /!trustSettingsCopyCertificatesReportsEmptyDomain\(errSecItemNotFound\)/u);
  assert.match(support, /struct DevSecurityFailure: LocalizedError, CustomStringConvertible/u);
  assert.match(support, /var errorDescription: String\? \{ message \}/u);
  assert.match(support, /func diagnosticMessage\(_ error: Error\) -> String/u);
  assert.match(authority, /Provisioning failed \(\\\(diagnosticMessage\(provisioningError\)\)\)/u);
  assert.match(authority, /private func loadCertificate\(sha256 expectedSHA256: String, keychain: SecKeychain\)/u);
  assert.match(authority, /kSecMatchLimit: kSecMatchLimitAll/u);
  assert.match(authority, /sha256\(SecCertificateCopyData\(certificate\) as Data\) == expectedSHA256/u);
  assert.match(authority, /private func deleteCertificate/u);
  assert.match(authority, /SecTrustSettingsCopyTrustSettings\(certificate, \.admin, &settings\)/u);
  assert.match(authority, /exactAppleCodeSigningTrustSettingsMismatch\(settings\)/u);
  assert.match(trustSettings, /SecPolicyCopyProperties\(policy\)/u);
  assert.match(trustSettings, /policyProperties\.count == 1/u);
  assert.match(trustSettings, /oid == \(kSecPolicyAppleCodeSigning as String\)/u);
  assert.match(trustSettings, /exactCodeSigningPolicyName = "CodeSigning"/u);
  assert.match(trustSettings, /values\.count == 3/u);
  assert.doesNotMatch(trustSettings, /CFEqual/u);
  assert.doesNotMatch(authority, /loadCertificate\(label:/u);
  assert.match(support, /let signingCleanupRecordPath = generatedSigningCleanupRecordPath/u);
  assert.match(cleanupRecord, /nimi\.macos-local-development-signing-cleanup\/v2/u);
  assert.match(cleanupRecord, /cleanupCertificateRoles = Set\(\["root-ca"\]\)/u);
  assert.doesNotMatch(cleanupRecord, /record_signer/u);
  assert.match(cleanupRecord, /writeAtomicRootFile\(data, to: signingCleanupRecordPath, mode: 0o600\)/u);
  assert.match(cleanupRecord, /validateSigningProfileCleanupRecord/u);
  assert.match(cleanupRecord, /removeSigningProfileCleanupRecordIfPresent/u);
  assert.match(support, /try requireTrustedCommandHome\(homeDirectory\)/u);
  assert.match(build, /'CodeSigningSearchList\.swift'/u);
  assert.match(build, /'KeychainAccessControl\.swift'/u);
  assert.match(build, /'TrustSettingsValidation\.swift'/u);
  assert.match(build, /'SigningProfileCleanupRecord\.swift'/u);
  assert.match(keychainAccess, /func trustedApplicationIdentitySHA256/u);
  assert.match(keychainAccess, /func validateKeychainAccessIdentityDigests/u);
  assert.match(keychainAccess, /func closeKeychainOwnerTransitionPreservingFinalApplication/u);
  assert.match(keychainAccess, /\[finalApplication\] as CFArray/u);
  const ownershipClosure = keychainAccess.slice(
    keychainAccess.indexOf('func closeKeychainOwnerTransitionPreservingFinalApplication'),
    keychainAccess.indexOf('private func copyAccess'),
  );
  assert.doesNotMatch(ownershipClosure, /CFEqual/u);
  assert.equal((nativeIntegration.match(/try codesign\(/gu) ?? []).length, 2);
  assert.equal((nativeIntegration.match(/try validateCompleteSignedCodeIdentity\(/gu) ?? []).length, 2);
  assert.match(nativeIntegration, /try inspectBootstrapCode\(executable\)/u);
  assert.match(nativeIntegration, /let identity = try inspectSignedCode\(path\)/u);
  assert.match(nativeIntegration, /try validateInMemoryCertificateChain\(keychain: keychain\)/u);
  assert.match(nativeIntegration, /kSecAttrLabel: nonDurableCAKeyLabel[\s\S]*kSecMatchSearchList: \[keychain\][\s\S]*persistedRootStatus == errSecItemNotFound/u);
  assert.match(nativeIntegration, /validateExactCodeSigningTrustSettingsParser/u);
  assert.match(nativeIntegration, /validateTemporaryCertificateFingerprintLookup/u);
  assert.match(nativeIntegration, /SecTrustSetAnchorCertificatesOnly\(trust, true\)/u);
  assert.match(nativeIntegration, /SecTrustSetNetworkFetchAllowed\(trust, false\)/u);
  assert.match(nativeIntegration, /--locked-custody-probe/u);
  assert.match(nativeIntegration, /--password-custody-probe/u);
  assert.match(nativeIntegration, /--password-custody-deny-probe/u);
  assert.match(nativeIntegration, /--password-delete-probe/u);
  assert.match(nativeIntegration, /--password-delete-deny-probe/u);
  assert.match(keychainAccess, /authorization: kSecACLAuthorizationDecrypt/u);
  assert.match(nativeIntegration, /createExactGenericPasswordAccess/u);
  assert.match(nativeIntegration, /"passwordCustodyCommitPolicy": "born_final_signed_owner_only"/u);
  assert.match(nativeIntegration, /"passwordDeleteFinalOwnerSuccesses": 1/u);
  assert.match(nativeIntegration, /"passwordDeleteInvalidOwnerDenials": 1/u);
  assert.match(nativeIntegration, /"immutableBootstrapHandoffValidations": 1/u);
  assert.match(nativeIntegration, /"transitionalOwnerValidations": 1/u);
  assert.match(nativeIntegration, /"independentFinalOwnerClosures": 1/u);
  assert.match(nativeIntegration, /"freshFinalCustodyValidations": 1/u);
  assert.match(nativeIntegration, /"lockedSigningKeychainBornFinalRoleValidations": 2/u);
  assert.match(nativeIntegration, /"nonDurableCAKeyPersistenceDenials": 1/u);
  assert.match(nativeIntegration, /--finalize-owner-transition-probe/u);
  assert.match(nativeIntegration, /--validate-final-custody-probe/u);
  assert.match(nativeIntegration, /An untrusted bootstrap process read the signing Keychain password/u);
  assert.match(nativeIntegration, /status == errSecInvalidOwnerEdit/u);
  assert.match(nativeIntegration, /kSecMatchItemList: \[item\]/u);
  assert.match(nativeIntegration, /fresh process read a private-key ACL while its signing Keychain was locked/u);
  assert.match(nativeIntegration, /inspect unlocked custody revalidation/u);
  assert.match(nativeIntegration, /"passwordTransport": "in_memory_only"/u);
  assert.doesNotMatch(nativeIntegration, /set-key-partition-list|"-k"/u);
  assert.doesNotMatch(signing, /signingKeychainPassword|SecKeychainUnlock/u);
  assert.doesNotMatch(signing, /runFixedCommand\("\/usr\/bin\/codesign", arguments\)\s*$/mu);

  const provision = authority.slice(authority.indexOf('func provision()'), authority.indexOf('func signReleaseRecord'));
  const helperSigned = provision.indexOf('try signInstalledHelper');
  const finalPrivateACL = provision.lastIndexOf('try replaceExactKeychainAccess');
  const bornFinalRoleCreation = provision.indexOf('for (role, commonName, signingIdentifier) in roleSpecifications where role != "helper"');
  const durableSecretCommit = provision.indexOf('try storeSigningKeychainPassword');
  assert.ok(helperSigned >= 0
    && helperSigned < finalPrivateACL
    && finalPrivateACL < bornFinalRoleCreation
    && bornFinalRoleCreation < durableSecretCommit);
  assert.equal((provision.match(/try replaceExactKeychainAccess/gu) ?? []).length, 1);
  assert.match(provision, /let helperPrivateKey = try loadPrivateKey\([\s\S]*try replaceExactKeychainAccess\([\s\S]*label: "\\\(helperSpecification\.1\) private key transition"/u);
  assert.match(provision, /let roleAccess = try createExactKeychainAccess\([\s\S]*partitions: finalPartitions[\s\S]*let pair = try generateKeyPair\([\s\S]*access: roleAccess/u);
  const bornFinalRoles = provision.slice(bornFinalRoleCreation, provision.indexOf('let recordPublicKey', bornFinalRoleCreation));
  assert.match(bornFinalRoles, /keychain: signingKeychain/u);
  assert.doesNotMatch(bornFinalRoles, /systemKeychain|recordSystemCertificateForCleanup/u);
  assert.doesNotMatch(provision, /generateKeyPair\([\s\S]{0,160}profileLabel\("root-ca"\)/u);
  assert.doesNotMatch(provision, /loadPrivateKey\([\s\S]{0,160}profileLabel\("root-ca"\)/u);
  assert.doesNotMatch(provision, /setExactKeychainPartitions/u);
  assert.equal((provision.match(/try storeSigningKeychainPassword/gu) ?? []).length, 1);
  assert.doesNotMatch(provision.slice(0, helperSigned), /storeSigningKeychainPassword/u);

  const finalizer = authority.slice(
    authority.indexOf('func finalizeProvisioningCustody()'),
    authority.indexOf('private func closePrivateKeyOwnerTransition'),
  );
  assert.match(finalizer, /profileLabel\("helper"\)/u);
  assert.match(finalizer, /closePrivateKeyOwnerTransition/u);
  assert.doesNotMatch(finalizer, /systemKeychain|root-ca|for \(role/u);

  const releaseRecordSigner = authority.slice(
    authority.indexOf('func signReleaseRecord('),
    authority.indexOf('func removeProfileItems()'),
  );
  assert.match(releaseRecordSigner, /withCodeSigningCustody/u);
  assert.match(releaseRecordSigner, /profileLabel\("record_signer"\), keychain: signingKeychain/u);
  assert.doesNotMatch(releaseRecordSigner, /systemKeychain/u);

  const integrationSigned = nativeIntegration.indexOf('try validateCompleteSignedCodeIdentity(firstTarget');
  const integrationTransitionalPrivateACL = nativeIntegration.indexOf('label: "temporary transitional codesign private key"', integrationSigned);
  const integrationDurableSecretCommit = nativeIntegration.indexOf('let passwordAccess = try createExactGenericPasswordAccess', integrationTransitionalPrivateACL);
  const integrationFinalization = nativeIntegration.indexOf('let finalization = try runBounded', integrationDurableSecretCommit);
  const integrationFreshVerification = nativeIntegration.indexOf('let finalValidation = try runBounded', integrationFinalization);
  assert.ok(integrationSigned >= 0
    && integrationSigned < integrationTransitionalPrivateACL
    && integrationTransitionalPrivateACL < integrationDurableSecretCommit
    && integrationDurableSecretCommit < integrationFinalization
    && integrationFinalization < integrationFreshVerification);
});

test('helper subprocess capture cannot deadlock on sequential stdout and stderr pipes', async () => {
  const support = await source('apps/desktop/macos/dev-security/DevSecuritySupport.swift');
  assert.match(support, /let output = try unlinkedCaptureFile\(\)/u);
  assert.match(support, /let errors = try unlinkedCaptureFile\(\)/u);
  assert.match(support, /mkstemp/u);
  assert.match(support, /fchmod\(descriptor, 0o600\)/u);
  assert.match(support, /unlink\(path\)/u);
  assert.match(support, /boundedCaptureData\(output, limit: captureLimit\)/u);
  assert.doesNotMatch(support, /let output = Pipe\(\)\s+process\.standardOutput = output/u);
  assert.doesNotMatch(support, /let errors = Pipe\(\)\s+process\.standardError = errors/u);
});

test('all final-helper service mutations serialize on the exact open helper vnode', async () => {
  const [support, main] = await Promise.all([
    source('apps/desktop/macos/dev-security/DevSecuritySupport.swift'),
    source('apps/desktop/macos/dev-security/main.swift'),
  ]);
  assert.match(support, /open\(helperInstallPath, O_RDONLY \| O_CLOEXEC \| O_NOFOLLOW\)/u);
  assert.match(support, /fstat\(descriptor, &metadata\)/u);
  assert.match(support, /flock\(descriptor, LOCK_EX \| LOCK_NB\)/u);
  assert.match(support, /metadata\.st_uid == 0/u);
  assert.match(support, /metadata\.st_nlink == 1/u);
  for (const operation of [
    'installDevelopmentCandidate',
    'restartDevelopmentService',
    'resetDevelopmentServiceState',
    'uninstallDevelopmentService',
    'unprovisionDevelopmentTrust',
  ]) {
    assert.match(main, new RegExp(`withRuntimeServiceMutationLock[\\s\\S]{0,120}${operation}`, 'u'));
  }
});

test('Runtime service account is born atomically through OpenDirectory behind a durable exact-recovery journal', async () => {
  const [profile, generated, plan, store, transaction, installer, build] = await Promise.all([
    source('apps/desktop/scripts/generated/macos-local-development-profile.mjs'),
    source('apps/desktop/macos/generated/macos_local_development_profile.swift'),
    source('apps/desktop/macos/dev-security/DirectoryServiceAccountPlan.swift'),
    source('apps/desktop/macos/dev-security/OpenDirectoryAccountStore.swift'),
    source('apps/desktop/macos/dev-security/RuntimePrincipalTransaction.swift'),
    source('apps/desktop/macos/dev-security/InstallerState.swift'),
    source('scripts/build-macos-dev-security-helper.mjs'),
  ]);

  assert.match(profile, /"runtimeAccountUIDMinimum": 450/u);
  assert.match(profile, /"runtimeAccountUIDMaximum": 499/u);
  assert.match(profile, /"runtimePrincipalCarrierContractVersion": 4/u);
  assert.match(profile, /"runtimeAuthenticationAuthorityPosture": "absent_required"/u);
  assert.match(profile, /"runtimeForbiddenAuthenticationMaterialAttributes": \[/u);
  assert.match(profile, /"dsAttrTypeNative:ShadowHashData"/u);
  assert.match(profile, /"runtimeDirectoryServiceAPI": "public_OpenDirectory_framework_ODNode_createRecord_only"/u);
  assert.match(profile, /"runtimeDirectoryServiceCommitPolicy": "fsynced_root_owned_principal_journal_precedes_any_record_mutation_then_ODNode_createRecord_atomically_creates_group_then_user_with_complete_birth_attributes_including_distinct_GeneratedUID_password_star_hidden_state_false_shell_and_empty_home_but_no_AuthenticationAuthority_authentication_material_delegated-writer_or_explicit-group-membership_then_synchronizes_and_a_fresh_exact-signed_real-root_helper_process_reads_raw_OpenDirectory_and_POSIX_identity_and_returns_a_transaction-and-plan-bound_receipt"/u);
  assert.match(generated, /let generatedRuntimeAccountUIDMinimum: UInt32 = 450/u);
  assert.match(generated, /let generatedRuntimeAccountUIDMaximum: UInt32 = 499/u);
  assert.match(generated, /let generatedRuntimePrincipalJournalPath = "\/Library\/Application Support\/Nimi\/RuntimeDev\/principal-transaction\.json"/u);

  assert.match(plan, /groupGeneratedUID != userGeneratedUID/u);
  assert.match(plan, /canonicalUUID\(groupGeneratedUID\)/u);
  assert.match(plan, /canonicalUUID\(userGeneratedUID\)/u);
  assert.match(store, /import OpenDirectory/u);
  assert.match(store, /node\.createRecord\(/u);
  assert.match(store, /kODAttributeTypeGUID: \[plan\.userGeneratedUID\]/u);
  assert.doesNotMatch(store, /kODAttributeTypeAuthenticationAuthority: \[/u);
  assert.match(store, /runtimeForbiddenAuthenticationMaterialAttributes\.allSatisfy/u);
  assert.match(store, /runtimeHiddenAttribute: \[runtimeDirectoryServiceHiddenRecordValue\]/u);
  assert.match(store, /try observed\.record\.delete\(\)/u);
  assert.match(store, /validateRuntimeAccountPOSIXProjection/u);
  assert.doesNotMatch(store, /\/usr\/bin\/dscl|sysadminctl|dsimport/u);
  assert.doesNotMatch(installer, /\/usr\/bin\/dscl|writeDirectoryServiceAttribute|directoryServiceRecordExists/u);

  const journalWrite = transaction.indexOf('try writeRuntimePrincipalJournal(journal)');
  const groupCreate = transaction.indexOf('store.createGroup(plan)', journalWrite);
  const userCreate = transaction.indexOf('store.createUser(plan)', groupCreate);
  const userRollback = transaction.indexOf('store.deleteExact(.user', userCreate);
  const groupRollback = transaction.indexOf('store.deleteExact(.group', userRollback);
  const absenceProof = transaction.indexOf('store.proveAbsent()', groupRollback);
  assert.ok(journalWrite >= 0 && journalWrite < groupCreate && groupCreate < userCreate);
  assert.ok(userRollback > userCreate && userRollback < groupRollback && groupRollback < absenceProof);
  assert.match(transaction, /secureMetadata\(runtimePrincipalJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1\)/u);
  assert.match(transaction, /syncDirectory\(runtimeDevRoot\)/u);
  assert.match(build, /'DirectoryServiceAccountPlan\.swift'/u);
  assert.match(build, /'OpenDirectoryAccountStore\.swift'/u);
  assert.match(build, /'RuntimePrincipalTransaction\.swift'/u);
  assert.match(build, /'-framework', 'OpenDirectory'/u);
});

test('service health distinguishes activation-ready journal recovery from healthy steady state', async () => {
  const [health, service, build, journal, lifecycle] = await Promise.all([
    source('apps/desktop/macos/dev-security/InstalledHealth.swift'),
    source('scripts/macos-dev-runtime-service.mjs'),
    source('scripts/build-macos-dev-security-helper.mjs'),
    source('apps/desktop/macos/dev-security/InstallationTransactionJournal.swift'),
    source('apps/desktop/macos/dev-security/ServiceLifecycle.swift'),
  ]);
  assert.match(health, /let activationReady = baseHealthy && \(transactionClean \|\| transactionCommitted\)/u);
  assert.match(health, /let healthy = baseHealthy && transactionClean/u);
  assert.match(health, /let bootstrapHelperResiduePresent = fixedPathExists\(bootstrapHelperInstallPath\)/u);
  assert.match(health, /"bootstrapHelperRetired": !bootstrapHelperResiduePresent/u);
  assert.match(health, /"signingCustodyVerification"/u);
  assert.match(health, /"privileged_transaction_required"/u);
  assert.match(health, /validateInstalledProfile\(\s*requirePrivateCustody: false\s*\)/u);
  assert.doesNotMatch(health, /privilegedCustodyVerification/u);
  assert.match(service, /status\?\.activationReady === true/u);
  assert.match(service, /status\?\.installationTransactionCommitted === false/u);
  assert.match(build, /'DevelopmentCertificateProfile\.swift'/u);
  assert.match(build, /'InstallationTransactionJournal\.swift'/u);
  const updateTransaction = journal.slice(
    journal.indexOf('func commitCandidate('),
    journal.indexOf('func recoverInterruptedInstallationIfNeeded('),
  );
  assert.doesNotMatch(updateTransaction, /runtimeStateRoot/u);
  assert.match(journal, /ensureDirectory\(runtimeStateRoot, owner: principal\.uid, group: principal\.gid, mode: 0o700\)/u);
  assert.match(lifecycle, /func resetDevelopmentServiceState\(\)/u);
  assert.match(lifecycle, /runtimeStateRoot/u);
});

test('partial first-install repair v2 owns direct deletion, effect-ahead recovery, and fresh-bootstrap proof', async () => {
  const [packageJSON, wrapper, repair, account, main, signing, lifecycle] = await Promise.all([
    source('package.json'),
    source('scripts/repair-macos-dev-runtime-install.mjs'),
    source('apps/desktop/macos/dev-security/PartialInstallationRepair.swift'),
    source('apps/desktop/macos/dev-security/OpenDirectoryAccountStore.swift'),
    source('apps/desktop/macos/dev-security/main.swift'),
    source('apps/desktop/macos/dev-security/SigningTransaction.swift'),
    source('apps/desktop/macos/dev-security/ServiceLifecycle.swift'),
  ]);

  assert.match(packageJSON, /"repair:macos-dev-runtime-install": "node scripts\/repair-macos-dev-runtime-install\.mjs"/u);
  assert.match(wrapper, /const confirmation = 'REPAIR NIMI MACOS DEV RUNTIME INSTALL'/u);
  assert.match(wrapper, /process\.argv\.length !== 2/u);
  assert.match(wrapper, /lstatSync\(bootstrapHelperPath, \{ throwIfNoEntry: false \}\) !== undefined/u);
  assert.match(wrapper, /runInherited\(process\.execPath, \[path\.join\(scriptRoot, 'build-macos-dev-security-helper\.mjs'\)\]\)/u);
  assert.match(wrapper, /sourceBefore\.device !== sourceAfter\.device/u);
  assert.match(wrapper, /installed\.sha256 !== sourceBefore\.sha256/u);
  assert.match(wrapper, /execute\('\/usr\/bin\/sudo', \[bootstrapHelperPath, 'repair-partial-runtime-install'\]\)/u);
  assert.match(wrapper, /receipt\?\.status !== 'repaired'/u);
  assert.match(wrapper, /\['residue-removed', 'already-clean'\]/u);
  assert.match(wrapper, /digest !== expectedSHA256/u);
  assert.match(wrapper, /Repair completed but the temporary bootstrap helper was not retired/u);
  assert.match(wrapper, /does not retry installation, provision Runtime custody, or alter TCC\/Gatekeeper settings/u);

  assert.match(repair, /nimi\.macos-local-development-partial-install-repair\/v2/u);
  assert.match(repair, /let sourceHelperSHA256: String/u);
  assert.match(repair, /let sourceHelperCDHash: String/u);
  assert.match(repair, /let sourcePrincipalCarrierContractVersion: Int/u);
  assert.match(repair, /let residueClass: String/u);
  assert.match(repair, /let authenticationEvidenceSHA256: String/u);
  assert.match(repair, /let planDigest: String/u);
  assert.match(repair, /let rootKeyId: String/u);
  assert.match(repair, /let policyDigest: String/u);
  assert.match(repair, /let groupGeneratedUID: String/u);
  assert.match(repair, /let userGeneratedUID: String/u);
  const requiredRepairBindings = [
    'sourceHelperSHA256',
    'sourceHelperCDHash',
    'sourcePrincipalCarrierContractVersion',
    'residueClass',
    'authenticationEvidenceSHA256',
    'planDigest',
    'rootKeyId',
    'policyDigest',
    'groupGeneratedUID',
    'userGeneratedUID',
  ];
  assert.equal(requiredRepairBindings.length, 10);
  assert.match(repair, /journal\.sourceHelperSHA256 ==/u);
  assert.match(repair, /journal\.sourceHelperCDHash ==/u);
  assert.match(repair, /journal\.sourcePrincipalCarrierContractVersion ==/u);
  assert.match(repair, /journal\.residueClass ==/u);
  assert.match(repair, /journal\.authenticationEvidenceSHA256 ==/u);
  assert.match(repair, /journal\.planDigest ==/u);
  assert.match(repair, /journal\.rootKeyId ==/u);
  assert.match(repair, /journal\.policyDigest ==/u);
  assert.match(repair, /journal\.groupGeneratedUID ==/u);
  assert.match(repair, /journal\.userGeneratedUID ==/u);
  assert.match(repair, /sourceHelperSHA256\.range\(of: #"\^\[a-f0-9\]\{64\}\$"#/u);
  assert.match(repair, /sourceHelperCDHash\.range\(of: #"\^\[a-f0-9\]\{40\}\$"#/u);
  assert.match(repair, /try requireRuntimeKeychainCustodyAbsent\(\)/u);
  assert.match(repair, /kSecAttrService: generatedKeychainService/u);
  assert.match(repair, /kSecMatchLimit: kSecMatchLimitAll/u);
  assert.match(repair, /Runtime Keychain custody namespace is not empty/u);
  assert.match(repair, /try requireCurrentPartialInstallRepairAuthority\(journal\)/u);
  assert.match(repair, /try validatePartialInstallRepairPhaseState\(journal\)/u);
  assert.match(
    repair,
    /"prepared",\s*"artifacts-removed",\s*"user-removed",\s*"group-removed",\s*"principal-removed"/u,
  );

  const artifactsRemoved = repair.search(/updatePartialInstallRepairJournal\([^\n]*phase: "artifacts-removed"/u);
  const userDelete = repair.search(/try removePartialInstallRepairUser\(current\)/u);
  const userRemoved = repair.search(/updatePartialInstallRepairJournal\([^\n]*phase: "user-removed"/u);
  const groupDelete = repair.search(/try removePartialInstallRepairGroup\(current\)/u);
  const groupRemoved = repair.search(/updatePartialInstallRepairJournal\([^\n]*phase: "group-removed"/u);
  const freshBootstrapProof = repair.search(/verify-partial-install-repair-principal-removal/u);
  const principalRemoved = repair.search(/updatePartialInstallRepairJournal\([^\n]*phase: "principal-removed"/u);
  const finalAbsenceProof = repair.search(/try proveRepairTargetsAbsent\(\)/u);
  const journalRemoval = repair.search(/try removePartialInstallRepairJournal\(\)/u);
  for (const boundary of [
    artifactsRemoved,
    userDelete,
    userRemoved,
    groupDelete,
    groupRemoved,
    freshBootstrapProof,
    principalRemoved,
    finalAbsenceProof,
    journalRemoval,
  ]) {
    assert.notEqual(boundary, -1);
  }
  assert.ok(artifactsRemoved < userDelete);
  assert.ok(userDelete < userRemoved);
  assert.ok(userRemoved < groupDelete);
  assert.ok(groupDelete < groupRemoved);
  assert.ok(groupRemoved < freshBootstrapProof);
  assert.ok(freshBootstrapProof < principalRemoved);
  assert.ok(principalRemoved < finalAbsenceProof);
  assert.ok(finalAbsenceProof < journalRemoval);
  assert.match(repair, /func removePartialInstallRepairUser[\s\S]{0,1800}store\.deleteExactRepairUser/u);
  assert.match(repair, /func removePartialInstallRepairGroup[\s\S]{0,1800}store\.deleteExactRepairGroup/u);

  assert.doesNotMatch(repair, /\bremoveRuntimeAccount\s*\(/u);
  assert.doesNotMatch(repair, /\brecoverInterruptedRuntimePrincipalTransactionIfNeeded\s*\(/u);
  assert.doesNotMatch(repair, /\b(?:write|update|read|remove)RuntimePrincipalJournal\s*\(/u);
  assert.match(repair, /runtimePrincipalJournalPath/u);
  assert.match(repair, /normal Runtime principal (?:transaction|journal)[^\n]*(?:absent|forbidden)/iu);

  const reconcileStart = repair.indexOf('private func reconcilePartialInstallRepairEffectAheadOfJournal');
  const reconcileEnd = repair.indexOf('private func validateCompletePartialInstallRepairPrincipal', reconcileStart);
  assert.notEqual(reconcileStart, -1);
  assert.notEqual(reconcileEnd, -1);
  const reconcile = repair.slice(reconcileStart, reconcileEnd);
  assert.match(reconcile, /case "artifacts-removed" where user == nil && group != nil:[\s\S]*phase: "user-removed"/u);
  assert.match(reconcile, /case "user-removed" where user == nil && group == nil:[\s\S]*phase: "group-removed"/u);
  assert.match(repair, /The partial-install repair effect is ahead of its journal phase|effect-ahead/iu);

  const globalEnvelope = repair.indexOf('try validatePartialInstallRepairGlobalEnvelope(current)');
  const reconcileCall = repair.indexOf('reconcilePartialInstallRepairEffectAheadOfJournal(current)');
  const phaseValidation = repair.indexOf('try validatePartialInstallRepairPhaseState(current)');
  assert.ok(globalEnvelope >= 0 && globalEnvelope < reconcileCall && reconcileCall < phaseValidation);

  assert.match(repair, /recoverInterruptedPartialInstallRepairJournalWrite\(\)/u);
  assert.match(repair, /runtimePartialInstallRepairJournalStagingPath/u);
  assert.match(repair, /O_WRONLY \| O_CREAT \| O_EXCL \| O_CLOEXEC \| O_NOFOLLOW/u);
  assert.match(repair, /descriptorMetadata\.st_nlink == 1/u);
  assert.match(repair, /descriptorMetadata\.st_size <= 64 \* 1024/u);
  assert.match(repair, /descriptorMetadata\.st_dev == stablePathMetadata\.st_dev/u);
  assert.match(repair, /descriptorMetadata\.st_ino == stablePathMetadata\.st_ino/u);
  assert.match(repair, /unlinkat\(parentDescriptor/u);
  assert.match(repair, /try verifyInstalledSigningProfileWithSignedHelper\(\)/u);

  assert.match(repair, /runFixedCommand\(\s*bootstrapHelperInstallPath,\s*\["verify-partial-install-repair-principal-removal"\]\s*\)/u);
  assert.match(repair, /result\.pid > 1, result\.pid != getpid\(\)/u);
  assert.match(repair, /Set\(value\.keys\) == Set\(\[[\s\S]{0,1200}"sourceHelperSHA256"[\s\S]{0,1200}"sourceHelperCDHash"[\s\S]{0,1200}"sourcePrincipalCarrierContractVersion"[\s\S]{0,1200}"residueClass"[\s\S]{0,1200}"authenticationEvidenceSHA256"[\s\S]{0,1200}"planDigest"[\s\S]{0,1200}"rootKeyId"[\s\S]{0,1200}"policyDigest"/u);
  assert.match(repair, /value\["transactionID"\] as\? String == journal\.transactionID/u);
  assert.match(repair, /\(value\["verifierPID"\] as\? NSNumber\)\?\.int32Value == result\.pid/u);
  assert.match(repair, /try proveRepairTargetsAbsent\(\)/u);
  assert.match(repair, /lstat\(path, &metadata\)/u);
  assert.match(repair, /"preserved": \["local_CA", "signing_Keychain", "signing_profile", "final_helper"\]/u);

  const normalV4MatcherStart = account.indexOf('func runtimeDirectoryRecord(\n    _ record: RuntimeDirectoryRecord,\n    matches plan: RuntimeAccountCreationPlan');
  const repairDiagnosisStart = account.indexOf('struct RuntimeDirectoryFieldMismatch', normalV4MatcherStart);
  assert.notEqual(normalV4MatcherStart, -1);
  assert.notEqual(repairDiagnosisStart, -1);
  const normalV4Matcher = account.slice(normalV4MatcherStart, repairDiagnosisStart);
  assert.match(normalV4Matcher, /runtimeForbiddenAuthenticationMaterialAttributes\.allSatisfy\(record\.absent\)/u);
  assert.doesNotMatch(normalV4Matcher, /DisabledUser|legacyV2|residueClass/u);
  assert.match(account, /case generatedRuntimeLegacyRepairResidueClass: self = \.legacyV2DisabledUser/u);
  assert.match(account, /case \.legacyV2DisabledUser:[\s\S]{0,3000}legacyV2RuntimeDirectoryUserRecord/u);
  assert.match(account, /disabledAuthority\.count == generatedRuntimeLegacyRepairAuthenticationAuthorityExactValueCount/u);
  assert.match(account, /disabledAuthority\.first\.map\(runtimeDirectoryValueType\)[\s\S]{0,180}generatedRuntimeLegacyRepairAuthenticationAuthorityValueType/u);
  assert.match(account, /\(disabledAuthority\.first as\? String\) == generatedRuntimeLegacyRepairAuthenticationAuthorityExactValue/u);
  assert.match(account, /deleteExactRepairUser|deleteExactLegacyRepairUser|deleteExact\(\.user,\s*(?:witness|repairWitness):/u);
  assert.match(account, /delete-only shape emitted by the retired v2[\s\S]{0,180}first-install principal carrier/u);

  assert.match(main, /case "repair-partial-runtime-install":/u);
  assert.match(main, /case "verify-partial-install-repair-principal-removal":/u);
  assert.match(main, /requireProvisioningBootstrapMutationContext\(unsignedFinalCandidateRequired: false\)/u);
  assert.match(main, /withRuntimeServiceMutationLock[\s\S]{0,180}repairExactPartialRuntimeInstallation[\s\S]{0,180}retireProvisioningBootstrapHelper/u);
  for (const mutationSource of [signing, lifecycle]) {
    assert.match(mutationSource, /requireNoPartialInstallRepairInProgress\(\)/u);
  }
});

test('fresh installation owns all machine effects and rollback removes the journal last', async () => {
  const [journal, signing, service] = await Promise.all([
    source('apps/desktop/macos/dev-security/InstallationTransactionJournal.swift'),
    source('apps/desktop/macos/dev-security/SigningTransaction.swift'),
    source('scripts/macos-dev-runtime-service.mjs'),
  ]);

  assert.match(journal, /installation-transaction\/v2/u);
  assert.match(journal, /kind: freshInstallKind/u);
  assert.match(journal, /try requireFreshInstallationBaseline\(\)[\s\S]{0,500}try writeInstallationJournal\(journal\)/u);
  assert.match(journal, /"prepared": "principal-ready"/u);
  assert.match(journal, /"launchd-activated": "service-healthy"/u);
  assert.match(journal, /"service-healthy": "commit-decided"/u);
  assert.match(journal, /requireRuntimeKeychainCustodyAbsent\(\)/u);
  assert.match(journal, /runtimeUpdateAdmission == "fail_closed_pending_nonmutating_release_lineage_validation/u);

  const begin = signing.indexOf('try beginFreshInstallationTransaction(');
  const stop = signing.indexOf('try stopLaunchDaemonIfLoaded()', begin);
  const principal = signing.indexOf('try ensureRuntimeAccount(plannedPlan: principalPlan)', stop);
  const custody = signing.indexOf('["macos-protected-state-provision"]', principal);
  const healthy = signing.indexOf('try waitForHealthyDevelopmentService(allowCommittedTransaction: true)', custody);
  const commit = signing.indexOf('try markInstallationPhase("commit-decided")', healthy);
  assert.ok(begin >= 0 && begin < stop && stop < principal && principal < custody && custody < healthy && healthy < commit);

  const rollback = journal.slice(journal.indexOf('private func rollbackFreshInstallation'));
  const bootout = rollback.indexOf('try stopLaunchDaemonIfLoaded()');
  const sockets = rollback.indexOf('removeInstallationSocketIfPresent', bootout);
  const custodyReset = rollback.indexOf('["macos-protected-state-reset"]', sockets);
  const payload = rollback.indexOf('removeInstallationNodeIfPresent(launchDaemonPath)', custodyReset);
  const directories = rollback.indexOf('removeEmptyFreshDirectory(runtimeStateRoot', payload);
  const account = rollback.indexOf('removeRuntimeAccount(expectedPlan: journal.principalPlan)', directories);
  const absence = rollback.indexOf('proveFreshInstallationTargetsAbsent(journal)', account);
  const journalLast = rollback.indexOf('try removeInstallationJournal()', absence);
  assert.ok(bootout >= 0 && bootout < sockets && sockets < custodyReset && custodyReset < payload
    && payload < directories && directories < account && account < absence && absence < journalLast);
  assert.match(service, /'dev-runtime-update-not-admitted'/u);
});

test('helper build uses the CLT frontend and linker without depending on swift-driver', async () => {
  const build = await source('scripts/build-macos-dev-security-helper.mjs');
  assert.match(build, /'--find', 'swift-frontend'/u);
  assert.match(build, /'swift-frontend'/u);
  assert.match(build, /'clang'/u);
  assert.match(build, /'-target', 'arm64-apple-macos13\.0'/u);
  assert.match(build, /'-Wl,-rpath,\/usr\/lib\/swift'/u);
  assert.match(build, /linker_signed_adhoc_bootstrap_is_non-authorizing|linker_signed_adhoc_bootstrap_is_non_authorizing/u);
  assert.doesNotMatch(build, /'swiftc'/u);
});

test('trust provisioning refuses partial residue and rolls back the root helper transaction on failure', async () => {
  const [provision, unprovision, authority, cleanup, lifecycle, profile, generated, nativeIntegration, nativeBuild, helperBuild] = await Promise.all([
    source('scripts/provision-macos-dev-trust.mjs'),
    source('scripts/unprovision-macos-dev-trust.mjs'),
    source('apps/desktop/macos/dev-security/CertificateAuthority.swift'),
    source('apps/desktop/macos/dev-security/ProfileKeyCleanup.swift'),
    source('apps/desktop/macos/dev-security/ServiceLifecycle.swift'),
    source('apps/desktop/scripts/generated/macos-local-development-profile.mjs'),
    source('apps/desktop/macos/generated/macos_local_development_profile.swift'),
    source('scripts/macos-dev-keychain-access-integration.swift'),
    source('scripts/test-macos-dev-keychain-access.mjs'),
    source('scripts/build-macos-dev-security-helper.mjs'),
  ]);
  assert.match(provision, /const existingTargets = \[bootstrapHelperTarget, helperTarget, signingProfileTarget, signingCleanupRecordTarget\]/u);
  assert.match(provision, /macos-dev-trust-already-present/u);
  assert.match(provision, /\[bootstrapHelperTarget, 'provision-signing-profile'\]/u);
  assert.match(provision, /const helpers = \[helperTarget, bootstrapHelperTarget\]/u);
  assert.match(provision, /for \(const rollbackHelper of helpers\)/u);
  assert.match(provision, /installedBootstrap\.sha256 !== before\.sha256 \|\| installedFinalCandidate\.sha256 !== before\.sha256/u);
  assert.match(provision, /bootstrapResidue !== undefined/u);
  assert.match(provision, /the privileged installation transaction was rolled back completely/u);
  assert.match(provision, /Provisioning failed .* and final-helper-first privileged rollback failed/u);
  assert.match(unprovision, /build-macos-dev-security-helper\.mjs/u);
  assert.match(unprovision, /installed\.sha256 !== sourceBefore\.sha256/u);
  assert.match(unprovision, /temporarily install the exact current non-authorizing verifier/u);
  assert.match(unprovision, /executePrivilegedHelper\(bootstrapHelperPath, 'prepare-stranded-unprovision'\)/u);
  assert.match(unprovision, /const cleanupHelper = finalHelperPresent \? helperPath : bootstrapHelperPath/u);
  assert.match(unprovision, /executePrivilegedHelper\(cleanupHelper, 'unprovision-signing-profile'\)/u);
  assert.match(unprovision, /residualIdentityClosure: MACOS_LOCAL_DEVELOPMENT_PROFILE\.unprovisionResidualIdentityClosure/u);
  assert.match(profile, /"unprovisionResidualIdentityClosure": "explicit_confirmed_unprovision_may_run_with_public_profile_or_cleanup_record_absent_but_a_present_signing-Keychain_unlock-secret_requires_the_exact_verified_final_helper/u);
  assert.match(generated, /let generatedUnprovisionResidualIdentityClosure = "explicit_confirmed_unprovision_may_run_with_public_profile_or_cleanup_record_absent_but_a_present_signing-Keychain_unlock-secret_requires_the_exact_verified_final_helper/u);
  assert.match(generated, /let generatedSigningUnprovisionRepairPolicy = "repair-only_for_the_exact_stranded_shape/u);
  assert.match(authority, /func prepareStrandedUnprovisionHandoff\(\)/u);
  assert.match(authority, /signedCodeCertificateChainDER\(helperInstallPath\)/u);
  assert.match(authority, /try validateStrandedGenericPasswordCleanupBinding/u);
  assert.match(authority, /try validateSigningKeychainPasswordDeletionAuthority\(\)/u);
  assert.match(authority, /kSecMatchItemList: \[item\]/u);
  assert.match(authority, /run rollback through the exact signed final helper/u);
  assert.match(authority, /for suffix in \["root-ca"\] \+ roleSpecifications\.map/u);
  assert.match(authority, /deleteExactProfileKeys\(label: profileLabel\(suffix\), keychain: systemKeychain\)/u);
  assert.match(cleanup, /kSecAttrApplicationTag: Data\(label\.utf8\)/u);
  assert.match(cleanup, /kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom/u);
  assert.match(cleanup, /kSecAttrKeySizeInBits: 256/u);
  assert.match(cleanup, /for keyClass in \[kSecAttrKeyClassPublic, kSecAttrKeyClassPrivate\]/u);
  assert.match(authority, /try assertProfileLabelsAbsent\(\)/u);
  assert.doesNotMatch(authority, /deleteKeychainItems/u);
  assert.match(lifecycle, /for path in \[bootstrapHelperInstallPath, helperInstallPath, runtimeDevRoot, signingProfilePath, signingCleanupRecordPath, signingKeychainPath\]/u);
  assert.match(lifecycle, /try removeHelperIfPresent\(helperInstallPath\)/u);
  assert.match(lifecycle, /try removeHelperIfPresent\(bootstrapHelperInstallPath\)/u);
  assert.match(lifecycle, /func prepareStrandedDevelopmentTrustUnprovision\(\)/u);
  assert.match(lifecycle, /"residual_profile_keys"/u);
  assert.match(nativeIntegration, /try validateExactProfileKeyCleanup\(keychain: keychain, application: testApplication\)/u);
  assert.match(nativeIntegration, /"profileKeyCleanupValidations": 1/u);
  assert.match(nativeBuild, /'ProfileKeyCleanup\.swift'/u);
  assert.match(helperBuild, /'ProfileKeyCleanup\.swift'/u);

  const cleanupTransaction = authority.slice(
    authority.indexOf('func removeProfileItems()'),
    authority.indexOf('func prepareStrandedUnprovisionHandoff()'),
  );
  const validateSecretOwner = cleanupTransaction.indexOf('try validateSigningKeychainPasswordDeletionAuthority()');
  const deleteSigningKeychain = cleanupTransaction.indexOf('try deleteSigningKeychain()');
  const deleteUnlockSecret = cleanupTransaction.indexOf('try deleteSigningKeychainPassword()');
  const removePublicTrust = cleanupTransaction.indexOf('SecTrustSettingsRemoveTrustSettings');
  assert.ok(validateSecretOwner >= 0
    && validateSecretOwner < deleteSigningKeychain
    && deleteSigningKeychain < deleteUnlockSecret
    && deleteUnlockSecret < removePublicTrust);
});
