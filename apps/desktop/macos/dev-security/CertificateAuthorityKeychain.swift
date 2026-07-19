import CryptoKit
import Foundation
import Security

extension DevelopmentCertificateAuthority {
    func assertProfileLabelsAbsent() throws {
        let passwordExists = try signingKeychainPasswordExists()
        if certificateAuthorityPathExists(signingKeychainPath)
            || certificateAuthorityPathExists(signingCleanupRecordPath)
            || passwordExists {
            throw fail(
                "runtime-service-repair-required",
                "run unprovision only after uninstalling the development service, then provision again",
                "A partial root-owned signing Keychain or unlock secret already exists."
            )
        }
        for suffix in ["root-ca"] + roleSpecifications.map({ $0.0 }) {
            let classes = try keychainItemClasses(label: profileLabel(suffix), keychain: systemKeychain)
            if !classes.isEmpty {
                throw fail(
                    "runtime-service-repair-required",
                    "run unprovision only after uninstalling the development service, then provision again",
                    "A partial or unrecorded local-development identity already exists for \(suffix) (classes=\(classes.joined(separator: ",")))."
                )
            }
        }
    }

    func generateKeyPair(label: String, access: SecAccess, keychain: SecKeychain) throws -> KeyPair {
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
            throw securityFailure("generate persistent P-256 Keychain key", status)
        }
        return KeyPair(publicKey: publicKey, privateKey: privateKey)
    }

    func generateEphemeralRootKeyPair() throws -> KeyPair {
        let parameters: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecAttrIsPermanent: false,
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(parameters as CFDictionary, &error) else {
            throw securityError("generate non-durable P-256 CA key", error)
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw fail(
                "runtime-service-repair-required",
                "restart the local CA provisioning transaction",
                "Cannot derive the non-durable CA public key."
            )
        }
        return KeyPair(publicKey: publicKey, privateKey: privateKey)
    }

    func addCertificate(_ data: Data, label: String, keychain: SecKeychain) throws -> SecCertificate {
        guard let certificate = SecCertificateCreateWithData(nil, data as CFData) else {
            throw fail("runtime-service-repair-required", "inspect X.509 certificate construction", "Security.framework rejected a generated development certificate.")
        }
        let query: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecValueRef: certificate,
            kSecAttrLabel: label,
            kSecUseKeychain: keychain,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw securityFailure("add certificate to System Keychain", status) }
        return certificate
    }

    func loadPublicKey(label: String, keychain: SecKeychain) throws -> SecKey {
        try loadKey(label: label, keyClass: kSecAttrKeyClassPublic, keychain: keychain)
    }

    func loadPrivateKey(label: String, keychain: SecKeychain) throws -> SecKey {
        try loadKey(label: label, keyClass: kSecAttrKeyClassPrivate, keychain: keychain)
    }

    func loadCertificate(sha256 expectedSHA256: String, keychain: SecKeychain) throws -> SecCertificate {
        guard expectedSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the development certificate fingerprint",
                "A development certificate fingerprint is malformed."
            )
        }
        let matches = try certificates(in: keychain).filter { certificate in
            sha256(SecCertificateCopyData(certificate) as Data) == expectedSHA256
        }
        guard matches.count == 1, let certificate = matches.first else {
            throw fail(
                "runtime-service-repair-required",
                "reprovision the development signing profile",
                "The fixed Keychain contains \(matches.count) certificates for the expected SHA-256 fingerprint."
            )
        }
        return certificate
    }

    func certificates(in keychain: SecKeychain) throws -> [SecCertificate] {
        let query: [CFString: Any] = [
            kSecClass: kSecClassCertificate,
            kSecMatchSearchList: [keychain],
            kSecMatchLimit: kSecMatchLimitAll,
            kSecReturnRef: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let result,
              CFGetTypeID(result) == CFArrayGetTypeID() else {
            throw securityFailure("enumerate fixed-Keychain certificates", status == errSecSuccess ? errSecDecode : status)
        }
        let values = unsafeBitCast(result, to: CFArray.self)
        return (0..<CFArrayGetCount(values)).map { index in
            unsafeBitCast(CFArrayGetValueAtIndex(values, index), to: SecCertificate.self)
        }
    }

    func certificateIfPresent(sha256 expectedSHA256: String, keychain: SecKeychain) throws -> SecCertificate? {
        guard expectedSHA256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the development signing cleanup fingerprint",
                "A cleanup certificate fingerprint is malformed."
            )
        }
        let matches = try certificates(in: keychain).filter { certificate in
            sha256(SecCertificateCopyData(certificate) as Data) == expectedSHA256
        }
        guard matches.count <= 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect duplicate exact development certificates before cleanup",
                "The fixed Keychain contains multiple certificates with one recorded DER SHA-256."
            )
        }
        return matches.first
    }

    func adminTrustCertificateIfPresent(sha256 expectedSHA256: String) throws -> SecCertificate? {
        var values: CFArray?
        let status = SecTrustSettingsCopyCertificates(.admin, &values)
        if trustSettingsCopyCertificatesReportsEmptyDomain(status) { return nil }
        guard status == errSecSuccess, let values else {
            throw securityFailure("enumerate admin trust certificates", status)
        }
        let matches = (0..<CFArrayGetCount(values)).compactMap { index -> SecCertificate? in
            let raw = CFArrayGetValueAtIndex(values, index)
            let object = unsafeBitCast(raw, to: CFTypeRef.self)
            guard CFGetTypeID(object) == SecCertificateGetTypeID() else { return nil }
            let certificate = unsafeBitCast(object, to: SecCertificate.self)
            return sha256(SecCertificateCopyData(certificate) as Data) == expectedSHA256
                ? certificate
                : nil
        }
        guard matches.count <= 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect duplicate exact admin trust certificates before cleanup",
                "The admin trust domain contains multiple certificates with one recorded DER SHA-256."
            )
        }
        return matches.first
    }

    func certificateMatchingPublicKeyIfPresent(label: String, keychain: SecKeychain) throws -> SecCertificate? {
        guard let publicKey = try loadKeyIfPresent(
            label: label,
            keyClass: kSecAttrKeyClassPublic,
            keychain: keychain
        ) else { return nil }
        let expectedSPKI = try subjectPublicKeyInfo(publicKey)
        let matches = try certificates(in: keychain).filter { certificate in
            guard let publicKey = SecCertificateCopyKey(certificate),
                  let spki = try? subjectPublicKeyInfo(publicKey) else { return false }
            return spki == expectedSPKI
        }
        guard matches.count <= 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect duplicate development certificates before unprovisioning",
                "The fixed Keychain contains multiple certificates for one development key."
            )
        }
        return matches.first
    }

    func deleteCertificate(_ certificate: SecCertificate, keychain: SecKeychain) throws {
        let status = SecItemDelete([
            kSecClass: kSecClassCertificate,
            kSecValueRef: certificate,
            kSecMatchSearchList: [keychain],
        ] as CFDictionary)
        if status != errSecSuccess, status != errSecItemNotFound {
            throw securityFailure("delete exact development certificate", status)
        }
    }

    func loadKey(label: String, keyClass: CFString, keychain: SecKeychain) throws -> SecKey {
        guard let key = try loadKeyIfPresent(label: label, keyClass: keyClass, keychain: keychain) else {
            throw securityFailure("load System Keychain key", errSecItemNotFound)
        }
        return key
    }

    func loadKeyIfPresent(label: String, keyClass: CFString, keychain: SecKeychain) throws -> SecKey? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrLabel: label,
            kSecAttrKeyClass: keyClass,
            kSecMatchSearchList: [keychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnRef: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let key = result as! SecKey? else {
            throw securityFailure("load System Keychain key", status)
        }
        return key
    }

    func keychainItemExists(label: String, keychain: SecKeychain) throws -> Bool {
        !(try keychainItemClasses(label: label, keychain: keychain)).isEmpty
    }

    func keychainItemClasses(label: String, keychain: SecKeychain) throws -> [String] {
        var matches = [String]()
        for (itemClass, name) in [(kSecClassKey, "key"), (kSecClassCertificate, "certificate")] {
            let query: [CFString: Any] = [
                kSecClass: itemClass,
                kSecAttrLabel: label,
                kSecMatchSearchList: [keychain],
                kSecMatchLimit: kSecMatchLimitOne,
                kSecReturnAttributes: true,
            ]
            let status = SecItemCopyMatching(query as CFDictionary, nil)
            if status == errSecSuccess {
                matches.append(name)
                continue
            }
            if status != errSecItemNotFound { throw securityFailure("inspect System Keychain profile item", status) }
        }
        return matches
    }

    func randomSecret(count: Int) throws -> Data {
        guard count >= 32, count <= 128 else {
            throw fail("runtime-service-repair-required", "inspect signing custody construction", "The signing Keychain password length is invalid.")
        }
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, bytes.count, bytes.baseAddress!)
        }
        guard status == errSecSuccess else { throw securityFailure("generate signing Keychain password", status) }
        return data
    }

    func createSigningKeychain(password: Data) throws -> SecKeychain {
        guard !certificateAuthorityPathExists(signingKeychainPath) else {
            throw fail("runtime-service-repair-required", "remove the partial signing profile before reprovisioning", "The fixed signing Keychain path already exists.")
        }
        var created: SecKeychain?
        let status = password.withUnsafeBytes { bytes in
            SecKeychainCreate(
                signingKeychainPath,
                UInt32(bytes.count),
                bytes.baseAddress,
                false,
                nil,
                &created
            )
        }
        guard status == errSecSuccess, let created else {
            throw securityFailure("create root-owned signing Keychain", status)
        }
        guard chown(signingKeychainPath, 0, 0) == 0, chmod(signingKeychainPath, 0o600) == 0 else {
            throw posixFailure("secure root-owned signing Keychain", signingKeychainPath)
        }
        _ = try secureMetadata(signingKeychainPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
        return created
    }

    func openSigningKeychain() throws -> SecKeychain {
        if let signingKeychain { return signingKeychain }
        _ = try secureMetadata(signingKeychainPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
        var opened: SecKeychain?
        let status = SecKeychainOpen(signingKeychainPath, &opened)
        guard status == errSecSuccess, let opened else {
            throw securityFailure("open root-owned signing Keychain", status)
        }
        signingKeychain = opened
        return opened
    }

    func deleteSigningKeychain() throws {
        guard certificateAuthorityPathExists(signingKeychainPath) else { return }
        let keychain = try openSigningKeychain()
        let status = SecKeychainDelete(keychain)
        guard status == errSecSuccess else { throw securityFailure("delete root-owned signing Keychain", status) }
        signingKeychain = nil
        if certificateAuthorityPathExists(signingKeychainPath) {
            throw fail("runtime-service-repair-required", "remove the residual signing Keychain", "The signing Keychain file remained after deletion.")
        }
    }

    func storeSigningKeychainPassword(
        _ password: Data,
        application: SecTrustedApplication,
        partition: String
    ) throws {
        let itemAccess = try createExactGenericPasswordAccess(
            label: "Nimi macOS Local Development Signing Keychain",
            application: application,
            partitions: [partition]
        )
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: signingKeychainPasswordService,
            kSecAttrAccount: signingKeychainPasswordAccount,
            kSecAttrLabel: signingKeychainPasswordService,
            kSecValueData: password,
            kSecUseKeychain: systemKeychain,
            kSecAttrAccess: itemAccess,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw securityFailure("store signing Keychain unlock secret", status) }
        try validateExactGenericPasswordAccess(
            try signingKeychainPasswordItem(),
            application: application,
            partitions: [partition],
            label: "signing Keychain unlock secret"
        )
    }

    func signingKeychainPasswordExists() throws -> Bool {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: signingKeychainPasswordService,
            kSecAttrAccount: signingKeychainPasswordAccount,
            kSecMatchSearchList: [systemKeychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnAttributes: true,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess { return true }
        if status == errSecItemNotFound { return false }
        throw securityFailure("inspect signing Keychain unlock secret", status)
    }

    func readSigningKeychainPassword() throws -> Data {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: signingKeychainPasswordService,
            kSecAttrAccount: signingKeychainPasswordAccount,
            kSecMatchSearchList: [systemKeychain],
            kSecMatchLimit: kSecMatchLimitOne,
            kSecReturnData: true,
        ]
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        guard status == errSecSuccess, let password = value as? Data,
              password.count >= 32, password.count <= 128 else {
            throw securityFailure("read signing Keychain unlock secret", status == errSecSuccess ? errSecDecode : status)
        }
        return password
    }

    func signingKeychainPasswordItem() throws -> SecKeychainItem {
        var item: SecKeychainItem?
        let status = signingKeychainPasswordService.withCString { service in
            signingKeychainPasswordAccount.withCString { account in
                SecKeychainFindGenericPassword(
                    systemKeychain,
                    UInt32(signingKeychainPasswordService.utf8.count), service,
                    UInt32(signingKeychainPasswordAccount.utf8.count), account,
                    nil, nil, &item
                )
            }
        }
        guard status == errSecSuccess, let item else {
            throw securityFailure("locate signing Keychain unlock secret", status)
        }
        return item
    }

    func validateSigningKeychainPasswordAccess(
        partition: String,
        helperACLIdentitySHA256: String
    ) throws {
        let item = try signingKeychainPasswordItem()
        try validateKeychainAccessIdentityDigests(
            item,
            restrictedAuthorization: kSecACLAuthorizationDecrypt,
            restrictedApplicationDigests: [helperACLIdentitySHA256],
            ownerApplicationDigests: [helperACLIdentitySHA256],
            partitions: [partition],
            label: "signing Keychain unlock secret"
        )
        try validateKeychainAuthorizationIdentityDigests(
            item,
            authorization: kSecACLAuthorizationDelete,
            applicationDigests: [helperACLIdentitySHA256],
            label: "signing Keychain unlock secret delete"
        )
    }

    func deleteSigningKeychainPassword() throws {
        guard try signingKeychainPasswordExists() else { return }
        try validateSigningKeychainPasswordDeletionAuthority()
        let item = try signingKeychainPasswordItem()
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecMatchSearchList: [systemKeychain],
            kSecMatchItemList: [item],
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess {
            throw securityFailure("delete signing Keychain unlock secret", status)
        }
        guard try !signingKeychainPasswordExists() else {
            throw fail(
                "runtime-service-repair-required",
                "retry cleanup through the exact signed final helper",
                "The signing Keychain unlock secret remains after exact-item deletion."
            )
        }
    }

    func validateSigningKeychainPasswordDeletionAuthority() throws {
        guard try canonicalCurrentExecutablePath() == helperInstallPath else {
            throw fail(
                "runtime-service-repair-required",
                "run unprovision through the exact signed final helper",
                "The bootstrap helper cannot delete the final-helper-only signing Keychain unlock secret."
            )
        }
        let identity = try inspectSignedCode(helperInstallPath)
        guard identity.identifier == "ai.nimi.dev-security-helper",
              identity.teamId.isEmpty,
              identity.hardenedRuntime else {
            throw fail(
                "runtime-service-untrusted",
                "restore the exact signed final helper before cleanup",
                "The installed final helper is not an admitted local-development cleanup anchor."
            )
        }
        let application = try trustedApplication(helperInstallPath)
        try validateExactGenericPasswordAccess(
            try signingKeychainPasswordItem(),
            application: application,
            partitions: ["cdhash:\(identity.cdhash)"],
            label: "signing Keychain unlock secret"
        )
    }

    func access(label: String, applications: [SecTrustedApplication]) throws -> SecAccess {
        try createExactKeychainAccess(
            label: label,
            restrictedApplications: applications,
            ownerApplications: [helperApplication]
        )
    }

}
