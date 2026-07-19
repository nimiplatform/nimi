import Darwin
import Foundation
import Security

struct PartialInstallRepairJournal: Codable {
    let schemaVersion: String
    let transactionID: String
    let phase: String
    let accountName: String
    let identifier: UInt32
    let groupGeneratedUID: String
    let userGeneratedUID: String
    let sourceHelperSHA256: String
    let sourceHelperCDHash: String
    let sourcePrincipalCarrierContractVersion: Int
    let residueClass: String
    let authenticationEvidenceSHA256: String
    let planDigest: String
    let rootKeyId: String
    let policyDigest: String

    var plan: RuntimeAccountCreationPlan {
        RuntimeAccountCreationPlan(
            identifier: identifier,
            groupGeneratedUID: groupGeneratedUID,
            userGeneratedUID: userGeneratedUID
        )
    }
}

struct PartialInstallRepairAuthority {
    let rootKeyId: String
    let sourceHelperSHA256: String
    let sourceHelperCDHash: String
    let sourcePrincipalCarrierContractVersion: Int
    let policyDigest: String
}

func requireNoPartialInstallRepairInProgress() throws {
    guard try !repairPathPresent(runtimePartialInstallRepairJournalPath) else {
        throw repairFailure("A partial-install repair journal is active; normal install, lifecycle, and trust removal mutations are forbidden until exact repair completes.")
    }
}

func repairExactPartialRuntimeInstallation() throws -> [String: Any] {
    guard runtimeLegacyRepairJournalSchemaVersion == "nimi.macos-local-development-partial-install-repair/v2",
          runtimeLegacyRepairJournalPhases == [
              "prepared", "artifacts-removed", "user-removed", "group-removed", "principal-removed",
          ],
          runtimeLegacyRepairJournalOwnership == "parent_repair_journal_directly_owns_artifact_user_group_deletion_and_must_not_delegate_to_or_recover_a_principal_transaction_journal",
          runtimeLegacyRepairJournalStagingRecovery == "fixed_single-use_staging_path_is_removed_only_inside_the_final-helper-mutation-lock_after_open-fd_regular_root-root_mode-0600-nlink-1-size-at-most-65536_and_same-device-inode-path_revalidation;_recovery_precedes_every_unknown-entry_or_phase-evaluation_gate_and_the_staging_path_is_never_semantic_authority",
          runtimeLegacyRepairJournalAuthorityBindingRequiredFields == [
              "source_helper_sha256", "source_helper_cdhash", "source_principal_carrier_contract_version",
              "residue_class", "authentication_evidence_sha256", "plan_digest", "user_generated_uid",
              "group_generated_uid", "root_key_id", "policy_digest",
          ] else {
        throw repairFailure("The authority-derived partial-install repair policy is invalid.")
    }
    try recoverInterruptedPartialInstallRepairJournalWrite()
    let authority = try currentPartialInstallRepairAuthority()
    try requireRuntimeKeychainCustodyAbsent()

    let journal: PartialInstallRepairJournal
    if try repairPathPresent(runtimePartialInstallRepairJournalPath) {
        journal = try readPartialInstallRepairJournal()
    } else {
        if try exactRepairTerminalStateIsClean() {
            try requireRepairQuiescence(plan: nil)
            return [
                "status": "repaired",
                "disposition": "already-clean",
                "serviceName": launchDaemonLabel,
                "removed": [],
                "preserved": ["local_CA", "signing_Keychain", "signing_profile", "final_helper"],
            ]
        }
        let witness = try requireExactRepairResidue(authority: authority)
        try requireRepairQuiescence(plan: witness.plan)
        journal = PartialInstallRepairJournal(
            schemaVersion: runtimeLegacyRepairJournalSchemaVersion,
            transactionID: UUID().uuidString.lowercased(),
            phase: "prepared",
            accountName: runtimeAccountName,
            identifier: witness.plan.identifier,
            groupGeneratedUID: witness.plan.groupGeneratedUID,
            userGeneratedUID: witness.plan.userGeneratedUID,
            sourceHelperSHA256: authority.sourceHelperSHA256,
            sourceHelperCDHash: authority.sourceHelperCDHash,
            sourcePrincipalCarrierContractVersion: authority.sourcePrincipalCarrierContractVersion,
            residueClass: witness.residueClass.rawValue,
            authenticationEvidenceSHA256: witness.authenticationEvidenceSHA256,
            planDigest: partialInstallRepairPlanDigest(witness.plan),
            rootKeyId: authority.rootKeyId,
            policyDigest: authority.policyDigest
        )
        try writePartialInstallRepairJournal(journal)
    }

    for _ in 0..<12 {
        let current = try readPartialInstallRepairJournal()
        try requireCurrentPartialInstallRepairAuthority(current)
        try requireRuntimeKeychainCustodyAbsent()
        try requireRepairQuiescence(plan: current.plan)
        try validatePartialInstallRepairGlobalEnvelope(current)
        if try reconcilePartialInstallRepairEffectAheadOfJournal(current) { continue }
        try validatePartialInstallRepairPhaseState(current)

        switch current.phase {
        case "prepared":
            try removeRepairLaunchDaemonIfPresent()
            try removeEmptyRepairDirectoryIfPresent(runtimeStateRoot, owner: current.plan.identifier, group: current.plan.identifier, mode: 0o700)
            try removeEmptyRepairDirectoryIfPresent(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700)
            try removeEmptyRepairDirectoryIfPresent(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700)
            try removeEmptyRepairDirectoryIfPresent(repairSocketRoot(), owner: 0, group: 0, mode: 0o755)
            try updatePartialInstallRepairJournal(current, phase: "artifacts-removed")
        case "artifacts-removed":
            try removePartialInstallRepairUser(current)
            try updatePartialInstallRepairJournal(current, phase: "user-removed")
        case "user-removed":
            try removePartialInstallRepairGroup(current)
            try updatePartialInstallRepairJournal(current, phase: "group-removed")
        case "group-removed":
            let result = try runFixedCommand(
                bootstrapHelperInstallPath,
                ["verify-partial-install-repair-principal-removal"]
            )
            try validateFreshPartialInstallRepairAbsenceReceipt(result, journal: current)
            try updatePartialInstallRepairJournal(current, phase: "principal-removed")
        case "principal-removed":
            try proveRepairTargetsAbsent()
            try requireCurrentPartialInstallRepairAuthority(current)
            try removePartialInstallRepairJournal()
            return [
                "status": "repaired",
                "disposition": "residue-removed",
                "serviceName": launchDaemonLabel,
                "removed": ["partial_launchd_definition", "empty_install_directories", "exact_runtime_principal"],
                "preserved": ["local_CA", "signing_Keychain", "signing_profile", "final_helper"],
            ]
        default:
            throw repairFailure("The partial-install repair journal phase is not admitted.")
        }
    }
    throw repairFailure("The partial-install repair state machine exceeded its bounded monotonic transition budget.")
}

private func requireExactRepairResidue(
    authority: PartialInstallRepairAuthority
) throws -> RuntimeAccountRepairWitness {
    try requireNoUnknownRuntimeDevEntries()
    let forbidden = try [
        runtimeActiveRoot,
        runtimeExecutablePath,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
    ].filter { try repairPathPresent($0) }
    guard forbidden.isEmpty else {
        throw repairFailure("The machine contains payload, socket, custody, or transaction state outside the exact repair-only shape: \(forbidden.joined(separator: ", ")).")
    }
    try verifyInstalledLaunchDaemonDefinition()
    let store = try OpenDirectoryRuntimeAccountStore()
    guard let user = try store.observe(.user), let group = try store.observe(.group) else {
        throw repairFailure("The exact repair baseline requires one complete Runtime service user and group.")
    }
    let witness = try requireRuntimeAccountRepairWitness(
        user: user,
        group: group,
        sourcePrincipalCarrierContractVersion: authority.sourcePrincipalCarrierContractVersion
    )
    try store.proveNoExplicitGroupMembership(witness.plan)
    _ = try validateRuntimeAccountPOSIXProjection(witness.plan)
    try requireEmptyRepairDirectory(runtimeStateRoot, owner: witness.plan.identifier, group: witness.plan.identifier, mode: 0o700)
    try requireEmptyRepairDirectory(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700)
    try requireEmptyRepairDirectory(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700)
    try requireEmptyRepairDirectory(repairSocketRoot(), owner: 0, group: 0, mode: 0o755)
    return witness
}

private func requireRepairQuiescence(plan: RuntimeAccountCreationPlan?) throws {
    let launchd = try inspectLaunchdRuntimeState()
    guard !launchd.loaded, !launchd.running, launchd.pid == nil,
          try !developmentProcessesRunning(),
          try !repairBoundProcessesRunning(plan: plan) else {
        throw repairFailure("The repair-only transaction requires the launchd job and all Nimi development processes to be absent.")
    }
}

private func repairBoundProcessesRunning(plan: RuntimeAccountCreationPlan?) throws -> Bool {
    let result = try runFixedCommand("/bin/ps", ["-axo", "pid=,ruid=,uid=,svuid=,comm="], captureLimit: 8 * 1024 * 1024)
    guard let output = String(data: result.stdout, encoding: .utf8) else {
        throw repairFailure("The process table is not valid UTF-8.")
    }
    let fixedExecutables = Set([
        runtimeExecutablePath,
        "\(desktopApplicationPath)/Contents/MacOS/Nimi Dev",
        "\(desktopApplicationPath)/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev",
    ])
    for line in output.split(separator: "\n", omittingEmptySubsequences: true) {
        let fields = line.split(maxSplits: 4, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
        guard fields.count == 5,
              let pid = Int32(fields[0]),
              let realUID = UInt32(fields[1]),
              let effectiveUID = UInt32(fields[2]),
              let savedUID = UInt32(fields[3]),
              pid > 0 else {
            throw repairFailure("The process table contains an unrecognized row; quiescence cannot be proven.")
        }
        let executable = String(fields[4])
        if fixedExecutables.contains(executable) { return true }
        if let plan, [realUID, effectiveUID, savedUID].contains(plan.identifier) { return true }
    }
    return false
}

private func currentPartialInstallRepairAuthority() throws -> PartialInstallRepairAuthority {
    try requireSecureInstalledHelper()
    let profile = try DevelopmentCertificateAuthority().validateInstalledProfile(requirePrivateCustody: false)
    try verifyInstalledSigningProfileWithSignedHelper()
    let sourceHelperSHA256 = try sha256File(helperInstallPath)
    let sourceHelper = try inspectSignedCode(helperInstallPath)
    guard let helperIdentity = profile.identities["helper"],
          sourceHelper.identifier == helperIdentity.signingIdentifier,
          sourceHelper.teamId.isEmpty,
          sourceHelper.leafSPKISHA256 == helperIdentity.leafSPKISHA256,
          sourceHelper.hardenedRuntime else {
        throw repairFailure("The installed final helper does not match the current local-development signing profile.")
    }
    let status = try runFixedCommand(helperInstallPath, ["status"], captureLimit: 256 * 1024)
    guard status.pid > 1, status.pid != getpid(),
          let value = try JSONSerialization.jsonObject(with: status.stdout) as? [String: Any],
          value["rootKeyId"] as? String == profile.rootKeyId,
          value["identityClass"] as? String == "local_ca",
          (value["productAdmission"] as? NSNumber)?.boolValue == false,
          (value["signingProfileTrusted"] as? NSNumber)?.boolValue == true,
          value["serviceName"] as? String == launchDaemonLabel,
          let sourceCarrier = (value["runtimePrincipalCarrierContractVersion"] as? NSNumber)?.intValue,
          [
              runtimeNormalRepairSourcePrincipalCarrierContractVersion,
              runtimeLegacyRepairSourcePrincipalCarrierContractVersion,
          ].contains(sourceCarrier) else {
        throw repairFailure("The exact installed source helper did not return a repair-admitted carrier status receipt.")
    }
    try requireSecureInstalledHelper()
    let stableSourceHelper = try inspectSignedCode(helperInstallPath)
    let stableSourceHelperSHA256 = try sha256File(helperInstallPath)
    guard sourceHelperSHA256 == stableSourceHelperSHA256,
          sourceHelper.identifier == stableSourceHelper.identifier,
          sourceHelper.teamId == stableSourceHelper.teamId,
          sourceHelper.cdhash == stableSourceHelper.cdhash,
          sourceHelper.designatedRequirement == stableSourceHelper.designatedRequirement,
          sourceHelper.leafSPKISHA256 == stableSourceHelper.leafSPKISHA256,
          sourceHelper.hardenedRuntime == stableSourceHelper.hardenedRuntime else {
        throw repairFailure("The installed source helper changed while its repair authority was inspected.")
    }
    return PartialInstallRepairAuthority(
        rootKeyId: profile.rootKeyId,
        sourceHelperSHA256: sourceHelperSHA256,
        sourceHelperCDHash: sourceHelper.cdhash,
        sourcePrincipalCarrierContractVersion: sourceCarrier,
        policyDigest: sha256(Data(runtimePartialInstallRepairPolicy.utf8))
    )
}

private func requireCurrentPartialInstallRepairAuthority(_ journal: PartialInstallRepairJournal) throws {
    let current = try currentPartialInstallRepairAuthority()
    guard journal.sourceHelperSHA256 == current.sourceHelperSHA256,
          journal.sourceHelperCDHash == current.sourceHelperCDHash,
          journal.sourcePrincipalCarrierContractVersion == current.sourcePrincipalCarrierContractVersion,
          journal.residueClass == repairResidueClass(for: current.sourcePrincipalCarrierContractVersion)?.rawValue,
          journal.planDigest == partialInstallRepairPlanDigest(journal.plan),
          journal.groupGeneratedUID == journal.plan.groupGeneratedUID,
          journal.userGeneratedUID == journal.plan.userGeneratedUID,
          journal.rootKeyId == current.rootKeyId,
          journal.policyDigest == current.policyDigest else {
        throw repairFailure("The partial-install repair journal belongs to a different trust generation, helper, or authority policy.")
    }
}

private func validatePartialInstallRepairPhaseState(_ journal: PartialInstallRepairJournal) throws {
    try validatePartialInstallRepairGlobalEnvelope(journal)
    switch journal.phase {
    case "prepared", "artifacts-removed":
        try validateCompletePartialInstallRepairPrincipal(journal)
    case "user-removed":
        try validatePartialInstallRepairUserAbsentGroupPresent(journal)
    case "group-removed", "principal-removed":
        try proveRuntimeAccountFullyAbsent(journal.plan)
    default:
        throw repairFailure("The partial-install repair journal phase is not admitted.")
    }
}

private func validatePartialInstallRepairGlobalEnvelope(_ journal: PartialInstallRepairJournal) throws {
    try requireNoUnknownRuntimeDevEntries()
    guard try !repairPathPresent(runtimePrincipalJournalPath) else {
        throw repairFailure("The normal Runtime principal transaction journal must remain absent throughout partial-install repair.")
    }
    let forbiddenPayloads = [
        runtimeActiveRoot,
        runtimeExecutablePath,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
    ]
    let presentPayloads = try forbiddenPayloads.filter { try repairPathPresent($0) }
    guard presentPayloads.isEmpty else {
        throw repairFailure("A payload, socket, or normal installation transaction appeared during partial-install repair: \(presentPayloads.joined(separator: ", ")).")
    }
    switch journal.phase {
    case "prepared":
        try verifyOptionalRepairLaunchDaemon()
        try verifyOptionalEmptyRepairDirectory(runtimeStateRoot, owner: journal.identifier, group: journal.identifier, mode: 0o700)
        try verifyOptionalEmptyRepairDirectory(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700)
        try verifyOptionalEmptyRepairDirectory(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700)
        try verifyOptionalEmptyRepairDirectory(repairSocketRoot(), owner: 0, group: 0, mode: 0o755)
    case "artifacts-removed", "user-removed", "group-removed", "principal-removed":
        try requireRepairOwnedArtifactsAbsent()
    default:
        throw repairFailure("The partial-install repair journal phase is not admitted.")
    }
}

private func reconcilePartialInstallRepairEffectAheadOfJournal(
    _ journal: PartialInstallRepairJournal
) throws -> Bool {
    let store = try OpenDirectoryRuntimeAccountStore()
    let user = try store.observe(.user)
    let group = try store.observe(.group)
    switch journal.phase {
    case "artifacts-removed" where user == nil && group != nil:
        try validatePartialInstallRepairUserAbsentGroupPresent(journal)
        try updatePartialInstallRepairJournal(journal, phase: "user-removed")
        return true
    case "user-removed" where user == nil && group == nil:
        try proveRuntimeAccountFullyAbsent(journal.plan)
        try updatePartialInstallRepairJournal(journal, phase: "group-removed")
        return true
    default:
        return false
    }
}

private func validateCompletePartialInstallRepairPrincipal(
    _ journal: PartialInstallRepairJournal
) throws {
    let store = try OpenDirectoryRuntimeAccountStore()
    guard let user = try store.observe(.user), let group = try store.observe(.group) else {
        throw repairFailure("The repair phase requires one complete class-bound Runtime principal.")
    }
    let observed = try requireRuntimeAccountRepairWitness(
        user: user,
        group: group,
        sourcePrincipalCarrierContractVersion: journal.sourcePrincipalCarrierContractVersion
    )
    let journalWitness = try partialInstallRepairWitness(journal)
    guard journal.authenticationEvidenceSHA256 == observed.authenticationEvidenceSHA256,
          observed == journalWitness else {
        throw repairFailure("The Runtime principal changed after the delete-only repair journal was committed.")
    }
    try store.proveNoExplicitGroupMembership(journal.plan)
    _ = try validateRuntimeAccountPOSIXProjection(journal.plan)
}

private func validatePartialInstallRepairUserAbsentGroupPresent(
    _ journal: PartialInstallRepairJournal
) throws {
    let store = try OpenDirectoryRuntimeAccountStore()
    guard try store.observe(.user) == nil else {
        throw repairFailure("The user-removed repair boundary still contains the Runtime service user.")
    }
    _ = try store.validateExactRepairGroup(try partialInstallRepairWitness(journal))
    try store.proveNoExplicitGroupMembership(journal.plan)
    try provePartialInstallRepairUserPOSIXAbsentGroupPresent(journal.plan)
}

private func removePartialInstallRepairUser(_ journal: PartialInstallRepairJournal) throws {
    let store = try OpenDirectoryRuntimeAccountStore()
    let witness = try partialInstallRepairWitness(journal)
    _ = try store.validateExactRepairGroup(witness)
    try store.proveNoExplicitGroupMembership(journal.plan)
    try store.deleteExactRepairUser(witness)
    try validatePartialInstallRepairUserAbsentGroupPresent(journal)
}

private func removePartialInstallRepairGroup(_ journal: PartialInstallRepairJournal) throws {
    let store = try OpenDirectoryRuntimeAccountStore()
    guard try store.observe(.user) == nil else {
        throw repairFailure("The Runtime service user must be absent before its exact repair group is deleted.")
    }
    let witness = try partialInstallRepairWitness(journal)
    try store.proveNoExplicitGroupMembership(journal.plan)
    try provePartialInstallRepairUserPOSIXAbsentGroupPresent(journal.plan)
    try store.deleteExactRepairGroup(witness)
    try proveRuntimeAccountFullyAbsent(journal.plan)
}

private func provePartialInstallRepairUserPOSIXAbsentGroupPresent(
    _ plan: RuntimeAccountCreationPlan
) throws {
    for attempt in 0..<25 {
        let userAbsent = getpwnam(runtimeAccountName) == nil && getpwuid(uid_t(plan.identifier)) == nil
        let namedGroupMatches: Bool
        if let group = getgrnam(runtimeAccountName) {
            namedGroupMatches = group.pointee.gr_gid == plan.identifier
                && String(cString: group.pointee.gr_name) == runtimeAccountName
        } else {
            namedGroupMatches = false
        }
        let identifierGroupMatches: Bool
        if let group = getgrgid(gid_t(plan.identifier)) {
            identifierGroupMatches = group.pointee.gr_gid == plan.identifier
                && String(cString: group.pointee.gr_name) == runtimeAccountName
        } else {
            identifierGroupMatches = false
        }
        if userAbsent && namedGroupMatches && identifierGroupMatches { return }
        if attempt < 24 { usleep(100_000) }
    }
    throw repairFailure("The effect-ahead user deletion did not reach the exact user-absent/group-present POSIX boundary.")
}

func verifyPartialInstallRepairPrincipalRemovalInFreshProcess() throws -> [String: Any] {
    let journal = try readPartialInstallRepairJournal()
    guard journal.phase == "group-removed" else {
        throw repairFailure("Fresh-process partial-install absence verification requires the group-removed boundary.")
    }
    try requireCurrentPartialInstallRepairAuthority(journal)
    try requireRuntimeKeychainCustodyAbsent()
    try requireRepairQuiescence(plan: journal.plan)
    try validatePartialInstallRepairPhaseState(journal)
    return [
        "status": "absence-verified",
        "accountName": runtimeAccountName,
        "transactionID": journal.transactionID,
        "phase": journal.phase,
        "sourceHelperSHA256": journal.sourceHelperSHA256,
        "sourceHelperCDHash": journal.sourceHelperCDHash,
        "sourcePrincipalCarrierContractVersion": journal.sourcePrincipalCarrierContractVersion,
        "residueClass": journal.residueClass,
        "authenticationEvidenceSHA256": journal.authenticationEvidenceSHA256,
        "planDigest": journal.planDigest,
        "groupGeneratedUID": journal.groupGeneratedUID,
        "userGeneratedUID": journal.userGeneratedUID,
        "rootKeyId": journal.rootKeyId,
        "policyDigest": journal.policyDigest,
        "verifierPID": getpid(),
    ]
}

private func validateFreshPartialInstallRepairAbsenceReceipt(
    _ result: CommandResult,
    journal: PartialInstallRepairJournal
) throws {
    guard result.pid > 1, result.pid != getpid(),
          result.stdout.count > 0, result.stdout.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          Set(value.keys) == Set([
              "status", "accountName", "transactionID", "phase",
              "sourceHelperSHA256", "sourceHelperCDHash", "sourcePrincipalCarrierContractVersion",
              "residueClass", "authenticationEvidenceSHA256", "planDigest",
              "groupGeneratedUID", "userGeneratedUID", "rootKeyId", "policyDigest", "verifierPID",
          ]),
          value["status"] as? String == "absence-verified",
          value["accountName"] as? String == runtimeAccountName,
          value["transactionID"] as? String == journal.transactionID,
          value["phase"] as? String == "group-removed",
          value["sourceHelperSHA256"] as? String == journal.sourceHelperSHA256,
          value["sourceHelperCDHash"] as? String == journal.sourceHelperCDHash,
          (value["sourcePrincipalCarrierContractVersion"] as? NSNumber)?.intValue
              == journal.sourcePrincipalCarrierContractVersion,
          value["residueClass"] as? String == journal.residueClass,
          value["authenticationEvidenceSHA256"] as? String == journal.authenticationEvidenceSHA256,
          value["planDigest"] as? String == journal.planDigest,
          value["groupGeneratedUID"] as? String == journal.groupGeneratedUID,
          value["userGeneratedUID"] as? String == journal.userGeneratedUID,
          value["rootKeyId"] as? String == journal.rootKeyId,
          value["policyDigest"] as? String == journal.policyDigest,
          (value["verifierPID"] as? NSNumber)?.int32Value == result.pid else {
        throw repairFailure("The fresh bootstrap returned an invalid or unbound partial-install absence receipt.")
    }
}

func partialInstallRepairWitness(
    _ journal: PartialInstallRepairJournal
) throws -> RuntimeAccountRepairWitness {
    guard let residueClass = RuntimeAccountRepairResidueClass(rawValue: journal.residueClass),
          residueClass.sourcePrincipalCarrierContractVersion
              == journal.sourcePrincipalCarrierContractVersion else {
        throw repairFailure("The partial-install repair journal residue class and source carrier diverge.")
    }
    return RuntimeAccountRepairWitness(
        residueClass: residueClass,
        plan: journal.plan,
        authenticationEvidenceSHA256: journal.authenticationEvidenceSHA256
    )
}

func repairResidueClass(
    for sourcePrincipalCarrierContractVersion: Int
) -> RuntimeAccountRepairResidueClass? {
    switch sourcePrincipalCarrierContractVersion {
    case runtimeNormalRepairSourcePrincipalCarrierContractVersion:
        return RuntimeAccountRepairResidueClass(rawValue: runtimeNormalRepairResidueClass)
    case runtimeLegacyRepairSourcePrincipalCarrierContractVersion:
        return RuntimeAccountRepairResidueClass(rawValue: runtimeLegacyRepairResidueClass)
    default:
        return nil
    }
}

func partialInstallRepairPlanDigest(_ plan: RuntimeAccountCreationPlan) -> String {
    sha256(Data([
        "nimi.macos-local-development-partial-install-plan/v1",
        runtimeAccountName,
        String(plan.identifier),
        plan.groupGeneratedUID,
        plan.userGeneratedUID,
    ].joined(separator: "\u{0}").utf8))
}

private func exactRepairTerminalStateIsClean() throws -> Bool {
    try requireNoUnknownRuntimeDevEntries()
    let targets = [
        launchDaemonPath,
        runtimeStateRoot,
        runtimeTransactionRoot,
        runtimeRollbackRoot,
        try repairSocketRoot(),
        runtimeActiveRoot,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
    ]
    if try targets.contains(where: { try repairPathPresent($0) }) { return false }
    return try !runtimeAccountRecordsPresent()
}

private func requireRepairOwnedArtifactsAbsent() throws {
    let targets = [launchDaemonPath, runtimeStateRoot, runtimeTransactionRoot, runtimeRollbackRoot, try repairSocketRoot()]
    let present = try targets.filter { try repairPathPresent($0) }
    guard present.isEmpty else {
        throw repairFailure("An owned partial-install artifact remains after the artifacts-removed boundary: \(present.joined(separator: ", ")).")
    }
}

private func verifyOptionalRepairLaunchDaemon() throws {
    if try repairPathPresent(launchDaemonPath) { try verifyInstalledLaunchDaemonDefinition() }
}

private func verifyOptionalEmptyRepairDirectory(_ path: String, owner: UInt32, group: UInt32, mode: mode_t) throws {
    if try repairPathPresent(path) {
        try requireEmptyRepairDirectory(path, owner: owner, group: group, mode: mode)
    }
}

private func requireNoUnknownRuntimeDevEntries() throws {
    let allowed = Set([
        (signingProfilePath as NSString).lastPathComponent,
        (signingCleanupRecordPath as NSString).lastPathComponent,
        (signingCustodyRoot as NSString).lastPathComponent,
        (runtimeActiveRoot as NSString).lastPathComponent,
        (runtimeStateRoot as NSString).lastPathComponent,
        (runtimeTransactionRoot as NSString).lastPathComponent,
        (runtimeRollbackRoot as NSString).lastPathComponent,
        (installationJournalPath as NSString).lastPathComponent,
        (runtimePrincipalJournalPath as NSString).lastPathComponent,
        (runtimePartialInstallRepairJournalPath as NSString).lastPathComponent,
        "installer-ledger.json",
    ])
    let entries = try FileManager.default.contentsOfDirectory(atPath: runtimeDevRoot)
    let unknown = entries.filter { !allowed.contains($0) }
    guard unknown.isEmpty else {
        throw repairFailure("The RuntimeDev root contains unknown entries that repair does not own: \(unknown.sorted().joined(separator: ", ")).")
    }
}
