import Foundation

enum CanonicalValue {
    case string(String)
    case unsigned(UInt64)
    case boolean(Bool)
    case array([CanonicalValue])
    case object([String: CanonicalValue])

    func encode() throws -> Data {
        switch self {
        case .string(let value):
            let wrapped = try JSONSerialization.data(withJSONObject: [value], options: [.withoutEscapingSlashes])
            guard wrapped.count >= 2 else { throw recordFailure("encode canonical JSON string") }
            return wrapped.dropFirst().dropLast()
        case .unsigned(let value):
            return Data(String(value).utf8)
        case .boolean(let value):
            return Data((value ? "true" : "false").utf8)
        case .array(let values):
            var result = Data([0x5b])
            for (index, value) in values.enumerated() {
                if index > 0 { result.append(0x2c) }
                result.append(try value.encode())
            }
            result.append(0x5d)
            return result
        case .object(let values):
            var result = Data([0x7b])
            for (index, key) in values.keys.sorted().enumerated() {
                if index > 0 { result.append(0x2c) }
                result.append(try CanonicalValue.string(key).encode())
                result.append(0x3a)
                guard let value = values[key] else { throw recordFailure("resolve canonical JSON field") }
                result.append(try value.encode())
            }
            result.append(0x7d)
            return result
        }
    }
}

struct DevelopmentReleaseRole {
    let executableRole: String
    let trustSetId: String
    let signingIdentifier: String
    let servicePrincipal: String
    let recordFilename: String
    let executablePath: String
    let identityRole: String
}

let developmentReleaseRoles = [
    DevelopmentReleaseRole(
        executableRole: "nimi_runtime_service",
        trustSetId: generatedRuntimeTrustSetID,
        signingIdentifier: generatedRuntimeSigningIdentifier,
        servicePrincipal: "_nimiruntimedev",
        recordFilename: "nimi_runtime_service.release-trust-record.json",
        executablePath: runtimeExecutablePath,
        identityRole: "runtime"
    ),
    DevelopmentReleaseRole(
        executableRole: "nimi_desktop",
        trustSetId: generatedDesktopTrustSetID,
        signingIdentifier: generatedDesktopSigningIdentifier,
        servicePrincipal: "active_console_user",
        recordFilename: "nimi_desktop.release-trust-record.json",
        executablePath: generatedDesktopExecutablePath,
        identityRole: "desktop"
    ),
    DevelopmentReleaseRole(
        executableRole: "nimi_local_app_host",
        trustSetId: generatedLocalAppHostTrustSetID,
        signingIdentifier: generatedLocalAppHostSigningIdentifier,
        servicePrincipal: "verified_desktop_supervised_active_console_user",
        recordFilename: "nimi_local_app_host.release-trust-record.json",
        executablePath: generatedLocalAppHostPath,
        identityRole: "local_app_host"
    ),
]

func createDevelopmentReleaseRecords(
    profile: DevelopmentSigningProfile,
    generation: UInt64,
    buildId: String,
    releaseId: String,
    rolePaths: [String: String]
) throws -> [String: Data] {
    guard generation > 0,
          validRecordText(buildId),
          validRecordText(releaseId) else {
        throw recordFailure("validate development release identity")
    }
    let now = Date()
    guard let expiry = Calendar(identifier: .gregorian).date(byAdding: .day, value: 30, to: now) else {
        throw recordFailure("construct development release expiry")
    }
    let validFrom = rfc3339(now.addingTimeInterval(-60))
    let expiresAt = rfc3339(expiry)
    var result = [String: Data]()
    let signer = try DevelopmentCertificateAuthority()
    for role in developmentReleaseRoles {
        guard let expectedIdentity = profile.identities[role.identityRole] else {
            throw recordFailure("resolve development role signing identity")
        }
        guard let executablePath = rolePaths[role.executableRole] else {
            throw recordFailure("resolve staged development role path")
        }
        let identity = try inspectSignedCode(executablePath)
        guard identity.identifier == role.signingIdentifier,
              identity.teamId.isEmpty,
              identity.leafSPKISHA256 == expectedIdentity.leafSPKISHA256,
              identity.hardenedRuntime else {
            throw fail("runtime-service-untrusted", "rebuild and reinstall the exact local-CA candidate", "Installed role \(role.executableRole) does not match its fixed local-development code policy.")
        }
        var fields: [String: CanonicalValue] = [
            "schema_version": .unsigned(2),
            "environment": .string("local_development"),
            "identity_class": .string("local_ca"),
            "signature_algorithm": .string("ecdsa_p256_sha256"),
            "executable_role": .string(role.executableRole),
            "trust_set_id": .string(role.trustSetId),
            "os_profile": .string("macos"),
            "protected_local_protocol_version": .string("1"),
            "compatible_peer_release_ids": .array([.string(releaseId)]),
            "release_id": .string(releaseId),
            "build_id": .string(buildId),
            "artifact_sha256": .string(try sha256File(executablePath)),
            "signer_policy_id": .string(generatedSignerPolicyID),
            "windows_leaf_spki_sha256": .string(""),
            "windows_chain_policy_ref": .string(""),
            "macos_designated_requirement": .string(identity.designatedRequirement),
            "macos_team_id": .string(""),
            "macos_leaf_spki_sha256": .string(identity.leafSPKISHA256),
            "macos_cdhash": .string(identity.cdhash),
            "macos_hardened_runtime_required": .boolean(true),
            "macos_notarization_required": .boolean(false),
            "linux_manifest_key_id": .string(""),
            "os_service_principal": .string(role.servicePrincipal),
            "valid_from": .string(validFrom),
            "expires_at": .string(expiresAt),
            "generation": .unsigned(generation),
            "root_key_id": .string(profile.rootKeyId),
        ]
        let payload = try CanonicalValue.object(fields).encode()
        let signature = try signer.signReleaseRecord(payload, keyId: profile.rootKeyId)
        fields["signature"] = .string(signature.base64URLEncodedString())
        result[role.recordFilename] = try CanonicalValue.object(fields).encode()
    }
    return result
}

private func validRecordText(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && !value.contains("\0") && !value.contains("\n") && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func recordFailure(_ operation: String) -> DevSecurityFailure {
    fail("runtime-service-repair-required", "inspect local-development release record construction", "Failed to \(operation).")
}

private func rfc3339(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
