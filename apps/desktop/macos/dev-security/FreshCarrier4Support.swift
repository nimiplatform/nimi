import CryptoKit
import Darwin
import Foundation
import Security

struct FreshCarrier4Failure: Error {
    let reasonCode: String
    let actionHint: String
    let message: String
    let details: [String: Any]
}

func freshFail(_ code: String, _ hint: String, _ message: String, details: [String: Any] = [:]) -> FreshCarrier4Failure {
    FreshCarrier4Failure(reasonCode: code, actionHint: hint, message: message, details: details)
}

func freshEmit(_ value: [String: Any], to handle: FileHandle = .standardOutput) throws {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    try handle.write(contentsOf: bytes + Data([0x0a]))
}

struct FreshRetainedFile {
    let url: URL
    let descriptor: Int32
    let before: stat
    let sha256: String

    func proveStable() throws {
        var after = stat()
        guard fstat(descriptor, &after) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_mode == after.st_mode, before.st_uid == after.st_uid,
              before.st_gid == after.st_gid, before.st_nlink == after.st_nlink,
              before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec, before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else {
            throw freshFail("dev-candidate-vnode-replaced", "rebuild_the_candidate", "A retained candidate vnode changed during verification.", details: ["path": url.path])
        }
        var linked = stat()
        guard lstat(url.path, &linked) == 0, linked.st_dev == after.st_dev, linked.st_ino == after.st_ino else {
            throw freshFail("dev-candidate-vnode-replaced", "rebuild_the_candidate", "The candidate pathname no longer resolves to the retained vnode.", details: ["path": url.path])
        }
    }

    func close() { Darwin.close(descriptor) }
}

func retainFreshFile(_ url: URL, executable: Bool = false) throws -> FreshRetainedFile {
    let fd = open(url.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
    guard fd >= 0 else { throw freshFail("dev-candidate-path-untrusted", "rebuild_the_candidate", "A fixed candidate file cannot be opened without following links.", details: ["path": url.path, "errno": errno]) }
    var metadata = stat()
    guard fstat(fd, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG, metadata.st_nlink == 1,
          metadata.st_size > 0, metadata.st_size <= 512 * 1024 * 1024,
          metadata.st_mode & 0o022 == 0, !executable || metadata.st_mode & 0o111 != 0 else {
        Darwin.close(fd)
        throw freshFail("dev-candidate-metadata-untrusted", "rebuild_the_candidate", "A fixed candidate file has unsafe type, links, size, mode, or writability.", details: ["path": url.path])
    }
    var digest = SHA256(), offset: off_t = 0
    var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
    while true {
        let count = pread(fd, &buffer, buffer.count, offset)
        if count < 0 { Darwin.close(fd); throw freshFail("dev-candidate-read-failed", "rebuild_the_candidate", "A retained candidate file could not be read.", details: ["path": url.path, "errno": errno]) }
        if count == 0 { break }
        digest.update(data: Data(buffer[0..<count])); offset += off_t(count)
    }
    guard offset == metadata.st_size else { Darwin.close(fd); throw freshFail("dev-candidate-vnode-replaced", "rebuild_the_candidate", "A retained candidate file changed length during hashing.", details: ["path": url.path]) }
    let retained = FreshRetainedFile(url: url, descriptor: fd, before: metadata, sha256: digest.finalize().hex)
    try retained.proveStable()
    return retained
}

func freshRequireExactDirectory(_ url:URL, entries:Set<String>)throws{
    var metadata=stat()
    guard lstat(url.path,&metadata)==0,metadata.st_mode&S_IFMT==S_IFDIR,metadata.st_mode&0o022==0,metadata.st_nlink>0 else{throw freshFail("dev-candidate-layout-invalid","rebuild_the_closed_candidate","A fixed candidate directory is absent, linked, or writable.",details:["path":url.path])}
    let observed=try FileManager.default.contentsOfDirectory(atPath:url.path)
    guard observed.allSatisfy({!$0.isEmpty && !$0.contains("/") && !$0.contains("\0")}),Set(observed)==entries else{throw freshFail("dev-candidate-layout-invalid","rebuild_the_closed_candidate","A fixed candidate directory contains missing or extra entries.",details:["path":url.path,"expected":entries.sorted(),"observed":observed.sorted()])}
}

struct FreshCodeIdentity {
    let identifier: String
    let teamID: String
    let cdhash: String
    let designatedRequirement: String
    let leafSPKISHA256: String
    let leafCertificateSHA256: String
    let rootCertificateSHA256: String
    let leafPublicKey: P256.Signing.PublicKey
    let hardenedRuntime: Bool
    let architecture: String
    let entitlementsSHA256: String
}

func inspectFreshCode(at url: URL, expectedIdentifier: String, retained: FreshRetainedFile) throws -> FreshCodeIdentity {
    try retained.proveStable()
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &staticCode) == errSecSuccess, let staticCode,
          SecStaticCodeCheckValidity(staticCode, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), nil) == errSecSuccess else {
        throw freshFail("dev-candidate-code-untrusted", "rebuild_and_sign_the_candidate", "Candidate strict code-signing validation failed.", details: ["path": url.path])
    }
    return try freshCodeIdentity(staticCode, expectedIdentifier: expectedIdentifier, retained: retained)
}

func inspectFreshRunningCode(pid: pid_t, expectedIdentifier: String, retained: FreshRetainedFile) throws -> FreshCodeIdentity {
    guard pid > 1, kill(pid, 0) == 0 else {
        throw freshFail("runtime-service-unavailable", "inspect_launchd_and_the_exact_principal", "The Runtime process is not live.", details: ["pid": pid])
    }
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    var code: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess, let code,
          SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures), nil) == errSecSuccess else {
        throw freshFail("runtime-service-untrusted", "run_the_exact_reset", "Dynamic Runtime code-signing validation failed.", details: ["pid": pid])
    }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
        throw freshFail("runtime-service-untrusted", "run_the_exact_reset", "The live Runtime cannot be bound to its static code object.", details: ["pid": pid])
    }
    let identity = try freshCodeIdentity(staticCode, expectedIdentifier: expectedIdentifier, retained: retained)
    guard kill(pid, 0) == 0 else {
        throw freshFail("runtime-service-unavailable", "inspect_launchd_and_the_exact_principal", "The Runtime exited during dynamic identity verification.", details: ["pid": pid])
    }
    return identity
}

private func freshCodeIdentity(_ staticCode: SecStaticCode, expectedIdentifier: String, retained: FreshRetainedFile) throws -> FreshCodeIdentity {
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
          let values = information as? [String: Any],
          let identifier = values[kSecCodeInfoIdentifier as String] as? String, identifier == expectedIdentifier,
          let cdhashData = values[kSecCodeInfoUnique as String] as? Data,
          let certificates = values[kSecCodeInfoCertificates as String] as? [SecCertificate], certificates.count == 2,
          let leafKey = SecCertificateCopyKey(certificates[0]) else {
        throw freshFail("dev-candidate-identity-mismatch", "use_the_exact_fresh_carrier_4_role", "Candidate identifier, CDHash, or certificate chain is unavailable or mismatched.", details: ["path": retained.url.path])
    }
    guard let codeSigningPolicy = SecPolicyCreateWithProperties(kSecPolicyAppleCodeSigning, nil) else {
        throw freshFail("dev-runtime-candidate-verification-failed", "create_Apple_code_signing_policy", "Apple code-signing policy is unavailable.")
    }
    var trust: SecTrust?
    guard SecTrustCreateWithCertificates(certificates as CFArray, codeSigningPolicy, &trust) == errSecSuccess, let trust,
          SecTrustSetAnchorCertificates(trust, [certificates[1]] as CFArray) == errSecSuccess,
          SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
          SecTrustEvaluateWithError(trust, nil) else {
        throw freshFail("dev-candidate-certificate-policy-invalid", "reprovision_the_signing_profile", "Candidate certificate chain does not satisfy Apple code-signing policy against its exact local root.", details: ["path": retained.url.path])
    }
    let teamID = values[kSecCodeInfoTeamIdentifier as String] as? String ?? ""
    guard teamID.isEmpty else { throw freshFail("dev-candidate-team-id-forbidden", "use_the_machine_local_CA_profile", "Fresh carrier 4 requires Team ID to be absent.") }
    let flags = (values[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? 0
    guard flags & 0x0001_0000 != 0 else { throw freshFail("dev-candidate-hardened-runtime-required", "sign_with_hardened_runtime", "Fresh carrier 4 requires hardened runtime.") }
    var requirement: SecRequirement?
    var requirementText: CFString?
    guard SecCodeCopyDesignatedRequirement(staticCode, [], &requirement) == errSecSuccess, let requirement,
          SecRequirementCopyString(requirement, [], &requirementText) == errSecSuccess, let requirementText else {
        throw freshFail("dev-candidate-designated-requirement-invalid", "rebuild_and_sign_the_candidate", "Candidate designated requirement is unavailable.")
    }
    var keyError: Unmanaged<CFError>?
    guard let point = SecKeyCopyExternalRepresentation(leafKey, &keyError) as Data?,
          let p256 = try? P256.Signing.PublicKey(x963Representation: point) else {
        throw freshFail("dev-candidate-leaf-key-invalid", "reprovision_the_signing_profile", "Candidate leaf is not a P-256 signing identity.")
    }
    let architecture = try freshArchitecture(retained)
    let entitlements = values[kSecCodeInfoEntitlementsDict as String] as? [String: Any] ?? [:]
    let entitlementBytes = try JSONSerialization.data(withJSONObject: entitlements, options: [.sortedKeys, .withoutEscapingSlashes])
    try retained.proveStable()
    return FreshCodeIdentity(
        identifier: identifier, teamID: teamID, cdhash: cdhashData.hex,
        designatedRequirement: requirementText as String,
        leafSPKISHA256: SHA256.hash(data: p256.derRepresentation).hex,
        leafCertificateSHA256: SHA256.hash(data: SecCertificateCopyData(certificates[0]) as Data).hex,
        rootCertificateSHA256: SHA256.hash(data: SecCertificateCopyData(certificates[1]) as Data).hex,
        leafPublicKey: p256, hardenedRuntime: true, architecture: architecture,
        entitlementsSHA256: SHA256.hash(data: entitlementBytes).hex
    )
}

private func freshArchitecture(_ retained: FreshRetainedFile) throws -> String {
    var header = [UInt8](repeating: 0, count: 8)
    guard pread(retained.descriptor, &header, header.count, 0) == header.count else { throw freshFail("dev-candidate-architecture-invalid", "rebuild_native_arm64", "Candidate Mach-O header is unavailable.") }
    let magic = UInt32(header[0]) | UInt32(header[1]) << 8 | UInt32(header[2]) << 16 | UInt32(header[3]) << 24
    let cpu = UInt32(header[4]) | UInt32(header[5]) << 8 | UInt32(header[6]) << 16 | UInt32(header[7]) << 24
    guard magic == 0xfeedfacf, cpu == 0x0100000c else { throw freshFail("dev-candidate-architecture-invalid", "rebuild_native_arm64", "Fresh carrier 4 requires one thin native arm64 Mach-O.") }
    return generatedRequiredArchitecture
}

func freshCanonicalJSON(_ value: Any) throws -> Data {
    guard JSONSerialization.isValidJSONObject(value) else { throw freshFail("dev-release-record-invalid", "rebuild_the_candidate", "A signed JSON object is not canonicalizable.") }
    return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
}

func freshRequireRoot() throws {
    guard getuid() == 0, geteuid() == 0 else { throw freshFail("macos-dev-administrator-authorization-required", "run_only_through_the_confirmed_installer", "This operation requires real and effective uid 0.") }
}

func freshRequireCanonicalFixedPath(_ path: String) throws {
    let fixed = URL(fileURLWithPath: path).standardizedFileURL
    guard fixed.path == path, fixed.resolvingSymlinksInPath().path == path else {
        throw freshFail("runtime-service-untrusted", "run_the_exact_reset", "A fixed carrier-4 path has a symlinked or noncanonical component.", details: ["path": path])
    }
}

private extension Digest { var hex: String { map { String(format: "%02x", $0) }.joined() } }
private extension Data { var hex: String { map { String(format: "%02x", $0) }.joined() } }
