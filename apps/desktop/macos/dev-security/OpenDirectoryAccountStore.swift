import Darwin
import Foundation
import OpenDirectory

private let runtimeDirectoryNodeName = "/Local/Default"
let runtimeHiddenAttribute = "dsAttrTypeNative:IsHidden"

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

func accountFailure(_ message: String) -> DevSecurityFailure {
    fail("runtime-service-repair-required", "repair the dedicated _nimiruntimedev OpenDirectory identity", message)
}

private func openDirectoryFailure(_ operation: String, _ error: Error) -> DevSecurityFailure {
    let value = error as NSError
    return accountFailure("\(operation) failed [domain=\(value.domain), code=\(value.code)]: \(value.localizedDescription)")
}
