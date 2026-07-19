import Foundation

private struct SigningProfileCleanupRecord: Codable {
    let schemaVersion: String
    let profileId: String
    var systemCertificateSHA256: [String: String]
}

private let cleanupCertificateRoles = Set(["root-ca"])

func recordSystemCertificateForCleanup(role: String, sha256: String) throws {
    guard cleanupCertificateRoles.contains(role), isCertificateSHA256(sha256) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the development signing cleanup record input",
            "Refusing an invalid cleanup-record certificate role or fingerprint."
        )
    }
    var record = try readSigningProfileCleanupRecordIfPresent() ?? SigningProfileCleanupRecord(
        schemaVersion: "nimi.macos-local-development-signing-cleanup/v2",
        profileId: "macos_local_development_v1",
        systemCertificateSHA256: [:]
    )
    if let existing = record.systemCertificateSHA256[role], existing != sha256 {
        throw fail(
            "runtime-service-repair-required",
            "inspect the conflicting development signing cleanup record",
            "The cleanup record already binds \(role) to a different certificate fingerprint."
        )
    }
    record.systemCertificateSHA256[role] = sha256
    try writeSigningProfileCleanupRecord(record)
}

func signingProfileCleanupFingerprints() throws -> [String: String] {
    try readSigningProfileCleanupRecordIfPresent()?.systemCertificateSHA256 ?? [:]
}

func validateSigningProfileCleanupRecord(_ profile: DevelopmentSigningProfile) throws {
    guard let record = try readSigningProfileCleanupRecordIfPresent(),
          record.systemCertificateSHA256["root-ca"] == profile.rootCertificateSHA256,
          Set(record.systemCertificateSHA256.keys) == cleanupCertificateRoles else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The exact signing cleanup record is absent or does not match the public profile."
        )
    }
}

func removeSigningProfileCleanupRecordIfPresent() throws {
    var metadata = stat()
    if lstat(signingCleanupRecordPath, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect signing cleanup record", signingCleanupRecordPath)
    }
    _ = try secureMetadata(signingCleanupRecordPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    guard unlink(signingCleanupRecordPath) == 0 else {
        throw posixFailure("remove signing cleanup record", signingCleanupRecordPath)
    }
    try syncDirectory(runtimeDevRoot)
}

private func readSigningProfileCleanupRecordIfPresent() throws -> SigningProfileCleanupRecord? {
    var metadata = stat()
    if lstat(signingCleanupRecordPath, &metadata) != 0 {
        if errno == ENOENT { return nil }
        throw posixFailure("inspect signing cleanup record", signingCleanupRecordPath)
    }
    _ = try secureMetadata(signingCleanupRecordPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: signingCleanupRecordPath), options: [.mappedIfSafe])
    guard data.count > 0, data.count <= 16 * 1024 else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the development signing cleanup record",
            "The signing cleanup record has an invalid size."
        )
    }
    let record = try JSONDecoder().decode(SigningProfileCleanupRecord.self, from: data)
    try validateSigningProfileCleanupRecordShape(record)
    return record
}

private func writeSigningProfileCleanupRecord(_ record: SigningProfileCleanupRecord) throws {
    try validateSigningProfileCleanupRecordShape(record)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(record)
    data.append(0x0a)
    try writeAtomicRootFile(data, to: signingCleanupRecordPath, mode: 0o600)
}

private func validateSigningProfileCleanupRecordShape(_ record: SigningProfileCleanupRecord) throws {
    guard record.schemaVersion == "nimi.macos-local-development-signing-cleanup/v2",
          record.profileId == "macos_local_development_v1",
          Set(record.systemCertificateSHA256.keys).isSubset(of: cleanupCertificateRoles),
          !record.systemCertificateSHA256.isEmpty,
          record.systemCertificateSHA256.values.allSatisfy(isCertificateSHA256) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the development signing cleanup record",
            "The signing cleanup record does not match its fixed schema."
        )
    }
}

private func isCertificateSHA256(_ value: String) -> Bool {
    value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
}
