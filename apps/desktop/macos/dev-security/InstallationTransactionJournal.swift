import Darwin
import Foundation

private let installationJournalSchema = "nimi.macos-local-development-installation-transaction/v2"
private let freshInstallKind = "fresh_install"

private struct InstallationJournal: Codable {
    let schemaVersion: String
    let transactionID: String
    let kind: String
    let phase: String
    let principalPlan: RuntimeAccountCreationPlan
    let stagedActive: String
    let stagedApplication: String
    let stagedLedger: String
}

func beginFreshInstallationTransaction(
    transactionID: String,
    principalPlan: RuntimeAccountCreationPlan,
    stagedActive: String,
    stagedApplication: String,
    stagedLedger: String
) throws {
    try requireInstallationTransactionAuthority()
    try requireFreshInstallationBaseline()
    let journal = InstallationJournal(
        schemaVersion: installationJournalSchema,
        transactionID: transactionID,
        kind: freshInstallKind,
        phase: "prepared",
        principalPlan: principalPlan,
        stagedActive: stagedActive,
        stagedApplication: stagedApplication,
        stagedLedger: stagedLedger
    )
    try writeInstallationJournal(journal)
}

func markInstallationPhase(_ phase: String) throws {
    let current = try readInstallationJournal()
    let allowedTransitions: [String: String] = [
        "prepared": "principal-ready",
        "principal-ready": "directories-ready",
        "directories-ready": "candidate-staged",
        "candidate-staged": "candidate-installed",
        "candidate-installed": "plist-installed",
        "plist-installed": "custody-ready",
        "custody-ready": "launchd-activated",
        "launchd-activated": "service-healthy",
        "service-healthy": "commit-decided",
    ]
    guard allowedTransitions[current.phase] == phase else {
        throw installationFailure("Refusing a non-monotonic installation phase transition from \(current.phase) to \(phase).")
    }
    try writeInstallationJournal(InstallationJournal(
        schemaVersion: current.schemaVersion,
        transactionID: current.transactionID,
        kind: current.kind,
        phase: phase,
        principalPlan: current.principalPlan,
        stagedActive: current.stagedActive,
        stagedApplication: current.stagedApplication,
        stagedLedger: current.stagedLedger
    ))
}

func commitCandidate(
    transactionID: String,
    stagedActive: String,
    stagedApplication: String,
    stagedLedger: String
) throws {
    let journal = try readInstallationJournal()
    guard journal.phase == "candidate-staged",
          journal.transactionID == transactionID,
          journal.stagedActive == stagedActive,
          journal.stagedApplication == stagedApplication,
          journal.stagedLedger == stagedLedger else {
        throw installationFailure("The staged candidate does not match the full installation transaction witness.")
    }
    let destinations = [runtimeActiveRoot, desktopApplicationPath, "\(runtimeDevRoot)/installer-ledger.json"]
    guard try destinations.allSatisfy({ try !installationPathPresent($0) }) else {
        throw installationFailure("Fresh installation destinations are no longer absent.")
    }
    try FileManager.default.moveItem(atPath: stagedActive, toPath: runtimeActiveRoot)
    try FileManager.default.moveItem(atPath: stagedApplication, toPath: desktopApplicationPath)
    try FileManager.default.moveItem(atPath: stagedLedger, toPath: "\(runtimeDevRoot)/installer-ledger.json")
    try syncDirectory(runtimeDevRoot)
    try syncDirectory("/Applications")
    try markInstallationPhase("candidate-installed")
}

func recoverInterruptedInstallationIfNeeded() throws {
    guard try installationPathPresent(installationJournalPath) else { return }
    let journal = try readInstallationJournal()
    guard journal.phase != "commit-decided" else {
        try finalizeInstallationJournal()
        return
    }
    try rollbackFreshInstallation(journal)
}

func finalizeInstallationJournal() throws {
    let journal = try readInstallationJournal()
    guard journal.phase == "commit-decided" else {
        throw installationFailure("The installation transaction has not crossed its final verified-health commit boundary.")
    }
    try removeInstallationNodeIfPresent("\(runtimeTransactionRoot)/\(journal.transactionID)")
    try removeInstallationNodeIfPresent(journal.stagedApplication)
    try removeInstallationJournal()
}

func verifyCandidateCommittedInstallationJournal() throws {
    let journal = try readInstallationJournal()
    guard ["launchd-activated", "service-healthy", "commit-decided"].contains(journal.phase) else {
        throw installationFailure("The installation transaction is not at a health-verifiable activation boundary.")
    }
}

func prepareRuntimeDirectories(principal: (uid: uid_t, gid: gid_t)) throws {
    let journal = try readInstallationJournal()
    guard journal.phase == "principal-ready",
          principal.uid == journal.principalPlan.identifier,
          principal.gid == journal.principalPlan.identifier else {
        throw installationFailure("Runtime directory ownership is not bound to the journaled principal plan.")
    }
    try ensureDirectory("/Library/Application Support/Nimi", owner: 0, group: 0, mode: 0o755)
    _ = try secureMetadata(runtimeDevRoot, type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
    try ensureDirectory(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700)
    try ensureDirectory(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700)
    try ensureDirectory(runtimeStateRoot, owner: principal.uid, group: principal.gid, mode: 0o700)
    try ensureDirectory(try installationSocketRoot(), owner: 0, group: 0, mode: 0o755)
    try markInstallationPhase("directories-ready")
}

func requireDesktopStopped() throws {
    var running = [String]()
    for name in ["Nimi Dev", "Nimi Local App Host Dev"] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-x", name]
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        try process.run()
        let bytes = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationReason == .exit,
              process.terminationStatus == 0 || process.terminationStatus == 1 else {
            throw installationFailure("Cannot prove whether \(name) is running.")
        }
        if process.terminationStatus == 0 || !bytes.isEmpty { running.append(name) }
    }
    guard running.isEmpty else {
        throw fail(
            "runtime-service-repair-required",
            "quit Nimi Dev and all supervised local-app hosts before service mutation",
            "Live verified development processes prevent replacement: \(running.joined(separator: ", "))"
        )
    }
}

func stopLaunchDaemonIfLoaded() throws {
    let initial = try inspectLaunchdRuntimeState()
    if initial.loaded {
        _ = try runFixedCommand("/bin/launchctl", ["bootout", "system/\(launchDaemonLabel)"])
    }
    let final = try inspectLaunchdRuntimeState()
    guard !final.loaded, !final.running, final.pid == nil else {
        throw installationFailure("The launchd Runtime job did not reach a proved-absent state.")
    }
}

func startLaunchDaemon() throws {
    let initial = try inspectLaunchdRuntimeState()
    guard !initial.loaded, !initial.running, initial.pid == nil else {
        throw installationFailure("The launchd Runtime job was already loaded before transaction activation.")
    }
    _ = try runFixedCommand("/bin/launchctl", ["bootstrap", "system", launchDaemonPath])
    _ = try runFixedCommand("/bin/launchctl", ["kickstart", "-k", "system/\(launchDaemonLabel)"])
}

private func requireFreshInstallationBaseline() throws {
    try requireNoPartialInstallRepairInProgress()
    let launchd = try inspectLaunchdRuntimeState()
    guard !launchd.loaded, !launchd.running, launchd.pid == nil,
          try !developmentProcessesRunning() else {
        throw installationFailure("Fresh installation requires a quiescent, unloaded Runtime baseline.")
    }
    let forbidden = [
        runtimeActiveRoot,
        runtimeExecutablePath,
        runtimeStateRoot,
        runtimeTransactionRoot,
        runtimeRollbackRoot,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        runtimePrincipalJournalPath,
        launchDaemonPath,
        generatedDesktopSocketPath,
        generatedLocalAppSocketPath,
        try installationSocketRoot(),
    ]
    let present = try forbidden.filter { try installationPathPresent($0) }
    guard present.isEmpty, try !runtimeAccountRecordsPresent() else {
        throw fail(
            "runtime-service-repair-required",
            "run the explicit repair or uninstall transaction before a fresh install",
            "Fresh installation baseline is mixed or non-empty: \(present.joined(separator: ", "))."
        )
    }
    try requireRuntimeKeychainCustodyAbsent()
    let expectedTrustEntries = Set([
        (signingProfilePath as NSString).lastPathComponent,
        (signingCleanupRecordPath as NSString).lastPathComponent,
        (signingCustodyRoot as NSString).lastPathComponent,
    ])
    let actualEntries = Set(try FileManager.default.contentsOfDirectory(atPath: runtimeDevRoot))
    guard actualEntries == expectedTrustEntries else {
        throw installationFailure("RuntimeDev contains entries outside the exact trust-only fresh-install baseline: \(actualEntries.subtracting(expectedTrustEntries).sorted().joined(separator: ", ")).")
    }
}

private func rollbackFreshInstallation(_ journal: InstallationJournal) throws {
    var rollbackErrors = [String]()
    func attempt(_ operation: () throws -> Void) {
        do { try operation() }
        catch { rollbackErrors.append(diagnosticMessage(error)) }
    }

    attempt { try stopLaunchDaemonIfLoaded() }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }

    attempt { try removeInstallationSocketIfPresent(generatedDesktopSocketPath) }
    attempt { try removeInstallationSocketIfPresent(generatedLocalAppSocketPath) }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }

    if try installationPathPresent(runtimeExecutablePath) {
        attempt { _ = try runFixedCommand(runtimeExecutablePath, ["macos-protected-state-reset"]) }
    } else {
        attempt { try requireRuntimeKeychainCustodyAbsent() }
    }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }

    attempt { try removeInstallationNodeIfPresent(launchDaemonPath) }
    attempt { try removeInstallationNodeIfPresent(runtimeActiveRoot) }
    attempt { try removeInstallationNodeIfPresent(desktopApplicationPath) }
    attempt { try removeInstallationNodeIfPresent("\(runtimeDevRoot)/installer-ledger.json") }
    attempt { try removeInstallationNodeIfPresent("\(runtimeTransactionRoot)/\(journal.transactionID)") }
    attempt { try removeInstallationNodeIfPresent(journal.stagedApplication) }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }

    attempt { try removeEmptyFreshDirectory(runtimeStateRoot, owner: journal.principalPlan.identifier, group: journal.principalPlan.identifier, mode: 0o700) }
    attempt { try removeEmptyFreshDirectory(runtimeTransactionRoot, owner: 0, group: 0, mode: 0o700) }
    attempt { try removeEmptyFreshDirectory(runtimeRollbackRoot, owner: 0, group: 0, mode: 0o700) }
    attempt { try removeEmptyFreshDirectory(try installationSocketRoot(), owner: 0, group: 0, mode: 0o755) }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }

    attempt { try removeRuntimeAccount(expectedPlan: journal.principalPlan) }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }

    attempt { try requireRuntimeKeychainCustodyAbsent() }
    attempt { try proveFreshInstallationTargetsAbsent(journal) }
    if !rollbackErrors.isEmpty { throw rollbackFailure(rollbackErrors) }
    try removeInstallationJournal()
}

private func proveFreshInstallationTargetsAbsent(_ journal: InstallationJournal) throws {
    let targets = [
        runtimeActiveRoot, runtimeExecutablePath, runtimeStateRoot, runtimeTransactionRoot,
        runtimeRollbackRoot, desktopApplicationPath, "\(runtimeDevRoot)/installer-ledger.json",
        runtimePrincipalJournalPath, launchDaemonPath, generatedDesktopSocketPath,
        generatedLocalAppSocketPath, try installationSocketRoot(),
        "\(runtimeTransactionRoot)/\(journal.transactionID)", journal.stagedApplication,
    ]
    let present = try targets.filter { try installationPathPresent($0) }
    guard present.isEmpty else {
        throw installationFailure("Fresh installation rollback left fixed targets: \(present.joined(separator: ", ")).")
    }
    try proveRuntimeAccountFullyAbsent(journal.principalPlan)
    let launchd = try inspectLaunchdRuntimeState()
    guard !launchd.loaded, !launchd.running, launchd.pid == nil else {
        throw installationFailure("Fresh installation rollback left the launchd job loaded.")
    }
}

private func removeInstallationSocketIfPresent(_ path: String) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect launchd socket during rollback", path)
    }
    guard metadata.st_mode & S_IFMT == S_IFSOCK,
          metadata.st_uid == 0,
          metadata.st_gid == 20,
          metadata.st_nlink == 1 else {
        throw installationFailure("Refusing to remove an untrusted launchd socket at \(path).")
    }
    guard unlink(path) == 0 else { throw posixFailure("remove launchd socket during rollback", path) }
}

private func removeEmptyFreshDirectory(_ path: String, owner: UInt32, group: UInt32, mode: mode_t) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect fresh-install directory", path)
    }
    _ = try secureMetadata(path, type: S_IFDIR, uid: uid_t(owner), gid: gid_t(group), mode: mode)
    guard try FileManager.default.contentsOfDirectory(atPath: path).isEmpty else {
        throw installationFailure("Refusing to remove a non-empty fresh-install directory: \(path)")
    }
    guard rmdir(path) == 0 else { throw posixFailure("remove empty fresh-install directory", path) }
    try syncDirectory((path as NSString).deletingLastPathComponent)
}

private func writeInstallationJournal(_ journal: InstallationJournal) throws {
    try validateInstallationJournal(journal)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(journal)
    data.append(0x0a)
    try writeAtomicRootFile(data, to: installationJournalPath, mode: 0o600)
}

private func readInstallationJournal() throws -> InstallationJournal {
    _ = try secureMetadata(installationJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: installationJournalPath))
    guard !data.isEmpty, data.count <= 64 * 1024 else {
        throw installationFailure("The installation journal has an invalid size.")
    }
    let journal = try JSONDecoder().decode(InstallationJournal.self, from: data)
    try validateInstallationJournal(journal)
    return journal
}

private func validateInstallationJournal(_ journal: InstallationJournal) throws {
    try requireInstallationTransactionAuthority()
    let transactionRoot = "\(runtimeTransactionRoot)/\(journal.transactionID)"
    let validPhases = Set([
        "prepared", "principal-ready", "directories-ready", "candidate-staged",
        "candidate-installed", "plist-installed", "custody-ready", "launchd-activated",
        "service-healthy", "commit-decided",
    ])
    guard journal.schemaVersion == installationJournalSchema,
          journal.kind == freshInstallKind,
          journal.transactionID.range(of: #"^[a-f0-9-]{36}$"#, options: .regularExpression) != nil,
          validPhases.contains(journal.phase),
          journal.stagedActive == "\(transactionRoot)/active",
          journal.stagedLedger == "\(transactionRoot)/installer-ledger.json",
          journal.stagedApplication.hasPrefix("/Applications/.Nimi Dev."),
          journal.stagedApplication.hasSuffix(".staging.app"),
          (journal.stagedApplication as NSString).deletingLastPathComponent == "/Applications" else {
        throw installationFailure("The installation journal contains an unrecognized authority, path, or phase.")
    }
    _ = try makeRuntimeAccountCreationPlan(
        identifier: journal.principalPlan.identifier,
        groupGeneratedUID: journal.principalPlan.groupGeneratedUID,
        userGeneratedUID: journal.principalPlan.userGeneratedUID
    )
}

private func requireInstallationTransactionAuthority() throws {
    guard runtimeInstallationTransactionScope == "one_fsynced_fresh_install_top_level_journal_precedes_service_stop_or_first_mutation_requires_all_service_principal_directory_plist_payload_socket_and_Runtime_custody_baselines_absent_and_owns_every_created_principal_directory_plist_active_Desktop_installer_ledger_custody_and_socket_effect",
          runtimeInstallationRollbackOrder == "bootout_and_prove_process_stopped_then_remove_and_prove_sockets_then_reset_transaction-created_Runtime_custody_while_candidate_Runtime_remains_verified_then_remove_plist_active_Desktop_and_ledger_then_remove_staging_then_remove_only_transaction-created_empty_fixed_directories_then_remove_exact_transaction-created_user_before_group_then_prove_full_baseline_absent_then_remove_journal",
          runtimeInstallationCommitBoundary == "final_mutually_verified_Runtime_health_after_launchd_bootstrap_and_all_fixed_artifact_checks;_journal_and_rollback_generation_are_retained_until_this_boundary",
          runtimeUpdateAdmission == "fail_closed_pending_nonmutating_release_lineage_validation_and_installer-bound_pending_commit_protocol;_current_AdmitReleaseLineage_mutates_anchored_high-water_before_final_health_so_old-candidate_restore_is_forbidden" else {
        throw installationFailure("The generated full installation transaction authority is not admitted.")
    }
}

private func removeInstallationJournal() throws {
    _ = try secureMetadata(installationJournalPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o600, links: 1)
    guard unlink(installationJournalPath) == 0 else { throw posixFailure("remove installation journal", installationJournalPath) }
    try syncDirectory(runtimeDevRoot)
}

private func installationSocketRoot() throws -> String {
    let desktopRoot = (generatedDesktopSocketPath as NSString).deletingLastPathComponent
    let hostRoot = (generatedLocalAppSocketPath as NSString).deletingLastPathComponent
    guard desktopRoot == hostRoot, desktopRoot == "/private/var/run/nimi-dev" else {
        throw installationFailure("The generated protected socket roots do not share the fixed admitted path.")
    }
    return desktopRoot
}

private func installationPathPresent(_ path: String) throws -> Bool {
    var metadata = stat()
    if lstat(path, &metadata) == 0 { return true }
    if errno == ENOENT { return false }
    throw posixFailure("inspect installation transaction path", path)
}

private func removeInstallationNodeIfPresent(_ path: String) throws {
    let dynamicTransaction = path.hasPrefix("\(runtimeTransactionRoot)/")
    let dynamicStagingApplication = path.hasPrefix("/Applications/.Nimi Dev.")
        && path.hasSuffix(".staging.app")
        && (path as NSString).deletingLastPathComponent == "/Applications"
    let fixed = [
        runtimeActiveRoot,
        desktopApplicationPath,
        "\(runtimeDevRoot)/installer-ledger.json",
        launchDaemonPath,
    ].contains(path)
    guard fixed || dynamicTransaction || dynamicStagingApplication else {
        throw installationFailure("Refusing to remove an unrecognized installation transaction path: \(path)")
    }
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect installation transaction node", path)
    }
    guard metadata.st_mode & S_IFMT != S_IFLNK,
          metadata.st_uid == 0,
          metadata.st_nlink >= 1 else {
        throw installationFailure("Refusing to remove an unsafe installation transaction node: \(path)")
    }
    try FileManager.default.removeItem(atPath: path)
    try syncDirectory((path as NSString).deletingLastPathComponent)
}

private func installationFailure(_ message: String) -> DevSecurityFailure {
    fail("runtime-service-repair-required", "inspect the full macOS development installation transaction", message)
}

private func rollbackFailure(_ errors: [String]) -> DevSecurityFailure {
    installationFailure("Fresh installation rollback was incomplete; the journal and any required candidate were preserved: \(errors.joined(separator: "; "))")
}
