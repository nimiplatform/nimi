import CryptoKit
import Darwin
import Foundation
import Security

private let temporaryPasswordService = "ai.nimi.keychain-access-integration.unlock-secret"
private let temporaryPasswordAccount = "macos_local_development_v1"
private let temporarySigningKeyLabel = "Nimi temporary codesign identity"
private let lockedRolePrivateKeyLabel = "Nimi temporary locked-custody record signer"
private let nonDurableCAKeyLabel = "Nimi temporary non-durable CA key"

struct DevSecurityFailure: LocalizedError {
    let reasonCode: String
    let actionHint: String
    let message: String

    var errorDescription: String? { "\(reasonCode): \(message) [\(actionHint)]" }
}

func fail(_ reasonCode: String, _ actionHint: String, _ message: String) -> DevSecurityFailure {
    DevSecurityFailure(reasonCode: reasonCode, actionHint: actionHint, message: message)
}

func securityFailure(_ operation: String, _ status: OSStatus) -> DevSecurityFailure {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
    return fail("native-keychain-access-test-failed", "inspect the native Keychain ACL integration", "\(operation) failed: \(message)")
}

func trustedApplicationData(_ application: SecTrustedApplication) throws -> Data {
    var value: CFData?
    let status = SecTrustedApplicationCopyData(application, &value)
    guard status == errSecSuccess, let value else {
        throw securityFailure("inspect trusted application", status)
    }
    return value as Data
}

@main
struct MacOSDevelopmentKeychainAccessIntegration {
    static func main() {
        do {
            let interactionStatus = SecKeychainSetUserInteractionAllowed(false)
            guard interactionStatus == errSecSuccess else {
                throw securityFailure("disable interactive Keychain fallback", interactionStatus)
            }
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.count == 2, arguments[0] == "--locked-custody-probe" {
                try runLockedCustodyProbe(arguments[1])
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"denied\"}\n".utf8))
                return
            }
            if arguments.count == 2, arguments[0] == "--password-custody-probe" {
                try runPasswordCustodyProbe(arguments[1], expectAccess: true)
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"read\"}\n".utf8))
                return
            }
            if arguments.count == 2, arguments[0] == "--password-custody-deny-probe" {
                try runPasswordCustodyProbe(arguments[1], expectAccess: false)
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"denied\"}\n".utf8))
                return
            }
            if arguments.count == 2, arguments[0] == "--password-delete-probe" {
                try runPasswordDeleteProbe(arguments[1], expectAccess: true)
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"deleted\"}\n".utf8))
                return
            }
            if arguments.count == 2, arguments[0] == "--password-delete-deny-probe" {
                try runPasswordDeleteProbe(arguments[1], expectAccess: false)
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"denied\"}\n".utf8))
                return
            }
            if arguments.count == 5, arguments[0] == "--finalize-owner-transition-probe" {
                try runFinalOwnerTransitionProbe(
                    keychainPath: arguments[1],
                    bootstrapPath: arguments[2],
                    finalApplicationDigest: arguments[3],
                    codesignApplicationDigest: arguments[4]
                )
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"finalized\"}\n".utf8))
                return
            }
            if arguments.count == 4, arguments[0] == "--validate-final-custody-probe" {
                try runFinalCustodyValidationProbe(
                    keychainPath: arguments[1],
                    finalApplicationDigest: arguments[2],
                    codesignApplicationDigest: arguments[3]
                )
                try FileHandle.standardOutput.write(contentsOf: Data("{\"status\":\"verified\"}\n".utf8))
                return
            }
            guard arguments.isEmpty else {
                throw fail(
                    "native-keychain-access-test-failed",
                    "use the exact native integration command shape",
                    "Unexpected native integration arguments."
                )
            }
            try runIntegration()
            let output: [String: Any] = [
                "bootstrapIdentityInspections": 2,
                "lockedSigningKeychainBornFinalRoleValidations": 2,
                "codesignInvocations": 2,
                "certificateFingerprintLookups": 1,
                "inMemoryCAChainEvaluations": 1,
                "nonDurableCAKeyPersistenceDenials": 1,
                "immutableBootstrapHandoffValidations": 1,
                "independentFinalOwnerClosures": 1,
                "freshFinalCustodyValidations": 1,
                "lockedCustodyDenials": 1,
                "passwordCustodyDenials": 1,
                "passwordCustodyCommitPolicy": "born_final_signed_owner_only",
                "passwordCustodyReads": 1,
                "passwordDeleteFinalOwnerSuccesses": 1,
                "passwordDeleteInvalidOwnerDenials": 1,
                "passwordTransport": "in_memory_only",
                "profile": "temporary_user_keychain",
                "profileKeyCleanupValidations": 1,
                "signedIdentityInspections": 2,
                "transitionalOwnerValidations": 1,
                "trustSettingsSemanticValidations": 6,
                "trustSettingsEmptyDomainStatusValidations": 3,
                "status": "passed",
            ]
            let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
            try FileHandle.standardOutput.write(contentsOf: data + Data([0x0a]))
        } catch {
            let output: [String: Any] = [
                "status": "failed",
                "message": error.localizedDescription,
            ]
            if let data = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]) {
                try? FileHandle.standardError.write(contentsOf: data + Data([0x0a]))
            }
            exit(1)
        }
    }
}

private func runIntegration() throws {
    try validateTrustSettingsEmptyDomainStatus()
    try validateExactCodeSigningTrustSettingsParser()
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("nimi-keychain-access-\(UUID().uuidString.lowercased())", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }

    let home = root.appendingPathComponent("home", isDirectory: true)
    let preferences = home.appendingPathComponent("Library/Preferences", isDirectory: true)
    try FileManager.default.createDirectory(at: preferences, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let keychainPath = root.appendingPathComponent("codesign.keychain-db").path
    var password = Data(count: 48)
    let randomStatus = password.withUnsafeMutableBytes { bytes in
        SecRandomCopyBytes(kSecRandomDefault, bytes.count, bytes.baseAddress!)
    }
    guard randomStatus == errSecSuccess else { throw securityFailure("generate temporary Keychain secret", randomStatus) }

    var keychain: SecKeychain?
    let createStatus = password.withUnsafeBytes { bytes in
        SecKeychainCreate(keychainPath, UInt32(bytes.count), bytes.baseAddress, false, nil, &keychain)
    }
    guard createStatus == errSecSuccess, let keychain else {
        throw securityFailure("create temporary signing Keychain", createStatus)
    }
    defer { _ = SecKeychainDelete(keychain) }
    guard chmod(keychainPath, 0o600) == 0 else {
        throw fail("native-keychain-access-test-failed", "inspect the temporary Keychain", "Cannot secure the temporary Keychain file.")
    }
    try validateInMemoryCertificateChain(keychain: keychain)

    let executable = try canonicalPath(CommandLine.arguments[0])
    let bootstrapIdentity = try inspectBootstrapCode(executable)
    let runningBootstrapIdentity = try inspectRunningBootstrapCode(getpid())
    let bootstrapDigest = SHA256.hash(data: try Data(contentsOf: URL(fileURLWithPath: executable)))
    guard bootstrapIdentity.identifier == "integration",
          bootstrapIdentity.teamId.isEmpty,
          bootstrapIdentity.cdhash.count == 40,
          runningBootstrapIdentity.identifier == bootstrapIdentity.identifier,
          runningBootstrapIdentity.teamId == bootstrapIdentity.teamId,
          runningBootstrapIdentity.cdhash == bootstrapIdentity.cdhash,
          runningBootstrapIdentity.designatedRequirement == bootstrapIdentity.designatedRequirement else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the linker-signed bootstrap identity",
            "The native integration executable is not an exact certificate-free bootstrap carrier."
        )
    }
    let testApplication = try trustedApplication(executable)
    let codesignApplication = try trustedApplication("/usr/bin/codesign")
    let testPartition = "cdhash:\(try codeCDHash(executable))"
    let leafAccess = try createExactKeychainAccess(
        label: temporarySigningKeyLabel,
        restrictedApplications: [testApplication],
        ownerApplications: [testApplication]
    )
    let pair = try generateTemporaryKeyPair(
        keychain: keychain,
        access: leafAccess,
        label: temporarySigningKeyLabel
    )
    let certificateData = try createTemporaryCodeSigningCertificate(
        publicKey: pair.publicKey,
        privateKey: pair.privateKey
    )
    let expectedLeafSPKI = SHA256.hash(data: try subjectPublicKeyInfo(pair.publicKey))
        .map { String(format: "%02x", $0) }.joined()
    let certificateLabel = "ai.nimi.keychain-access-integration.certificate"
    try addTemporaryCertificate(certificateData, label: certificateLabel, keychain: keychain)
    try validateTemporaryCertificateFingerprintLookup(
        data: certificateData,
        label: certificateLabel,
        keychain: keychain
    )

    let keyItem = unsafeBitCast(pair.privateKey, to: SecKeychainItem.self)
    try replaceExactKeychainAccess(
        keyItem,
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplications: [codesignApplication],
        ownerApplications: [testApplication],
        partitions: ["apple:", testPartition],
        label: "temporary helper-role private key"
    )
    try validateExactKeychainAccess(
        keyItem,
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplication: codesignApplication,
        ownerApplication: testApplication,
        partitions: ["apple:", testPartition],
        label: "temporary codesign private key"
    )

    let environment = [
        "HOME": home.path,
        "LANG": "en_US.UTF-8",
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": root.path,
    ]
    _ = try runBounded(
        "/usr/bin/security",
        ["list-keychains", "-d", "user", "-s", keychainPath, "/Library/Keychains/System.keychain"],
        environment: environment
    )
    let identitySHA1 = Insecure.SHA1.hash(data: certificateData).map { String(format: "%02x", $0) }.joined()
    let firstTarget = try copySigningTarget(executable, into: root, name: "first")
    try codesign(firstTarget, identitySHA1: identitySHA1, keychainPath: keychainPath, environment: environment)
    try validateCompleteSignedCodeIdentity(firstTarget, expectedLeafSPKI: expectedLeafSPKI)

    let signedOwner = try trustedApplication(firstTarget)
    let signedOwnerPartition = "cdhash:\(try codeCDHash(firstTarget))"
    let signedOwnerDigest = try trustedApplicationIdentitySHA256(signedOwner)
    let codesignApplicationDigest = try trustedApplicationIdentitySHA256(codesignApplication)
    try replaceExactKeychainAccess(
        keyItem,
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplications: [codesignApplication],
        ownerApplications: [testApplication, signedOwner],
        partitions: ["apple:", signedOwnerPartition],
        label: "temporary transitional codesign private key"
    )
    try validateKeychainAccess(
        keyItem,
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplications: [codesignApplication],
        ownerApplications: [testApplication, signedOwner],
        partitions: ["apple:", signedOwnerPartition],
        label: "temporary transitional codesign private key"
    )
    let bornFinalAccess = try createExactKeychainAccess(
        label: lockedRolePrivateKeyLabel,
        restrictedApplications: [signedOwner],
        ownerApplications: [signedOwner],
        partitions: [signedOwnerPartition]
    )
    let bornFinalPair = try generateTemporaryKeyPair(
        keychain: keychain,
        access: bornFinalAccess,
        label: lockedRolePrivateKeyLabel
    )
    try validateKeychainAccessIdentityDigests(
        unsafeBitCast(bornFinalPair.privateKey, to: SecKeychainItem.self),
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplicationDigests: [signedOwnerDigest],
        ownerApplicationDigests: [signedOwnerDigest],
        partitions: [signedOwnerPartition],
        label: "temporary locked-signing-Keychain born-final record signer"
    )
    let passwordAccess = try createExactGenericPasswordAccess(
        label: "Nimi temporary signing Keychain password",
        application: signedOwner,
        partitions: [signedOwnerPartition]
    )
    let passwordItem = try storeTemporaryPassword(password, keychain: keychain, access: passwordAccess)
    let finalization = try runBounded(
        firstTarget,
        [
            "--finalize-owner-transition-probe",
            keychainPath,
            executable,
            signedOwnerDigest,
            codesignApplicationDigest,
        ],
        environment: environment
    )
    guard String(data: finalization, encoding: .utf8) == "{\"status\":\"finalized\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the independent final-owner closure",
            "The signed final process returned an invalid custody-closure result."
        )
    }
    let finalValidation = try runBounded(
        firstTarget,
        [
            "--validate-final-custody-probe",
            keychainPath,
            signedOwnerDigest,
            codesignApplicationDigest,
        ],
        environment: environment
    )
    guard String(data: finalValidation, encoding: .utf8) == "{\"status\":\"verified\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the fresh final-custody verifier",
            "The fresh signed process returned an invalid custody result."
        )
    }
    try validateExactGenericPasswordAccess(
        passwordItem,
        application: signedOwner,
        partitions: [signedOwnerPartition],
        label: "temporary signing Keychain password"
    )
    let passwordRead = try runBounded(
        firstTarget,
        ["--password-custody-probe", keychainPath],
        environment: environment
    )
    guard String(data: passwordRead, encoding: .utf8) == "{\"status\":\"read\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the signed-process password custody handoff",
            "The signed owner returned an invalid password custody result."
        )
    }
    let passwordDenied = try runBounded(
        executable,
        ["--password-custody-deny-probe", keychainPath],
        environment: environment
    )
    guard String(data: passwordDenied, encoding: .utf8) == "{\"status\":\"denied\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the bootstrap-process password custody denial",
            "The untrusted bootstrap process returned an invalid password custody result."
        )
    }
    let bootstrapIdentityAfterHandoff = try inspectBootstrapCode(executable)
    let bootstrapDigestAfterHandoff = SHA256.hash(data: try Data(contentsOf: URL(fileURLWithPath: executable)))
    guard bootstrapIdentityAfterHandoff.identifier == bootstrapIdentity.identifier,
          bootstrapIdentityAfterHandoff.teamId == bootstrapIdentity.teamId,
          bootstrapIdentityAfterHandoff.cdhash == bootstrapIdentity.cdhash,
          bootstrapIdentityAfterHandoff.designatedRequirement == bootstrapIdentity.designatedRequirement,
          bootstrapDigestAfterHandoff == bootstrapDigest else {
        throw fail(
            "native-keychain-access-test-failed",
            "keep the bootstrap carrier immutable through custody handoff",
            "The bootstrap code identity or bytes changed while the distinct signed carrier received custody."
        )
    }
    let secondTarget = try copySigningTarget(executable, into: root, name: "second")
    try codesign(secondTarget, identitySHA1: identitySHA1, keychainPath: keychainPath, environment: environment)
    try validateCompleteSignedCodeIdentity(secondTarget, expectedLeafSPKI: expectedLeafSPKI)
    let lockStatus = SecKeychainLock(keychain)
    guard lockStatus == errSecSuccess else { throw securityFailure("lock temporary signing Keychain", lockStatus) }
    _ = try runBounded(
        executable,
        ["--locked-custody-probe", keychainPath],
        environment: environment
    )
    let unlockStatus = password.withUnsafeBytes { bytes in
        SecKeychainUnlock(keychain, UInt32(bytes.count), bytes.baseAddress, true)
    }
    guard unlockStatus == errSecSuccess else { throw securityFailure("unlock temporary signing Keychain", unlockStatus) }
    let unlockedValidation = try runBounded(
        firstTarget,
        [
            "--validate-final-custody-probe",
            keychainPath,
            signedOwnerDigest,
            codesignApplicationDigest,
        ],
        environment: environment
    )
    guard String(data: unlockedValidation, encoding: .utf8) == "{\"status\":\"verified\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect unlocked custody revalidation",
            "The fresh signed process returned an invalid unlocked-custody result."
        )
    }
    try validateExactProfileKeyCleanup(keychain: keychain, application: testApplication)
    let passwordDeleteDenied = try runBounded(
        executable,
        ["--password-delete-deny-probe", keychainPath],
        environment: environment
    )
    guard String(data: passwordDeleteDenied, encoding: .utf8) == "{\"status\":\"denied\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the bootstrap-process password deletion denial",
            "The untrusted bootstrap process returned an invalid password deletion result."
        )
    }
    let passwordDelete = try runBounded(
        firstTarget,
        ["--password-delete-probe", keychainPath],
        environment: environment
    )
    guard String(data: passwordDelete, encoding: .utf8) == "{\"status\":\"deleted\"}\n" else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the signed-owner exact password deletion",
            "The signed final owner returned an invalid password deletion result."
        )
    }
    let finalLockStatus = SecKeychainLock(keychain)
    guard finalLockStatus == errSecSuccess else { throw securityFailure("relock temporary signing Keychain", finalLockStatus) }
    password.resetBytes(in: 0..<password.count)
}

private func validateTrustSettingsEmptyDomainStatus() throws {
    guard trustSettingsCopyCertificatesReportsEmptyDomain(errSecNoTrustSettings),
          !trustSettingsCopyCertificatesReportsEmptyDomain(errSecSuccess),
          !trustSettingsCopyCertificatesReportsEmptyDomain(errSecItemNotFound) else {
        throw fail(
            "native-keychain-access-test-failed",
            "preserve the exact Security.framework empty trust-domain status",
            "Only errSecNoTrustSettings may classify SecTrustSettingsCopyCertificates as an empty domain."
        )
    }
}

private func validateExactCodeSigningTrustSettingsParser() throws {
    guard let codeSigning = SecPolicyCreateWithProperties(kSecPolicyAppleCodeSigning, nil) else {
        throw fail("native-keychain-access-test-failed", "inspect the code-signing policy", "Cannot create the Apple code-signing policy.")
    }
    let valid: [[String: Any]] = [[
        kSecTrustSettingsPolicy as String: codeSigning,
        "kSecTrustSettingsPolicyName": "CodeSigning",
        kSecTrustSettingsResult as String: NSNumber(value: SecTrustSettingsResult.trustRoot.rawValue),
    ]]
    guard exactAppleCodeSigningTrustSettingsMismatch(valid as CFArray) == nil else {
        throw fail("native-keychain-access-test-failed", "inspect trust-settings parsing", "The exact Apple code-signing trust setting was rejected.")
    }
    let wrongPolicy: [[String: Any]] = [[
        kSecTrustSettingsPolicy as String: SecPolicyCreateBasicX509(),
        "kSecTrustSettingsPolicyName": "CodeSigning",
        kSecTrustSettingsResult as String: NSNumber(value: SecTrustSettingsResult.trustRoot.rawValue),
    ]]
    let wrongResult: [[String: Any]] = [[
        kSecTrustSettingsPolicy as String: codeSigning,
        "kSecTrustSettingsPolicyName": "CodeSigning",
        kSecTrustSettingsResult as String: NSNumber(value: SecTrustSettingsResult.deny.rawValue),
    ]]
    let wrongName: [[String: Any]] = [[
        kSecTrustSettingsPolicy as String: codeSigning,
        "kSecTrustSettingsPolicyName": "sslServer",
        kSecTrustSettingsResult as String: NSNumber(value: SecTrustSettingsResult.trustRoot.rawValue),
    ]]
    let missingName: [[String: Any]] = [[
        kSecTrustSettingsPolicy as String: codeSigning,
        kSecTrustSettingsResult as String: NSNumber(value: SecTrustSettingsResult.trustRoot.rawValue),
    ]]
    let overBroad: [[String: Any]] = [[
        kSecTrustSettingsPolicy as String: codeSigning,
        "kSecTrustSettingsPolicyName": "CodeSigning",
        kSecTrustSettingsResult as String: NSNumber(value: SecTrustSettingsResult.trustRoot.rawValue),
        kSecTrustSettingsKeyUsage as String: NSNumber(value: UInt32.max),
    ]]
    for invalid in [wrongPolicy, wrongResult, wrongName, missingName, overBroad] {
        guard exactAppleCodeSigningTrustSettingsMismatch(invalid as CFArray) != nil else {
            throw fail("native-keychain-access-test-failed", "inspect trust-settings parsing", "A non-exact trust setting was admitted.")
        }
    }
}

private func validateExactProfileKeyCleanup(
    keychain: SecKeychain,
    application: SecTrustedApplication
) throws {
    let label = "ai.nimi.macos-local-development.v1.cleanup-integration"
    let access = try createExactKeychainAccess(
        label: "Nimi exact profile key cleanup integration",
        restrictedApplications: [application],
        ownerApplications: [application]
    )
    _ = try generateTemporaryKeyPair(keychain: keychain, access: access, label: label)
    try deleteExactProfileKeys(label: label, keychain: keychain)
    for keyClass in [kSecAttrKeyClassPublic, kSecAttrKeyClassPrivate] {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrLabel: label,
            kSecAttrKeyClass: keyClass,
            kSecMatchSearchList: [keychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnAttributes: true,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        guard status == errSecItemNotFound else {
            throw securityFailure(
                "verify exact profile key cleanup",
                status == errSecSuccess ? errSecDuplicateItem : status
            )
        }
    }
}

private func storeTemporaryPassword(
    _ password: Data,
    keychain: SecKeychain,
    access: SecAccess
) throws -> SecKeychainItem {
    let status = SecItemAdd([
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: temporaryPasswordService,
        kSecAttrAccount: temporaryPasswordAccount,
        kSecAttrLabel: temporaryPasswordService,
        kSecValueData: password,
        kSecUseKeychain: keychain,
        kSecAttrAccess: access,
    ] as CFDictionary, nil)
    guard status == errSecSuccess else { throw securityFailure("store temporary signing Keychain password", status) }
    return try temporaryPasswordItem(keychain: keychain)
}

private func temporaryPasswordItem(keychain: SecKeychain) throws -> SecKeychainItem {
    var item: SecKeychainItem?
    let findStatus = temporaryPasswordService.withCString { service in
        temporaryPasswordAccount.withCString { account in
            SecKeychainFindGenericPassword(
                keychain,
                UInt32(temporaryPasswordService.utf8.count), service,
                UInt32(temporaryPasswordAccount.utf8.count), account,
                nil, nil, &item
            )
        }
    }
    guard findStatus == errSecSuccess, let item else {
        throw securityFailure("locate temporary signing Keychain password", findStatus)
    }
    return item
}

private func runFinalOwnerTransitionProbe(
    keychainPath: String,
    bootstrapPath: String,
    finalApplicationDigest: String,
    codesignApplicationDigest: String
) throws {
    let keychain = try openTemporaryProbeKeychain(keychainPath)
    let canonicalBootstrap = try canonicalPath(bootstrapPath)
    let canonicalFinal = try canonicalPath(CommandLine.arguments[0])
    let bootstrapApplication = try trustedApplication(canonicalBootstrap)
    _ = try inspectSignedCode(canonicalFinal)
    let runningBootstrap = try inspectRunningBootstrapCode(getppid())
    let installedBootstrap = try inspectBootstrapCode(canonicalBootstrap)
    guard runningBootstrap.identifier == installedBootstrap.identifier,
          runningBootstrap.teamId == installedBootstrap.teamId,
          runningBootstrap.cdhash == installedBootstrap.cdhash,
          runningBootstrap.designatedRequirement == installedBootstrap.designatedRequirement,
          kill(getppid(), 0) == 0 else {
        throw fail(
            "native-keychain-access-test-failed",
            "bind final custody closure to the immutable bootstrap parent",
            "The final-owner probe does not have the expected live bootstrap parent."
        )
    }
    let key = try loadTemporaryPrivateKey(keychain: keychain)
    let item = unsafeBitCast(key, to: SecKeychainItem.self)
    let finalPartition = "cdhash:\(try codeCDHash(canonicalFinal))"
    try closeKeychainOwnerTransitionPreservingFinalApplication(
        item,
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplicationDigests: [codesignApplicationDigest],
        bootstrapApplication: bootstrapApplication,
        finalApplicationDigest: finalApplicationDigest,
        partitions: ["apple:", finalPartition],
        label: "temporary final-process custody"
    )
}

private func loadTemporaryPrivateKey(
    keychain: SecKeychain,
    label: String = temporarySigningKeyLabel
) throws -> SecKey {
    let query: [CFString: Any] = [
        kSecClass: kSecClassKey,
        kSecAttrKeyClass: kSecAttrKeyClassPrivate,
        kSecAttrLabel: label,
        kSecMatchSearchList: [keychain],
        kSecMatchLimit: kSecMatchLimitOne,
        kSecReturnRef: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let result,
          CFGetTypeID(result) == SecKeyGetTypeID() else {
        throw securityFailure(
            "load transitional private key in final process",
            status == errSecSuccess ? errSecDecode : status
        )
    }
    return unsafeBitCast(result, to: SecKey.self)
}

private func runFinalCustodyValidationProbe(
    keychainPath: String,
    finalApplicationDigest: String,
    codesignApplicationDigest: String
) throws {
    let keychain = try openTemporaryProbeKeychain(keychainPath)
    let canonicalFinal = try canonicalPath(CommandLine.arguments[0])
    _ = try inspectSignedCode(canonicalFinal)
    let key = try loadTemporaryPrivateKey(keychain: keychain)
    try validateKeychainAccessIdentityDigests(
        unsafeBitCast(key, to: SecKeychainItem.self),
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplicationDigests: [codesignApplicationDigest],
        ownerApplicationDigests: [finalApplicationDigest],
        partitions: ["apple:", "cdhash:\(try codeCDHash(canonicalFinal))"],
        label: "temporary fresh final custody"
    )
    let bornFinalKey = try loadTemporaryPrivateKey(
        keychain: keychain,
        label: lockedRolePrivateKeyLabel
    )
    try validateKeychainAccessIdentityDigests(
        unsafeBitCast(bornFinalKey, to: SecKeychainItem.self),
        restrictedAuthorization: kSecACLAuthorizationSign,
        restrictedApplicationDigests: [finalApplicationDigest],
        ownerApplicationDigests: [finalApplicationDigest],
        partitions: ["cdhash:\(try codeCDHash(canonicalFinal))"],
        label: "temporary fresh born-final custody"
    )
}

private func runPasswordCustodyProbe(_ keychainPath: String, expectAccess: Bool) throws {
    let keychain = try openTemporaryProbeKeychain(keychainPath)
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: temporaryPasswordService,
        kSecAttrAccount: temporaryPasswordAccount,
        kSecMatchSearchList: [keychain],
        kSecMatchLimit: kSecMatchLimitOne,
        kSecReturnData: true,
    ]
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    if expectAccess {
        guard status == errSecSuccess, let data = value as? Data, data.count == 48 else {
            throw securityFailure("read signed-owner password custody", status == errSecSuccess ? errSecDecode : status)
        }
        return
    }
    guard [errSecAuthFailed, errSecInteractionNotAllowed].contains(status), value == nil else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the password custody negative boundary",
            "An untrusted bootstrap process read the signing Keychain password."
        )
    }
}

private func runPasswordDeleteProbe(_ keychainPath: String, expectAccess: Bool) throws {
    let keychain = try openTemporaryProbeKeychain(keychainPath)
    let item = try temporaryPasswordItem(keychain: keychain)
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecMatchSearchList: [keychain],
        kSecMatchItemList: [item],
    ]
    let status = SecItemDelete(query as CFDictionary)
    if expectAccess {
        guard status == errSecSuccess else {
            throw securityFailure("delete signed-owner password custody by exact item reference", status)
        }
        guard try !temporaryPasswordExists(keychain: keychain) else {
            throw fail(
                "native-keychain-access-test-failed",
                "inspect the exact signed-owner password deletion",
                "The final-owner deletion returned success but the password remains."
            )
        }
        return
    }
    guard status == errSecInvalidOwnerEdit else {
        throw fail(
            "native-keychain-access-test-failed",
            "preserve the final-helper-only password deletion boundary",
            "The untrusted bootstrap deletion returned OSStatus \(status) instead of errSecInvalidOwnerEdit."
        )
    }
    guard try temporaryPasswordExists(keychain: keychain) else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the denied password deletion result",
            "The final-helper-only password disappeared after an invalid-owner deletion attempt."
        )
    }
}

private func temporaryPasswordExists(keychain: SecKeychain) throws -> Bool {
    var item: SecKeychainItem?
    let status = temporaryPasswordService.withCString { service in
        temporaryPasswordAccount.withCString { account in
            SecKeychainFindGenericPassword(
                keychain,
                UInt32(temporaryPasswordService.utf8.count), service,
                UInt32(temporaryPasswordAccount.utf8.count), account,
                nil, nil, &item
            )
        }
    }
    if status == errSecSuccess { return item != nil }
    if status == errSecItemNotFound { return false }
    throw securityFailure("inspect temporary signing Keychain password presence", status)
}

private func openTemporaryProbeKeychain(_ keychainPath: String) throws -> SecKeychain {
    guard keychainPath.hasPrefix("/"), !keychainPath.contains("\0") else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the temporary custody probe path",
            "A temporary custody probe requires one absolute Keychain path."
        )
    }
    var metadata = stat()
    guard lstat(keychainPath, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == getuid(),
          metadata.st_mode & 0o777 == 0o600 else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the temporary custody probe Keychain",
            "The temporary custody probe Keychain has unsafe metadata."
        )
    }
    var keychain: SecKeychain?
    let status = SecKeychainOpen(keychainPath, &keychain)
    guard status == errSecSuccess, let keychain else {
        throw securityFailure("open temporary custody probe Keychain", status)
    }
    return keychain
}

private func runLockedCustodyProbe(_ keychainPath: String) throws {
    guard keychainPath.hasPrefix("/"), !keychainPath.contains("\0") else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the locked custody probe path",
            "The locked custody probe requires one absolute Keychain path."
        )
    }
    var metadata = stat()
    guard lstat(keychainPath, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == getuid(),
          metadata.st_mode & 0o777 == 0o600 else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the locked custody probe Keychain",
            "The locked custody probe Keychain has unsafe metadata."
        )
    }
    var keychain: SecKeychain?
    let openStatus = SecKeychainOpen(keychainPath, &keychain)
    guard openStatus == errSecSuccess, let keychain else {
        throw securityFailure("open locked custody probe Keychain", openStatus)
    }
    let query: [CFString: Any] = [
        kSecClass: kSecClassKey,
        kSecAttrKeyClass: kSecAttrKeyClassPrivate,
        kSecAttrLabel: temporarySigningKeyLabel,
        kSecMatchSearchList: [keychain],
        kSecMatchLimit: kSecMatchLimitOne,
        kSecReturnRef: true,
    ]
    var value: CFTypeRef?
    let loadStatus = SecItemCopyMatching(query as CFDictionary, &value)
    if loadStatus == errSecSuccess, let value {
        guard CFGetTypeID(value) == SecKeyGetTypeID() else {
            throw fail(
                "native-keychain-access-test-failed",
                "inspect the locked custody probe key",
                "The locked custody probe returned a non-key object."
            )
        }
        let key = unsafeBitCast(value, to: SecKey.self)
        var access: SecAccess?
        let accessStatus = SecKeychainItemCopyAccess(
            unsafeBitCast(key, to: SecKeychainItem.self),
            &access
        )
        guard [errSecAuthFailed, errSecInteractionNotAllowed].contains(accessStatus), access == nil else {
            throw fail(
                "native-keychain-access-test-failed",
                "inspect the locked signing Keychain boundary",
                "A fresh process read a private-key ACL while its signing Keychain was locked."
            )
        }
        return
    }
    guard [errSecAuthFailed, errSecInteractionNotAllowed].contains(loadStatus) else {
        throw securityFailure("load locked custody probe private key", loadStatus)
    }
}

private func trustedApplication(_ path: String) throws -> SecTrustedApplication {
    var application: SecTrustedApplication?
    let status = SecTrustedApplicationCreateFromPath(path, &application)
    guard status == errSecSuccess, let application else {
        throw securityFailure("create trusted application", status)
    }
    return application
}

private func generateTemporaryKeyPair(
    keychain: SecKeychain,
    access: SecAccess,
    label: String
) throws -> (publicKey: SecKey, privateKey: SecKey) {
    let parameters: [CFString: Any] = [
        kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits: 256,
        kSecUseKeychain: keychain,
        kSecAttrAccess: access,
        kSecPrivateKeyAttrs: [
            kSecAttrLabel: label,
            kSecAttrApplicationTag: Data(label.utf8),
            kSecAttrIsPermanent: true,
            kSecAttrCanSign: true,
        ],
        kSecPublicKeyAttrs: [
            kSecAttrLabel: label,
            kSecAttrApplicationTag: Data(label.utf8),
            kSecAttrIsPermanent: true,
            kSecAttrCanVerify: true,
        ],
    ]
    var publicKey: SecKey?
    var privateKey: SecKey?
    let status = SecKeyGeneratePair(parameters as CFDictionary, &publicKey, &privateKey)
    guard status == errSecSuccess, let publicKey, let privateKey else {
        throw securityFailure("generate temporary code-signing key", status)
    }
    return (publicKey, privateKey)
}

private func createTemporaryCodeSigningCertificate(publicKey: SecKey, privateKey: SecKey) throws -> Data {
    try createTemporaryCertificate(
        subjectName: "Nimi Temporary Keychain ACL Integration",
        issuerName: "Nimi Temporary Keychain ACL Integration",
        publicKey: publicKey,
        issuerPrivateKey: privateKey,
        isCA: false
    )
}

private func validateInMemoryCertificateChain(keychain: SecKeychain) throws {
    let rootPair = try createInMemoryKeyPair(label: nonDurableCAKeyLabel)
    let leafPair = try createInMemoryKeyPair()
    let persistedRootQuery: [CFString: Any] = [
        kSecClass: kSecClassKey,
        kSecAttrLabel: nonDurableCAKeyLabel,
        kSecMatchSearchList: [keychain],
        kSecMatchLimit: kSecMatchLimitOne,
        kSecReturnAttributes: true,
    ]
    let persistedRootStatus = SecItemCopyMatching(persistedRootQuery as CFDictionary, nil)
    guard persistedRootStatus == errSecItemNotFound else {
        throw securityFailure(
            "verify non-durable CA key absence",
            persistedRootStatus == errSecSuccess ? errSecDuplicateItem : persistedRootStatus
        )
    }
    let rootData = try createTemporaryCertificate(
        subjectName: "Nimi Temporary In-Memory Root",
        issuerName: "Nimi Temporary In-Memory Root",
        publicKey: rootPair.publicKey,
        issuerPrivateKey: rootPair.privateKey,
        isCA: true
    )
    let leafData = try createTemporaryCertificate(
        subjectName: "Nimi Temporary In-Memory Code Signer",
        issuerName: "Nimi Temporary In-Memory Root",
        publicKey: leafPair.publicKey,
        issuerPrivateKey: rootPair.privateKey,
        isCA: false
    )
    guard let root = SecCertificateCreateWithData(nil, rootData as CFData),
          let leaf = SecCertificateCreateWithData(nil, leafData as CFData) else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the in-memory development certificate chain",
            "Cannot parse the generated CA or leaf certificate."
        )
    }
    var trust: SecTrust?
    let createStatus = SecTrustCreateWithCertificates(
        [leaf, root] as CFArray,
        SecPolicyCreateBasicX509(),
        &trust
    )
    guard createStatus == errSecSuccess, let trust else {
        throw securityFailure("create in-memory development certificate trust", createStatus)
    }
    let anchorStatus = SecTrustSetAnchorCertificates(trust, [root] as CFArray)
    guard anchorStatus == errSecSuccess else {
        throw securityFailure("set in-memory development certificate anchor", anchorStatus)
    }
    let anchorOnlyStatus = SecTrustSetAnchorCertificatesOnly(trust, true)
    guard anchorOnlyStatus == errSecSuccess else {
        throw securityFailure("isolate in-memory development certificate anchors", anchorOnlyStatus)
    }
    let networkStatus = SecTrustSetNetworkFetchAllowed(trust, false)
    guard networkStatus == errSecSuccess else {
        throw securityFailure("disable in-memory certificate network fetch", networkStatus)
    }
    var error: CFError?
    guard SecTrustEvaluateWithError(trust, &error) else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the generated development CA certificate profile",
            error?.localizedDescription ?? "The generated CA-to-leaf chain did not validate."
        )
    }
}

private func createInMemoryKeyPair(label: String? = nil) throws -> (publicKey: SecKey, privateKey: SecKey) {
    var attributes: [CFString: Any] = [
        kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits: 256,
        kSecAttrIsPermanent: false,
    ]
    if let label { attributes[kSecAttrLabel] = label }
    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
          let publicKey = SecKeyCopyPublicKey(privateKey) else {
        throw fail(
            "native-keychain-access-test-failed",
            "create the in-memory development certificate test keys",
            error?.takeRetainedValue().localizedDescription ?? "Cannot generate the in-memory P-256 key pair."
        )
    }
    return (publicKey, privateKey)
}

private func createTemporaryCertificate(
    subjectName: String,
    issuerName: String,
    publicKey: SecKey,
    issuerPrivateKey: SecKey,
    isCA: Bool
) throws -> Data {
    let algorithm = DER.sequence([DER.objectIdentifier([1, 2, 840, 10045, 4, 3, 2])])
    let subject = temporaryDistinguishedName(subjectName)
    let issuer = temporaryDistinguishedName(issuerName)
    let extensions = DER.sequence(isCA ? [
        certificateExtension([2, 5, 29, 19], critical: true, value: DER.sequence([DER.boolean(true)])),
        certificateExtension([2, 5, 29, 15], critical: true, value: DER.bitString(Data([0x06]), unusedBits: 1)),
    ] : [
        certificateExtension([2, 5, 29, 19], critical: true, value: DER.sequence([])),
        certificateExtension([2, 5, 29, 15], critical: true, value: DER.bitString(Data([0x80]), unusedBits: 7)),
        certificateExtension(
            [2, 5, 29, 37],
            critical: false,
            value: DER.sequence([DER.objectIdentifier([1, 3, 6, 1, 5, 5, 7, 3, 3])])
        ),
    ])
    let now = Date()
    let tbs = DER.sequence([
        DER.explicit(0, DER.integer(2)),
        DER.integer(UInt64.random(in: 1...UInt64.max)),
        algorithm,
        issuer,
        DER.sequence([DER.utcTime(now.addingTimeInterval(-60)), DER.utcTime(now.addingTimeInterval(3600))]),
        subject,
        try temporarySubjectPublicKeyInfo(publicKey),
        DER.explicit(3, extensions),
    ])
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
        issuerPrivateKey,
        .ecdsaSignatureMessageX962SHA256,
        tbs as CFData,
        &error
    ) as Data? else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the temporary certificate signature",
            error?.takeRetainedValue().localizedDescription ?? "Cannot sign the temporary certificate."
        )
    }
    return DER.sequence([tbs, algorithm, DER.bitString(signature)])
}

private func temporaryDistinguishedName(_ commonName: String) -> Data {
    DER.sequence([
        DER.set([DER.sequence([DER.objectIdentifier([2, 5, 4, 3]), DER.utf8String(commonName)])]),
    ])
}

private func addTemporaryCertificate(_ data: Data, label: String, keychain: SecKeychain) throws {
    guard let certificate = SecCertificateCreateWithData(nil, data as CFData) else {
        throw fail("native-keychain-access-test-failed", "inspect the temporary certificate", "Cannot parse a temporary certificate.")
    }
    let status = SecItemAdd([
        kSecClass: kSecClassCertificate,
        kSecValueRef: certificate,
        kSecUseKeychain: keychain,
        kSecAttrLabel: label,
    ] as CFDictionary, nil)
    guard status == errSecSuccess else { throw securityFailure("store temporary certificate", status) }
}

private func validateTemporaryCertificateFingerprintLookup(data: Data, label: String, keychain: SecKeychain) throws {
    let query: [CFString: Any] = [
        kSecClass: kSecClassCertificate,
        kSecMatchSearchList: [keychain],
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnRef: true,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let result,
          CFGetTypeID(result) == CFArrayGetTypeID() else {
        throw securityFailure(
            "enumerate temporary certificates for SHA-256 lookup",
            status == errSecSuccess ? errSecDecode : status
        )
    }
    let values = unsafeBitCast(result, to: CFArray.self)
    let expected = SHA256.hash(data: data)
    let matches = (0..<CFArrayGetCount(values)).filter { index in
        let certificate = unsafeBitCast(CFArrayGetValueAtIndex(values, index), to: SecCertificate.self)
        return SHA256.hash(data: SecCertificateCopyData(certificate) as Data) == expected
    }
    guard matches.count == 1 else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the certificate fingerprint lookup",
            "The exact temporary certificate fingerprint was not unique; explicit label \(label) is intentionally non-authorizing."
        )
    }
}

private func certificateExtension(_ oid: [UInt64], critical: Bool, value: Data) -> Data {
    var fields = [DER.objectIdentifier(oid)]
    if critical { fields.append(DER.boolean(true)) }
    fields.append(DER.octetString(value))
    return DER.sequence(fields)
}

private func temporarySubjectPublicKeyInfo(_ key: SecKey) throws -> Data {
    var error: Unmanaged<CFError>?
    guard let external = SecKeyCopyExternalRepresentation(key, &error) as Data?,
          external.count == 65, external.first == 0x04 else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the temporary P-256 key",
            error?.takeRetainedValue().localizedDescription ?? "The temporary public key is invalid."
        )
    }
    return DER.sequence([
        DER.sequence([
            DER.objectIdentifier([1, 2, 840, 10045, 2, 1]),
            DER.objectIdentifier([1, 2, 840, 10045, 3, 1, 7]),
        ]),
        DER.bitString(external),
    ])
}

func subjectPublicKeyInfo(_ key: SecKey) throws -> Data {
    try temporarySubjectPublicKeyInfo(key)
}

private func copySigningTarget(_ source: String, into root: URL, name: String) throws -> String {
    let destination = root.appendingPathComponent("\(name)-target")
    try FileManager.default.copyItem(atPath: source, toPath: destination.path)
    guard chmod(destination.path, 0o700) == 0 else {
        throw fail("native-keychain-access-test-failed", "inspect the signing target", "Cannot secure the temporary signing target.")
    }
    return destination.path
}

private func codesign(
    _ target: String,
    identitySHA1: String,
    keychainPath: String,
    environment: [String: String]
) throws {
    _ = try runBounded(
        "/usr/bin/codesign",
        [
            "--force", "--sign", identitySHA1,
            "--keychain", keychainPath,
            "--identifier", "ai.nimi.keychain-access-integration",
            "--options", "runtime",
            "--timestamp=none",
            target,
        ],
        environment: environment
    )
    _ = try runBounded("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", target], environment: environment)
}

private func runBounded(
    _ executable: String,
    _ arguments: [String],
    environment: [String: String]
) throws -> Data {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = environment
    process.standardInput = FileHandle.nullDevice
    let output = Pipe()
    let errors = Pipe()
    process.standardOutput = output
    process.standardError = errors
    let finished = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in finished.signal() }
    try process.run()
    if finished.wait(timeout: .now() + 15) == .timedOut {
        process.terminate()
        process.waitUntilExit()
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the non-interactive Keychain ACL",
            "\(URL(fileURLWithPath: executable).lastPathComponent) did not finish without Keychain interaction."
        )
    }
    let stdout = output.fileHandleForReading.readDataToEndOfFile()
    let stderr = errors.fileHandleForReading.readDataToEndOfFile()
    guard stdout.count <= 1024 * 1024, stderr.count <= 1024 * 1024,
          process.terminationStatus == 0 else {
        let diagnostic = String(data: stderr, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the non-interactive Keychain ACL",
            "\(URL(fileURLWithPath: executable).lastPathComponent) failed with status \(process.terminationStatus): \(diagnostic.prefix(500))"
        )
    }
    return stdout
}

private func codeCDHash(_ path: String) throws -> String {
    var code: SecStaticCode?
    let createStatus = SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &code)
    guard createStatus == errSecSuccess, let code else { throw securityFailure("open temporary signed code", createStatus) }
    var information: CFDictionary?
    let infoStatus = SecCodeCopySigningInformation(code, SecCSFlags(rawValue: UInt32(kSecCSSigningInformation)), &information)
    guard infoStatus == errSecSuccess,
          let values = information as? [CFString: Any],
          let cdhash = values[kSecCodeInfoUnique] as? Data,
          cdhash.count == 20 else {
        throw securityFailure("inspect temporary signed code", infoStatus == errSecSuccess ? errSecDecode : infoStatus)
    }
    return cdhash.map { String(format: "%02x", $0) }.joined()
}

private func validateCompleteSignedCodeIdentity(_ path: String, expectedLeafSPKI: String) throws {
    let identity = try inspectSignedCode(path)
    guard identity.identifier == "ai.nimi.keychain-access-integration",
          identity.teamId.isEmpty,
          identity.cdhash.count == 40,
          identity.designatedRequirement.contains("identifier \"ai.nimi.keychain-access-integration\""),
          identity.leafSPKISHA256 == expectedLeafSPKI,
          identity.hardenedRuntime else {
        throw fail(
            "native-keychain-access-test-failed",
            "inspect the complete Security.framework signing information",
            "The signed integration target does not expose the required code identity fields."
        )
    }
}

private func canonicalPath(_ path: String) throws -> String {
    guard let resolved = realpath(path, nil) else {
        throw fail("native-keychain-access-test-failed", "inspect the integration executable", "Cannot resolve the integration executable.")
    }
    defer { free(resolved) }
    return String(cString: resolved)
}
