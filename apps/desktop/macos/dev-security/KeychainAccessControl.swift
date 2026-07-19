import CryptoKit
import Foundation
import Security

private let ownerAuthorization = kSecACLAuthorizationChangeACL
private let partitionAuthorization = kSecACLAuthorizationPartitionID

func createExactKeychainAccess(
    label: String,
    restrictedApplications: [SecTrustedApplication],
    ownerApplications: [SecTrustedApplication]
) throws -> SecAccess {
    guard !restrictedApplications.isEmpty, !ownerApplications.isEmpty else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the exact Keychain access policy",
            "A Keychain access policy cannot contain an empty trusted-application list."
        )
    }
    var access: SecAccess?
    let status = SecAccessCreate(label as CFString, restrictedApplications as CFArray, &access)
    guard status == errSecSuccess, let access else {
        throw securityFailure("create exact Keychain access", status)
    }
    try replaceApplications(
        in: access,
        authorization: ownerAuthorization,
        applications: ownerApplications,
        label: label
    )
    return access
}

func createExactKeychainAccess(
    label: String,
    restrictedApplications: [SecTrustedApplication],
    ownerApplications: [SecTrustedApplication],
    partitions: [String]
) throws -> SecAccess {
    let access = try createExactKeychainAccess(
        label: label,
        restrictedApplications: restrictedApplications,
        ownerApplications: ownerApplications
    )
    try replacePartitions(in: access, partitions: partitions, label: label)
    return access
}

func createExactGenericPasswordAccess(
    label: String,
    application: SecTrustedApplication,
    partitions: [String]
) throws -> SecAccess {
    let access = try createExactKeychainAccess(
        label: label,
        restrictedApplications: [application],
        ownerApplications: [application]
    )
    try replaceApplications(
        in: access,
        authorization: kSecACLAuthorizationDecrypt,
        applications: [application],
        label: label
    )
    try createApplicationsACL(
        in: access,
        authorization: kSecACLAuthorizationDelete,
        applications: [application],
        label: "\(label) delete"
    )
    try replacePartitions(in: access, partitions: partitions, label: label)
    return access
}

func validateExactGenericPasswordAccess(
    _ item: SecKeychainItem,
    application: SecTrustedApplication,
    partitions: [String],
    label: String
) throws {
    try validateExactKeychainAccess(
        item,
        restrictedAuthorization: kSecACLAuthorizationDecrypt,
        restrictedApplication: application,
        ownerApplication: application,
        partitions: partitions,
        label: label
    )
    let access = try copyAccess(item, label: label)
    try validateApplications(
        in: access,
        authorization: kSecACLAuthorizationDelete,
        expected: [application],
        label: "\(label) delete"
    )
}

func validateStrandedGenericPasswordCleanupBinding(
    _ item: SecKeychainItem,
    application: SecTrustedApplication,
    requiredPartition: String,
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try validateApplications(
        in: access,
        authorization: kSecACLAuthorizationDecrypt,
        expected: [application],
        label: label
    )
    try validateApplications(
        in: access,
        authorization: ownerAuthorization,
        expected: [application],
        label: "\(label) owner"
    )
    if let deleteEntries = SecAccessCopyMatchingACLList(access, kSecACLAuthorizationDelete) {
        guard CFArrayGetCount(deleteEntries) == 1 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the stranded unlock-secret delete ACL",
                "The stranded unlock-secret delete ACL is ambiguous."
            )
        }
        try validateApplications(
            in: access,
            authorization: kSecACLAuthorizationDelete,
            expected: [application],
            label: "\(label) delete"
        )
    }
    let partitionEntries = try partitionACLs(in: access, label: "\(label) partition")
    guard !partitionEntries.isEmpty else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the stranded unlock-secret partition ACL",
            "The stranded unlock-secret has no code partition ACL."
        )
    }
    var observedPartitions = Set<String>()
    for entry in partitionEntries {
        let contents = try copyContents(entry, label: "\(label) partition")
        guard contents.applications == nil, contents.prompt.rawValue == 0 else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the stranded unlock-secret partition ACL",
                "The stranded unlock-secret partition ACL can prompt or carries application subjects."
            )
        }
        observedPartitions.formUnion(try decodePartitionDescription(contents.description))
    }
    guard observedPartitions.contains(requiredPartition) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the stranded unlock-secret final-helper partition",
            "The stranded unlock-secret is not bound to the exact final-helper code partition."
        )
    }
}

func setExactKeychainPartitions(
    _ item: SecKeychainItem,
    partitions: [String],
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try replacePartitions(in: access, partitions: partitions, label: label)
    try persistAccess(access, on: item, label: label)
}

func replaceExactKeychainAccess(
    _ item: SecKeychainItem,
    restrictedAuthorization: CFString,
    restrictedApplications: [SecTrustedApplication],
    ownerApplications: [SecTrustedApplication],
    partitions: [String],
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try replaceApplications(
        in: access,
        authorization: restrictedAuthorization,
        applications: restrictedApplications,
        label: label
    )
    try replaceApplications(
        in: access,
        authorization: ownerAuthorization,
        applications: ownerApplications,
        label: label
    )
    try replacePartitions(in: access, partitions: partitions, label: label)
    try persistAccess(access, on: item, label: label)
}

func validateExactKeychainAccess(
    _ item: SecKeychainItem,
    restrictedAuthorization: CFString,
    restrictedApplication: SecTrustedApplication,
    ownerApplication: SecTrustedApplication,
    partitions: [String],
    label: String
) throws {
    try validateKeychainAccess(
        item,
        restrictedAuthorization: restrictedAuthorization,
        restrictedApplications: [restrictedApplication],
        ownerApplications: [ownerApplication],
        partitions: partitions,
        label: label
    )
}

func validateKeychainAccess(
    _ item: SecKeychainItem,
    restrictedAuthorization: CFString,
    restrictedApplications: [SecTrustedApplication],
    ownerApplications: [SecTrustedApplication],
    partitions: [String],
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try validateApplications(
        in: access,
        authorization: restrictedAuthorization,
        expected: restrictedApplications,
        label: label
    )
    try validateApplications(
        in: access,
        authorization: ownerAuthorization,
        expected: ownerApplications,
        label: "\(label) owner"
    )
    let partitionACL = try exactPartitionACL(in: access, label: "\(label) partition")
    let contents = try copyContents(partitionACL, label: "\(label) partition")
    guard contents.prompt.rawValue == 0,
          try decodePartitionDescription(contents.description) == validatedPartitions(partitions) else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) partition ACL does not match its exact admitted code partitions."
        )
    }
}

func trustedApplicationIdentitySHA256(_ application: SecTrustedApplication) throws -> String {
    SHA256.hash(data: try trustedApplicationData(application))
        .map { String(format: "%02x", $0) }
        .joined()
}

func validateKeychainAccessIdentityDigests(
    _ item: SecKeychainItem,
    restrictedAuthorization: CFString,
    restrictedApplicationDigests: [String],
    ownerApplicationDigests: [String],
    partitions: [String],
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try validateApplicationDigests(
        in: access,
        authorization: restrictedAuthorization,
        expected: restrictedApplicationDigests,
        label: label
    )
    try validateApplicationDigests(
        in: access,
        authorization: ownerAuthorization,
        expected: ownerApplicationDigests,
        label: "\(label) owner"
    )
    let partitionACL = try exactPartitionACL(in: access, label: "\(label) partition")
    let contents = try copyContents(partitionACL, label: "\(label) partition")
    guard contents.prompt.rawValue == 0,
          try decodePartitionDescription(contents.description) == validatedPartitions(partitions) else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) partition ACL does not match its exact admitted code partitions."
        )
    }
}

func validateKeychainAuthorizationIdentityDigests(
    _ item: SecKeychainItem,
    authorization: CFString,
    applicationDigests: [String],
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try validateApplicationDigests(
        in: access,
        authorization: authorization,
        expected: applicationDigests,
        label: label
    )
}

func closeKeychainOwnerTransitionPreservingFinalApplication(
    _ item: SecKeychainItem,
    restrictedAuthorization: CFString,
    restrictedApplicationDigests: [String],
    bootstrapApplication: SecTrustedApplication,
    finalApplicationDigest: String,
    partitions: [String],
    label: String
) throws {
    let access = try copyAccess(item, label: label)
    try validateApplicationDigests(
        in: access,
        authorization: restrictedAuthorization,
        expected: restrictedApplicationDigests,
        label: label
    )
    let ownerACL = try exactACL(in: access, authorization: ownerAuthorization, label: "\(label) owner")
    let ownerContents = try copyContents(ownerACL, label: "\(label) owner")
    guard let ownerApplications = ownerContents.applications,
          CFArrayGetCount(ownerApplications) == 2,
          ownerContents.prompt.rawValue == 0 else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) owner transition is absent, interactive, or ambiguous."
        )
    }
    let bootstrapDigest = try trustedApplicationIdentitySHA256(bootstrapApplication)
    let expectedTransition = try validatedApplicationDigests([bootstrapDigest, finalApplicationDigest])
    var finalApplication: SecTrustedApplication?
    var actualTransition = [String]()
    for index in 0..<CFArrayGetCount(ownerApplications) {
        let application = unsafeBitCast(
            CFArrayGetValueAtIndex(ownerApplications, index),
            to: SecTrustedApplication.self
        )
        let digest = try trustedApplicationIdentitySHA256(application)
        actualTransition.append(digest)
        if digest == finalApplicationDigest { finalApplication = application }
    }
    guard try validatedApplicationDigests(actualTransition) == expectedTransition,
          let finalApplication else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) owner transition does not contain the exact bootstrap and recorded final ACL identities."
        )
    }
    let status = SecACLSetContents(
        ownerACL,
        [finalApplication] as CFArray,
        ownerContents.description as CFString,
        SecKeychainPromptSelector(rawValue: 0)
    )
    guard status == errSecSuccess else {
        throw securityFailure("close \(label) owner transition", status)
    }
    try persistAccess(access, on: item, label: label)
    try validateKeychainAccessIdentityDigests(
        item,
        restrictedAuthorization: restrictedAuthorization,
        restrictedApplicationDigests: restrictedApplicationDigests,
        ownerApplicationDigests: [finalApplicationDigest],
        partitions: partitions,
        label: label
    )
}

private func copyAccess(_ item: SecKeychainItem, label: String) throws -> SecAccess {
    var access: SecAccess?
    let status = SecKeychainItemCopyAccess(item, &access)
    guard status == errSecSuccess, let access else {
        throw securityFailure("copy \(label) Keychain access", status)
    }
    return access
}

private func exactACL(in access: SecAccess, authorization: CFString, label: String) throws -> SecACL {
    guard let entries = SecAccessCopyMatchingACLList(access, authorization),
          CFArrayGetCount(entries) == 1 else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) ACL is absent or ambiguous."
        )
    }
    return unsafeBitCast(CFArrayGetValueAtIndex(entries, 0), to: SecACL.self)
}

private func exactPartitionACL(in access: SecAccess, label: String) throws -> SecACL {
    let matches = try partitionACLs(in: access, label: label)
    guard matches.count == 1, let partition = matches.first else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) ACL is absent or ambiguous (found \(matches.count))."
        )
    }
    return partition
}

private func partitionACLs(in access: SecAccess, label: String) throws -> [SecACL] {
    var entries: CFArray?
    let status = SecAccessCopyACLList(access, &entries)
    guard status == errSecSuccess, let entries else {
        throw securityFailure("copy \(label) ACL list", status)
    }
    var matches = [SecACL]()
    for index in 0..<CFArrayGetCount(entries) {
        let acl = unsafeBitCast(CFArrayGetValueAtIndex(entries, index), to: SecACL.self)
        let authorizations = SecACLCopyAuthorizations(acl)
        let containsPartition = (0..<CFArrayGetCount(authorizations)).contains { authorizationIndex in
            let authorization = unsafeBitCast(
                CFArrayGetValueAtIndex(authorizations, authorizationIndex),
                to: CFString.self
            )
            return CFEqual(authorization, partitionAuthorization)
        }
        if containsPartition {
            matches.append(acl)
        }
    }
    return matches
}

private func replaceApplications(
    in access: SecAccess,
    authorization: CFString,
    applications: [SecTrustedApplication],
    label: String
) throws {
    let applicationIdentities = try applications.map(trustedApplicationData)
    guard !applications.isEmpty, Set(applicationIdentities).count == applications.count else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the exact Keychain access policy",
            "The \(label) ACL cannot trust an empty or duplicate application list."
        )
    }
    let acl = try exactACL(in: access, authorization: authorization, label: label)
    let status = SecACLSetContents(
        acl,
        applications as CFArray,
        label as CFString,
        SecKeychainPromptSelector(rawValue: 0)
    )
    guard status == errSecSuccess else {
        throw securityFailure("replace \(label) trusted applications", status)
    }
}

private func createApplicationsACL(
    in access: SecAccess,
    authorization: CFString,
    applications: [SecTrustedApplication],
    label: String
) throws {
    guard SecAccessCopyMatchingACLList(access, authorization) == nil else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the exact Keychain access policy",
            "The \(label) ACL already exists before born-final construction."
        )
    }
    var acl: SecACL?
    let createStatus = SecACLCreateWithSimpleContents(
        access,
        applications as CFArray,
        label as CFString,
        SecKeychainPromptSelector(rawValue: 0),
        &acl
    )
    guard createStatus == errSecSuccess, let acl else {
        throw securityFailure("create \(label) ACL", createStatus)
    }
    let authorizationStatus = SecACLUpdateAuthorizations(acl, [authorization] as CFArray)
    guard authorizationStatus == errSecSuccess else {
        throw securityFailure("authorize \(label) ACL", authorizationStatus)
    }
}

private func replacePartitions(in access: SecAccess, partitions: [String], label: String) throws {
    let admitted = try validatedPartitions(partitions)
    let description = try encodePartitionDescription(admitted) as CFString
    let matches = try partitionACLs(in: access, label: "\(label) partition")
    if matches.isEmpty {
        var created: SecACL?
        let createStatus = SecACLCreateWithSimpleContents(
            access,
            nil,
            description,
            SecKeychainPromptSelector(rawValue: 0),
            &created
        )
        guard createStatus == errSecSuccess, let created else {
            throw securityFailure("create \(label) code partitions", createStatus)
        }
        let authorizationStatus = SecACLUpdateAuthorizations(
            created,
            [partitionAuthorization] as CFArray
        )
        guard authorizationStatus == errSecSuccess else {
            throw securityFailure("authorize \(label) code partitions", authorizationStatus)
        }
    } else {
        guard matches.count == 1, let acl = matches.first else {
            throw fail(
                "runtime-service-repair-required",
                "reprovision the development signing profile",
                "The \(label) partition ACL is ambiguous."
            )
        }
        let contents = try copyContents(acl, label: "\(label) partition")
        let status = SecACLSetContents(
            acl,
            contents.applications,
            description,
            SecKeychainPromptSelector(rawValue: 0)
        )
        guard status == errSecSuccess else {
            throw securityFailure("replace \(label) code partitions", status)
        }
    }
}

private func persistAccess(_ access: SecAccess, on item: SecKeychainItem, label: String) throws {
    let status = SecKeychainItemSetAccess(item, access)
    guard status == errSecSuccess else {
        throw securityFailure("persist exact \(label) Keychain access", status)
    }
}

private func validateApplications(
    in access: SecAccess,
    authorization: CFString,
    expected: [SecTrustedApplication],
    label: String
) throws {
    let acl = try exactACL(in: access, authorization: authorization, label: label)
    let contents = try copyContents(acl, label: label)
    guard let applications = contents.applications,
          !expected.isEmpty,
          CFArrayGetCount(applications) == expected.count,
          contents.prompt.rawValue == 0 else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) ACL is interactive or trusts an ambiguous application set."
        )
    }
    var actualIdentities = [Data]()
    for index in 0..<CFArrayGetCount(applications) {
        let actual = unsafeBitCast(
            CFArrayGetValueAtIndex(applications, index),
            to: SecTrustedApplication.self
        )
        actualIdentities.append(try trustedApplicationData(actual))
    }
    let expectedIdentities = try expected.map(trustedApplicationData)
    guard Set(actualIdentities).count == actualIdentities.count,
          Set(expectedIdentities).count == expectedIdentities.count,
          Set(actualIdentities) == Set(expectedIdentities) else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) ACL trusts an unexpected application."
        )
    }
}

private func validateApplicationDigests(
    in access: SecAccess,
    authorization: CFString,
    expected: [String],
    label: String
) throws {
    let expectedDigests = try validatedApplicationDigests(expected)
    let acl = try exactACL(in: access, authorization: authorization, label: label)
    let contents = try copyContents(acl, label: label)
    guard let applications = contents.applications,
          CFArrayGetCount(applications) == expectedDigests.count,
          contents.prompt.rawValue == 0 else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) ACL is interactive or trusts an ambiguous application set."
        )
    }
    var actualDigests = [String]()
    for index in 0..<CFArrayGetCount(applications) {
        let application = unsafeBitCast(
            CFArrayGetValueAtIndex(applications, index),
            to: SecTrustedApplication.self
        )
        actualDigests.append(try trustedApplicationIdentitySHA256(application))
    }
    guard try validatedApplicationDigests(actualDigests) == expectedDigests else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "The \(label) ACL identity digests do not match the root-owned public profile."
        )
    }
}

private func validatedApplicationDigests(_ digests: [String]) throws -> [String] {
    guard !digests.isEmpty,
          Set(digests).count == digests.count,
          digests.allSatisfy({ $0.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil }) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the exact Keychain ACL identity digests",
            "A Keychain ACL identity digest set is empty, duplicate, or malformed."
        )
    }
    return digests.sorted()
}

private func copyContents(
    _ acl: SecACL,
    label: String
) throws -> (applications: CFArray?, description: String, prompt: SecKeychainPromptSelector) {
    var applications: CFArray?
    var description: CFString?
    var prompt = SecKeychainPromptSelector(rawValue: 0)
    let status = SecACLCopyContents(acl, &applications, &description, &prompt)
    guard status == errSecSuccess, let description else {
        throw securityFailure("copy \(label) ACL contents", status == errSecSuccess ? errSecDecode : status)
    }
    return (applications, description as String, prompt)
}

private func validatedPartitions(_ partitions: [String]) throws -> [String] {
    let unique = Set(partitions)
    guard !partitions.isEmpty, partitions.count <= 2, unique.count == partitions.count,
          partitions.allSatisfy({ value in
              value == "apple:" || value.range(of: #"^cdhash:[a-f0-9]{40}$"#, options: .regularExpression) != nil
          }) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the exact Keychain code partitions",
            "A Keychain partition list contains an unadmitted value."
        )
    }
    return partitions.sorted()
}

private func encodePartitionDescription(_ partitions: [String]) throws -> String {
    let payload = ["Partitions": partitions]
    let data = try PropertyListSerialization.data(
        fromPropertyList: payload,
        format: .xml,
        options: 0
    )
    guard data.count > 0, data.count <= 4096 else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the Keychain partition payload",
            "The encoded Keychain partition payload has an invalid size."
        )
    }
    return data.map { String(format: "%02x", $0) }.joined()
}

private func decodePartitionDescription(_ description: String) throws -> [String] {
    let encoded = Array(description.utf8)
    guard !encoded.isEmpty, encoded.count <= 8192, encoded.count.isMultiple(of: 2) else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "A Keychain partition payload has an invalid encoded size."
        )
    }
    var data = Data(capacity: encoded.count / 2)
    for index in stride(from: 0, to: encoded.count, by: 2) {
        guard let high = hexNibble(encoded[index]), let low = hexNibble(encoded[index + 1]) else {
            throw fail(
                "runtime-service-repair-required",
                "reprovision the development signing profile",
                "A Keychain partition payload is not hexadecimal."
            )
        }
        data.append((high << 4) | low)
    }
    let value = try PropertyListSerialization.propertyList(from: data, options: [], format: nil)
    guard let dictionary = value as? [String: Any], Set(dictionary.keys) == Set(["Partitions"]),
          let partitions = dictionary["Partitions"] as? [String] else {
        throw fail(
            "runtime-service-repair-required",
            "reprovision the development signing profile",
            "A Keychain partition payload does not match its admitted schema."
        )
    }
    return try validatedPartitions(partitions)
}

private func hexNibble(_ byte: UInt8) -> UInt8? {
    switch byte {
    case 48...57: return byte - 48
    case 65...70: return byte - 65 + 10
    case 97...102: return byte - 97 + 10
    default: return nil
    }
}
