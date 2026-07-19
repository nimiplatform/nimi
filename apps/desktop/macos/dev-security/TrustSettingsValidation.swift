import Foundation
import Security

private let derivedTrustSettingsPolicyNameKey = "kSecTrustSettingsPolicyName"
private let exactCodeSigningPolicyName = "CodeSigning"

func trustSettingsCopyCertificatesReportsEmptyDomain(_ status: OSStatus) -> Bool {
    status == errSecNoTrustSettings
}

func exactAppleCodeSigningTrustSettingsMismatch(_ settings: CFArray) -> String? {
    let count = CFArrayGetCount(settings)
    guard count == 1 else { return "usage-constraint-count=\(count)" }

    let raw = CFArrayGetValueAtIndex(settings, 0)
    let object = unsafeBitCast(raw, to: CFTypeRef.self)
    guard CFGetTypeID(object) == CFDictionaryGetTypeID() else {
        return "usage-constraint-type=\(CFGetTypeID(object))"
    }
    let dictionary = unsafeBitCast(object, to: CFDictionary.self)
    let values = dictionary as NSDictionary
    let keys = values.allKeys.compactMap { $0 as? String }.sorted()
    let expectedKeys = [
        kSecTrustSettingsPolicy as String,
        derivedTrustSettingsPolicyNameKey,
        kSecTrustSettingsResult as String,
    ].sorted()
    guard values.count == 3, keys == expectedKeys else {
        return "usage-constraint-keys=\(keys.joined(separator: ","))"
    }

    guard let policyName = values.object(forKey: derivedTrustSettingsPolicyNameKey) as? String,
          policyName == exactCodeSigningPolicyName else {
        let observed = values.object(forKey: derivedTrustSettingsPolicyNameKey)
            .map { String(describing: $0) } ?? "missing"
        return "policy-name=\(observed)"
    }

    guard let policyValue = values.object(forKey: kSecTrustSettingsPolicy as String) else {
        return "policy=missing"
    }
    let policyObject = policyValue as CFTypeRef
    guard CFGetTypeID(policyObject) == SecPolicyGetTypeID() else {
        return "policy-type=\(CFGetTypeID(policyObject))"
    }
    let policy = unsafeBitCast(policyObject, to: SecPolicy.self)
    guard let properties = SecPolicyCopyProperties(policy) else {
        return "policy-properties=missing"
    }
    let policyProperties = properties as NSDictionary
    let propertyKeys = policyProperties.allKeys.compactMap { $0 as? String }.sorted()
    guard policyProperties.count == 1,
          propertyKeys == [kSecPolicyOid as String],
          let oid = policyProperties.object(forKey: kSecPolicyOid as String) as? String,
          oid == (kSecPolicyAppleCodeSigning as String) else {
        let oid = policyProperties.object(forKey: kSecPolicyOid as String) as? String ?? "missing"
        return "policy-properties=\(propertyKeys.joined(separator: ","));policy-oid=\(oid)"
    }

    guard let result = values.object(forKey: kSecTrustSettingsResult as String) as? NSNumber,
          CFGetTypeID(result) == CFNumberGetTypeID(),
          result.int32Value == SecTrustSettingsResult.trustRoot.rawValue else {
        let observed = (values.object(forKey: kSecTrustSettingsResult as String) as? NSNumber)?.stringValue ?? "missing"
        return "trust-result=\(observed)"
    }
    return nil
}
