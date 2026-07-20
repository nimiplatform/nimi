import CryptoKit
import Darwin
import Foundation
import Security

private let profileSchema = "nimi.macos-local-development-signing-profile/fresh-carrier-4/v1"
private let profileID = "macos_local_development_v1"
private let keyLabelPrefix = "ai.nimi.macos-local-development.carrier4."
private let unlockService = "ai.nimi.macos-local-development.signing-keychain.carrier4"
private let unlockAccount = "unlock-v1"

private struct RoleSpec {
    let role: String
    let commonName: String
    let identifier: String
}

private let roles = [
    RoleSpec(role: "runtime", commonName: "Nimi Runtime Dev Carrier 4", identifier: "ai.nimi.runtime.dev"),
    RoleSpec(role: "desktop", commonName: "Nimi Desktop Dev Carrier 4", identifier: "ai.nimi.apps.nimi.desktop.dev"),
    RoleSpec(role: "local_app_host", commonName: "Nimi Local App Host Dev Carrier 4", identifier: "ai.nimi.apps.nimi.local-app-host.dev"),
    RoleSpec(role: "installer", commonName: "Nimi Dev Installer Carrier 4", identifier: "ai.nimi.dev-installer"),
    RoleSpec(role: "release_record", commonName: "Nimi Dev Release Record Carrier 4", identifier: "ai.nimi.dev-release-record"),
]

struct ToolFailure: Error {
    let reasonCode: String
    let actionHint: String
    let message: String
}

private struct KeyPair { let publicKey: SecKey; let privateKey: SecKey }
struct Issuer { let commonName: String; let privateKey: SecKey }

@main
private struct NimiMacOSDevSigningTool {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else { throw fail("dev-signing-argument-invalid", "use_an_exact_documented_command", "A signing command is required.") }
            switch command {
            case "provision":
                guard arguments.count == 3 else { throw argumentFailure() }
                try emit(try provision(keychainPath: arguments[1], profilePath: arguments[2]))
            case "unlock":
                guard arguments.count == 2 else { throw argumentFailure() }
                try unlockKeychain(path: arguments[1])
                try emit(["status": "unlocked", "productAdmission": false])
            case "sign-record":
                guard arguments.count == 3 else { throw argumentFailure() }
                try emitSignature(keychainPath: arguments[1], keyID: arguments[2])
            case "unprovision":
                guard arguments.count == 3 else { throw argumentFailure() }
                try emit(try unprovision(keychainPath: arguments[1], profilePath: arguments[2]))
            default:
                throw argumentFailure()
            }
        } catch let error as ToolFailure {
            try? emit(["status": "failed", "reasonCode": error.reasonCode, "actionHint": error.actionHint, "message": error.message], to: .standardError)
            exit(1)
        } catch {
            try? emit(["status": "failed", "reasonCode": "dev-signing-native-operation-failed", "actionHint": "inspect_the_bounded_user_domain_signing_diagnostic", "message": String(describing: error)], to: .standardError)
            exit(1)
        }
    }
}

private func provision(keychainPath: String, profilePath: String) throws -> [String: Any] {
    try requireUserDomainPath(keychainPath, suffix: "/Library/Keychains/nimi-local-development-signing.keychain-db")
    try requireUserDomainPath(profilePath, suffix: "/.nimi/macos-dev-signing/public-profile.json")
    guard !FileManager.default.fileExists(atPath: keychainPath), !FileManager.default.fileExists(atPath: profilePath) else {
        throw fail("dev-signing-profile-already-present", "inspect_or_unprovision_the_exact_user_domain_profile", "The fresh carrier-4 signing profile already exists or is partial.")
    }
    var password = try readSecretFromStandardInput()
    defer { _ = password.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    var keychain: SecKeychain?
    let createStatus = password.withUnsafeBytes { bytes in
        SecKeychainCreate(keychainPath, UInt32(bytes.count), bytes.baseAddress, false, nil, &keychain)
    }
    guard createStatus == errSecSuccess, let keychain else { throw securityFailure("create dedicated user signing Keychain", createStatus) }
    var committed = false
    defer {
        if !committed {
            _ = SecKeychainDelete(keychain)
            try? deleteUnlockSecret()
            try? FileManager.default.removeItem(atPath: profilePath)
        }
    }
    guard chmod(keychainPath, 0o600) == 0 else { throw posixFailure("secure signing Keychain") }
    let now = Date()
    guard let rootExpiry = Calendar(identifier: .gregorian).date(byAdding: .year, value: 10, to: now),
          let leafExpiry = Calendar(identifier: .gregorian).date(byAdding: .year, value: 3, to: now) else {
        throw fail("dev-signing-profile-invalid", "inspect_the_system_clock", "Certificate validity could not be constructed.")
    }
    let rootName = "Nimi Local Development Carrier 4 Root CA"
    let rootPair = try generateKeyPair(label: "\(keyLabelPrefix)root", keychain: nil, permanent: false, trustedPaths: [])
    let rootDER = try createCertificate(subjectCommonName: rootName, subjectPublicKey: rootPair.publicKey, issuer: Issuer(commonName: rootName, privateKey: rootPair.privateKey), notBefore: now.addingTimeInterval(-300), notAfter: rootExpiry, isCA: true)
    _ = try addCertificate(rootDER, label: "\(keyLabelPrefix)root", keychain: keychain)

    var identities = [String: Any]()
    for role in roles {
        let trustedPaths = role.role == "release_record" ? [CommandLine.arguments[0]] : [CommandLine.arguments[0], "/usr/bin/codesign"]
        let pair = try generateKeyPair(label: "\(keyLabelPrefix)\(role.role)", keychain: keychain, permanent: true, trustedPaths: trustedPaths)
        let der = try createCertificate(subjectCommonName: role.commonName, subjectPublicKey: pair.publicKey, issuer: Issuer(commonName: rootName, privateKey: rootPair.privateKey), notBefore: now.addingTimeInterval(-300), notAfter: leafExpiry, isCA: false)
        _ = try addCertificate(der, label: "\(keyLabelPrefix)\(role.role)", keychain: keychain)
        identities[role.role] = [
            "role": role.role,
            "commonName": role.commonName,
            "signingIdentifier": role.identifier,
            "certificateSHA1": Insecure.SHA1.hash(data: der).hex,
            "certificateSHA256": SHA256.hash(data: der).hex,
            "leafSPKISHA256": SHA256.hash(data: try subjectPublicKeyInfo(pair.publicKey)).hex,
            "expiresAt": rfc3339(leafExpiry),
        ]
    }
    guard let recordKey = try loadKey(label: "\(keyLabelPrefix)release_record", keyClass: kSecAttrKeyClassPublic, keychain: keychain) else {
        throw fail("dev-signing-profile-invalid", "reprovision_the_exact_profile", "The release-record public key is absent.")
    }
    let recordSPKI = try subjectPublicKeyInfo(recordKey)
    var profile: [String: Any] = [
        "schemaVersion": profileSchema,
        "profileId": profileID,
        "carrier": 4,
        "environment": "local_development",
        "identityClass": "local_ca",
        "signatureAlgorithm": "ecdsa_p256_sha256",
        "teamId": "",
        "notarized": false,
        "keychainPath": keychainPath,
        "rootCertificateSHA256": SHA256.hash(data: rootDER).hex,
        "rootKeyId": "nimi-macos-dev-record-\(SHA256.hash(data: recordSPKI).hex.prefix(20))",
        "rootPublicKeyB64URL": recordSPKI.base64URLEncodedString(),
        "createdAt": rfc3339(now),
        "expiresAt": rfc3339(leafExpiry),
        "identities": identities,
    ]
    guard let installerKey = try loadKey(label: "\(keyLabelPrefix)installer", keyClass: kSecAttrKeyClassPrivate, keychain: keychain) else {
        throw fail("dev-signing-profile-invalid", "reprovision_the_exact_profile", "The installer profile-signing key is absent.")
    }
    let profilePayload = try JSONSerialization.data(withJSONObject: profile, options: [.sortedKeys, .withoutEscapingSlashes])
    var profileError: Unmanaged<CFError>?
    guard let profileSignature = SecKeyCreateSignature(installerKey, .ecdsaSignatureMessageX962SHA256, profilePayload as CFData, &profileError) as Data? else {
        throw securityError("sign public development profile", profileError)
    }
    profile["profileSignature"] = profileSignature.base64URLEncodedString()
    try storeUnlockSecret(password)
    try writeAtomicJSON(profile, path: profilePath)
    let lockStatus = SecKeychainLock(keychain)
    guard lockStatus == errSecSuccess else { throw securityFailure("lock dedicated signing Keychain", lockStatus) }
    committed = true
    return [
        "status": "provisioned", "profileId": profileID, "carrier": 4,
        "keychainPath": keychainPath, "profilePath": profilePath,
        "identityRoles": roles.map(\.role), "systemKeychain": false,
        "trustSettings": false, "openDirectory": false, "launchd": false,
        "sudo": false, "productAdmission": false,
    ]
}

private func unprovision(keychainPath: String, profilePath: String) throws -> [String: Any] {
    try requireUserDomainPath(keychainPath, suffix: "/Library/Keychains/nimi-local-development-signing.keychain-db")
    try requireUserDomainPath(profilePath, suffix: "/.nimi/macos-dev-signing/public-profile.json")
    if FileManager.default.fileExists(atPath: keychainPath) {
        var keychain: SecKeychain?
        let status = SecKeychainOpen(keychainPath, &keychain)
        guard status == errSecSuccess, let keychain else { throw securityFailure("open exact signing Keychain for deletion", status) }
        let deleteStatus = SecKeychainDelete(keychain)
        guard deleteStatus == errSecSuccess else { throw securityFailure("delete exact signing Keychain", deleteStatus) }
    }
    try deleteUnlockSecret()
    if FileManager.default.fileExists(atPath: profilePath) { try FileManager.default.removeItem(atPath: profilePath) }
    guard !FileManager.default.fileExists(atPath: keychainPath), !FileManager.default.fileExists(atPath: profilePath) else {
        throw fail("dev-signing-unprovision-incomplete", "inspect_the_exact_user_domain_paths", "Signing profile deletion did not reach exact absence.")
    }
    return ["status": "unprovisioned", "mutation": "exact_user_domain_signing_profile_deleted", "systemKeychain": false, "trustSettings": false, "productAdmission": false]
}

private func unlockKeychain(path: String) throws {
    try requireUserDomainPath(path, suffix: "/Library/Keychains/nimi-local-development-signing.keychain-db")
    var keychain: SecKeychain?
    let openStatus = SecKeychainOpen(path, &keychain)
    guard openStatus == errSecSuccess, let keychain else { throw securityFailure("open dedicated signing Keychain", openStatus) }
    var password = try loadUnlockSecret()
    defer { _ = password.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    let status = password.withUnsafeBytes { SecKeychainUnlock(keychain, UInt32($0.count), $0.baseAddress, true) }
    guard status == errSecSuccess else { throw securityFailure("unlock dedicated signing Keychain", status) }
}

private func emitSignature(keychainPath: String, keyID: String) throws {
    guard keyID.range(of: #"^[a-z0-9][a-z0-9._-]{7,127}$"#, options: .regularExpression) != nil else { throw argumentFailure() }
    try unlockKeychain(path: keychainPath)
    var keychain: SecKeychain?
    let status = SecKeychainOpen(keychainPath, &keychain)
    guard status == errSecSuccess, let keychain else { throw securityFailure("open release-record signing Keychain", status) }
    guard let key = try loadKey(label: "\(keyLabelPrefix)release_record", keyClass: kSecAttrKeyClassPrivate, keychain: keychain) else {
        throw fail("dev-signing-profile-invalid", "reprovision_the_exact_profile", "The release-record private key is absent.")
    }
    let payload = FileHandle.standardInput.readDataToEndOfFile()
    guard !payload.isEmpty, payload.count <= 64 * 1024 else { throw fail("dev-release-record-payload-invalid", "rebuild_the_candidate", "Release-record payload is empty or oversized.") }
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, payload as CFData, &error) as Data? else {
        throw securityError("sign release record", error)
    }
    FileHandle.standardOutput.write(Data(signature.base64URLEncodedString().utf8) + Data([0x0a]))
}

private func generateKeyPair(label: String, keychain: SecKeychain?, permanent: Bool, trustedPaths: [String]) throws -> KeyPair {
    var parameters: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits: 256, kSecAttrIsPermanent: permanent]
    if let keychain { parameters[kSecUseKeychain] = keychain }
    if !trustedPaths.isEmpty {
        let applications = try trustedPaths.map(trustedApplication)
        var access: SecAccess?
        let status = SecAccessCreate(label as CFString, applications as CFArray, &access)
        guard status == errSecSuccess, let access else { throw securityFailure("create exact role-key ACL", status) }
        if trustedPaths.contains("/usr/bin/codesign") { try addAppleCodeSigningPartition(to: access, label: label) }
        parameters[kSecAttrAccess] = access
    }
    if permanent {
        parameters[kSecPrivateKeyAttrs] = [kSecAttrLabel: label, kSecAttrApplicationTag: Data(label.utf8), kSecAttrIsPermanent: true, kSecAttrCanSign: true]
        parameters[kSecPublicKeyAttrs] = [kSecAttrLabel: label, kSecAttrApplicationTag: Data(label.utf8), kSecAttrIsPermanent: true, kSecAttrCanVerify: true]
    }
    var publicKey: SecKey?, privateKey: SecKey?
    let status = SecKeyGeneratePair(parameters as CFDictionary, &publicKey, &privateKey)
    guard status == errSecSuccess, let publicKey, let privateKey else { throw securityFailure("generate non-exportable P-256 role key", status) }
    return KeyPair(publicKey: publicKey, privateKey: privateKey)
}

private func addCertificate(_ data: Data, label: String, keychain: SecKeychain) throws -> SecCertificate {
    guard let certificate = SecCertificateCreateWithData(nil, data as CFData) else { throw fail("dev-signing-certificate-invalid", "reprovision_the_exact_profile", "Generated certificate DER was rejected.") }
    let status = SecItemAdd([kSecClass: kSecClassCertificate, kSecValueRef: certificate, kSecAttrLabel: label, kSecUseKeychain: keychain] as CFDictionary, nil)
    guard status == errSecSuccess else { throw securityFailure("add role certificate to dedicated Keychain", status) }
    return certificate
}

private func loadKey(label: String, keyClass: CFString, keychain: SecKeychain) throws -> SecKey? {
    var result: CFTypeRef?
    let status = SecItemCopyMatching([kSecClass: kSecClassKey, kSecAttrLabel: label, kSecAttrKeyClass: keyClass, kSecMatchSearchList: [keychain], kSecMatchLimit: kSecMatchLimitOne, kSecReturnRef: true] as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let result else { throw securityFailure("load exact signing key", status) }
    return unsafeBitCast(result, to: SecKey.self)
}

private func storeUnlockSecret(_ password: Data) throws {
    var login: SecKeychain?
    let defaultStatus = SecKeychainCopyDefault(&login)
    guard defaultStatus == errSecSuccess, let login else { throw securityFailure("open default user Keychain", defaultStatus) }
    let application = try trustedApplication(CommandLine.arguments[0])
    var access: SecAccess?
    let accessStatus = SecAccessCreate("Nimi carrier-4 signing Keychain unlock" as CFString, [application] as CFArray, &access)
    guard accessStatus == errSecSuccess, let access else { throw securityFailure("create signing unlock ACL", accessStatus) }
    let status = SecItemAdd([kSecClass: kSecClassGenericPassword, kSecAttrService: unlockService, kSecAttrAccount: unlockAccount, kSecAttrLabel: unlockService, kSecValueData: password, kSecUseKeychain: login, kSecAttrAccess: access] as CFDictionary, nil)
    guard status == errSecSuccess else { throw securityFailure("store signing Keychain unlock secret in user Keychain", status) }
}

private func loadUnlockSecret() throws -> Data {
    var result: CFTypeRef?
    let status = SecItemCopyMatching([kSecClass: kSecClassGenericPassword, kSecAttrService: unlockService, kSecAttrAccount: unlockAccount, kSecMatchLimit: kSecMatchLimitOne, kSecReturnData: true] as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data, (32...128).contains(data.count) else { throw securityFailure("load signing Keychain unlock secret", status == errSecSuccess ? errSecDecode : status) }
    return data
}

private func deleteUnlockSecret() throws {
    let status = SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: unlockService, kSecAttrAccount: unlockAccount] as CFDictionary)
    if status != errSecSuccess, status != errSecItemNotFound { throw securityFailure("delete exact signing Keychain unlock secret", status) }
}

// The legacy SecAccess partition ACL is isolated here because modern SecItem APIs
// cannot create a file-backed dedicated Keychain or grant noninteractive codesign
// access to its non-exportable private keys. Removing it causes codesign to fail
// with errSecInteractionNotAllowed; the signing-tool build plus candidate-signing
// integration is its independent acceptance path.
private func addAppleCodeSigningPartition(to access: SecAccess, label: String) throws {
    let payload = try PropertyListSerialization.data(fromPropertyList: ["Partitions": ["apple:"]], format: .xml, options: 0)
    let description = payload.map { String(format: "%02x", $0) }.joined() as CFString
    var acl: SecACL?
    let create = SecACLCreateWithSimpleContents(access, nil, description, SecKeychainPromptSelector(rawValue: 0), &acl)
    guard create == errSecSuccess, let acl else { throw securityFailure("create codesign partition ACL", create) }
    let authorize = SecACLUpdateAuthorizations(acl, [kSecACLAuthorizationPartitionID] as CFArray)
    guard authorize == errSecSuccess else { throw securityFailure("authorize codesign partition ACL", authorize) }
}

private func trustedApplication(_ path: String) throws -> SecTrustedApplication {
    var application: SecTrustedApplication?
    let status = SecTrustedApplicationCreateFromPath(path, &application)
    guard status == errSecSuccess, let application else { throw securityFailure("bind signing tool Keychain ACL", status) }
    return application
}

private func readSecretFromStandardInput() throws -> Data {
    var data = FileHandle.standardInput.readDataToEndOfFile()
    while data.last == 0x0a || data.last == 0x0d { data.removeLast() }
    guard (32...128).contains(data.count) else { throw fail("dev-signing-secret-input-invalid", "rerun_the_confirmed_provisioner", "Provisioning requires one bounded CSPRNG secret on stdin.") }
    return data
}

private func requireUserDomainPath(_ path: String, suffix: String) throws {
    guard let home = FileManager.default.homeDirectoryForCurrentUser.path.removingPercentEncoding,
          path == home + suffix, !path.contains("\0"), getuid() != 0, geteuid() != 0 else {
        throw fail("dev-signing-path-untrusted", "use_the_fixed_current_user_profile_paths", "Signing authority must remain at the fixed non-root user-domain paths.")
    }
}

private func writeAtomicJSON(_ value: [String: Any], path: String) throws {
    let parent = (path as NSString).deletingLastPathComponent
    try FileManager.default.createDirectory(atPath: parent, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]); bytes.append(0x0a)
    let temporary = "\(path).tmp.\(getpid())"
    guard FileManager.default.createFile(atPath: temporary, contents: bytes, attributes: [.posixPermissions: 0o600]) else { throw posixFailure("create public signing profile") }
    guard rename(temporary, path) == 0 else { try? FileManager.default.removeItem(atPath: temporary); throw posixFailure("commit public signing profile") }
}

private func emit(_ value: [String: Any], to handle: FileHandle = .standardOutput) throws {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    handle.write(bytes + Data([0x0a]))
}

private func argumentFailure() -> ToolFailure { fail("dev-signing-argument-invalid", "use_an_exact_documented_command", "The signing command shape is invalid.") }
private func fail(_ code: String, _ hint: String, _ message: String) -> ToolFailure { ToolFailure(reasonCode: code, actionHint: hint, message: message) }
func securityFailure(_ operation: String, _ status: OSStatus) -> ToolFailure { fail("dev-signing-native-operation-failed", "inspect_the_exact_user_domain_Keychain_state", "\(operation) failed: \(SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)")") }
func securityError(_ operation: String, _ error: Unmanaged<CFError>?) -> ToolFailure { fail("dev-signing-native-operation-failed", "inspect_the_exact_user_domain_Keychain_state", "\(operation) failed: \(error?.takeRetainedValue().localizedDescription ?? "unknown Security.framework error")") }
private func posixFailure(_ operation: String) -> ToolFailure { fail("dev-signing-native-operation-failed", "inspect_the_exact_user_domain_filesystem_state", "\(operation) failed: \(String(cString: strerror(errno)))") }
private func rfc3339(_ date: Date) -> String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime]; formatter.timeZone = TimeZone(secondsFromGMT: 0); return formatter.string(from: date) }
private extension Digest { var hex: String { map { String(format: "%02x", $0) }.joined() } }
private extension Data { func base64URLEncodedString() -> String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") } }
