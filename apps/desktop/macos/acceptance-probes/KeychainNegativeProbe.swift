import Foundation
import Security

struct ProbeResult: Codable {
    let schemaVersion: String
    let results: [ItemResult]
    let passed: Bool
}

struct ItemResult: Codable {
    let service: String
    let account: String
    let status: Int32
    let secretReturned: Bool
}

let targets = [
    ("ai.nimi.runtime.local-development.signing-keychain-password.v1", "macos_local_development_v1"),
    ("ai.nimi.runtime.protected-local.dev.v1", "ledger-anchor-v1"),
    ("ai.nimi.runtime.protected-local.dev.v1", "ledger-record-hmac-v1"),
]

let results = targets.map { service, account -> ItemResult in
    var output: CFTypeRef?
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecMatchLimit: kSecMatchLimitOne,
        kSecReturnData: true,
        kSecUseAuthenticationUI: kSecUseAuthenticationUIFail,
    ]
    let status = SecItemCopyMatching(query as CFDictionary, &output)
    let secretReturned = status == errSecSuccess || output != nil
    output = nil
    return ItemResult(service: service, account: account, status: status, secretReturned: secretReturned)
}

let report = ProbeResult(
    schemaVersion: "nimi.macos-keychain-negative-probe/v1",
    results: results,
    passed: results.allSatisfy { !$0.secretReturned }
)
let data = try JSONEncoder().encode(report)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data([0x0a]))
exit(report.passed ? 0 : 77)
