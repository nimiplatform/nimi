import CryptoKit
import Darwin
import Foundation

struct InstalledDevelopmentReleaseSet {
    let generation: UInt64
    let releaseId: String
    let roleIdentities: [String: SignedCodeIdentity]
}

func verifyInstalledDevelopmentReleaseSet(
    profile: DevelopmentSigningProfile,
    ledger: InstallerLedger
) throws -> InstalledDevelopmentReleaseSet {
    let identities = try verifyInstalledDevelopmentCode(profile: profile)
    var releaseId: String?
    var generation: UInt64?
    for role in developmentReleaseRoles {
        guard let identity = identities[role.executableRole] else {
            throw installedRecordFailure("resolve installed role identity")
        }
        let record = try verifyInstalledDevelopmentReleaseRecord(
            path: "\(trustRecordRoot)/\(role.recordFilename)",
            role: role,
            identity: identity,
            profile: profile
        )
        if let releaseId {
            guard releaseId == record.releaseId else {
                throw installedRecordFailure("bind all installed roles to one release")
            }
        } else {
            releaseId = record.releaseId
        }
        if let generation {
            guard generation == record.generation else {
                throw installedRecordFailure("bind all installed roles to one generation")
            }
        } else {
            generation = record.generation
        }
    }
    let runtimeSHA256 = try sha256File(runtimeExecutablePath)
    guard let releaseId, let generation,
          ledger.releaseId == releaseId,
          ledger.generation == generation,
          ledger.runtimeSHA256 == runtimeSHA256 else {
        throw installedRecordFailure("bind release records to the committed installer ledger")
    }
    return InstalledDevelopmentReleaseSet(
        generation: generation,
        releaseId: releaseId,
        roleIdentities: identities
    )
}

private struct VerifiedInstalledRecord {
    let releaseId: String
    let generation: UInt64
}

private func verifyInstalledDevelopmentCode(
    profile: DevelopmentSigningProfile
) throws -> [String: SignedCodeIdentity] {
    _ = try secureMetadata(trustRecordRoot, type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
    var result = [String: SignedCodeIdentity]()
    for role in developmentReleaseRoles {
        try verifyCanonicalRootOwnedExecutable(role.executablePath)
        guard let expected = profile.identities[role.identityRole] else {
            throw installedRecordFailure("resolve the fixed role signing profile")
        }
        let identity = try inspectSignedCode(role.executablePath)
        guard identity.identifier == role.signingIdentifier,
              identity.teamId.isEmpty,
              identity.leafSPKISHA256 == expected.leafSPKISHA256,
              identity.hardenedRuntime else {
            throw fail(
                "runtime-service-untrusted",
                "reinstall the exact signed macOS local-development candidate",
                "Installed role \(role.executableRole) does not match its local-CA code policy."
            )
        }
        result[role.executableRole] = identity
    }
    let desktopBundleIdentity = try inspectSignedCode(desktopApplicationPath, checkNested: true)
    guard let desktopIdentity = result["nimi_desktop"],
          sameCodeIdentity(desktopBundleIdentity, desktopIdentity) else {
        throw fail("runtime-service-untrusted", "reinstall the exact signed Desktop bundle", "The Desktop bundle and main executable identities differ.")
    }
    let hostBundle = (generatedLocalAppHostPath as NSString).deletingLastPathComponent
        .splitDeletingLastPathComponents(2)
    let hostBundleIdentity = try inspectSignedCode(hostBundle, checkNested: true)
    guard let hostIdentity = result["nimi_local_app_host"],
          sameCodeIdentity(hostBundleIdentity, hostIdentity) else {
        throw fail("runtime-service-untrusted", "reinstall the exact signed local-app Host bundle", "The local-app Host bundle and executable identities differ.")
    }
    return result
}

private func verifyInstalledDevelopmentReleaseRecord(
    path: String,
    role: DevelopmentReleaseRole,
    identity: SignedCodeIdentity,
    profile: DevelopmentSigningProfile
) throws -> VerifiedInstalledRecord {
    _ = try secureMetadata(path, type: S_IFREG, uid: 0, gid: 0, mode: 0o644, links: 1)
    let encoded = try Data(contentsOf: URL(fileURLWithPath: path), options: [.mappedIfSafe])
    guard !encoded.isEmpty, encoded.count <= 64 * 1024,
          let object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any],
          Set(object.keys) == installedReleaseRecordFields,
          try CanonicalValue.object(try canonicalObject(object)).encode() == encoded else {
        throw installedRecordFailure("read one exact canonical installed release record")
    }
    guard requiredUnsigned(object, "schema_version") == 2,
          requiredString(object, "environment") == "local_development",
          requiredString(object, "identity_class") == "local_ca",
          requiredString(object, "signature_algorithm") == "ecdsa_p256_sha256",
          requiredString(object, "executable_role") == role.executableRole,
          requiredString(object, "trust_set_id") == role.trustSetId,
          requiredString(object, "os_profile") == "macos",
          requiredString(object, "protected_local_protocol_version") == "1",
          requiredString(object, "signer_policy_id") == generatedSignerPolicyID,
          requiredString(object, "root_key_id") == profile.rootKeyId,
          requiredString(object, "os_service_principal") == role.servicePrincipal,
          requiredString(object, "windows_leaf_spki_sha256") == "",
          requiredString(object, "windows_chain_policy_ref") == "",
          requiredString(object, "linux_manifest_key_id") == "",
          requiredString(object, "macos_team_id") == "",
          requiredBoolean(object, "macos_hardened_runtime_required") == true,
          requiredBoolean(object, "macos_notarization_required") == false else {
        throw installedRecordFailure("match the fixed local-development record policy")
    }
    let releaseId = try requiredStringValue(object, "release_id")
    let buildId = try requiredStringValue(object, "build_id")
    let artifactSHA256 = try requiredStringValue(object, "artifact_sha256")
    let leafSPKI = try requiredStringValue(object, "macos_leaf_spki_sha256")
    let cdhash = try requiredStringValue(object, "macos_cdhash")
    let designatedRequirement = try requiredStringValue(object, "macos_designated_requirement")
    let signatureText = try requiredStringValue(object, "signature")
    let generation = try requiredUnsignedValue(object, "generation")
    let peers = try requiredStringArray(object, "compatible_peer_release_ids")
    let installedArtifactSHA256 = try sha256File(role.executablePath)
    guard validReleaseText(releaseId), validReleaseText(buildId), generation > 0,
          peers == peers.sorted(), Set(peers).count == peers.count,
          (1...16).contains(peers.count), peers == [releaseId],
          validLowerHex(artifactSHA256, count: 64),
          artifactSHA256 == installedArtifactSHA256,
          validLowerHex(leafSPKI, count: 64), leafSPKI == identity.leafSPKISHA256,
          validCDHash(cdhash), cdhash == identity.cdhash,
          validDesignatedRequirement(designatedRequirement),
          designatedRequirement == identity.designatedRequirement,
          validRecordInterval(
              validFrom: try requiredStringValue(object, "valid_from"),
              expiresAt: try requiredStringValue(object, "expires_at")
          ),
          let signature = Data(base64URLNoPadding: signatureText) else {
        throw installedRecordFailure("bind release fields to the installed signed artifact")
    }
    var payloadObject = object
    payloadObject.removeValue(forKey: "signature")
    let payload = try CanonicalValue.object(try canonicalObject(payloadObject)).encode()
    guard let rootDER = Data(base64URLNoPadding: profile.rootPublicKeyB64URL),
          let rootKey = try? P256.Signing.PublicKey(derRepresentation: rootDER),
          let parsedSignature = try? P256.Signing.ECDSASignature(derRepresentation: signature),
          rootKey.isValidSignature(parsedSignature, for: payload) else {
        throw fail("runtime-service-untrusted", "reprovision trust and reinstall the candidate", "An installed release record signature is invalid.")
    }
    return VerifiedInstalledRecord(releaseId: releaseId, generation: generation)
}

private let installedReleaseRecordFields = Set([
    "schema_version", "environment", "identity_class", "signature_algorithm",
    "executable_role", "trust_set_id", "os_profile", "protected_local_protocol_version",
    "compatible_peer_release_ids", "release_id", "build_id", "artifact_sha256",
    "signer_policy_id", "windows_leaf_spki_sha256", "windows_chain_policy_ref",
    "macos_designated_requirement", "macos_team_id", "macos_leaf_spki_sha256",
    "macos_cdhash", "macos_hardened_runtime_required", "macos_notarization_required",
    "linux_manifest_key_id", "os_service_principal", "valid_from", "expires_at",
    "generation", "root_key_id", "signature",
])

private func canonicalObject(_ object: [String: Any]) throws -> [String: CanonicalValue] {
    try object.mapValues(canonicalJSONValue)
}

private func canonicalJSONValue(_ value: Any) throws -> CanonicalValue {
    if let value = value as? String { return .string(value) }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return .boolean(number.boolValue) }
        guard !CFNumberIsFloatType(number), let unsigned = UInt64(number.stringValue) else {
            throw installedRecordFailure("canonicalize an unsigned JSON number")
        }
        return .unsigned(unsigned)
    }
    if let value = value as? [Any] { return .array(try value.map(canonicalJSONValue)) }
    if let value = value as? [String: Any] { return .object(try canonicalObject(value)) }
    throw installedRecordFailure("canonicalize an admitted JSON type")
}

private func requiredString(_ object: [String: Any], _ key: String) -> String? {
    object[key] as? String
}

private func requiredStringValue(_ object: [String: Any], _ key: String) throws -> String {
    guard let value = requiredString(object, key) else { throw installedRecordFailure("read string field \(key)") }
    return value
}

private func requiredBoolean(_ object: [String: Any], _ key: String) -> Bool? {
    guard let value = object[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
    return value.boolValue
}

private func requiredUnsigned(_ object: [String: Any], _ key: String) -> UInt64? {
    guard let value = object[key] as? NSNumber,
          CFGetTypeID(value) != CFBooleanGetTypeID(),
          !CFNumberIsFloatType(value) else { return nil }
    return UInt64(value.stringValue)
}

private func requiredUnsignedValue(_ object: [String: Any], _ key: String) throws -> UInt64 {
    guard let value = requiredUnsigned(object, key) else { throw installedRecordFailure("read unsigned field \(key)") }
    return value
}

private func requiredStringArray(_ object: [String: Any], _ key: String) throws -> [String] {
    guard let values = object[key] as? [Any], values.allSatisfy({ $0 is String }) else {
        throw installedRecordFailure("read string-array field \(key)")
    }
    return values.map({ $0 as! String })
}

private func validReleaseText(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        && value.utf8.allSatisfy({ (0x21...0x7e).contains($0) && $0 != 0x2f && $0 != 0x5c })
}

private func validLowerHex(_ value: String, count: Int) -> Bool {
    value.utf8.count == count && value.utf8.allSatisfy({ (0x30...0x39).contains($0) || (0x61...0x66).contains($0) })
}

private func validCDHash(_ value: String) -> Bool {
    (value.utf8.count == 40 || value.utf8.count == 64) && validLowerHex(value, count: value.utf8.count)
}

private func validDesignatedRequirement(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 2048 && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        && value.utf8.allSatisfy({ $0 == 0x20 || (0x21...0x7e).contains($0) })
}

private func validRecordInterval(validFrom: String, expiresAt: String) -> Bool {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    guard let start = formatter.date(from: validFrom), formatter.string(from: start) == validFrom,
          let end = formatter.date(from: expiresAt), formatter.string(from: end) == expiresAt else { return false }
    let now = Date()
    return start < end && now >= start && now < end
}

private func verifyCanonicalRootOwnedExecutable(_ path: String) throws {
    var metadata = stat()
    guard lstat(path, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == 0,
          metadata.st_gid == 0,
          metadata.st_nlink == 1,
          metadata.st_mode & 0o022 == 0,
          let resolved = realpath(path, nil) else {
        throw fail("runtime-service-untrusted", "reinstall the fixed signed candidate", "An installed executable has unsafe metadata: \(path)")
    }
    defer { free(resolved) }
    guard String(cString: resolved) == path else {
        throw fail("runtime-service-untrusted", "reinstall the fixed signed candidate", "An installed executable path is not canonical: \(path)")
    }
}

private func sameCodeIdentity(_ left: SignedCodeIdentity, _ right: SignedCodeIdentity) -> Bool {
    left.identifier == right.identifier && left.teamId == right.teamId && left.cdhash == right.cdhash
        && left.designatedRequirement == right.designatedRequirement
        && left.leafSPKISHA256 == right.leafSPKISHA256
        && left.hardenedRuntime == right.hardenedRuntime
}

private func installedRecordFailure(_ operation: String) -> DevSecurityFailure {
    fail(
        "runtime-service-untrusted",
        "reinstall the exact signed macOS local-development candidate",
        "Failed to \(operation)."
    )
}

private extension NSString {
    func splitDeletingLastPathComponents(_ count: Int) -> String {
        var value = self as String
        for _ in 0..<count { value = (value as NSString).deletingLastPathComponent }
        return value
    }
}

private extension Data {
    init?(base64URLNoPadding value: String) {
        guard !value.isEmpty,
              value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil,
              value.count % 4 != 1 else { return nil }
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        self.init(base64Encoded: value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding)
    }
}
