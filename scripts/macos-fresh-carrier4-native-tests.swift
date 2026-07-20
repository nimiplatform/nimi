import CryptoKit
import Foundation
import Security

struct Issuer { let commonName: String; let privateKey: SecKey }
func securityFailure(_ operation: String, _ status: OSStatus) -> TestFailure { TestFailure("\(operation): \(status)") }
func securityError(_ operation: String, _ error: Unmanaged<CFError>?) -> TestFailure { TestFailure("\(operation): \(error?.takeRetainedValue().localizedDescription ?? "unknown")") }

@main
struct FreshCarrier4NativeTests {
    static func main() throws {
        try testAllMutationSubsets()
        try testRecoveryClassification()
        try testVerifierRejectsMissingAndSymlinkedCandidates()
        try testRetainedVnodeAndMetadataRejection()
        try testActivationStagingResidueMatcher()
        try testBoundedPOSIXIdentityLookups()
        try testGeneratedCertificateCodeSigningPolicy()
        try testExactCandidateDirectoryLayout()
        try freshRequireInstallerParent()
        print("fresh carrier-4 native tests passed: 2087 assertions")
    }

    private static func testAllMutationSubsets() throws {
        let effects = FreshMutationEffect.allCases
        let reverse: [FreshMutationEffect] = [.launchd,.custody,.plist,.desktop,.payload,.principal,.staging,.bootstrap,.ledger,.journal,.helper]
        for mask in 0..<(1 << effects.count) {
            let observed = Set(effects.enumerated().compactMap { mask & (1 << $0.offset) == 0 ? nil : $0.element })
            let expected = reverse.filter(observed.contains)
            guard freshRollbackOrder(observed) == expected else { throw TestFailure("rollback order mismatch at subset \(mask)") }
        }
    }

    private static func testRecoveryClassification() throws {
        guard freshRecoveryDisposition(journalPresent: false, observed: [], witnessMatches: false) == .clean else { throw TestFailure("clean classification") }
        guard freshRecoveryDisposition(journalPresent: true, observed: [.principal, .payload], witnessMatches: true) == .rollbackExactEffects else { throw TestFailure("journaled effect-ahead classification") }
        guard freshRecoveryDisposition(journalPresent: false, observed: [.custody], witnessMatches: true) == .resetRequired else { throw TestFailure("unjournaled effect classification") }
        guard freshRecoveryDisposition(journalPresent: true, observed: [.principal], witnessMatches: false) == .resetRequired else { throw TestFailure("mismatched witness classification") }
    }

    private static func testVerifierRejectsMissingAndSymlinkedCandidates() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nimi-carrier4-native-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        do { _ = try verifyFreshCarrier4Candidate(root: root); throw TestFailure("missing candidate accepted") }
        catch let failure as FreshCarrier4Failure { guard failure.reasonCode == "dev-candidate-layout-invalid" else { throw TestFailure("unexpected missing-candidate reason \(failure.reasonCode)") } }
        let real = root.appendingPathComponent("real"), link = root.appendingPathComponent("linked")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
        do { _ = try verifyFreshCarrier4Candidate(root: link); throw TestFailure("symlink candidate accepted") }
        catch let failure as FreshCarrier4Failure { guard failure.reasonCode == "dev-candidate-path-untrusted" else { throw TestFailure("unexpected symlink reason \(failure.reasonCode)") } }
    }

    private static func testRetainedVnodeAndMetadataRejection() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nimi-carrier4-retained-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("candidate")
        try Data("candidate".utf8).write(to: file, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: file.path)
        let retained = try retainFreshFile(file, executable: true)
        defer { retained.close() }
        let moved = root.appendingPathComponent("moved")
        try FileManager.default.moveItem(at: file, to: moved)
        try Data("replacement".utf8).write(to: file, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: file.path)
        do { try retained.proveStable(); throw TestFailure("pathname replacement accepted") }
        catch let failure as FreshCarrier4Failure { guard failure.reasonCode == "dev-candidate-vnode-replaced" else { throw TestFailure("unexpected vnode reason \(failure.reasonCode)") } }
        let hardlink = root.appendingPathComponent("hardlink")
        try FileManager.default.linkItem(at: file, to: hardlink)
        do { _ = try retainFreshFile(file, executable: true); throw TestFailure("multiply-linked candidate accepted") }
        catch let failure as FreshCarrier4Failure { guard failure.reasonCode == "dev-candidate-metadata-untrusted" else { throw TestFailure("unexpected hardlink reason \(failure.reasonCode)") } }
        let writable = root.appendingPathComponent("writable")
        try Data("writable".utf8).write(to: writable, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o522], ofItemAtPath: writable.path)
        do { _ = try retainFreshFile(writable, executable: true); throw TestFailure("group-writable candidate accepted") }
        catch let failure as FreshCarrier4Failure { guard failure.reasonCode == "dev-candidate-metadata-untrusted" else { throw TestFailure("unexpected writable reason \(failure.reasonCode)") } }
    }

    private static func testActivationStagingResidueMatcher() throws {
        let id = "d9428888-122b-11e1-b85c-61cd3cbb3210"
        let accepted = [
            ("/Library/Application Support/Nimi/RuntimeDev", ".active-\(id).staging"),
            ("/Library/Application Support/Nimi/RuntimeDev", ".signing-profile-public.\(id).staging"),
            ("/Applications", ".Nimi Dev.app.\(id).staging"),
            ("/usr/local/libexec", ".nimi-macos-dev-security.\(id).staging"),
            ("/Library/LaunchDaemons", ".ai.nimi.runtime.dev.\(id).staging.plist"),
            ("/Applications", ".Nimi Dev.app.not-a-uuid.staging"),
        ]
        for (parent, entry) in accepted where !freshIsActivationStagingEntry(parent: parent, entry: entry) {
            throw TestFailure("known staging residue was ignored: \(parent)/\(entry)")
        }
        let rejected = [
            ("/Applications", "Nimi Dev.app"),
            ("/Applications", ".Nimi Dev.app.not-a-uuid.staging.backup"),
            ("/usr/local/libexec", "nimi-macos-dev-security"),
            ("/Library/LaunchDaemons", ".ai.nimi.runtime.dev.\(id).plist"),
            ("/private/tmp", ".active-\(id).staging"),
        ]
        for (parent, entry) in rejected where freshIsActivationStagingEntry(parent: parent, entry: entry) {
            throw TestFailure("non-staging path was classified as residue: \(parent)/\(entry)")
        }
    }

    private static func testBoundedPOSIXIdentityLookups() throws {
        guard let rootByName = try freshLookupUser(name: "root"), let rootByID = try freshLookupUser(uid: 0), rootByName == rootByID, rootByName.uid == 0 else { throw TestFailure("getpwnam_r/getpwuid_r projection mismatch") }
        guard let wheelByName = try freshLookupGroup(name: "wheel"), let wheelByID = try freshLookupGroup(gid: 0), wheelByName == wheelByID, wheelByName.gid == 0 else { throw TestFailure("getgrnam_r/getgrgid_r projection mismatch") }
        let missingName = "_nimi_fresh_carrier4_test_\(UUID().uuidString)"
        guard try freshLookupUser(name: missingName) == nil else { throw TestFailure("missing user name was treated as present") }
        guard try freshLookupGroup(name: missingName) == nil else { throw TestFailure("missing group name was treated as present") }
        let missingIdentifier: UInt32 = 4_000_000_000
        guard try freshLookupUser(uid: uid_t(missingIdentifier)) == nil else { throw TestFailure("missing uid was treated as present") }
        guard try freshLookupGroup(gid: gid_t(missingIdentifier)) == nil else { throw TestFailure("missing gid was treated as present") }
    }

    private static func testGeneratedCertificateCodeSigningPolicy() throws {
        func keyPair() throws -> (SecKey, SecKey) {
            var error: Unmanaged<CFError>?
            guard let privateKey = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits: 256] as CFDictionary, &error),
                  let publicKey = SecKeyCopyPublicKey(privateKey) else { throw securityError("generate ephemeral signing test key", error) }
            return (privateKey, publicKey)
        }
        let now = Date(), root = try keyPair(), leaf = try keyPair(), wrongRoot = try keyPair()
        let rootDER = try createCertificate(subjectCommonName: "Nimi Carrier 4 Native Test Root", subjectPublicKey: root.1, issuer: Issuer(commonName: "Nimi Carrier 4 Native Test Root", privateKey: root.0), notBefore: now.addingTimeInterval(-60), notAfter: now.addingTimeInterval(3600), isCA: true)
        let leafDER = try createCertificate(subjectCommonName: "Nimi Carrier 4 Native Test Leaf", subjectPublicKey: leaf.1, issuer: Issuer(commonName: "Nimi Carrier 4 Native Test Root", privateKey: root.0), notBefore: now.addingTimeInterval(-60), notAfter: now.addingTimeInterval(1800), isCA: false)
        let wrongRootDER = try createCertificate(subjectCommonName: "Nimi Carrier 4 Wrong Root", subjectPublicKey: wrongRoot.1, issuer: Issuer(commonName: "Nimi Carrier 4 Wrong Root", privateKey: wrongRoot.0), notBefore: now.addingTimeInterval(-60), notAfter: now.addingTimeInterval(3600), isCA: true)
        guard let rootCertificate=SecCertificateCreateWithData(nil,rootDER as CFData),let leafCertificate=SecCertificateCreateWithData(nil,leafDER as CFData),let wrongRootCertificate=SecCertificateCreateWithData(nil,wrongRootDER as CFData),let policy=SecPolicyCreateWithProperties(kSecPolicyAppleCodeSigning,nil) else{throw TestFailure("generated certificate or code-signing policy was rejected")}
        var trust:SecTrust?;guard SecTrustCreateWithCertificates([leafCertificate,rootCertificate] as CFArray,policy,&trust)==errSecSuccess,let trust,SecTrustSetAnchorCertificates(trust,[rootCertificate] as CFArray)==errSecSuccess,SecTrustSetAnchorCertificatesOnly(trust,true)==errSecSuccess else{throw TestFailure("exact-root code-signing trust construction failed")}
        SecTrustSetVerifyDate(trust,now as CFDate);guard SecTrustEvaluateWithError(trust,nil) else{throw TestFailure("generated leaf failed Apple code-signing policy")}
        var wrongTrust:SecTrust?;guard SecTrustCreateWithCertificates([leafCertificate,rootCertificate] as CFArray,policy,&wrongTrust)==errSecSuccess,let wrongTrust,SecTrustSetAnchorCertificates(wrongTrust,[wrongRootCertificate] as CFArray)==errSecSuccess,SecTrustSetAnchorCertificatesOnly(wrongTrust,true)==errSecSuccess else{throw TestFailure("wrong-root trust construction failed")}
        SecTrustSetVerifyDate(wrongTrust,now as CFDate);guard !SecTrustEvaluateWithError(wrongTrust,nil) else{throw TestFailure("generated leaf was accepted against the wrong root")}
        guard SHA256.hash(data:try subjectPublicKeyInfo(leaf.1))==SHA256.hash(data:try subjectPublicKeyInfo(SecCertificateCopyKey(leafCertificate)!)) else{throw TestFailure("generated leaf SPKI changed during certificate encoding")}
    }

    private static func testExactCandidateDirectoryLayout() throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("nimi-carrier4-layout-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:false);defer{try? FileManager.default.removeItem(at:root)}
        try Data("fixed".utf8).write(to:root.appendingPathComponent("fixed"),options:.withoutOverwriting)
        try freshRequireExactDirectory(root,entries:["fixed"])
        try Data("extra".utf8).write(to:root.appendingPathComponent("extra"),options:.withoutOverwriting)
        do{try freshRequireExactDirectory(root,entries:["fixed"]);throw TestFailure("extra candidate entry was accepted")}catch let failure as FreshCarrier4Failure{guard failure.reasonCode=="dev-candidate-layout-invalid" else{throw TestFailure("unexpected extra-entry reason \(failure.reasonCode)")}}
        let link=root.deletingLastPathComponent().appendingPathComponent("nimi-carrier4-layout-link-\(UUID().uuidString)");try FileManager.default.createSymbolicLink(at:link,withDestinationURL:root);defer{try? FileManager.default.removeItem(at:link)}
        do{try freshRequireExactDirectory(link,entries:["fixed","extra"]);throw TestFailure("symlinked candidate directory was accepted")}catch let failure as FreshCarrier4Failure{guard failure.reasonCode=="dev-candidate-layout-invalid" else{throw TestFailure("unexpected directory-link reason \(failure.reasonCode)")}}
    }
}

struct TestFailure: Error, CustomStringConvertible { let description: String; init(_ value: String) { description = value } }
