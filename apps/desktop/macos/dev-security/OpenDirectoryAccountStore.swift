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
    private let session: ODSession
    private let node: ODNode

    init() throws {
        guard getuid() == 0, geteuid() == 0 else {
            throw accountFailure("Protected Runtime service account inspection requires a real-root helper process.")
        }
        do {
            let openedSession = try ODSession(options: nil)
            session = openedSession
            node = try ODNode(session: openedSession, name: runtimeDirectoryNodeName)
        } catch {
            let value = error as NSError
            throw principalDiagnosticFailure(
                "runtime-principal-directory-query-failed",
                "inspect the fixed local OpenDirectory node failure",
                "The fixed local OpenDirectory node could not be opened.",
                details: [
                    "phase": "directory-node-open",
                    "probe": "local-default-node",
                    "state": "open-error",
                    "return_code": value.code,
                    "verifier_pid": getpid(),
                ]
            )
        }
    }

    func observe(_ kind: RuntimeDirectoryRecordKind) throws -> RuntimeDirectoryRecord? {
        try observe(kind, attribute: kODAttributeTypeRecordName, value: runtimeAccountName)
    }

    func observeByIdentifier(
        _ kind: RuntimeDirectoryRecordKind,
        identifier: UInt32
    ) throws -> RuntimeDirectoryRecord? {
        let attribute = kind == .user ? kODAttributeTypeUniqueID : kODAttributeTypePrimaryGroupID
        return try observe(kind, attribute: attribute, value: String(identifier))
    }

    func proveRawAbsent(_ plan: RuntimeAccountCreationPlan, phase: String) throws {
        for kind in [RuntimeDirectoryRecordKind.user, .group] {
            let byName = try observe(kind)
            let byIdentifier = try observeByIdentifier(kind, identifier: plan.identifier)
            guard byName == nil, byIdentifier == nil else {
                throw principalDirectoryStateFailure(
                    phase: phase,
                    probe: "raw-od-\(kind.rawValue)-name-and-identifier",
                    state: "present-or-conflicting",
                    expectedIdentifier: plan.identifier,
                    observed: byName ?? byIdentifier
                )
            }
        }
    }

    func proveRawUserAbsentGroupExact(
        _ witness: RuntimeAccountRepairWitness,
        phase: String
    ) throws {
        let plan = witness.plan
        let userByName = try observe(.user)
        let userByIdentifier = try observeByIdentifier(.user, identifier: plan.identifier)
        guard userByName == nil, userByIdentifier == nil else {
            throw principalDirectoryStateFailure(
                phase: phase,
                probe: "raw-od-user-name-and-identifier",
                state: "present-or-conflicting",
                expectedIdentifier: plan.identifier,
                observed: userByName ?? userByIdentifier
            )
        }
        let groupByName = try observe(.group)
        let groupByIdentifier = try observeByIdentifier(.group, identifier: plan.identifier)
        guard let groupByName, let groupByIdentifier,
              runtimeDirectoryRecord(groupByName, matches: witness),
              runtimeDirectoryRecord(groupByIdentifier, matches: witness),
              groupByName.one(kODAttributeTypeGUID) == groupByIdentifier.one(kODAttributeTypeGUID) else {
            throw principalDirectoryStateFailure(
                phase: phase,
                probe: "raw-od-group-name-and-identifier",
                state: "absent-or-conflicting",
                expectedIdentifier: plan.identifier,
                observed: groupByName ?? groupByIdentifier
            )
        }
    }

    private func observe(
        _ kind: RuntimeDirectoryRecordKind,
        attribute: String,
        value: String
    ) throws -> RuntimeDirectoryRecord? {
        let records: [ODRecord]
        do {
            let query = try ODQuery(
                node: node,
                forRecordTypes: kind.recordType,
                attribute: attribute,
                matchType: ODMatchType(kODMatchEqualTo),
                queryValues: value,
                returnAttributes: [kODAttributeTypeAllAttributes],
                maximumResults: 2
            )
            guard let result = try query.resultsAllowingPartial(false) as? [ODRecord] else {
                throw openDirectoryQueryFailure(
                    kind: kind,
                    attribute: attribute,
                    state: "invalid-query-projection"
                )
            }
            records = result
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryQueryFailure(kind: kind, attribute: attribute, error: error)
        }
        guard records.count <= 1 else {
            throw principalDirectoryStateFailure(
                phase: "directory-query",
                probe: "raw-od-\(kind.rawValue)-\(attribute)",
                state: "ambiguous",
                expectedIdentifier: UInt32(value),
                observed: nil
            )
        }
        guard let record = records.first else { return nil }
        do {
            let details = try record.recordDetails(forAttributes: [kODAttributeTypeAllAttributes])
            var values = [String: [Any]]()
            for (rawKey, rawValue) in details {
                guard let attribute = rawKey as? String,
                      let observed = rawValue as? [Any] else {
                    throw openDirectoryQueryFailure(
                        kind: kind,
                        attribute: attribute,
                        state: "malformed-record-projection"
                    )
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
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryQueryFailure(
                kind: kind,
                attribute: attribute,
                state: "record-details-error",
                error: error
            )
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
            throw principalDirectoryStateFailure(
                phase: "principal-delete",
                probe: "raw-od-\(kind.rawValue)",
                state: "transaction-witness-conflict",
                expectedIdentifier: plan.identifier,
                observed: observed
            )
        }
        let deletionError: Error?
        do {
            try observed.record.delete()
            deletionError = nil
        } catch {
            deletionError = error
        }
        try proveRecordAbsentAfterDelete(
            kind,
            identifier: plan.identifier,
            phase: "principal-delete",
            deletionError: deletionError
        )
    }

    @discardableResult
    func validateExactRepairUser(_ witness: RuntimeAccountRepairWitness) throws -> RuntimeDirectoryRecord {
        let candidate = try observe(.user)
        guard let observed = candidate,
              runtimeDirectoryRecord(observed, matches: witness) else {
            throw principalDirectoryStateFailure(
                phase: "partial-install-repair-user-validation",
                probe: "raw-od-user",
                state: "class-witness-conflict",
                expectedIdentifier: witness.plan.identifier,
                observed: candidate
            )
        }
        return observed
    }

    @discardableResult
    func validateExactRepairGroup(_ witness: RuntimeAccountRepairWitness) throws -> RuntimeDirectoryRecord {
        let candidate = try observe(.group)
        guard let observed = candidate,
              runtimeDirectoryRecord(observed, matches: witness) else {
            throw principalDirectoryStateFailure(
                phase: "partial-install-repair-group-validation",
                probe: "raw-od-group",
                state: "class-witness-conflict",
                expectedIdentifier: witness.plan.identifier,
                observed: candidate
            )
        }
        return observed
    }

    func deleteExactRepairUser(_ witness: RuntimeAccountRepairWitness) throws {
        let observed = try validateExactRepairUser(witness)
        let deletionError: Error?
        do {
            try observed.record.delete()
            deletionError = nil
        } catch {
            deletionError = error
        }
        try proveRecordAbsentAfterDelete(
            .user,
            identifier: witness.plan.identifier,
            phase: "partial-install-repair-user-delete",
            deletionError: deletionError
        )
    }

    func deleteExactRepairGroup(_ witness: RuntimeAccountRepairWitness) throws {
        let observed = try validateExactRepairGroup(witness)
        let deletionError: Error?
        do {
            try observed.record.delete()
            deletionError = nil
        } catch {
            deletionError = error
        }
        try proveRecordAbsentAfterDelete(
            .group,
            identifier: witness.plan.identifier,
            phase: "partial-install-repair-group-delete",
            deletionError: deletionError
        )
    }

    private func proveRecordAbsentAfterDelete(
        _ kind: RuntimeDirectoryRecordKind,
        identifier: UInt32,
        phase: String,
        deletionError: Error?
    ) throws {
        // A new ODSession is mandatory here. If delete() committed its effect
        // before surfacing an error, the same privileged invocation must
        // recognize that effect-ahead boundary instead of demanding a retry.
        let verificationStore = try OpenDirectoryRuntimeAccountStore()
        let byName = try verificationStore.observe(kind)
        let byIdentifier = try verificationStore.observeByIdentifier(kind, identifier: identifier)
        switch openDirectoryDeletePostconditionDecision(
            deletionReportedError: deletionError != nil,
            byNamePresent: byName != nil,
            byIdentifierPresent: byIdentifier != nil
        ) {
        case .acceptCommittedAbsence:
            return
        case .failDeleteErrorRecordRemains:
            guard let deletionError else {
                throw principalDirectoryStateFailure(
                    phase: phase,
                    probe: "raw-od-\(kind.rawValue)-delete-decision",
                    state: "delete-error-decision-without-error",
                    expectedIdentifier: identifier,
                    observed: byName ?? byIdentifier
                )
            }
            throw openDirectoryMutationFailure(
                phase: phase,
                probe: "raw-od-\(kind.rawValue)-delete",
                state: "delete-error-record-remains",
                error: deletionError
            )
        case .failRecordRemainedAfterDelete:
            throw principalDirectoryStateFailure(
                phase: phase,
                probe: "raw-od-\(kind.rawValue)-name-and-identifier",
                state: "remained-after-delete",
                expectedIdentifier: identifier,
                observed: byName ?? byIdentifier
            )
        }
    }

    func proveAbsent() throws {
        for kind in [RuntimeDirectoryRecordKind.user, .group] {
            if let observed = try observe(kind) {
                throw principalDirectoryStateFailure(
                    phase: "principal-name-absence",
                    probe: "raw-od-\(kind.rawValue)-name",
                    state: "present",
                    expectedIdentifier: nil,
                    observed: observed
                )
            }
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
                throw openDirectoryQueryFailure(
                    kind: .group,
                    attribute: "explicit-membership",
                    state: "invalid-query-projection"
                )
            }
            records = result
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryQueryFailure(
                kind: .group,
                attribute: "explicit-membership",
                state: "query-error",
                error: error
            )
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
                throw openDirectoryQueryFailure(
                    kind: .group,
                    attribute: "explicit-membership-details",
                    state: "record-details-error",
                    error: error
                )
            }
            for attribute in runtimeForbiddenExplicitGroupMembershipAttributes {
                guard let raw = details[attribute] else { continue }
                guard let values = raw as? [Any], values.allSatisfy({ $0 is String }) else {
                    throw openDirectoryQueryFailure(
                        kind: .group,
                        attribute: attribute,
                        state: "malformed-membership-projection"
                    )
                }
                if values.compactMap({ $0 as? String }).contains(forbiddenValues[attribute]) {
                    throw principalDiagnosticFailure(
                        "runtime-principal-directory-state-mismatch",
                        "remove the forbidden explicit Runtime principal group attachment before retrying repair",
                        "The Runtime service identity has a forbidden explicit local-group attachment.",
                        details: [
                            "phase": "explicit-group-membership",
                            "probe": attribute,
                            "state": "forbidden-membership-present",
                            "expected_identifier": plan.identifier,
                            "observed_name_sha256": sha256(Data(localGroupName.utf8)),
                            "verifier_pid": getpid(),
                        ]
                    )
                }
            }
        }
    }

    private func create(
        _ kind: RuntimeDirectoryRecordKind,
        attributes: [AnyHashable: Any]
    ) throws -> RuntimeDirectoryRecord {
        let record: ODRecord
        do {
            record = try node.createRecord(
                withRecordType: kind.recordType,
                name: runtimeAccountName,
                attributes: attributes
            )
        } catch {
            throw openDirectoryMutationFailure(
                phase: "principal-create",
                probe: "raw-od-\(kind.rawValue)-create",
                state: "create-error",
                error: error
            )
        }
        do {
            try record.synchronize()
        } catch {
            throw openDirectoryMutationFailure(
                phase: "principal-create",
                probe: "raw-od-\(kind.rawValue)-synchronize",
                state: "synchronize-error",
                error: error
            )
        }
        guard let observed = try observe(kind) else {
            throw principalDirectoryStateFailure(
                phase: "principal-create",
                probe: "raw-od-\(kind.rawValue)",
                state: "not-observable-after-create",
                expectedIdentifier: nil,
                observed: nil
            )
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
                throw openDirectoryQueryFailure(
                    kind: recordType == kODRecordTypeUsers ? .user : .group,
                    attribute: attribute,
                    state: "invalid-collision-projection"
                )
            }
            for record in records {
                let details = try record.recordDetails(forAttributes: [attribute])
                guard let raw = details[attribute] else { continue }
                guard let values = raw as? [Any], values.count == 1,
                      let value = values[0] as? String,
                      !value.isEmpty, value.allSatisfy({ $0.isASCII && $0.isNumber }),
                      let identifier = UInt32(value), String(identifier) == value else {
                    throw openDirectoryQueryFailure(
                        kind: recordType == kODRecordTypeUsers ? .user : .group,
                        attribute: attribute,
                        state: "malformed-collision-identifier"
                    )
                }
                used.insert(identifier)
            }
        } catch let failure as DevSecurityFailure {
            throw failure
        } catch {
            throw openDirectoryQueryFailure(
                kind: recordType == kODRecordTypeUsers ? .user : .group,
                attribute: attribute,
                state: "identifier-enumeration-error",
                error: error
            )
        }
    }
}

func accountFailure(_ message: String) -> DevSecurityFailure {
    fail("runtime-service-repair-required", "repair the dedicated _nimiruntimedev OpenDirectory identity", message)
}

private func openDirectoryMutationFailure(
    phase: String,
    probe: String,
    state: String,
    error: Error
) -> DevSecurityFailure {
    let value = error as NSError
    return principalDiagnosticFailure(
        "runtime-principal-directory-mutation-failed",
        "inspect the exact local OpenDirectory mutation failure and retained journal",
        "The exact Runtime service OpenDirectory mutation failed; the transaction remains recoverable.",
        details: [
            "phase": phase,
            "probe": probe,
            "state": state,
            "return_code": value.code,
            "observed_name_sha256": sha256(Data(runtimeAccountName.utf8)),
            "verifier_pid": getpid(),
        ]
    )
}

private func openDirectoryQueryFailure(
    kind: RuntimeDirectoryRecordKind,
    attribute: String,
    state: String = "query-error",
    error: Error? = nil
) -> DevSecurityFailure {
    let value = error as NSError?
    return principalDiagnosticFailure(
        "runtime-principal-directory-query-failed",
        "inspect the exact local OpenDirectory query failure",
        "The exact Runtime service \(kind.rawValue) OpenDirectory query failed.",
        details: [
            "phase": "directory-query",
            "probe": "\(kind.rawValue):\(attribute)",
            "state": state,
            "return_code": value?.code ?? 0,
            "observed_name_sha256": sha256(Data(runtimeAccountName.utf8)),
            "verifier_pid": getpid(),
        ]
    )
}

func principalDirectoryStateFailure(
    phase: String,
    probe: String,
    state: String,
    expectedIdentifier: UInt32?,
    observed: RuntimeDirectoryRecord?
) -> DevSecurityFailure {
    var details: [String: Any] = [
        "phase": phase,
        "probe": probe,
        "state": state,
        "verifier_pid": getpid(),
    ]
    if let expectedIdentifier { details["expected_identifier"] = expectedIdentifier }
    if let observed {
        details["observed_name_sha256"] = sha256(Data(observed.canonicalName.utf8))
        if let identifier = observed.one(
            observed.kind == .user ? kODAttributeTypeUniqueID : kODAttributeTypePrimaryGroupID
        ), let parsed = UInt32(identifier) {
            details["observed_identifier"] = parsed
        }
        if observed.kind == .user,
           let groupIdentifier = observed.one(kODAttributeTypePrimaryGroupID),
           let parsed = UInt32(groupIdentifier) {
            details["observed_primary_group_identifier"] = parsed
        }
    }
    details["projection_sha256"] = sha256(Data(
        [phase, probe, state, expectedIdentifier.map(String.init) ?? "-"].joined(separator: "\u{0}").utf8
    ))
    return principalDiagnosticFailure(
        "runtime-principal-directory-state-mismatch",
        "inspect the exact fixed OpenDirectory record before retrying repair",
        "The raw OpenDirectory principal state does not match the journal boundary.",
        details: details
    )
}
