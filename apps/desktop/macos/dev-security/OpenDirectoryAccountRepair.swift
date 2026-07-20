import Darwin
import Foundation
import OpenDirectory

func runtimeDirectoryRecord(
    _ record: RuntimeDirectoryRecord,
    matches plan: RuntimeAccountCreationPlan
) -> Bool {
    let identifier = String(plan.identifier)
    guard record.canonicalName == runtimeAccountName,
          record.one(kODAttributeTypeRecordName) == runtimeAccountName,
          record.one(kODAttributeTypeFullName) == runtimeAccountFullName,
          !record.hasDelegatedWriter else { return false }
    switch record.kind {
    case .group:
        return record.one(kODAttributeTypePrimaryGroupID) == identifier
            && record.one(kODAttributeTypeGUID) == plan.groupGeneratedUID
            && runtimeForbiddenExplicitGroupMembershipAttributes.allSatisfy(record.absent)
    case .user:
        return record.one(kODAttributeTypeUniqueID) == identifier
            && record.one(kODAttributeTypePrimaryGroupID) == identifier
            && record.one(kODAttributeTypeNFSHomeDirectory) == runtimeHomeDirectory
            && record.one(kODAttributeTypeUserShell) == runtimeLoginShell
            && record.one(kODAttributeTypePassword) == runtimePasswordRecordValue
            && record.one(kODAttributeTypeGUID) == plan.userGeneratedUID
            && record.one(runtimeHiddenAttribute) == runtimeDirectoryServiceHiddenRecordValue
            && runtimeForbiddenAuthenticationMaterialAttributes.allSatisfy(record.absent)
    }
}

struct RuntimeDirectoryFieldMismatch: Codable, Equatable {
    let recordKind: String
    let attribute: String
    let observedCount: Int
    let observedTypes: [String]
    let observedDigestSHA256: String
}

struct RuntimeAccountRepairDiagnosis {
    let plan: RuntimeAccountCreationPlan?
    let mismatches: [RuntimeDirectoryFieldMismatch]
    let authenticationEvidenceSHA256: String

    var matchesDeleteOnlyResidue: Bool {
        plan != nil && mismatches.isEmpty
    }
}

enum RuntimeAccountRepairResidueClass: Codable, Equatable {
    case currentV4Exact
    case legacyV2DisabledUser

    init?(rawValue: String) {
        switch rawValue {
        case generatedRuntimeNormalRepairResidueClass: self = .currentV4Exact
        case generatedRuntimeLegacyRepairResidueClass: self = .legacyV2DisabledUser
        default: return nil
        }
    }

    var rawValue: String {
        switch self {
        case .currentV4Exact: return generatedRuntimeNormalRepairResidueClass
        case .legacyV2DisabledUser: return generatedRuntimeLegacyRepairResidueClass
        }
    }

    var sourcePrincipalCarrierContractVersion: Int {
        switch self {
        case .currentV4Exact: return generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion
        case .legacyV2DisabledUser: return generatedRuntimeLegacyRepairSourcePrincipalCarrierContractVersion
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        guard let parsed = Self(rawValue: value) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unknown Runtime account repair residue class.")
        }
        self = parsed
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

struct RuntimeAccountRepairWitness: Codable, Equatable {
    let residueClass: RuntimeAccountRepairResidueClass
    let plan: RuntimeAccountCreationPlan
    let authenticationEvidenceSHA256: String
}

private enum RuntimeRepairAuthenticationPosture {
    case absent
    case disabledUser
}

private func generatedRuntimeRepairMatcherAuthorityIsValid() -> Bool {
    generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion == runtimePrincipalCarrierContractVersion
        && generatedRuntimeLegacyRepairSourcePrincipalCarrierContractVersion
            != generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion
        && generatedRuntimeNormalRepairResidueClass != generatedRuntimeLegacyRepairResidueClass
        && generatedRuntimeLegacyRepairAuthenticationAuthorityAttribute == kODAttributeTypeAuthenticationAuthority
        && runtimeForbiddenAuthenticationMaterialAttributes.first
            == generatedRuntimeLegacyRepairAuthenticationAuthorityAttribute
        && generatedRuntimeLegacyRepairAuthenticationAuthorityValueType == String(describing: String.self)
        && generatedRuntimeLegacyRepairAuthenticationAuthorityExactValueCount == 1
        && !generatedRuntimeLegacyRepairAuthenticationAuthorityExactValue.isEmpty
        && generatedRuntimeLegacyRepairOtherAuthenticationMaterialAttributes
            == Array(runtimeForbiddenAuthenticationMaterialAttributes.dropFirst())
        && generatedRuntimeNormalRepairAuthenticationAuthorityPosture == runtimeAuthenticationAuthorityPosture
        && generatedRuntimeLegacyRepairOtherAuthenticationMaterialPosture == runtimeAuthenticationAuthorityPosture
}

/// Diagnoses only the closed, delete-only shape emitted by the retired v2
/// first-install principal carrier. This is deliberately independent from
/// `runtimeDirectoryRecord`: a v2 residue must never become a trusted v4
/// service principal.
func diagnoseLegacyV2RuntimeAccountRepairResidue(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord
) -> RuntimeAccountRepairDiagnosis {
    diagnoseRuntimeAccountRepairResidue(user: user, group: group, authenticationPosture: .disabledUser)
}

func diagnoseCurrentV4RuntimeAccountRepairResidue(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord
) -> RuntimeAccountRepairDiagnosis {
    diagnoseRuntimeAccountRepairResidue(user: user, group: group, authenticationPosture: .absent)
}

private func diagnoseRuntimeAccountRepairResidue(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord,
    authenticationPosture: RuntimeRepairAuthenticationPosture
) -> RuntimeAccountRepairDiagnosis {
    var mismatches = [RuntimeDirectoryFieldMismatch]()
    var mismatchKeys = Set<String>()

    func recordMismatch(_ record: RuntimeDirectoryRecord, _ attribute: String, values: [Any]? = nil) {
        let key = "\(record.kind.rawValue)\u{0}\(attribute)"
        guard mismatchKeys.insert(key).inserted else { return }
        let observed = values ?? record.values[attribute, default: []]
        mismatches.append(runtimeDirectoryFieldMismatch(record: record, attribute: attribute, values: observed))
    }

    func requireOne(
        _ record: RuntimeDirectoryRecord,
        _ attribute: String,
        equals expected: String
    ) {
        if record.one(attribute) != expected {
            recordMismatch(record, attribute)
        }
    }

    if !generatedRuntimeRepairMatcherAuthorityIsValid() {
        recordMismatch(user, "$generated-repair-authority", values: ["rejected"])
    }

    if user.kind != .user {
        recordMismatch(user, "$record-kind", values: [user.kind.rawValue])
    }
    if group.kind != .group {
        recordMismatch(group, "$record-kind", values: [group.kind.rawValue])
    }
    if user.canonicalName != runtimeAccountName {
        recordMismatch(user, "$canonical-name", values: [user.canonicalName])
    }
    if group.canonicalName != runtimeAccountName {
        recordMismatch(group, "$canonical-name", values: [group.canonicalName])
    }

    requireOne(user, kODAttributeTypeRecordName, equals: runtimeAccountName)
    requireOne(user, kODAttributeTypeFullName, equals: runtimeAccountFullName)
    requireOne(user, kODAttributeTypeNFSHomeDirectory, equals: runtimeHomeDirectory)
    requireOne(user, kODAttributeTypeUserShell, equals: runtimeLoginShell)
    requireOne(user, kODAttributeTypePassword, equals: runtimePasswordRecordValue)
    requireOne(user, runtimeHiddenAttribute, equals: runtimeDirectoryServiceHiddenRecordValue)
    requireOne(group, kODAttributeTypeRecordName, equals: runtimeAccountName)
    requireOne(group, kODAttributeTypeFullName, equals: runtimeAccountFullName)

    let uid = canonicalRuntimeIdentifier(user.one(kODAttributeTypeUniqueID))
    let userGID = canonicalRuntimeIdentifier(user.one(kODAttributeTypePrimaryGroupID))
    let groupGID = canonicalRuntimeIdentifier(group.one(kODAttributeTypePrimaryGroupID))
    if uid == nil { recordMismatch(user, kODAttributeTypeUniqueID) }
    if userGID == nil { recordMismatch(user, kODAttributeTypePrimaryGroupID) }
    if groupGID == nil { recordMismatch(group, kODAttributeTypePrimaryGroupID) }
    if let uid, let userGID, let groupGID, !(uid == userGID && uid == groupGID) {
        recordMismatch(user, kODAttributeTypeUniqueID)
        recordMismatch(user, kODAttributeTypePrimaryGroupID)
        recordMismatch(group, kODAttributeTypePrimaryGroupID)
    }

    let userGeneratedUID = user.one(kODAttributeTypeGUID)
    let groupGeneratedUID = group.one(kODAttributeTypeGUID)
    if userGeneratedUID.map(canonicalUUID) != true {
        recordMismatch(user, kODAttributeTypeGUID)
    }
    if groupGeneratedUID.map(canonicalUUID) != true {
        recordMismatch(group, kODAttributeTypeGUID)
    }
    if let userGeneratedUID, let groupGeneratedUID, userGeneratedUID == groupGeneratedUID {
        recordMismatch(user, kODAttributeTypeGUID)
        recordMismatch(group, kODAttributeTypeGUID)
    }

    for (attribute, values) in user.values
    where attribute.hasPrefix(runtimeForbiddenDelegatedWriterAttributePrefix) && !values.isEmpty {
        recordMismatch(user, attribute)
    }
    for (attribute, values) in group.values
    where attribute.hasPrefix(runtimeForbiddenDelegatedWriterAttributePrefix) && !values.isEmpty {
        recordMismatch(group, attribute)
    }
    for attribute in runtimeForbiddenExplicitGroupMembershipAttributes where !group.absent(attribute) {
        recordMismatch(group, attribute)
    }

    switch authenticationPosture {
    case .absent:
        for attribute in runtimeForbiddenAuthenticationMaterialAttributes where !user.absent(attribute) {
            recordMismatch(user, attribute)
        }
    case .disabledUser:
        let authorityAttribute = generatedRuntimeLegacyRepairAuthenticationAuthorityAttribute
        let disabledAuthority = user.values[authorityAttribute, default: []]
        if disabledAuthority.count != generatedRuntimeLegacyRepairAuthenticationAuthorityExactValueCount
            || disabledAuthority.first.map(runtimeDirectoryValueType)
                != generatedRuntimeLegacyRepairAuthenticationAuthorityValueType
            || (disabledAuthority.first as? String) != generatedRuntimeLegacyRepairAuthenticationAuthorityExactValue {
            recordMismatch(user, authorityAttribute)
        }
        for attribute in generatedRuntimeLegacyRepairOtherAuthenticationMaterialAttributes
        where !user.absent(attribute) {
            recordMismatch(user, attribute)
        }
    }

    let plan: RuntimeAccountCreationPlan?
    if let uid, let userGID, let groupGID,
       uid == userGID, uid == groupGID,
       let userGeneratedUID, canonicalUUID(userGeneratedUID),
       let groupGeneratedUID, canonicalUUID(groupGeneratedUID),
       userGeneratedUID != groupGeneratedUID {
        plan = try? makeRuntimeAccountCreationPlan(
            identifier: uid,
            groupGeneratedUID: groupGeneratedUID,
            userGeneratedUID: userGeneratedUID
        )
    } else {
        plan = nil
    }
    if plan == nil && mismatches.isEmpty {
        recordMismatch(user, "$plan-authority", values: ["rejected"])
    }

    return RuntimeAccountRepairDiagnosis(
        plan: plan,
        mismatches: mismatches.sorted {
            ($0.recordKind, $0.attribute) < ($1.recordKind, $1.attribute)
        },
        authenticationEvidenceSHA256: canonicalRuntimeAuthenticationEvidenceSHA256(user)
    )
}

func requireLegacyV2RuntimeAccountRepairResidue(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord
) throws -> RuntimeAccountRepairWitness {
    try requireRuntimeAccountRepairWitness(
        user: user,
        group: group,
        residueClass: .legacyV2DisabledUser
    )
}

func requireRuntimeAccountRepairWitness(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord,
    sourcePrincipalCarrierContractVersion: Int
) throws -> RuntimeAccountRepairWitness {
    guard generatedRuntimeRepairMatcherAuthorityIsValid() else {
        throw accountFailure("The generated Runtime repair matcher authority is invalid.")
    }
    let residueClass: RuntimeAccountRepairResidueClass
    switch sourcePrincipalCarrierContractVersion {
    case generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion:
        residueClass = .currentV4Exact
    case generatedRuntimeLegacyRepairSourcePrincipalCarrierContractVersion:
        residueClass = .legacyV2DisabledUser
    default:
        throw accountFailure("The Runtime service principal carrier version has no admitted repair residue class.")
    }
    return try requireRuntimeAccountRepairWitness(user: user, group: group, residueClass: residueClass)
}

func requireRuntimeAccountRepairWitness(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord,
    residueClass: RuntimeAccountRepairResidueClass
) throws -> RuntimeAccountRepairWitness {
    guard generatedRuntimeRepairMatcherAuthorityIsValid() else {
        throw accountFailure("The generated Runtime repair matcher authority is invalid.")
    }
    let diagnosis: RuntimeAccountRepairDiagnosis
    switch residueClass {
    case .currentV4Exact:
        guard runtimePrincipalCarrierContractVersion
                == generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion else {
            throw accountFailure("The current Runtime principal carrier version is not the admitted v4 repair class.")
        }
        diagnosis = diagnoseCurrentV4RuntimeAccountRepairResidue(user: user, group: group)
    case .legacyV2DisabledUser:
        diagnosis = diagnoseLegacyV2RuntimeAccountRepairResidue(user: user, group: group)
    }
    guard diagnosis.matchesDeleteOnlyResidue, let plan = diagnosis.plan else {
        throw accountFailure(
            "The Runtime service identity is not the exact delete-only \(residueClass.rawValue) residue "
                + "(fieldDiagnostics=\(runtimeDirectoryMismatchSummary(diagnosis.mismatches)))."
        )
    }
    let witness = RuntimeAccountRepairWitness(
        residueClass: residueClass,
        plan: plan,
        authenticationEvidenceSHA256: diagnosis.authenticationEvidenceSHA256
    )
    guard runtimeDirectoryRecord(user, matches: witness),
          runtimeDirectoryRecord(group, matches: witness) else {
        throw accountFailure("The Runtime service identity changed while its class-bound repair witness was created.")
    }
    return witness
}

func runtimeDirectoryRecord(
    _ record: RuntimeDirectoryRecord,
    matches witness: RuntimeAccountRepairWitness
) -> Bool {
    guard generatedRuntimeRepairMatcherAuthorityIsValid() else { return false }
    switch witness.residueClass {
    case .currentV4Exact:
        return runtimeDirectoryRecord(record, matches: witness.plan)
            && (record.kind != .user
                || canonicalRuntimeAuthenticationEvidenceSHA256(record) == witness.authenticationEvidenceSHA256)
    case .legacyV2DisabledUser:
        switch record.kind {
        case .group:
            return runtimeDirectoryRecord(record, matches: witness.plan)
        case .user:
            return legacyV2RuntimeDirectoryUserRecord(record, matches: witness.plan)
                && canonicalRuntimeAuthenticationEvidenceSHA256(record) == witness.authenticationEvidenceSHA256
        }
    }
}

private func legacyV2RuntimeDirectoryUserRecord(
    _ record: RuntimeDirectoryRecord,
    matches plan: RuntimeAccountCreationPlan
) -> Bool {
    let identifier = String(plan.identifier)
    let authorityAttribute = generatedRuntimeLegacyRepairAuthenticationAuthorityAttribute
    let disabledAuthority = record.values[authorityAttribute, default: []]
    return record.kind == .user
        && record.canonicalName == runtimeAccountName
        && record.one(kODAttributeTypeRecordName) == runtimeAccountName
        && record.one(kODAttributeTypeUniqueID) == identifier
        && record.one(kODAttributeTypePrimaryGroupID) == identifier
        && record.one(kODAttributeTypeFullName) == runtimeAccountFullName
        && record.one(kODAttributeTypeNFSHomeDirectory) == runtimeHomeDirectory
        && record.one(kODAttributeTypeUserShell) == runtimeLoginShell
        && record.one(kODAttributeTypePassword) == runtimePasswordRecordValue
        && record.one(kODAttributeTypeGUID) == plan.userGeneratedUID
        && record.one(runtimeHiddenAttribute) == runtimeDirectoryServiceHiddenRecordValue
        && !record.hasDelegatedWriter
        && disabledAuthority.count == generatedRuntimeLegacyRepairAuthenticationAuthorityExactValueCount
        && disabledAuthority.first.map(runtimeDirectoryValueType)
            == generatedRuntimeLegacyRepairAuthenticationAuthorityValueType
        && (disabledAuthority.first as? String) == generatedRuntimeLegacyRepairAuthenticationAuthorityExactValue
        && generatedRuntimeLegacyRepairOtherAuthenticationMaterialAttributes.allSatisfy(record.absent)
}

private func canonicalRuntimeIdentifier(_ value: String?) -> UInt32? {
    guard let value, !value.isEmpty,
          value.allSatisfy({ $0.isASCII && $0.isNumber }),
          let identifier = UInt32(value),
          String(identifier) == value,
          (runtimeAccountUIDMinimum...runtimeAccountUIDMaximum).contains(identifier) else {
        return nil
    }
    return identifier
}

private func runtimeDirectoryFieldMismatch(
    record: RuntimeDirectoryRecord,
    attribute: String,
    values: [Any]
) -> RuntimeDirectoryFieldMismatch {
    RuntimeDirectoryFieldMismatch(
        recordKind: record.kind.rawValue,
        attribute: attribute,
        observedCount: values.count,
        observedTypes: values.map(runtimeDirectoryValueType),
        observedDigestSHA256: sha256(canonicalRuntimeDirectoryValues(values))
    )
}

private func runtimeDirectoryMismatchSummary(_ mismatches: [RuntimeDirectoryFieldMismatch]) -> String {
    let encoded = try? JSONEncoder().encode(mismatches)
    return encoded.flatMap { String(data: $0, encoding: .utf8) } ?? "diagnostic-encoding-failed"
}

private func canonicalRuntimeAuthenticationEvidenceSHA256(_ user: RuntimeDirectoryRecord) -> String {
    var evidence = Data("nimi.macos-local-development-authentication-evidence/v1".utf8)
    for attribute in runtimeForbiddenAuthenticationMaterialAttributes {
        appendCanonicalRuntimeDirectoryComponent(Data(attribute.utf8), to: &evidence)
        appendCanonicalRuntimeDirectoryComponent(
            canonicalRuntimeDirectoryValues(user.values[attribute, default: []]),
            to: &evidence
        )
    }
    return sha256(evidence)
}

private func canonicalRuntimeDirectoryValues(_ values: [Any]) -> Data {
    var result = Data()
    var count = UInt64(values.count).bigEndian
    withUnsafeBytes(of: &count) { result.append(contentsOf: $0) }
    for value in values {
        appendCanonicalRuntimeDirectoryComponent(Data(runtimeDirectoryValueType(value).utf8), to: &result)
        appendCanonicalRuntimeDirectoryComponent(runtimeDirectoryValueBytes(value), to: &result)
    }
    return result
}

private func appendCanonicalRuntimeDirectoryComponent(_ component: Data, to result: inout Data) {
    var size = UInt64(component.count).bigEndian
    withUnsafeBytes(of: &size) { result.append(contentsOf: $0) }
    result.append(component)
}

private func runtimeDirectoryValueType(_ value: Any) -> String {
    switch value {
    case is String: return String(describing: String.self)
    case is Data: return String(describing: Data.self)
    case is Date: return String(describing: Date.self)
    case is NSNumber: return String(describing: NSNumber.self)
    default: return "unsupported:\(String(reflecting: type(of: value)))"
    }
}

private func runtimeDirectoryValueBytes(_ value: Any) -> Data {
    switch value {
    case let string as String:
        return Data(string.utf8)
    case let data as Data:
        return data
    case let date as Date:
        var bits = date.timeIntervalSinceReferenceDate.bitPattern.bigEndian
        return withUnsafeBytes(of: &bits) { Data($0) }
    case let number as NSNumber:
        return Data(number.stringValue.utf8)
    default:
        return Data(String(reflecting: value).utf8)
    }
}

func runtimeAccountPlan(
    user: RuntimeDirectoryRecord,
    group: RuntimeDirectoryRecord
) throws -> RuntimeAccountCreationPlan {
    guard user.kind == .user,
          group.kind == .group,
          let uid = user.one(kODAttributeTypeUniqueID).flatMap(UInt32.init),
          let userGID = user.one(kODAttributeTypePrimaryGroupID).flatMap(UInt32.init),
          let groupGID = group.one(kODAttributeTypePrimaryGroupID).flatMap(UInt32.init),
          uid == userGID, uid == groupGID,
          let userGeneratedUID = user.one(kODAttributeTypeGUID),
          let groupGeneratedUID = group.one(kODAttributeTypeGUID) else {
        throw accountFailure("The Runtime service Directory Services identity is incomplete.")
    }
    let plan = try makeRuntimeAccountCreationPlan(
        identifier: uid,
        groupGeneratedUID: groupGeneratedUID,
        userGeneratedUID: userGeneratedUID
    )
    guard runtimeDirectoryRecord(user, matches: plan),
          runtimeDirectoryRecord(group, matches: plan) else {
        throw accountFailure("The Runtime service Directory Services identity does not match the admitted profile.")
    }
    return plan
}

func validateRuntimeAccountPOSIXProjection(_ plan: RuntimeAccountCreationPlan) throws -> (uid: uid_t, gid: gid_t) {
    _ = try requireRuntimePOSIXProjectionPresent(plan, phase: "principal-present")
    return (uid_t(plan.identifier), gid_t(plan.identifier))
}
