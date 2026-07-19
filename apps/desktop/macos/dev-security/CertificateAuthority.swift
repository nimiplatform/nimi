import CryptoKit
import Foundation
import Security

struct DevelopmentIdentity: Codable {
    let role: String
    let commonName: String
    let certificateSHA1: String
    let certificateSHA256: String
    let leafSPKISHA256: String
    let signingIdentifier: String
    let expiresAt: String
}

struct DevelopmentSigningProfile: Codable {
    let schemaVersion: String
    let profileId: String
    let environment: String
    let identityClass: String
    let signatureAlgorithm: String
    let aclIdentityDigestAlgorithm: String
    let helperACLIdentitySHA256: String
    let codesignACLIdentitySHA256: String
    let rootPrivateKeyPersistence: String
    let rolePrivateKeyCustody: String
    let systemKeychainPrivateKeyPolicy: String
    let systemUnlockSecretMutationPolicy: String
    let rootKeyId: String
    let rootPublicKeyB64URL: String
    let rootCertificateSHA256: String
    let createdAt: String
    let expiresAt: String
    let identities: [String: DevelopmentIdentity]
}

struct KeyPair {
    let publicKey: SecKey
    let privateKey: SecKey
}

struct Issuer {
    let commonName: String
    let privateKey: SecKey
}

let roleSpecifications: [(String, String, String)] = [
    ("runtime", "Nimi Runtime Dev", "ai.nimi.runtime.dev"),
    ("desktop", "Nimi Desktop Dev", "ai.nimi.apps.nimi.desktop.dev"),
    ("local_app_host", "Nimi Local App Host Dev", "ai.nimi.apps.nimi.local-app-host.dev"),
    ("helper", "Nimi macOS Dev Security Helper", "ai.nimi.dev-security-helper"),
    ("record_signer", "Nimi macOS Dev Record Signer", "ai.nimi.dev-record-signer"),
]
let codeSigningRoles = Set(["runtime", "desktop", "local_app_host", "helper"])

final class DevelopmentCertificateAuthority {
    let systemKeychain: SecKeychain
    private(set) var helperApplication: SecTrustedApplication
    let codesignApplication: SecTrustedApplication
    var signingKeychain: SecKeychain?

    init(authorizingHelperPath: String = helperInstallPath) throws {
        guard [bootstrapHelperInstallPath, helperInstallPath].contains(authorizingHelperPath) else {
            throw fail(
                "runtime-service-repair-required",
                "use one fixed development security helper path",
                "An unrecognized helper path cannot own development signing custody."
            )
        }
        var opened: SecKeychain?
        let status = SecKeychainOpen(systemKeychainPath, &opened)
        guard status == errSecSuccess, let opened else {
            throw securityFailure("open System Keychain", status)
        }
        systemKeychain = opened
        helperApplication = try trustedApplication(authorizingHelperPath)
        codesignApplication = try trustedApplication("/usr/bin/codesign")
    }

    func validateInstalledProfile(requirePrivateCustody: Bool) throws -> DevelopmentSigningProfile {
        let profile = try readInstalledSigningProfile()
        try validateProvisionedProfile(profile, requirePrivateCustody: requirePrivateCustody)
        return profile
    }

    func provision() throws -> DevelopmentSigningProfile {
        if FileManager.default.fileExists(atPath: signingProfilePath) {
            let profile = try readInstalledSigningProfile()
            try validateProvisionedProfile(profile, requirePrivateCustody: true)
            return profile
        }
        try assertProfileLabelsAbsent()
        do {
        let bootstrapHelperIdentity = try inspectBootstrapCode(bootstrapHelperInstallPath)
        guard bootstrapHelperIdentity.identifier == "nimi-macos-dev-security",
              bootstrapHelperIdentity.teamId.isEmpty,
              bootstrapHelperIdentity.cdhash.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil else {
            throw fail(
                "runtime-service-untrusted",
                "reinstall the exact locally built bootstrap helper",
                "The bootstrap helper does not have an admitted local code partition."
            )
        }
        let bootstrapHelperPartition = "cdhash:\(bootstrapHelperIdentity.cdhash)"
        var signingKeychainPassword = try randomSecret(count: 48)
        defer { signingKeychainPassword.resetBytes(in: 0..<signingKeychainPassword.count) }
        signingKeychain = try createSigningKeychain(password: signingKeychainPassword)
        guard let signingKeychain else {
            throw fail("runtime-service-repair-required", "reprovision the development signing profile", "The root-owned signing Keychain was not created.")
        }
        let now = Date()
        let calendar = Calendar(identifier: .gregorian)
        guard let rootExpiry = calendar.date(byAdding: .year, value: 10, to: now),
              let leafExpiry = calendar.date(byAdding: .year, value: 3, to: now) else {
            throw fail("runtime-service-repair-required", "inspect local CA date construction", "Cannot construct development certificate validity.")
        }

        let rootName = "Nimi Local Development Root CA"
        let rootPair = try generateEphemeralRootKeyPair()
        let rootCertificateData = try createCertificate(
            subjectCommonName: rootName,
            subjectPublicKey: rootPair.publicKey,
            issuer: Issuer(commonName: rootName, privateKey: rootPair.privateKey),
            notBefore: now.addingTimeInterval(-300),
            notAfter: rootExpiry,
            isCA: true
        )
        try recordSystemCertificateForCleanup(
            role: "root-ca",
            sha256: SHA256.hash(data: rootCertificateData).hex
        )
        let rootCertificate = try addCertificate(rootCertificateData, label: profileLabel("root-ca"), keychain: systemKeychain)
        try trustRootForCodeSigning(rootCertificate)

        guard let helperSpecification = roleSpecifications.first(where: { $0.0 == "helper" }) else {
            throw fail("runtime-service-repair-required", "inspect the local CA role set", "The helper role specification is absent.")
        }
        let helperAccess = try createExactKeychainAccess(
            label: helperSpecification.1,
            restrictedApplications: [codesignApplication],
            ownerApplications: [helperApplication],
            partitions: ["apple:", bootstrapHelperPartition]
        )
        let helperPair = try generateKeyPair(
            label: profileLabel("helper"),
            access: helperAccess,
            keychain: signingKeychain
        )
        let helperCertificateData = try createCertificate(
            subjectCommonName: helperSpecification.1,
            subjectPublicKey: helperPair.publicKey,
            issuer: Issuer(commonName: rootName, privateKey: rootPair.privateKey),
            notBefore: now.addingTimeInterval(-300),
            notAfter: leafExpiry,
            isCA: false
        )
        _ = try addCertificate(
            helperCertificateData,
            label: profileLabel("helper"),
            keychain: signingKeychain
        )
        var identities = [
            "helper": DevelopmentIdentity(
                role: "helper",
                commonName: helperSpecification.1,
                certificateSHA1: Insecure.SHA1.hash(data: helperCertificateData).hex,
                certificateSHA256: SHA256.hash(data: helperCertificateData).hex,
                leafSPKISHA256: SHA256.hash(data: try subjectPublicKeyInfo(helperPair.publicKey)).hex,
                signingIdentifier: helperSpecification.2,
                expiresAt: signingProfileRFC3339(leafExpiry)
            ),
        ]
        let helperIdentity = identities["helper"]!
        var completedProfile: DevelopmentSigningProfile?
        try withProvisioningCodeSigningCustody(password: signingKeychainPassword) { keychainPath, homeDirectory in
            try signInstalledHelper(
                identitySHA1: helperIdentity.certificateSHA1,
                keychainPath: keychainPath,
                homeDirectory: homeDirectory
            )
            try verifyInstalledHelper(expectedLeafSPKI: helperIdentity.leafSPKISHA256)
            let signedHelperIdentity = try inspectSignedCode(helperInstallPath)
            let signedHelperPartition = "cdhash:\(signedHelperIdentity.cdhash)"
            let signedHelperApplication = try trustedApplication(helperInstallPath)
            let transitionalOwners = [helperApplication, signedHelperApplication]
            let helperACLIdentitySHA256 = try trustedApplicationIdentitySHA256(signedHelperApplication)
            let codesignACLIdentitySHA256 = try trustedApplicationIdentitySHA256(codesignApplication)
            let helperPrivateKey = try loadPrivateKey(
                label: profileLabel("helper"),
                keychain: signingKeychain
            )
            try replaceExactKeychainAccess(
                unsafeBitCast(helperPrivateKey, to: SecKeychainItem.self),
                restrictedAuthorization: kSecACLAuthorizationSign,
                restrictedApplications: [codesignApplication],
                ownerApplications: transitionalOwners,
                partitions: ["apple:", signedHelperPartition],
                label: "\(helperSpecification.1) private key transition"
            )
            try validateKeychainAccess(
                unsafeBitCast(helperPrivateKey, to: SecKeychainItem.self),
                restrictedAuthorization: kSecACLAuthorizationSign,
                restrictedApplications: [codesignApplication],
                ownerApplications: transitionalOwners,
                partitions: ["apple:", signedHelperPartition],
                label: "\(helperSpecification.1) private key transition"
            )

            for (role, commonName, signingIdentifier) in roleSpecifications where role != "helper" {
                let codeSigningRole = codeSigningRoles.contains(role)
                let restrictedApplication = codeSigningRole ? codesignApplication : signedHelperApplication
                let finalPartitions = codeSigningRole
                    ? ["apple:", signedHelperPartition]
                    : [signedHelperPartition]
                let roleAccess = try createExactKeychainAccess(
                    label: commonName,
                    restrictedApplications: [restrictedApplication],
                    ownerApplications: [signedHelperApplication],
                    partitions: finalPartitions
                )
                let pair = try generateKeyPair(
                    label: profileLabel(role),
                    access: roleAccess,
                    keychain: signingKeychain
                )
                let certificateData = try createCertificate(
                    subjectCommonName: commonName,
                    subjectPublicKey: pair.publicKey,
                    issuer: Issuer(commonName: rootName, privateKey: rootPair.privateKey),
                    notBefore: now.addingTimeInterval(-300),
                    notAfter: leafExpiry,
                    isCA: false
                )
                _ = try addCertificate(
                    certificateData,
                    label: profileLabel(role),
                    keychain: signingKeychain
                )
                try validateKeychainAccess(
                    unsafeBitCast(pair.privateKey, to: SecKeychainItem.self),
                    restrictedAuthorization: kSecACLAuthorizationSign,
                    restrictedApplications: [restrictedApplication],
                    ownerApplications: [signedHelperApplication],
                    partitions: finalPartitions,
                    label: "\(commonName) born-final private key"
                )
                identities[role] = DevelopmentIdentity(
                    role: role,
                    commonName: commonName,
                    certificateSHA1: Insecure.SHA1.hash(data: certificateData).hex,
                    certificateSHA256: SHA256.hash(data: certificateData).hex,
                    leafSPKISHA256: SHA256.hash(data: try subjectPublicKeyInfo(pair.publicKey)).hex,
                    signingIdentifier: signingIdentifier,
                    expiresAt: signingProfileRFC3339(leafExpiry)
                )
            }

            let recordPublicKey = try loadPublicKey(
                label: profileLabel("record_signer"),
                keychain: signingKeychain
            )
            let recordSPKI = try subjectPublicKeyInfo(recordPublicKey)
            completedProfile = DevelopmentSigningProfile(
                schemaVersion: "nimi.macos-local-development-signing-profile/v4",
                profileId: "macos_local_development_v1",
                environment: "local_development",
                identityClass: "local_ca",
                signatureAlgorithm: "ecdsa_p256_sha256",
                aclIdentityDigestAlgorithm: "sha256_opaque_sectrustedapplication_data",
                helperACLIdentitySHA256: helperACLIdentitySHA256,
                codesignACLIdentitySHA256: codesignACLIdentitySHA256,
                rootPrivateKeyPersistence: "non_durable_destroyed_after_leaf_issuance",
                rolePrivateKeyCustody: "all_five_roles_root_owned_locked_system_domain_signing_keychain",
                systemKeychainPrivateKeyPolicy: "forbidden_zero_profile_private_keys",
                systemUnlockSecretMutationPolicy: "born_final_exact_final_helper_decrypt_delete_changeACL_partition_no_post_insert_mutation",
                rootKeyId: "nimi-macos-dev-record-\(sha256(recordSPKI).prefix(20))",
                rootPublicKeyB64URL: recordSPKI.base64URLEncodedString(),
                rootCertificateSHA256: SHA256.hash(data: rootCertificateData).hex,
                createdAt: signingProfileRFC3339(now),
                expiresAt: signingProfileRFC3339(leafExpiry),
                identities: identities
            )
            try storeSigningKeychainPassword(
                signingKeychainPassword,
                application: signedHelperApplication,
                partition: signedHelperPartition
            )
        }
        signingKeychainPassword.resetBytes(in: 0..<signingKeychainPassword.count)
        guard let profile = completedProfile else {
            throw fail(
                "runtime-service-repair-required",
                "restart the exact development trust provisioning transaction",
                "The bootstrap did not commit the public ACL identity digests."
            )
        }
        try writeSigningProfile(profile)
        try finalizeInstalledSigningCustodyWithSignedHelper()
        try verifyInstalledSigningProfileWithSignedHelper()
        _ = rootCertificate
        return profile
        } catch {
            let provisioningError = error
            let unlockSecretCommitted: Bool
            do {
                unlockSecretCommitted = try signingKeychainPasswordExists()
            } catch {
                throw fail(
                    "runtime-service-repair-required",
                    "preserve and run the exact signed final helper for rollback",
                    "Provisioning failed (\(diagnosticMessage(provisioningError))) and unlock-secret commit state could not be proven (\(diagnosticMessage(error)))."
                )
            }
            if unlockSecretCommitted {
                throw fail(
                    "runtime-service-repair-required",
                    "run rollback through the exact signed final helper",
                    "Provisioning failed after the final-helper-only unlock secret was committed: \(diagnosticMessage(provisioningError))"
                )
            }
            var cleanupFailures = [String]()
            do {
                try removeProfileItems()
            } catch {
                cleanupFailures.append(diagnosticMessage(error))
            }
            if !cleanupFailures.isEmpty {
                throw fail(
                    "runtime-service-repair-required",
                    "run pnpm unprovision:macos-dev-trust before retrying provisioning",
                    "Provisioning failed (\(diagnosticMessage(provisioningError))) and its rollback was incomplete (\(cleanupFailures.joined(separator: "; ")))."
                )
            }
            throw provisioningError
        }
    }

    func finalizeProvisioningCustody() throws -> DevelopmentSigningProfile {
        let profile = try readInstalledSigningProfile()
        try validateProvisionedProfile(profile, requirePrivateCustody: false)
        let bootstrapApplication = try trustedApplication(bootstrapHelperInstallPath)
        let finalHelperIdentity = try inspectSignedCode(helperInstallPath)
        let finalHelperPartition = "cdhash:\(finalHelperIdentity.cdhash)"

        try withCodeSigningCustody { _, _ in
            let roleSigningKeychain = try openSigningKeychain()
            let helperPrivateKey = try loadPrivateKey(
                label: profileLabel("helper"),
                keychain: roleSigningKeychain
            )
            try closePrivateKeyOwnerTransition(
                privateKey: helperPrivateKey,
                restrictedApplicationDigests: [profile.codesignACLIdentitySHA256],
                bootstrapApplication: bootstrapApplication,
                finalApplicationDigest: profile.helperACLIdentitySHA256,
                finalPartitions: ["apple:", finalHelperPartition],
                label: "Nimi macOS Dev Security Helper private key"
            )
        }
        try validateProvisionedProfile(profile, requirePrivateCustody: true)
        return profile
    }

    private func closePrivateKeyOwnerTransition(
        privateKey: SecKey,
        restrictedApplicationDigests: [String],
        bootstrapApplication: SecTrustedApplication,
        finalApplicationDigest: String,
        finalPartitions: [String],
        label: String
    ) throws {
        let item = unsafeBitCast(privateKey, to: SecKeychainItem.self)
        try closeKeychainOwnerTransitionPreservingFinalApplication(
            item,
            restrictedAuthorization: kSecACLAuthorizationSign,
            restrictedApplicationDigests: restrictedApplicationDigests,
            bootstrapApplication: bootstrapApplication,
            finalApplicationDigest: finalApplicationDigest,
            partitions: finalPartitions,
            label: label
        )
    }

    func signReleaseRecord(_ payload: Data, keyId: String) throws -> Data {
        guard payload.count > 0, payload.count <= 64 * 1024 else {
            throw fail("runtime-service-repair-required", "inspect release record construction", "Release record signing input is empty or oversized.")
        }
        let profile = try readInstalledSigningProfile()
        guard keyId == profile.rootKeyId else {
            throw fail("runtime-service-untrusted", "rebuild the matching development candidate", "Release record key id does not match the provisioned profile.")
        }
        return try withCodeSigningCustody { _, _ in
            try signReleaseRecordWithUnlockedCustody(payload, profile: profile)
        }
    }

    func signReleaseRecordWithUnlockedCustody(
        _ payload: Data,
        profile: DevelopmentSigningProfile
    ) throws -> Data {
        let signingKeychain = try openSigningKeychain()
        try requireSigningKeychainUnlocked(signingKeychain)
        let privateKey = try loadPrivateKey(label: profileLabel("record_signer"), keychain: signingKeychain)
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            payload as CFData,
            &error
        ) as Data? else {
            throw securityError("sign local-development release record", error)
        }
        return signature
    }

    func removeProfileItems() throws {
        var expectedFingerprints = try signingProfileCleanupFingerprints()
        if FileManager.default.fileExists(atPath: signingProfilePath) {
            let profile = try readInstalledSigningProfile()
            try mergeCleanupFingerprint(
                &expectedFingerprints,
                role: "root-ca",
                fingerprint: profile.rootCertificateSHA256
            )
            let expectedRoles = Set(roleSpecifications.map(\.0))
            guard Set(profile.identities.keys) == expectedRoles else {
                throw fail(
                    "runtime-service-repair-required",
                    "inspect the development signing profile before cleanup",
                    "The public profile does not contain the exact development role certificate set."
                )
            }
            for role in roleSpecifications.map(\.0) {
                try mergeCleanupFingerprint(
                    &expectedFingerprints,
                    role: role,
                    fingerprint: profile.identities[role]!.certificateSHA256
                )
            }
        }

        var failures = [String]()
        let unlockSecretPresent = try signingKeychainPasswordExists()
        if unlockSecretPresent {
            try validateSigningKeychainPasswordDeletionAuthority()
        }
        do {
            try deleteSigningKeychain()
        } catch {
            throw fail(
                "runtime-service-repair-required",
                "preserve the final helper and retry exact signing-custody cleanup",
                "Development signing cleanup stopped before unlock-secret or public-trust mutation: \(diagnosticMessage(error))"
            )
        }
        if unlockSecretPresent {
            try deleteSigningKeychainPassword()
        }

        var certificatesByRole = [String: SecCertificate]()
        var rootTrustCertificate: SecCertificate?
        for (role, fingerprint) in expectedFingerprints {
            if let certificate = try certificateIfPresent(sha256: fingerprint, keychain: systemKeychain) {
                certificatesByRole[role] = certificate
            }
            if role == "root-ca" {
                rootTrustCertificate = try adminTrustCertificateIfPresent(sha256: fingerprint)
            }
        }

        var rootTrustRemoved = true
        if let rootCertificate = rootTrustCertificate {
            let status = SecTrustSettingsRemoveTrustSettings(rootCertificate, .admin)
            if status != errSecSuccess, status != errSecItemNotFound {
                rootTrustRemoved = false
                failures.append(securityFailure("remove local CA code-signing trust settings", status).message)
            }
        }
        if rootTrustRemoved, let rootCertificate = certificatesByRole["root-ca"] {
            captureCleanupFailure(&failures) {
                try deleteCertificate(rootCertificate, keychain: systemKeychain)
            }
        }
        for (role, certificate) in certificatesByRole where role != "root-ca" {
            captureCleanupFailure(&failures) {
                try deleteCertificate(certificate, keychain: systemKeychain)
            }
        }
        for suffix in ["root-ca"] + roleSpecifications.map(\.0) {
            captureCleanupFailure(&failures) {
                try deleteExactProfileKeys(label: profileLabel(suffix), keychain: systemKeychain)
            }
        }
        guard failures.isEmpty else {
            throw fail(
                "runtime-service-repair-required",
                "retry the exact confirmed unprovision transaction after inspecting the reported fixed targets",
                "Development signing cleanup was incomplete: \(failures.joined(separator: "; "))"
            )
        }
        try removeSigningProfileFileIfPresent()
        try removeSigningProfileCleanupRecordIfPresent()
        try assertProfileLabelsAbsent()
        guard !FileManager.default.fileExists(atPath: signingProfilePath) else {
            throw fail(
                "runtime-service-repair-required",
                "retry the exact confirmed unprovision transaction",
                "The public signing profile remains after cleanup."
            )
        }
    }

    func prepareStrandedUnprovisionHandoff() throws -> Bool {
        guard !FileManager.default.fileExists(atPath: signingProfilePath),
              !certificateAuthorityPathExists(signingKeychainPath),
              try signingKeychainPasswordExists() else {
            throw fail(
                "runtime-service-repair-required",
                "use the normal final-helper unprovision path",
                "The repair-only unprovision handoff does not match the stranded custody shape."
            )
        }
        let cleanupFingerprints = try signingProfileCleanupFingerprints()
        guard Set(cleanupFingerprints.keys) == Set(["root-ca"]),
              let expectedRootSHA256 = cleanupFingerprints["root-ca"] else {
            throw fail(
                "runtime-service-repair-required",
                "preserve and inspect the exact signing cleanup record",
                "The repair-only unprovision handoff requires one exact root-certificate cleanup fingerprint."
            )
        }
        try requireSecureHelper(at: helperInstallPath)
        let finalIdentity = try inspectSignedCode(helperInstallPath)
        guard finalIdentity.identifier == "ai.nimi.dev-security-helper",
              finalIdentity.teamId.isEmpty,
              finalIdentity.hardenedRuntime,
              finalIdentity.cdhash.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
              finalIdentity.designatedRequirement.range(
                  of: #"^identifier \"ai\.nimi\.dev-security-helper\" and certificate leaf = H\"[a-f0-9]{40}\"$"#,
                  options: .regularExpression
              ) != nil else {
            throw fail(
                "runtime-service-untrusted",
                "restore the exact stranded final helper",
                "The stranded final helper does not have the admitted local-development code identity."
            )
        }
        let finalApplication = try trustedApplication(helperInstallPath)
        try validateStrandedGenericPasswordCleanupBinding(
            try signingKeychainPasswordItem(),
            application: finalApplication,
            requiredPartition: "cdhash:\(finalIdentity.cdhash)",
            label: "stranded signing Keychain unlock secret"
        )
        for suffix in ["root-ca"] + roleSpecifications.map(\.0) {
            let classes = try keychainItemClasses(label: profileLabel(suffix), keychain: systemKeychain)
            let admitted = suffix == "root-ca" ? Set(["certificate"]) : Set<String>()
            guard Set(classes).isSubset(of: admitted) else {
                throw fail(
                    "runtime-service-repair-required",
                    "remove private or role identity residue before repair",
                    "The repair-only handoff found unadmitted System Keychain material for \(suffix): \(classes.joined(separator: ","))."
                )
            }
        }
        let certificateChain = try signedCodeCertificateChainDER(helperInstallPath)
        guard let embeddedRootData = certificateChain.last,
              sha256(embeddedRootData) == expectedRootSHA256 else {
            throw fail(
                "runtime-service-untrusted",
                "restore the final helper matching the cleanup record",
                "The stranded final helper embedded root does not match the exact cleanup fingerprint."
            )
        }
        let existingCertificate = try certificateIfPresent(
            sha256: expectedRootSHA256,
            keychain: systemKeychain
        )
        let existingTrust = try adminTrustCertificateIfPresent(sha256: expectedRootSHA256)
        switch (existingCertificate, existingTrust) {
        case (nil, nil):
            let certificate = try addCertificate(
                embeddedRootData,
                label: profileLabel("root-ca"),
                keychain: systemKeychain
            )
            try trustRootForCodeSigning(certificate)
            return true
        case let (certificate?, trustCertificate?):
            guard sha256(SecCertificateCopyData(certificate) as Data) == expectedRootSHA256,
                  sha256(SecCertificateCopyData(trustCertificate) as Data) == expectedRootSHA256 else {
                throw fail(
                    "runtime-service-repair-required",
                    "inspect the stranded public trust material",
                    "The existing repair trust material does not match the cleanup fingerprint."
                )
            }
            try validateRootCodeSigningTrust(trustCertificate)
            return false
        default:
            throw fail(
                "runtime-service-repair-required",
                "inspect the partial stranded public trust material",
                "The repair-only handoff requires the exact root certificate and trust to be both absent or both present."
            )
        }
    }

    func withCodeSigningCustody<T>(_ operation: (String, String) throws -> T) throws -> T {
        try requireRootMutationContext()
        var password = try readSigningKeychainPassword()
        defer { password.resetBytes(in: 0..<password.count) }
        return try withUnlockedCodeSigningCustody(password: password, operation)
    }

    private func withProvisioningCodeSigningCustody<T>(
        password: Data,
        _ operation: (String, String) throws -> T
    ) throws -> T {
        try requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: false)
        return try withUnlockedCodeSigningCustody(password: password, operation)
    }

    private func withUnlockedCodeSigningCustody<T>(
        password: Data,
        _ operation: (String, String) throws -> T
    ) throws -> T {
        let keychain = try openSigningKeychain()
        let unlockStatus = password.withUnsafeBytes { bytes in
            SecKeychainUnlock(keychain, UInt32(bytes.count), bytes.baseAddress, true)
        }
        guard unlockStatus == errSecSuccess else {
            throw securityFailure("unlock root-owned signing Keychain", unlockStatus)
        }
        do {
            let value = try withEphemeralCodeSigningSearchList(signingKeychain: signingKeychainPath) { homeDirectory in
                try operation(signingKeychainPath, homeDirectory)
            }
            let lockStatus = SecKeychainLock(keychain)
            guard lockStatus == errSecSuccess else {
                throw securityFailure("lock root-owned signing Keychain", lockStatus)
            }
            return value
        } catch {
            let lockStatus = SecKeychainLock(keychain)
            if lockStatus != errSecSuccess {
                throw fail(
                    "runtime-service-repair-required",
                    "lock and repair the development signing Keychain before retrying",
                    "The signing transaction failed and its Keychain could not be relocked (OSStatus \(lockStatus)): \(diagnosticMessage(error))"
                )
            }
            throw error
        }
    }

}

private func mergeCleanupFingerprint(
    _ values: inout [String: String],
    role: String,
    fingerprint: String
) throws {
    if let existing = values[role], existing != fingerprint {
        throw fail(
            "runtime-service-repair-required",
            "inspect the conflicting signing profile and cleanup record",
            "The public profile and cleanup record disagree about the \(role) certificate."
        )
    }
    values[role] = fingerprint
}

private func captureCleanupFailure(_ failures: inout [String], _ operation: () throws -> Void) {
    do {
        try operation()
    } catch {
        failures.append(diagnosticMessage(error))
    }
}

private func removeSigningProfileFileIfPresent() throws {
    var metadata = stat()
    if lstat(signingProfilePath, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect signing profile during cleanup", signingProfilePath)
    }
    _ = try secureMetadata(signingProfilePath, type: S_IFREG, uid: 0, gid: 0, mode: 0o644, links: 1)
    guard unlink(signingProfilePath) == 0 else {
        throw posixFailure("remove signing profile", signingProfilePath)
    }
    try syncDirectory(runtimeDevRoot)
}

private extension Digest {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
