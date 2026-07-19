import Foundation
import Security

func deleteExactProfileKeys(label: String, keychain: SecKeychain) throws {
    for keyClass in [kSecAttrKeyClassPublic, kSecAttrKeyClassPrivate] {
        let query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrLabel: label,
            kSecAttrApplicationTag: Data(label.utf8),
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecAttrKeyClass: keyClass,
            kSecMatchSearchList: [keychain],
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess, status != errSecItemNotFound {
            throw securityFailure("delete exact System Keychain profile key", status)
        }
    }
}
