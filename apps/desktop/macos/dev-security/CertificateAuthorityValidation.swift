import CryptoKit
import Foundation
import Security

extension DevelopmentCertificateAuthority {
    func validateProvisionedProfile(
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

    func requireSigningKeychainLocked(_ keychain: SecKeychain) throws {
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

    func requireSigningKeychainUnlocked(_ keychain: SecKeychain) throws {
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


    func trustRootForCodeSigning(_ certificate: SecCertificate) throws {
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

    func validateRootCodeSigningTrust(_ certificate: SecCertificate) throws {
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
