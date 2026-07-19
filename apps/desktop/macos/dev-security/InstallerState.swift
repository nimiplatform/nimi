import Darwin
import Foundation

private let installerLedgerPath = "\(runtimeDevRoot)/installer-ledger.json"

func nextInstallerGeneration() throws -> UInt64 {
    guard FileManager.default.fileExists(atPath: installerLedgerPath) else { return 1 }
    _ = try secureMetadata(installerLedgerPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    let value = try readInstallerLedger()
    guard value.generation < UInt64.max else {
        throw fail("runtime-service-repair-required", "reprovision the isolated development profile", "Installer generation is exhausted.")
    }
    return value.generation + 1
}

func stageInstallerGeneration(
    _ generation: UInt64,
    releaseId: String,
    runtimeSHA256: String,
    to stagedPath: String
) throws {
    let current = FileManager.default.fileExists(atPath: installerLedgerPath)
        ? try readInstallerLedger()
        : nil
    guard generation > 0,
          current == nil || generation == current!.generation + 1,
          stagedPath.hasPrefix("\(runtimeTransactionRoot)/"),
          (stagedPath as NSString).lastPathComponent == "installer-ledger.json",
          runtimeSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
        throw fail("runtime-service-repair-required", "inspect installer generation state", "Refusing a non-monotonic development installer generation.")
    }
    let value: [String: Any] = [
        "schemaVersion": "nimi.macos-local-development-installer-ledger/v1",
        "generation": generation,
        "releaseId": releaseId,
        "runtimeSHA256": runtimeSHA256,
        "committedAt": ISO8601DateFormatter().string(from: Date()),
    ]
    let encoded = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]) + Data([0x0a])
    try writeAtomicRootFile(encoded, to: stagedPath, mode: 0o600)
}

struct InstallerLedger {
    let generation: UInt64
    let releaseId: String
    let runtimeSHA256: String
}

func readInstallerLedger() throws -> InstallerLedger {
    _ = try secureMetadata(installerLedgerPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: installerLedgerPath))
    guard data.count > 0, data.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(value.keys) == Set(["schemaVersion", "generation", "releaseId", "runtimeSHA256", "committedAt"]),
          value["schemaVersion"] as? String == "nimi.macos-local-development-installer-ledger/v1",
          let generation = (value["generation"] as? NSNumber)?.uint64Value,
          generation > 0,
          let releaseId = value["releaseId"] as? String,
          validInstallerText(releaseId),
          let runtimeSHA256 = value["runtimeSHA256"] as? String,
          runtimeSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
          let committedAt = value["committedAt"] as? String,
          canonicalInstallerDate(committedAt) != nil else {
        throw fail("runtime-service-repair-required", "repair the root-owned installer ledger", "The local-development installer ledger is invalid.")
    }
    return InstallerLedger(generation: generation, releaseId: releaseId, runtimeSHA256: runtimeSHA256)
}

private func validInstallerText(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        && value.utf8.allSatisfy({ (0x21...0x7e).contains($0) && $0 != 0x2f && $0 != 0x5c })
}

private func canonicalInstallerDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
    return date
}
