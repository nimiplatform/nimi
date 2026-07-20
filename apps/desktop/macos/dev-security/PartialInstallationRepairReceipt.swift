import Darwin
import Foundation

struct PartialInstallRepairJournalAbsenceReceiptExpectation: Equatable, Sendable {
    let accountName: String
    let transactionID: String
    let phase: String
    let sourceHelperSHA256: String
    let sourceHelperCDHash: String
    let sourcePrincipalCarrierContractVersion: Int
    let residueClass: String
    let authenticationEvidenceSHA256: String
    let planDigest: String
    let groupGeneratedUID: String
    let userGeneratedUID: String
    let rootKeyId: String
    let policyDigest: String
    let posixLookupAPI: String
    let parentPID: pid_t
    let parentProcessStartIdentity: String
}

func makePartialInstallRepairSuccessReceipt(
    disposition: String,
    serviceName: String,
    removed: [String],
    sourcePrincipalCarrierContractVersion: Int,
    requiredInstallPrincipalCarrierContractVersion: Int
) throws -> [String: Any] {
    let expectedRemoved: [String]
    switch disposition {
    case "residue-removed":
        expectedRemoved = [
            "partial_launchd_definition", "empty_install_directories", "exact_runtime_principal",
        ]
    default:
        throw repairFailure("The partial-install repair success disposition is not admitted.")
    }
    guard removed == expectedRemoved,
          serviceName == launchDaemonLabel,
          requiredInstallPrincipalCarrierContractVersion == runtimePrincipalCarrierContractVersion,
          [
              runtimeNormalRepairSourcePrincipalCarrierContractVersion,
              runtimeLegacyRepairSourcePrincipalCarrierContractVersion,
          ].contains(sourcePrincipalCarrierContractVersion),
          generatedRuntimeLegacyRepairSuccessReceiptSchemaVersion
              == "nimi.macos-local-development-partial-install-repair-receipt/v1",
          generatedRuntimeLegacyRepairSuccessReceiptRequiredFields == [
              "schemaVersion", "status", "disposition", "serviceName", "removed", "preserved",
              "sourcePrincipalCarrierContractVersion",
              "requiredInstallPrincipalCarrierContractVersion", "sourceHelperDisposition",
              "installReadiness", "trustHelperRotationRequired", "nextPrivilegedAction",
          ],
          generatedRuntimeLegacyRepairSuccessReceiptPreservedFields
              == ["local_CA", "signing_Keychain", "signing_profile", "final_helper"],
          generatedRuntimeLegacyRepairSuccessReceiptSourceHelperDisposition == "preserved",
          generatedRuntimeLegacyRepairSuccessReceiptCurrentCarrierAction == "none",
          generatedRuntimeLegacyRepairSuccessReceiptStaleCarrierAction
              == "separately_confirmed_trust_helper_rotation" else {
        throw repairFailure("The authority-derived partial-install repair success receipt is invalid.")
    }
    let rotationRequired = sourcePrincipalCarrierContractVersion
        != requiredInstallPrincipalCarrierContractVersion
    let receipt: [String: Any] = [
        "schemaVersion": generatedRuntimeLegacyRepairSuccessReceiptSchemaVersion,
        "status": "repaired",
        "disposition": disposition,
        "serviceName": serviceName,
        "removed": removed,
        "preserved": generatedRuntimeLegacyRepairSuccessReceiptPreservedFields,
        "sourcePrincipalCarrierContractVersion": sourcePrincipalCarrierContractVersion,
        "requiredInstallPrincipalCarrierContractVersion": requiredInstallPrincipalCarrierContractVersion,
        "sourceHelperDisposition": generatedRuntimeLegacyRepairSuccessReceiptSourceHelperDisposition,
        "installReadiness": rotationRequired
            ? "trust-helper-rotation-required"
            : "current-carrier-preserved",
        "trustHelperRotationRequired": rotationRequired,
        "nextPrivilegedAction": rotationRequired
            ? generatedRuntimeLegacyRepairSuccessReceiptStaleCarrierAction
            : generatedRuntimeLegacyRepairSuccessReceiptCurrentCarrierAction,
    ]
    guard Set(receipt.keys) == Set(generatedRuntimeLegacyRepairSuccessReceiptRequiredFields) else {
        throw repairFailure("The partial-install repair success receipt field set drifted.")
    }
    return receipt
}

func partialInstallRepairJournalAbsenceReceiptMatches(
    _ value: [String: Any],
    childPID: pid_t,
    parentPID: pid_t,
    expected: PartialInstallRepairJournalAbsenceReceiptExpectation
) -> Bool {
    guard childPID > 1, childPID != parentPID,
          Set(value.keys) == Set([
              "status", "accountName", "transactionID", "phase",
              "sourceHelperSHA256", "sourceHelperCDHash", "sourcePrincipalCarrierContractVersion",
              "residueClass", "authenticationEvidenceSHA256", "planDigest",
              "groupGeneratedUID", "userGeneratedUID", "rootKeyId", "policyDigest",
              "posixLookupAPI", "posixProjectionSHA256", "posixProbeStates",
              "parentPID", "parentProcessStartIdentity", "verifierPID",
          ]),
          value["status"] as? String == "absence-verified",
          value["accountName"] as? String == expected.accountName,
          value["transactionID"] as? String == expected.transactionID,
          value["phase"] as? String == expected.phase,
          value["sourceHelperSHA256"] as? String == expected.sourceHelperSHA256,
          value["sourceHelperCDHash"] as? String == expected.sourceHelperCDHash,
          repairReceiptInteger(value["sourcePrincipalCarrierContractVersion"])
              == expected.sourcePrincipalCarrierContractVersion,
          value["residueClass"] as? String == expected.residueClass,
          value["authenticationEvidenceSHA256"] as? String
              == expected.authenticationEvidenceSHA256,
          value["planDigest"] as? String == expected.planDigest,
          value["groupGeneratedUID"] as? String == expected.groupGeneratedUID,
          value["userGeneratedUID"] as? String == expected.userGeneratedUID,
          value["rootKeyId"] as? String == expected.rootKeyId,
          value["policyDigest"] as? String == expected.policyDigest,
          value["posixLookupAPI"] as? String == expected.posixLookupAPI,
          repairReceiptSHA256(value["posixProjectionSHA256"]),
          value["posixProbeStates"] as? [String]
              == ["not-found", "not-found", "not-found", "not-found"],
          repairReceiptInteger(value["parentPID"]) == Int(expected.parentPID),
          value["parentProcessStartIdentity"] as? String
              == expected.parentProcessStartIdentity,
          repairReceiptInteger(value["verifierPID"]) == Int(childPID) else {
        return false
    }
    return true
}

private func repairReceiptInteger(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    return nil
}

private func repairReceiptSHA256(_ value: Any?) -> Bool {
    guard let value = value as? String, value.count == 64 else { return false }
    return value.unicodeScalars.allSatisfy { scalar in
        ("0"..."9").contains(Character(String(scalar)))
            || ("a"..."f").contains(Character(String(scalar)))
    }
}
