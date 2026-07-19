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

private struct KeyPair {
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
    private let systemKeychain: SecKeychain
    private var helperApplication: SecTrustedApplication
    private let codesignApplication: SecTrustedApplication
    private var signingKeychain: SecKeychain?

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

    private func signReleaseRecordWithUnlockedCustody(
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

    private func assertProfileLabelsAbsent() throws {
        let passwordExists = try signingKeychainPasswordExists()
        if certificateAuthorityPathExists(signingKeychainPath)
            || certificateAuthorityPathExists(signingCleanupRecordPath)
            || passwordExists {
            throw fail(
                "runtime-service-repair-required",
                "run unprovision only after uninstalling the development service, then provision again",
                "A partial root-owned signing Keychain or unlock secret already exists."
            )
        }
        for suffix in ["root-ca"] + roleSpecifications.map({ $0.0 }) {
            let classes = try keychainItemClasses(label: profileLabel(suffix), keychain: systemKeychain)
            if !classes.isEmpty {
                throw fail(
                    "runtime-service-repair-required",
                    "run unprovision only after uninstalling the development service, then provision again",
                    "A partial or unrecorded local-development identity already exists for \(suffix) (classes=\(classes.joined(separator: ",")))."
                )
            }
        }
    }

    private func generateKeyPair(label: String, access: SecAccess, keychain: SecKeychain) throws -> KeyPair {
        let parameters: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecUseKeychain: keychain,
            kSecAttrAccess: access,
            kSecPrivateKeyAttrs: [
                kSecAttrLabel: label,
                kSecAttrApplicationTag: Data(label.utf8),
                kSecAttrIsPermanent: true,
                kSecAttrCanSign: true,
            ],
            kSecPublicKeyAttrs: [
                kSecAttrLabel: label,
                kSecAttrApplicationTag: Data(label.utf8),
                kSecAttrIsPermanent: true,
                kSecAttrCanVerify: true,
            ],
        ]
        var publicKey: SecKey?
        var privateKey: SecKey?
        let status = SecKeyGeneratePair(parameters as CFDictionary, &publicKey, &privateKey)
        guard status == errSecSuccess, let publicKey, let privateKey else {
            throw securityFailure("generate persistent P-256 Keychain key", status)
        }
        return KeyPair(publicKey: publicKey, privateKey: privateKey)
    }

    private func generateEphemeralRootKeyPair() throws -> KeyPair {
        let parameters: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecAttrIsPermanent: false,
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(parameters as CFDictionary, &error) else {
            throw securityError("generate non-durable P-256 CA key", error)
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw fail(
                "runtime-service-repair-required",
                "restart the local CA provisioning transaction",
                "Cannot derive the non-durable CA public key."
            )
        }
        return KeyPair(publicKey: publicKey, privateKey: privateKey)
    }

    private func addCertificate(_ data: Data, label: String, keychain: SecKeychain) throws -> SecCertificate {
        guard let certificate = SecCertificateCreateWithData(nil, data as CFData) else {
            throw fail("runtime-service-repair-required", "inspect X.509 certificate construction", "Security.framework rejected a generated development certificate.")
        }
        let query: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecValueRef: certificate,
            kSecAttrLabel: label,
            kSecUseKeychain: keychain,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw securityFailure("add certificate to System Keychain", status) }
        return certificate
    }

    private func loadPublicKey(label: String, keychain: SecKeychain) throws -> SecKey {
        try loadKey(label: label, keyClass: kSecAttrKeyClassPublic, keychain: keychain)
    }

    private func loadPrivateKey(label: String, keychain: SecKeychain) throws -> SecKey {
        try loadKey(label: label, keyClass: kSecAttrKeyClassPrivate, keychain: keychain)
    }

    private func loadCertificate(sha256 expectedSHA256: String, keychain: SecKeychain) throws -> SecCertificate {
        guard expectedSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the development certificate fingerprint",
                "A development certificate fingerprint is malformed."
            )
        }
        let matches = try certificates(in: keychain).filter { certificate in
            sha256(SecCertificateCopyData(certificate) as Data) == expectedSHA256
        }
        guard matches.count == 1, let certificate = matches.first else {
            throw fail(
                "runtime-service-repair-required",
                "reprovision the development signing profile",
                "The fixed Keychain contains \(matches.count) certificates for the expected SHA-256 fingerprint."
            )
        }
        return certificate
    }

    private func certificates(in keychain: SecKeychain) throws -> [SecCertificate] {
        let query: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecMatchSearchList: [keychain],
            kSecMatchLimit: kSecMatchLimitAll,
            kSecReturnRef: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let result,
              CFGetTypeID(result) == CFArrayGetTypeID() else {
            throw securityFailure("enumerate fixed-Keychain certificates", status == errSecSuccess ? errSecDecode : status)
        }
        let values = unsafeBitCast(result, to: CFArray.self)
        return (0..<CFArrayGetCount(values)).map { index in
            unsafeBitCast(CFArrayGetValueAtIndex(values, index), to: SecCertificate.self)
        }
    }

    private func certificateIfPresent(sha256 expectedSHA256: String, keychain: SecKeychain) throws -> SecCertificate? {
        guard expectedSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the development signing cleanup fingerprint",
                "A cleanup certificate fingerprint is malformed."
            )
        }
        let matches = try certificates(in: keychain).filter { certificate in
            sha256(SecCertificateCopyData(certificate) as Data) == expectedSHA256
        }
        guard matches.count <= 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect duplicate exact development certificates before cleanup",
                "The fixed Keychain contains multiple certificates with one recorded DER SHA-256."
            )
        }
        return matches.first
    }

    private func adminTrustCertificateIfPresent(sha256 expectedSHA256: String) throws -> SecCertificate? {
        var values: CFArray?
        let status = SecTrustSettingsCopyCertificates(.admin, &values)
        if trustSettingsCopyCertificatesReportsEmptyDomain(status) { return nil }
        guard status == errSecSuccess, let values else {
            throw securityFailure("enumerate admin trust certificates", status)
        }
        let matches = (0..<CFArrayGetCount(values)).compactMap { index -> SecCertificate? in
            let raw = CFArrayGetValueAtIndex(values, index)
            let object = unsafeBitCast(raw, to: CFTypeRef.self)
            guard CFGetTypeID(object) == SecCertificateGetTypeID() else { return nil }
            let certificate = unsafeBitCast(object, to: SecCertificate.self)
            return sha256(SecCertificateCopyData(certificate) as Data) == expectedSHA256
                ? certificate
                : nil
        }
        guard matches.count <= 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect duplicate exact admin trust certificates before cleanup",
                "The admin trust domain contains multiple certificates with one recorded DER SHA-256."
            )
        }
        return matches.first
    }

    private func certificateMatchingPublicKeyIfPresent(label: String, keychain: SecKeychain) throws -> SecCertificate? {
        guard let publicKey = try loadKeyIfPresent(
            label: label,
            keyClass: kSecAttrKeyClassPublic,
            keychain: keychain
        ) else { return nil }
        let expectedSPKI = try subjectPublicKeyInfo(publicKey)
        let matches = try certificates(in: keychain).filter { certificate in
            guard let publicKey = SecCertificateCopyKey(certificate),
                  let spki = try? subjectPublicKeyInfo(publicKey) else { return false }
            return spki == expectedSPKI
        }
        guard matches.count <= 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect duplicate development certificates before unprovisioning",
                "The fixed Keychain contains multiple certificates for one development key."
            )
        }
        return matches.first
    }

    private func deleteCertificate(_ certificate: SecCertificate, keychain: SecKeychain) throws {
        let status = SecItemDelete([
            kSecClass: kSecClassCertificate,
            kSecValueRef: certificate,
            kSecMatchSearchList: [keychain],
        ] as CFDictionary)
        if status != errSecSuccess, status != errSecItemNotFound {
            throw securityFailure("delete exact development certificate", status)
        }
    }

    private func loadKey(label: String, keyClass: CFString, keychain: SecKeychain) throws -> SecKey {
        guard let key = try loadKeyIfPresent(label: label, keyClass: keyClass, keychain: keychain) else {
            throw securityFailure("load System Keychain key", errSecItemNotFound)
        }
        return key
    }

    private func loadKeyIfPresent(label: String, keyClass: CFString, keychain: SecKeychain) throws -> SecKey? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrLabel: label,
            kSecAttrKeyClass: keyClass,
            kSecMatchSearchList: [keychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnRef: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let key = result as! SecKey? else {
            throw securityFailure("load System Keychain key", status)
        }
        return key
    }

    private func keychainItemExists(label: String, keychain: SecKeychain) throws -> Bool {
        !(try keychainItemClasses(label: label, keychain: keychain)).isEmpty
    }

    private func keychainItemClasses(label: String, keychain: SecKeychain) throws -> [String] {
        var matches = [String]()
        for (itemClass, name) in [(kSecClassKey, "key"), (kSecClassCertificate, "certificate")] {
            let query: [CFString: Any] = [
                kSecClass: itemClass,
                kSecAttrLabel: label,
                kSecMatchSearchList: [keychain],
                kSecMatchLimit: kSecMatchLimitOne,
                kSecReturnAttributes: true,
            ]
            let status = SecItemCopyMatching(query as CFDictionary, nil)
            if status == errSecSuccess {
                matches.append(name)
                continue
            }
            if status != errSecItemNotFound { throw securityFailure("inspect System Keychain profile item", status) }
        }
        return matches
    }

    private func randomSecret(count: Int) throws -> Data {
        guard count >= 32, count <= 128 else {
            throw fail("runtime-service-repair-required", "inspect signing custody construction", "The signing Keychain password length is invalid.")
        }
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, bytes.count, bytes.baseAddress!)
        }
        guard status == errSecSuccess else { throw securityFailure("generate signing Keychain password", status) }
        return data
    }

    private func createSigningKeychain(password: Data) throws -> SecKeychain {
        guard !certificateAuthorityPathExists(signingKeychainPath) else {
            throw fail("runtime-service-repair-required", "remove the partial signing profile before reprovisioning", "The fixed signing Keychain path already exists.")
        }
        var created: SecKeychain?
        let status = password.withUnsafeBytes { bytes in
            SecKeychainCreate(
                signingKeychainPath,
                UInt32(bytes.count),
                bytes.baseAddress,
                false,
                nil,
                &created
            )
        }
        guard status == errSecSuccess, let created else {
            throw securityFailure("create root-owned signing Keychain", status)
        }
        guard chown(signingKeychainPath, 0, 0) == 0, chmod(signingKeychainPath, 0o600) == 0 else {
            throw posixFailure("secure root-owned signing Keychain", signingKeychainPath)
        }
        _ = try secureMetadata(signingKeychainPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
        return created
    }

    private func openSigningKeychain() throws -> SecKeychain {
        if let signingKeychain { return signingKeychain }
        _ = try secureMetadata(signingKeychainPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
        var opened: SecKeychain?
        let status = SecKeychainOpen(signingKeychainPath, &opened)
        guard status == errSecSuccess, let opened else {
            throw securityFailure("open root-owned signing Keychain", status)
        }
        signingKeychain = opened
        return opened
    }

    private func deleteSigningKeychain() throws {
        guard certificateAuthorityPathExists(signingKeychainPath) else { return }
        let keychain = try openSigningKeychain()
        let status = SecKeychainDelete(keychain)
        guard status == errSecSuccess else { throw securityFailure("delete root-owned signing Keychain", status) }
        signingKeychain = nil
        if certificateAuthorityPathExists(signingKeychainPath) {
            throw fail("runtime-service-repair-required", "remove the residual signing Keychain", "The signing Keychain file remained after deletion.")
        }
    }

    private func storeSigningKeychainPassword(
        _ password: Data,
        application: SecTrustedApplication,
        partition: String
    ) throws {
        let itemAccess = try createExactGenericPasswordAccess(
            label: "Nimi macOS Local Development Signing Keychain",
            application: application,
            partitions: [partition]
        )
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: signingKeychainPasswordService,
            kSecAttrAccount: signingKeychainPasswordAccount,
            kSecAttrLabel: signingKeychainPasswordService,
            kSecValueData: password,
            kSecUseKeychain: systemKeychain,
            kSecAttrAccess: itemAccess,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw securityFailure("store signing Keychain unlock secret", status) }
        try validateExactGenericPasswordAccess(
            try signingKeychainPasswordItem(),
            application: application,
            partitions: [partition],
            label: "signing Keychain unlock secret"
        )
    }

    private func signingKeychainPasswordExists() throws -> Bool {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: signingKeychainPasswordService,
            kSecAttrAccount: signingKeychainPasswordAccount,
            kSecMatchSearchList: [systemKeychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnAttributes: true,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess { return true }
        if status == errSecItemNotFound { return false }
        throw securityFailure("inspect signing Keychain unlock secret", status)
    }

    private func readSigningKeychainPassword() throws -> Data {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: signingKeychainPasswordService,
            kSecAttrAccount: signingKeychainPasswordAccount,
            kSecMatchSearchList: [systemKeychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnData: true,
        ]
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        guard status == errSecSuccess, let password = value as? Data,
              password.count >= 32, password.count <= 128 else {
            throw securityFailure("read signing Keychain unlock secret", status == errSecSuccess ? errSecDecode : status)
        }
        return password
    }

    private func signingKeychainPasswordItem() throws -> SecKeychainItem {
        var item: SecKeychainItem?
        let status = signingKeychainPasswordService.withCString { service in
            signingKeychainPasswordAccount.withCString { account in
                SecKeychainFindGenericPassword(
                    systemKeychain,
                    UInt32(signingKeychainPasswordService.utf8.count), service,
                    UInt32(signingKeychainPasswordAccount.utf8.count), account,
                    nil, nil, &item
                )
            }
        }
        guard status == errSecSuccess, let item else {
            throw securityFailure("locate signing Keychain unlock secret", status)
        }
        return item
    }

    private func validateSigningKeychainPasswordAccess(
        partition: String,
        helperACLIdentitySHA256: String
    ) throws {
        let item = try signingKeychainPasswordItem()
        try validateKeychainAccessIdentityDigests(
            item,
            restrictedAuthorization: kSecACLAuthorizationDecrypt,
            restrictedApplicationDigests: [helperACLIdentitySHA256],
            ownerApplicationDigests: [helperACLIdentitySHA256],
            partitions: [partition],
            label: "signing Keychain unlock secret"
        )
        try validateKeychainAuthorizationIdentityDigests(
            item,
            authorization: kSecACLAuthorizationDelete,
            applicationDigests: [helperACLIdentitySHA256],
            label: "signing Keychain unlock secret delete"
        )
    }

    private func deleteSigningKeychainPassword() throws {
        guard try signingKeychainPasswordExists() else { return }
        try validateSigningKeychainPasswordDeletionAuthority()
        let item = try signingKeychainPasswordItem()
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecMatchSearchList: [systemKeychain],
            kSecMatchItemList: [item],
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess {
            throw securityFailure("delete signing Keychain unlock secret", status)
        }
        guard try !signingKeychainPasswordExists() else {
            throw fail(
                "runtime-service-repair-required",
                "retry cleanup through the exact signed final helper",
                "The signing Keychain unlock secret remains after exact-item deletion."
            )
        }
    }

    private func validateSigningKeychainPasswordDeletionAuthority() throws {
        guard try canonicalCurrentExecutablePath() == helperInstallPath else {
            throw fail(
                "runtime-service-repair-required",
                "run unprovision through the exact signed final helper",
                "The bootstrap helper cannot delete the final-helper-only signing Keychain unlock secret."
            )
        }
        let identity = try inspectSignedCode(helperInstallPath)
        guard identity.identifier == "ai.nimi.dev-security-helper",
              identity.teamId.isEmpty,
              identity.hardenedRuntime else {
            throw fail(
                "runtime-service-untrusted",
                "restore the exact signed final helper before cleanup",
                "The installed final helper is not an admitted local-development cleanup anchor."
            )
        }
        let application = try trustedApplication(helperInstallPath)
        try validateExactGenericPasswordAccess(
            try signingKeychainPasswordItem(),
            application: application,
            partitions: ["cdhash:\(identity.cdhash)"],
            label: "signing Keychain unlock secret"
        )
    }

    private func access(label: String, applications: [SecTrustedApplication]) throws -> SecAccess {
        try createExactKeychainAccess(
            label: label,
            restrictedApplications: applications,
            ownerApplications: [helperApplication]
        )
    }

    private func validateProvisionedProfile(
        _ profile: DevelopmentSigningProfile,
        requirePrivateCustody: Bool
    ) throws {
        guard let helperIdentity = profile.identities["helper"] else {
            throw fail("runtime-service-repair-required", "reprovision the development signing profile", "The helper identity is absent from the installed profile.")
        }
        try verifyInstalledHelper(expectedLeafSPKI: helperIdentity.leafSPKISHA256)
        let installedHelperIdentity = try inspectSignedCode(helperInstallPath)
        let helperPartition = "cdhash:\(installedHelperIdentity.cdhash)"
        for (role, commonName, signingIdentifier) in roleSpecifications {
            guard let identity = profile.identities[role],
                  identity.role == role,
                  identity.commonName == commonName,
                  identity.signingIdentifier == signingIdentifier,
                  identity.certificateSHA1.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
                  identity.certificateSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
                  identity.leafSPKISHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
                throw fail("runtime-service-repair-required", "reprovision the development signing profile", "A role identity does not match the admitted local-development profile: \(role)")
            }
        }
        let rootCertificate = try loadCertificate(
            sha256: profile.rootCertificateSHA256,
            keychain: systemKeychain
        )
        try validateRootCodeSigningTrust(rootCertificate)
        let rootCertificateData = SecCertificateCopyData(rootCertificate) as Data
        guard SHA256.hash(data: rootCertificateData).hex == profile.rootCertificateSHA256 else {
            throw fail("runtime-service-repair-required", "reprovision the development signing profile", "The local CA certificate does not match its public signing profile.")
        }
        guard try loadKeyIfPresent(
            label: profileLabel("root-ca"),
            keyClass: kSecAttrKeyClassPrivate,
            keychain: systemKeychain
        ) == nil,
        try loadKeyIfPresent(
            label: profileLabel("root-ca"),
            keyClass: kSecAttrKeyClassPublic,
            keychain: systemKeychain
        ) == nil else {
            throw fail(
                "runtime-service-repair-required",
                "unprovision the invalid durable CA key before retrying",
                "The non-product CA private or standalone public key persisted in the System Keychain."
            )
        }
        for (role, _, _) in roleSpecifications {
            let classes = try keychainItemClasses(label: profileLabel(role), keychain: systemKeychain)
            guard classes.isEmpty else {
                throw fail(
                    "runtime-service-repair-required",
                    "unprovision the invalid System Keychain role identity before retrying",
                    "A local-development role identity escaped into System Keychain: \(role) (classes=\(classes.joined(separator: ",")))."
                )
            }
        }
        guard requirePrivateCustody else { return }
        try validateSigningProfileCleanupRecord(profile)

        let signingKeychain = try openSigningKeychain()
        _ = try secureMetadata(signingKeychainPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
        guard !((try keychainItemClasses(
            label: profileLabel("root-ca"),
            keychain: signingKeychain
        )).contains("key")) else {
            throw fail(
                "runtime-service-repair-required",
                "unprovision the invalid durable CA key before retrying",
                "The non-product CA key escaped into the persistent signing Keychain."
            )
        }
        try requireSigningKeychainLocked(signingKeychain)
        guard try signingKeychainPasswordExists() else {
            throw fail("runtime-service-repair-required", "reprovision the development signing profile", "The signing Keychain unlock secret is absent.")
        }
        try validateSigningKeychainPasswordAccess(
            partition: helperPartition,
            helperACLIdentitySHA256: profile.helperACLIdentitySHA256
        )
        try withCodeSigningCustody { _, _ in
            for (role, _, _) in roleSpecifications {
                guard let identity = profile.identities[role] else {
                    throw fail("runtime-service-repair-required", "reprovision the development signing profile", "A role identity is absent: \(role)")
                }
                let codeSigningRole = codeSigningRoles.contains(role)
                let publicKey = try loadPublicKey(label: profileLabel(role), keychain: signingKeychain)
                guard sha256(try subjectPublicKeyInfo(publicKey)) == identity.leafSPKISHA256 else {
                    throw fail("runtime-service-repair-required", "reprovision the development signing profile", "A role public key does not match its public signing profile: \(role)")
                }
                let certificate = try loadCertificate(
                    sha256: identity.certificateSHA256,
                    keychain: signingKeychain
                )
                let certificateData = SecCertificateCopyData(certificate) as Data
                guard Insecure.SHA1.hash(data: certificateData).hex == identity.certificateSHA1,
                      SHA256.hash(data: certificateData).hex == identity.certificateSHA256 else {
                    throw fail("runtime-service-repair-required", "reprovision the development signing profile", "A role certificate does not match its public signing profile: \(role)")
                }
                let privateKey = try loadPrivateKey(label: profileLabel(role), keychain: signingKeychain)
                try validateKeychainAccessIdentityDigests(
                    unsafeBitCast(privateKey, to: SecKeychainItem.self),
                    restrictedAuthorization: kSecACLAuthorizationSign,
                    restrictedApplicationDigests: [
                        codeSigningRole
                            ? profile.codesignACLIdentitySHA256
                            : profile.helperACLIdentitySHA256,
                    ],
                    ownerApplicationDigests: [profile.helperACLIdentitySHA256],
                    partitions: codeSigningRole ? ["apple:", helperPartition] : [helperPartition],
                    label: "\(role) private key"
                )
            }
            let recordPublicKey = try loadPublicKey(label: profileLabel("record_signer"), keychain: signingKeychain)
            let recordSPKI = try subjectPublicKeyInfo(recordPublicKey)
            guard recordSPKI.base64URLEncodedString() == profile.rootPublicKeyB64URL else {
                throw fail("runtime-service-repair-required", "reprovision the development signing profile", "The release-record verification key does not match its public signing profile.")
            }
            let probe = Data("nimi-macos-development-record-signer-self-test-v1".utf8)
            let signature = try signReleaseRecordWithUnlockedCustody(probe, profile: profile)
            var exportError: Unmanaged<CFError>?
            guard let recordX963 = SecKeyCopyExternalRepresentation(recordPublicKey, &exportError) as Data? else {
                throw securityError("read release-record verification key", exportError)
            }
            let publicKey = try P256.Signing.PublicKey(x963Representation: recordX963)
            let parsedSignature = try P256.Signing.ECDSASignature(derRepresentation: signature)
            guard publicKey.isValidSignature(parsedSignature, for: probe) else {
                throw fail("runtime-service-repair-required", "reprovision the development signing profile", "The release-record signer failed its custody self-test.")
            }
        }
        try requireSigningKeychainLocked(signingKeychain)
    }

    private func requireSigningKeychainLocked(_ keychain: SecKeychain) throws {
        var keychainStatus: SecKeychainStatus = 0
        let status = SecKeychainGetStatus(keychain, &keychainStatus)
        guard status == errSecSuccess,
              keychainStatus & SecKeychainStatus(kSecUnlockStateStatus) == 0 else {
            throw fail(
                "runtime-service-repair-required",
                "lock the development signing Keychain",
                "The signing Keychain is unexpectedly unlocked outside a root transaction."
            )
        }
    }

    private func requireSigningKeychainUnlocked(_ keychain: SecKeychain) throws {
        var keychainStatus: SecKeychainStatus = 0
        let status = SecKeychainGetStatus(keychain, &keychainStatus)
        guard status == errSecSuccess,
              keychainStatus & SecKeychainStatus(kSecUnlockStateStatus) != 0 else {
            throw fail(
                "runtime-service-repair-required",
                "run release-record signing only inside the root-owned unlocked custody transaction",
                "The signing Keychain is locked during a release-record signing operation."
            )
        }
    }


    private func trustRootForCodeSigning(_ certificate: SecCertificate) throws {
        guard let policy = SecPolicyCreateWithProperties(kSecPolicyAppleCodeSigning, nil) else {
            throw fail("runtime-service-repair-required", "inspect local CA trust policy construction", "Cannot create the code-signing trust policy.")
        }
        let settings: [[String: Any]] = [[
            kSecTrustSettingsPolicy: policy,
            kSecTrustSettingsResult: NSNumber(value: SecTrustSettingsResult.trustRoot.rawValue),
        ]]
        let status = SecTrustSettingsSetTrustSettings(certificate, .admin, settings as CFArray)
        guard status == errSecSuccess else { throw securityFailure("install local CA code-signing trust settings", status) }
        try validateRootCodeSigningTrust(certificate)
    }

    private func validateRootCodeSigningTrust(_ certificate: SecCertificate) throws {
        var settings: CFArray?
        let status = SecTrustSettingsCopyTrustSettings(certificate, .admin, &settings)
        guard status == errSecSuccess, let settings else {
            throw securityFailure(
                "read exact local CA code-signing trust settings",
                status == errSecSuccess ? errSecDecode : status
            )
        }
        if let mismatch = exactAppleCodeSigningTrustSettingsMismatch(settings) {
            throw fail(
                "runtime-service-repair-required",
                "reprovision the local development trust profile",
                "The local CA admin trust is not constrained to one exact Apple code-signing policy (\(mismatch))."
            )
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
