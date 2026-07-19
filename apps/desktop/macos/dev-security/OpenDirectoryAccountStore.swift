import Darwin
import Foundation
import OpenDirectory

private let runtimeDirectoryNodeName = "/Local/Default"
private let runtimeHiddenAttribute = "dsAttrTypeNative:IsHidden"

enum RuntimeDirectoryRecordKind: String {
    case group
    case user

    var recordType: String {
        switch self {
        case .group: return kODRecordTypeGroups
        case .user: return kODRecordTypeUsers
        }
    }

    var requiredAttributes: [String] {
        switch self {
        case .group:
            return [
                kODAttributeTypeRecordName,
                kODAttributeTypePrimaryGroupID,
                kODAttributeTypeFullName,
                kODAttributeTypeGUID,
            ] + runtimeForbiddenExplicitGroupMembershipAttributes
        case .user:
            return [
                kODAttributeTypeRecordName,
                kODAttributeTypeUniqueID,
                kODAttributeTypePrimaryGroupID,
                kODAttributeTypeFullName,
                kODAttributeTypeNFSHomeDirectory,
                kODAttributeTypeUserShell,
                kODAttributeTypePassword,
                kODAttributeTypeGUID,
                runtimeHiddenAttribute,
            ] + runtimeForbiddenAuthenticationMaterialAttributes
        }
    }
}

struct RuntimeDirectoryRecord {
    let kind: RuntimeDirectoryRecordKind
    let record: ODRecord
    let canonicalName: String
    let values: [String: [Any]]

    func one(_ attribute: String) -> String? {
        guard let observed = values[attribute], observed.count == 1 else { return nil }
        return observed[0] as? String
    }

    func absent(_ attribute: String) -> Bool {
        values[attribute, default: []].isEmpty
    }

    var hasDelegatedWriter: Bool {
        values.contains { key, observed in
            key.hasPrefix(runtimeForbiddenDelegatedWriterAttributePrefix) && !observed.isEmpty
        }
    }
}

final class OpenDirectoryRuntimeAccountStore {
    private let node: ODNode

    init() throws {
        guard getuid() == 0, geteuid() == 0 else {
            throw accountFailure("Protected Runtime service account inspection requires a real-root helper process.")
        }
        do {
            node = try ODNode(session: ODSession.default(), name: runtimeDirectoryNodeName)
        } catch {
            throw openDirectoryFailure("open the fixed local Directory Services node", error)
        }
    }

    func observe(_ kind: RuntimeDirectoryRecordKind) throws -> RuntimeDirectoryRecord? {
        let records: [ODRecord]
        do {
            let query = try ODQuery(
                node: node,
                forRecordTypes: kind.recordType,
                attribute: kODAttributeTypeRecordName,
                matchType: ODMatchType(kODMatchEqualTo),
                queryValues: runtimeAccountName,
                returnAttributes: [kODAttributeTypeAllAttributes],
                maximumResults: 2
            )
            guard let result = try query.resultsAllowingPartial(false) as? [ODRecord] else {
                throw accountFailure("OpenDirectory returned an invalid \(kind.rawValue) query projection.")
            }
            records = result
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryFailure("query the exact Runtime service \(kind.rawValue)", error)
        }
        guard records.count <= 1 else {
            throw accountFailure("The Runtime service \(kind.rawValue) name resolved ambiguously.")
        }
        guard let record = records.first else { return nil }
        guard record.recordName == runtimeAccountName else {
            throw accountFailure("A case-folded or aliased Runtime service \(kind.rawValue) conflicts with the fixed account name.")
        }
        do {
            let details = try record.recordDetails(forAttributes: [kODAttributeTypeAllAttributes])
            var values = [String: [Any]]()
            for (rawKey, rawValue) in details {
                guard let attribute = rawKey as? String,
                      let observed = rawValue as? [Any] else {
                    throw accountFailure("OpenDirectory returned a malformed raw \(kind.rawValue) attribute projection.")
                }
                values[attribute] = observed
            }
            for attribute in kind.requiredAttributes where values[attribute] == nil {
                values[attribute] = []
            }
            return RuntimeDirectoryRecord(
                kind: kind,
                record: record,
                canonicalName: record.recordName,
                values: values
            )
        } catch {
            throw openDirectoryFailure("read the exact Runtime service \(kind.rawValue)", error)
        }
    }

    func selectUnusedIdentifier() throws -> UInt32 {
        var used = Set<UInt32>()
        try collectIdentifiers(recordType: kODRecordTypeUsers, attribute: kODAttributeTypeUniqueID, into: &used)
        try collectIdentifiers(recordType: kODRecordTypeGroups, attribute: kODAttributeTypePrimaryGroupID, into: &used)
        for candidate in stride(from: runtimeAccountUIDMaximum, through: runtimeAccountUIDMinimum, by: -1)
        where !used.contains(candidate) {
            return candidate
        }
        throw accountFailure("No collision-free macOS local role-account UID/GID is available in 450...499.")
    }

    @discardableResult
    func createGroup(_ plan: RuntimeAccountCreationPlan) throws -> RuntimeDirectoryRecord {
        let attributes: [AnyHashable: Any] = [
            kODAttributeTypePrimaryGroupID: [String(plan.identifier)],
            kODAttributeTypeFullName: [runtimeAccountFullName],
            kODAttributeTypeGUID: [plan.groupGeneratedUID],
        ]
        return try create(.group, attributes: attributes)
    }

    @discardableResult
    func createUser(_ plan: RuntimeAccountCreationPlan) throws -> RuntimeDirectoryRecord {
        let identifier = String(plan.identifier)
        let attributes: [AnyHashable: Any] = [
            kODAttributeTypeUniqueID: [identifier],
            kODAttributeTypePrimaryGroupID: [identifier],
            kODAttributeTypeFullName: [runtimeAccountFullName],
            kODAttributeTypeNFSHomeDirectory: [runtimeHomeDirectory],
            kODAttributeTypeUserShell: [runtimeLoginShell],
            kODAttributeTypePassword: [runtimePasswordRecordValue],
            kODAttributeTypeGUID: [plan.userGeneratedUID],
            runtimeHiddenAttribute: [runtimeDirectoryServiceHiddenRecordValue],
        ]
        return try create(.user, attributes: attributes)
    }

    func deleteExact(_ kind: RuntimeDirectoryRecordKind, plan: RuntimeAccountCreationPlan) throws {
        guard let observed = try observe(kind) else { return }
        guard runtimeDirectoryRecord(observed, matches: plan) else {
            throw accountFailure("Refusing to delete a Runtime service \(kind.rawValue) that does not match the transaction witness.")
        }
        do {
            try observed.record.delete()
        } catch {
            throw openDirectoryFailure("delete the exact Runtime service \(kind.rawValue)", error)
        }
        guard try observe(kind) == nil else {
            throw accountFailure("The Runtime service \(kind.rawValue) remained after exact deletion.")
        }
    }

    @discardableResult
    func validateExactRepairUser(_ witness: RuntimeAccountRepairWitness) throws -> RuntimeDirectoryRecord {
        guard let observed = try observe(.user),
              runtimeDirectoryRecord(observed, matches: witness) else {
            throw accountFailure("The Runtime service user does not match its class-bound repair witness.")
        }
        return observed
    }

    @discardableResult
    func validateExactRepairGroup(_ witness: RuntimeAccountRepairWitness) throws -> RuntimeDirectoryRecord {
        guard let observed = try observe(.group),
              runtimeDirectoryRecord(observed, matches: witness) else {
            throw accountFailure("The Runtime service group does not match its class-bound repair witness.")
        }
        return observed
    }

    func deleteExactRepairUser(_ witness: RuntimeAccountRepairWitness) throws {
        let observed = try validateExactRepairUser(witness)
        do {
            try observed.record.delete()
        } catch {
            throw openDirectoryFailure("delete the class-bound Runtime service user", error)
        }
        guard try observe(.user) == nil else {
            throw accountFailure("The class-bound Runtime service user remained after exact deletion.")
        }
    }

    func deleteExactRepairGroup(_ witness: RuntimeAccountRepairWitness) throws {
        let observed = try validateExactRepairGroup(witness)
        do {
            try observed.record.delete()
        } catch {
            throw openDirectoryFailure("delete the exact Runtime service repair group", error)
        }
        guard try observe(.group) == nil else {
            throw accountFailure("The exact Runtime service repair group remained after deletion.")
        }
    }

    func proveAbsent() throws {
        let user = try observe(.user)
        let group = try observe(.group)
        guard user == nil, group == nil else {
            throw accountFailure("The Runtime service user/group absence proof failed.")
        }
    }

    func proveNoExplicitGroupMembership(_ plan: RuntimeAccountCreationPlan) throws {
        let records: [ODRecord]
        do {
            let query = try ODQuery(
                node: node,
                forRecordTypes: kODRecordTypeGroups,
                attribute: kODAttributeTypeRecordName,
                matchType: ODMatchType(kODMatchAny),
                queryValues: nil,
                returnAttributes: [kODAttributeTypeRecordName] + runtimeForbiddenExplicitGroupMembershipAttributes,
                maximumResults: 0
            )
            guard let result = try query.resultsAllowingPartial(false) as? [ODRecord] else {
                throw accountFailure("OpenDirectory returned an invalid full group-membership projection.")
            }
            records = result
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryFailure("query explicit local group memberships", error)
        }
        let forbiddenValues: [String: String] = [
            "dsAttrTypeStandard:GroupMembership": runtimeAccountName,
            "dsAttrTypeStandard:GroupMembers": plan.userGeneratedUID,
            "dsAttrTypeStandard:NestedGroups": plan.groupGeneratedUID,
        ]
        for record in records {
            let localGroupName = record.recordName ?? "<missing-record-name>"
            let details: [AnyHashable: Any]
            do {
                details = try record.recordDetails(forAttributes: runtimeForbiddenExplicitGroupMembershipAttributes)
            } catch {
                throw openDirectoryFailure("read explicit membership fields for local group \(localGroupName)", error)
            }
            for attribute in runtimeForbiddenExplicitGroupMembershipAttributes {
                guard let raw = details[attribute] else { continue }
                guard let values = raw as? [Any], values.allSatisfy({ $0 is String }) else {
                    throw accountFailure("OpenDirectory returned a malformed explicit group-membership value.")
                }
                if values.compactMap({ $0 as? String }).contains(forbiddenValues[attribute]) {
                    throw accountFailure("The Runtime service identity is explicitly attached to local group \(localGroupName).")
                }
            }
        }
    }

    private func create(
        _ kind: RuntimeDirectoryRecordKind,
        attributes: [AnyHashable: Any]
    ) throws -> RuntimeDirectoryRecord {
        do {
            let record = try node.createRecord(
                withRecordType: kind.recordType,
                name: runtimeAccountName,
                attributes: attributes
            )
            try record.synchronize()
        } catch {
            throw openDirectoryFailure("atomically create the Runtime service \(kind.rawValue)", error)
        }
        guard let observed = try observe(kind) else {
            throw accountFailure("The atomically created Runtime service \(kind.rawValue) was not observable.")
        }
        return observed
    }

    private func collectIdentifiers(
        recordType: String,
        attribute: String,
        into used: inout Set<UInt32>
    ) throws {
        do {
            let query = try ODQuery(
                node: node,
                forRecordTypes: recordType,
                attribute: kODAttributeTypeRecordName,
                matchType: ODMatchType(kODMatchAny),
                queryValues: nil,
                returnAttributes: [attribute],
                maximumResults: 0
            )
            guard let records = try query.resultsAllowingPartial(false) as? [ODRecord] else {
                throw accountFailure("OpenDirectory returned an invalid UID/GID collision projection.")
            }
            for record in records {
                let details = try record.recordDetails(forAttributes: [attribute])
                guard let raw = details[attribute] else { continue }
                guard let values = raw as? [Any], values.count == 1,
                      let value = values[0] as? String,
                      !value.isEmpty, value.allSatisfy({ $0.isASCII && $0.isNumber }),
                      let identifier = UInt32(value), String(identifier) == value else {
                    throw accountFailure("OpenDirectory returned a malformed canonical UID/GID collision value.")
                }
                used.insert(identifier)
            }
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryFailure("enumerate local Directory Services identifiers", error)
        }
    }
}

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
    guard let password = getpwnam(runtimeAccountName),
          password.pointee.pw_uid == plan.identifier,
          password.pointee.pw_gid == plan.identifier,
          String(cString: password.pointee.pw_name) == runtimeAccountName,
          String(cString: password.pointee.pw_dir) == runtimeHomeDirectory,
          String(cString: password.pointee.pw_shell) == runtimeLoginShell,
          let group = getgrnam(runtimeAccountName),
          group.pointee.gr_gid == plan.identifier,
          String(cString: group.pointee.gr_name) == runtimeAccountName,
          let uidRecord = getpwuid(uid_t(plan.identifier)),
          String(cString: uidRecord.pointee.pw_name) == runtimeAccountName,
          let gidRecord = getgrgid(gid_t(plan.identifier)),
          String(cString: gidRecord.pointee.gr_name) == runtimeAccountName else {
        throw accountFailure("The Runtime service POSIX identity projection does not match OpenDirectory.")
    }
    return (uid_t(plan.identifier), gid_t(plan.identifier))
}

func accountFailure(_ message: String) -> DevSecurityFailure {
    fail("runtime-service-repair-required", "repair the dedicated _nimiruntimedev OpenDirectory identity", message)
}

private func openDirectoryFailure(_ operation: String, _ error: Error) -> DevSecurityFailure {
    let value = error as NSError
    return accountFailure("\(operation) failed [domain=\(value.domain), code=\(value.code)]: \(value.localizedDescription)")
}
