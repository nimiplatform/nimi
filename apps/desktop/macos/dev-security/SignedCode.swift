import CryptoKit
import Foundation
import Security

// Security/CSCommon.h publishes these SecCodeSignatureFlags values, but the
// Command Line Tools Swift importer does not expose their C enum constants.
private let codeSignatureAdHocFlag: UInt32 = 0x0002
private let codeSignatureRuntimeFlag: UInt32 = 0x10000
private let codeSignatureLinkerSignedFlag: UInt32 = 0x20000

struct SignedCodeIdentity {
    let identifier: String
    let teamId: String
    let cdhash: String
    let designatedRequirement: String
    let leafSPKISHA256: String
    let hardenedRuntime: Bool
}

struct BootstrapCodeIdentity {
    let identifier: String
    let teamId: String
    let cdhash: String
    let designatedRequirement: String
}

func inspectSignedCode(_ path: String, checkNested: Bool = false) throws -> SignedCodeIdentity {
    try signedCodeIdentity(validatedStaticCode(path, checkNested: checkNested))
}

func requireSignedCodeCertificateRequirement(
    _ path: String,
    identifier: String,
    leafCertificateSHA1: String
) throws {
    guard identifier.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$"#, options: .regularExpression) != nil,
          leafCertificateSHA1.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil else {
        throw fail(
            "runtime-service-untrusted",
            "reprovision the exact local development signing profile",
            "The expected helper certificate requirement is malformed."
        )
    }
    let requirementText = "identifier \"\(identifier)\" and certificate leaf = H\"\(leafCertificateSHA1)\""
    var requirement: SecRequirement?
    let requirementStatus = SecRequirementCreateWithString(
        requirementText as CFString,
        [],
        &requirement
    )
    guard requirementStatus == errSecSuccess, let requirement else {
        throw codeFailure("construct exact helper certificate requirement", requirementStatus)
    }
    let code = try validatedStaticCode(path, checkNested: false)
    var validationErrors: Unmanaged<CFError>?
    let validationStatus = SecStaticCodeCheckValidityWithErrors(
        code,
        SecCSFlags(rawValue: UInt32(kSecCSStrictValidate | kSecCSCheckAllArchitectures)),
        requirement,
        &validationErrors
    )
    guard validationStatus == errSecSuccess else {
        let diagnostic = validationErrors?.takeRetainedValue().localizedDescription
            ?? "OSStatus \(validationStatus)"
        throw fail(
            "runtime-service-untrusted",
            "restore the exact certificate-bound development security helper",
            "The final helper does not satisfy its exact certificate requirement: \(diagnostic)"
        )
    }
}

func signedCodeCertificateChainDER(_ path: String) throws -> [Data] {
    let code = try validatedStaticCode(path, checkNested: false)
    var information: CFDictionary?
    let status = SecCodeCopySigningInformation(
        code,
        SecCSFlags(rawValue: UInt32(kSecCSSigningInformation)),
        &information
    )
    guard status == errSecSuccess,
          let values = information as? [CFString: Any],
          let certificates = values[kSecCodeInfoCertificates] as? [SecCertificate],
          certificates.count == 2 else {
        throw fail(
            "runtime-service-untrusted",
            "restore the exact locally signed final helper",
            "The final helper does not contain one exact leaf-to-local-root certificate chain."
        )
    }
    return certificates.map { SecCertificateCopyData($0) as Data }
}

func inspectBootstrapCode(_ path: String) throws -> BootstrapCodeIdentity {
    try bootstrapCodeIdentity(validatedStaticCode(path, checkNested: false))
}

func inspectRunningBootstrapCode(_ pid: pid_t) throws -> BootstrapCodeIdentity {
    guard pid > 1 else {
        throw fail("runtime-service-untrusted", "reinstall the immutable bootstrap helper", "A valid bootstrap helper pid is required.")
    }
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    var code: SecCode?
    let createStatus = SecCodeCopyGuestWithAttributes(nil, attributes, [], &code)
    guard createStatus == errSecSuccess, let code else {
        throw codeFailure("open running bootstrap helper code", createStatus)
    }
    var validationErrors: Unmanaged<CFError>?
    let validationStatus = SecCodeCheckValidityWithErrors(
        code,
        SecCSFlags(rawValue: UInt32(kSecCSStrictValidate)),
        nil,
        &validationErrors
    )
    guard validationStatus == errSecSuccess else {
        let diagnostic = validationErrors?.takeRetainedValue().localizedDescription ?? "OSStatus \(validationStatus)"
        throw fail("runtime-service-untrusted", "reinstall the immutable bootstrap helper", "Running bootstrap code validation failed: \(diagnostic)")
    }
    var staticCode: SecStaticCode?
    let staticStatus = SecCodeCopyStaticCode(code, [], &staticCode)
    guard staticStatus == errSecSuccess, let staticCode else {
        throw codeFailure("bind running bootstrap helper to static code", staticStatus)
    }
    return try bootstrapCodeIdentity(staticCode)
}

private func validatedStaticCode(_ path: String, checkNested: Bool) throws -> SecStaticCode {
    var code: SecStaticCode?
    let createStatus = SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &code)
    guard createStatus == errSecSuccess, let code else {
        throw codeFailure("open signed code", createStatus)
    }
    var validationErrors: Unmanaged<CFError>?
    var rawFlags = kSecCSStrictValidate | kSecCSCheckAllArchitectures
    if checkNested { rawFlags |= kSecCSCheckNestedCode }
    let flags = SecCSFlags(rawValue: UInt32(rawFlags))
    let validationStatus = SecStaticCodeCheckValidityWithErrors(code, flags, nil, &validationErrors)
    guard validationStatus == errSecSuccess else {
        let diagnostic = validationErrors?.takeRetainedValue().localizedDescription ?? "OSStatus \(validationStatus)"
        throw fail("runtime-service-untrusted", "rebuild, sign, and reinstall the exact development candidate", "Code signature validation failed for \(path): \(diagnostic)")
    }
    return code
}

func inspectRunningSignedCode(_ pid: pid_t) throws -> SignedCodeIdentity {
    guard pid > 1 else {
        throw fail("runtime-service-untrusted", "repair the fixed launchd service", "A valid Runtime pid is required for dynamic code inspection.")
    }
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    var code: SecCode?
    let createStatus = SecCodeCopyGuestWithAttributes(nil, attributes, [], &code)
    guard createStatus == errSecSuccess, let code else {
        throw codeFailure("open running signed code", createStatus)
    }
    var validationErrors: Unmanaged<CFError>?
    let flags = SecCSFlags(rawValue: UInt32(kSecCSStrictValidate))
    let validationStatus = SecCodeCheckValidityWithErrors(code, flags, nil, &validationErrors)
    guard validationStatus == errSecSuccess else {
        let diagnostic = validationErrors?.takeRetainedValue().localizedDescription ?? "OSStatus \(validationStatus)"
        throw fail("runtime-service-untrusted", "repair the signed Runtime launchd service", "Dynamic code signature validation failed for pid \(pid): \(diagnostic)")
    }
    var staticCode: SecStaticCode?
    let staticStatus = SecCodeCopyStaticCode(code, [], &staticCode)
    guard staticStatus == errSecSuccess, let staticCode else {
        throw codeFailure("bind running code to its static code", staticStatus)
    }
    return try signedCodeIdentity(staticCode)
}

private func signedCodeIdentity(_ code: SecStaticCode) throws -> SignedCodeIdentity {
    var information: CFDictionary?
    let informationFlags = SecCSFlags(
        rawValue: UInt32(kSecCSSigningInformation | kSecCSRequirementInformation)
    )
    let informationStatus = SecCodeCopySigningInformation(
        code,
        informationFlags,
        &information
    )
    guard informationStatus == errSecSuccess else {
        throw codeFailure("inspect signed code identity", informationStatus)
    }
    guard let values = information as? [CFString: Any] else {
        throw incompleteCodeIdentity(["signing-information-dictionary"])
    }

    let requiredFields: [(CFString, String)] = [
        (kSecCodeInfoIdentifier, "identifier"),
        (kSecCodeInfoUnique, "cdhash"),
        (kSecCodeInfoDesignatedRequirement, "designated-requirement"),
        (kSecCodeInfoCertificates, "certificate-chain"),
        (kSecCodeInfoFlags, "code-signature-flags"),
    ]
    let missingFields = requiredFields.compactMap { key, name in
        values[key] == nil ? name : nil
    }
    guard missingFields.isEmpty else {
        throw incompleteCodeIdentity(missingFields)
    }
    guard let identifier = values[kSecCodeInfoIdentifier] as? String,
          !identifier.isEmpty,
          let cdhashData = values[kSecCodeInfoUnique] as? Data,
          !cdhashData.isEmpty,
          let requirementValue = values[kSecCodeInfoDesignatedRequirement],
          CFGetTypeID(requirementValue as CFTypeRef) == SecRequirementGetTypeID(),
          let certificates = values[kSecCodeInfoCertificates] as? [SecCertificate],
          let leaf = certificates.first,
          let flagsNumber = values[kSecCodeInfoFlags] as? NSNumber else {
        throw fail(
            "runtime-service-untrusted",
            "rebuild, sign, and reinstall the exact development candidate",
            "Signed code identity contains malformed required fields."
        )
    }
    let requirement = unsafeBitCast(requirementValue as CFTypeRef, to: SecRequirement.self)
    var requirementText: CFString?
    let requirementStatus = SecRequirementCopyString(requirement, [], &requirementText)
    guard requirementStatus == errSecSuccess, let requirementText else {
        throw codeFailure("render designated requirement", requirementStatus)
    }
    guard let publicKey = SecCertificateCopyKey(leaf) else {
        throw fail("runtime-service-untrusted", "reprovision the local development identities", "Signed code leaf certificate has no public key.")
    }
    let spki = try subjectPublicKeyInfo(publicKey)
    return SignedCodeIdentity(
        identifier: identifier,
        teamId: values[kSecCodeInfoTeamIdentifier] as? String ?? "",
        cdhash: cdhashData.hex,
        designatedRequirement: requirementText as String,
        leafSPKISHA256: SHA256.hash(data: spki).hex,
        hardenedRuntime: flagsNumber.uint32Value & codeSignatureRuntimeFlag != 0
    )
}

private func bootstrapCodeIdentity(_ code: SecStaticCode) throws -> BootstrapCodeIdentity {
    var information: CFDictionary?
    let informationFlags = SecCSFlags(
        rawValue: UInt32(kSecCSSigningInformation | kSecCSRequirementInformation)
    )
    let informationStatus = SecCodeCopySigningInformation(code, informationFlags, &information)
    guard informationStatus == errSecSuccess else {
        throw codeFailure("inspect bootstrap code identity", informationStatus)
    }
    guard let values = information as? [CFString: Any],
          let identifier = values[kSecCodeInfoIdentifier] as? String,
          !identifier.isEmpty,
          let cdhashData = values[kSecCodeInfoUnique] as? Data,
          cdhashData.count == 20,
          let requirementValue = values[kSecCodeInfoDesignatedRequirement],
          CFGetTypeID(requirementValue as CFTypeRef) == SecRequirementGetTypeID(),
          let flagsNumber = values[kSecCodeInfoFlags] as? NSNumber,
          values[kSecCodeInfoCertificates] == nil,
          values[kSecCodeInfoTeamIdentifier] == nil else {
        throw fail(
            "runtime-service-untrusted",
            "rebuild the exact local development bootstrap helper",
            "Bootstrap code identity is not an exact certificate-free linker signature."
        )
    }
    let rawFlags = flagsNumber.uint32Value
    guard rawFlags & codeSignatureAdHocFlag != 0,
          rawFlags & codeSignatureLinkerSignedFlag != 0,
          rawFlags & codeSignatureRuntimeFlag == 0 else {
        throw fail(
            "runtime-service-untrusted",
            "rebuild the exact local development bootstrap helper",
            "Bootstrap helper must be linker-signed ad-hoc code and must not impersonate an admitted hardened carrier."
        )
    }
    let requirement = unsafeBitCast(requirementValue as CFTypeRef, to: SecRequirement.self)
    var requirementText: CFString?
    let requirementStatus = SecRequirementCopyString(requirement, [], &requirementText)
    guard requirementStatus == errSecSuccess, let requirementText else {
        throw codeFailure("render bootstrap designated requirement", requirementStatus)
    }
    let cdhash = cdhashData.hex
    guard requirementText as String == "cdhash H\"\(cdhash)\"" else {
        throw fail(
            "runtime-service-untrusted",
            "rebuild the exact local development bootstrap helper",
            "Bootstrap designated requirement is not bound to its exact CDHash."
        )
    }
    return BootstrapCodeIdentity(
        identifier: identifier,
        teamId: "",
        cdhash: cdhash,
        designatedRequirement: requirementText as String
    )
}

private func incompleteCodeIdentity(_ fields: [String]) -> DevSecurityFailure {
    fail(
        "runtime-service-untrusted",
        "rebuild, sign, and reinstall the exact development candidate",
        "Signed code identity is missing required fields: \(fields.joined(separator: ", "))."
    )
}

private func codeFailure(_ operation: String, _ status: OSStatus) -> DevSecurityFailure {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
    return fail("runtime-service-untrusted", "rebuild, sign, and reinstall the exact development candidate", "\(operation) failed: \(message)")
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

private extension Digest {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
