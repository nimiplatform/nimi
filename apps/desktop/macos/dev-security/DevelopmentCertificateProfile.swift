import CryptoKit
import Foundation
import Security

func readInstalledSigningProfile() throws -> DevelopmentSigningProfile {
    _ = try secureMetadata(signingProfilePath, type: S_IFREG, uid: 0, gid: 0, mode: 0o644, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: signingProfilePath), options: [.mappedIfSafe])
    guard data.count > 0, data.count <= 64 * 1024 else {
        throw fail("runtime-service-repair-required", "reprovision the local development trust profile", "The installed signing profile has an invalid size.")
    }
    let profile = try JSONDecoder().decode(DevelopmentSigningProfile.self, from: data)
    guard profile.schemaVersion == "nimi.macos-local-development-signing-profile/v4",
          profile.profileId == "macos_local_development_v1",
          profile.environment == "local_development",
          profile.identityClass == "local_ca",
          profile.signatureAlgorithm == "ecdsa_p256_sha256",
          profile.aclIdentityDigestAlgorithm == "sha256_opaque_sectrustedapplication_data",
          profile.helperACLIdentitySHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          profile.codesignACLIdentitySHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          profile.helperACLIdentitySHA256 != profile.codesignACLIdentitySHA256,
          profile.rootPrivateKeyPersistence == "non_durable_destroyed_after_leaf_issuance",
          profile.rolePrivateKeyCustody == "all_five_roles_root_owned_locked_system_domain_signing_keychain",
          profile.systemKeychainPrivateKeyPolicy == "forbidden_zero_profile_private_keys",
          profile.systemUnlockSecretMutationPolicy == "born_final_exact_final_helper_decrypt_delete_changeACL_partition_no_post_insert_mutation",
          profile.rootKeyId.range(of: #"^[a-z0-9][a-z0-9._-]{7,127}$"#, options: .regularExpression) != nil,
          Data(base64URLEncoded: profile.rootPublicKeyB64URL) != nil,
          Set(profile.identities.keys) == Set(roleSpecifications.map({ $0.0 })) else {
        throw fail("runtime-service-repair-required", "reprovision the local development trust profile", "The installed signing profile does not match its admitted schema.")
    }
    return profile
}

func writeSigningProfile(_ profile: DevelopmentSigningProfile) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(profile)
    data.append(0x0a)
    try writeAtomicRootFile(data, to: signingProfilePath, mode: 0o644)
}

func createCertificate(
    subjectCommonName: String,
    subjectPublicKey: SecKey,
    issuer: Issuer,
    notBefore: Date,
    notAfter: Date,
    isCA: Bool
) throws -> Data {
    var serial = Data(count: 16)
    let randomStatus = serial.withUnsafeMutableBytes { bytes in
        SecRandomCopyBytes(kSecRandomDefault, bytes.count, bytes.baseAddress!)
    }
    guard randomStatus == errSecSuccess else { throw securityFailure("generate certificate serial", randomStatus) }
    serial[0] &= 0x7f
    if serial.allSatisfy({ $0 == 0 }) { serial[serial.startIndex] = 1 }

    let algorithm = DER.sequence([DER.objectIdentifier([1, 2, 840, 10045, 4, 3, 2])])
    let tbs = DER.sequence([
        DER.explicit(0, DER.integer(2)),
        DER.integer(serial),
        algorithm,
        distinguishedName(issuer.commonName),
        DER.sequence([DER.utcTime(notBefore), DER.utcTime(notAfter)]),
        distinguishedName(subjectCommonName),
        try subjectPublicKeyInfo(subjectPublicKey),
        DER.explicit(3, DER.sequence(isCA ? caExtensions() : codeSigningExtensions())),
    ])
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
        issuer.privateKey,
        .ecdsaSignatureMessageX962SHA256,
        tbs as CFData,
        &error
    ) as Data? else {
        throw securityError("sign development certificate", error)
    }
    return DER.sequence([tbs, algorithm, DER.bitString(signature)])
}

func subjectPublicKeyInfo(_ key: SecKey) throws -> Data {
    var error: Unmanaged<CFError>?
    guard let external = SecKeyCopyExternalRepresentation(key, &error) as Data? else {
        throw securityError("export public key", error)
    }
    guard external.count == 65, external.first == 0x04 else {
        throw fail("runtime-service-repair-required", "reprovision P-256 identities", "Generated public key is not an uncompressed P-256 point.")
    }
    return DER.sequence([
        DER.sequence([
            DER.objectIdentifier([1, 2, 840, 10045, 2, 1]),
            DER.objectIdentifier([1, 2, 840, 10045, 3, 1, 7]),
        ]),
        DER.bitString(external),
    ])
}

func trustedApplication(_ path: String) throws -> SecTrustedApplication {
    var application: SecTrustedApplication?
    let status = SecTrustedApplicationCreateFromPath(path, &application)
    guard status == errSecSuccess, let application else { throw securityFailure("bind Keychain ACL trusted application", status) }
    return application
}

func trustedApplicationData(_ application: SecTrustedApplication) throws -> Data {
    var value: CFData?
    let status = SecTrustedApplicationCopyData(application, &value)
    guard status == errSecSuccess, let value else {
        throw securityFailure("inspect Keychain trusted-application identity", status)
    }
    return value as Data
}

func signInstalledHelper(identitySHA1: String, keychainPath: String, homeDirectory: String) throws {
    _ = try runFixedCommand("/usr/bin/codesign", [
        "--force", "--sign", identitySHA1,
        "--keychain", keychainPath,
        "--identifier", "ai.nimi.dev-security-helper",
        "--options", "runtime",
        "--timestamp=none",
        helperInstallPath,
    ], homeDirectory: homeDirectory)
}

func certificateAuthorityPathExists(_ path: String) -> Bool {
    var metadata = stat()
    return lstat(path, &metadata) == 0
}

func verifyInstalledHelper(expectedLeafSPKI: String) throws {
    // Security.framework is the in-process trust root for repair and profile
    // validation. `inspectSignedCode` performs strict, all-architecture static
    // validation before projecting the code identity. Independent codesign and
    // spctl evidence remains an install/acceptance gate, not a nested trust path.
    let identity = try inspectSignedCode(helperInstallPath)
    guard identity.identifier == "ai.nimi.dev-security-helper",
          identity.teamId.isEmpty,
          identity.leafSPKISHA256 == expectedLeafSPKI,
          identity.hardenedRuntime else {
        throw fail("runtime-service-untrusted", "reprovision the development security helper", "The installed helper does not match its local-CA code policy.")
    }
}

func verifyInstalledSigningProfileWithSignedHelper() throws {
    let result = try runFixedCommand(helperInstallPath, ["verify-signing-profile"])
    guard result.stdout.count > 0, result.stdout.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          value["status"] as? String == "verified",
          value["profileId"] as? String == "macos_local_development_v1",
          value["signingCustodyVerification"] as? String == "verified",
          value["productAdmission"] as? Bool == false else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the signed helper Keychain custody validation",
            "The signed helper returned an invalid private-custody verification projection."
        )
    }
}

func finalizeInstalledSigningCustodyWithSignedHelper() throws {
    let result = try runFixedCommand(helperInstallPath, ["finalize-signing-custody"])
    guard result.stdout.count > 0, result.stdout.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          value["status"] as? String == "custody-finalized",
          value["profileId"] as? String == "macos_local_development_v1",
          value["signingCustodyVerification"] as? String == "final_helper_only",
          value["transitionalACLs"] as? Int == 0,
          value["productAdmission"] as? Bool == false else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the signed helper custody-closure subprocess",
            "The signed helper returned an invalid final custody projection."
        )
    }
}

func profileLabel(_ suffix: String) -> String {
    "ai.nimi.macos-local-development.v1.\(suffix)"
}

func signingProfileRFC3339(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
}

func securityFailure(_ operation: String, _ status: OSStatus) -> DevSecurityFailure {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
    return fail("runtime-service-repair-required", "inspect System Keychain and development signing profile", "\(operation) failed: \(message)")
}

func securityError(_ operation: String, _ error: Unmanaged<CFError>?) -> DevSecurityFailure {
    let message = error?.takeRetainedValue().localizedDescription ?? "unknown Security.framework error"
    return fail("runtime-service-repair-required", "inspect System Keychain and development signing profile", "\(operation) failed: \(message)")
}

private func distinguishedName(_ commonName: String) -> Data {
    DER.sequence([
        DER.set([
            DER.sequence([
                DER.objectIdentifier([2, 5, 4, 3]),
                DER.utf8String(commonName),
            ]),
        ]),
    ])
}

private func caExtensions() -> [Data] {
    [
        extensionValue([2, 5, 29, 19], critical: true, value: DER.sequence([DER.boolean(true)])),
        extensionValue([2, 5, 29, 15], critical: true, value: DER.bitString(Data([0x06]), unusedBits: 1)),
    ]
}

private func codeSigningExtensions() -> [Data] {
    [
        extensionValue([2, 5, 29, 19], critical: true, value: DER.sequence([])),
        extensionValue([2, 5, 29, 15], critical: true, value: DER.bitString(Data([0x80]), unusedBits: 7)),
        extensionValue(
            [2, 5, 29, 37],
            critical: false,
            value: DER.sequence([DER.objectIdentifier([1, 3, 6, 1, 5, 5, 7, 3, 3])])
        ),
    ]
}

private func extensionValue(_ oid: [UInt64], critical: Bool, value: Data) -> Data {
    var fields = [DER.objectIdentifier(oid)]
    if critical { fields.append(DER.boolean(true)) }
    fields.append(DER.octetString(value))
    return DER.sequence(fields)
}

private extension Data {
    init?(base64URLEncoded value: String) {
        guard value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return nil }
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        self.init(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + padding)
    }
}
