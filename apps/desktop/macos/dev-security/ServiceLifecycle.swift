import Darwin
import Foundation

func restartDevelopmentService() throws -> [String: Any] {
    try requireRootMutationContext()
    try requireNoPartialInstallRepairInProgress()
    try requireCompleteInstalledService()
    try stopLaunchDaemonIfLoaded()
    try startLaunchDaemon()
    _ = try waitForHealthyDevelopmentService()
    return [
        "status": "restarted",
        "serviceName": launchDaemonLabel,
        "consequence": "runtime_boot_epoch_and_all_protected_sessions_rotated",
    ]
}

func resetDevelopmentServiceState() throws -> [String: Any] {
    try requireRootMutationContext()
    try requireNoPartialInstallRepairInProgress()
    try requireCompleteInstalledService()
    try requireDesktopStopped()
    try stopLaunchDaemonIfLoaded()
    try recoverInterruptedInstallationIfNeeded()
    let reset = try runFixedCommand(runtimeExecutablePath, ["macos-protected-state-reset"])
    let provision = try runFixedCommand(runtimeExecutablePath, ["macos-protected-state-provision"])
    try startLaunchDaemon()
    _ = try waitForHealthyDevelopmentService()
    return [
        "status": "reset",
        "serviceName": launchDaemonLabel,
        "resetReceipt": try parseJSONObject(reset.stdout, label: "Runtime reset"),
        "provisionReceipt": try parseJSONObject(provision.stdout, label: "Runtime provision"),
        "consequence": "all_development_authorizations_accounts_sessions_and_boot_epoch_rotated",
    ]
}

func uninstallDevelopmentService() throws -> [String: Any] {
    try requireRootMutationContext()
    try requireNoPartialInstallRepairInProgress()
    try requireDesktopStopped()
    try stopLaunchDaemonIfLoaded()
    try recoverInterruptedInstallationIfNeeded()
    if FileManager.default.fileExists(atPath: runtimeExecutablePath) {
        _ = try runFixedCommand(runtimeExecutablePath, ["macos-protected-state-reset"])
    }
    for socket in [
        "/private/var/run/nimi-dev/runtime-desktop.sock",
        "/private/var/run/nimi-dev/runtime-local-app.sock",
    ] {
        try removeSocketIfPresent(socket)
    }
    for target in [
        desktopApplicationPath,
        runtimeActiveRoot,
        runtimeStateRoot,
        runtimeRollbackRoot,
        runtimeTransactionRoot,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        launchDaemonPath,
    ] {
        try removeFixedTargetIfPresent(target)
    }
    try removeRuntimeAccount()
    return [
        "status": "uninstalled",
        "serviceName": launchDaemonLabel,
        "localCA": "preserved",
        "signingProfile": FileManager.default.fileExists(atPath: signingProfilePath) ? "preserved" : "absent",
    ]
}

func unprovisionDevelopmentTrust() throws -> [String: Any] {
    let authorizingHelperPath = try requireCleanupMutationContext()
    try requireDevelopmentTrustRemovalPreconditions()
    try DevelopmentCertificateAuthority(authorizingHelperPath: authorizingHelperPath).removeProfileItems()
    try completeDevelopmentTrustUnprovision()
    return [
        "status": "unprovisioned",
        "serviceName": launchDaemonLabel,
        "removed": ["local_CA", "role_private_keys", "residual_profile_keys", "code_signing_trust_setting", "bootstrap_helper", "final_helper", "public_signing_profile", "signing_cleanup_record"],
    ]
}

func prepareStrandedDevelopmentTrustUnprovision() throws -> [String: Any] {
    try requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: false)
    try requireDevelopmentTrustRemovalPreconditions()
    let repaired = try DevelopmentCertificateAuthority(
        authorizingHelperPath: bootstrapHelperInstallPath
    ).prepareStrandedUnprovisionHandoff()
    return [
        "status": "unprovision-owner-handoff-prepared",
        "serviceName": launchDaemonLabel,
        "repairApplied": repaired,
        "cleanupOwner": helperInstallPath,
        "policy": generatedSigningUnprovisionRepairPolicy,
    ]
}

private func requireDevelopmentTrustRemovalPreconditions() throws {
    try requireNoPartialInstallRepairInProgress()
    let forbidden = [runtimeExecutablePath, desktopApplicationPath, launchDaemonPath].filter {
        FileManager.default.fileExists(atPath: $0)
    }
    guard forbidden.isEmpty,
          !FileManager.default.fileExists(atPath: runtimePrincipalJournalPath),
          try !runtimeAccountRecordsPresent(),
          try !developmentProcessesRunning() else {
        throw fail(
            "runtime-service-repair-required",
            "run pnpm dev:runtime -- --uninstall and ensure all Nimi development processes exit first",
            "Development trust cannot be removed while service artifacts, the service account, or related processes remain."
        )
    }
}

private func completeDevelopmentTrustUnprovision() throws {
    try removeFixedTargetIfPresent(signingProfilePath)
    try removeEmptyUnprovisionDirectory(signingCustodyRoot)
    try removeEmptyUnprovisionDirectory(runtimeDevRoot)
    try removeHelperIfPresent(helperInstallPath)
    try removeHelperIfPresent(bootstrapHelperInstallPath)
    try syncDirectory((helperInstallPath as NSString).deletingLastPathComponent)
    for path in [bootstrapHelperInstallPath, helperInstallPath, runtimeDevRoot, signingProfilePath, signingCleanupRecordPath, signingKeychainPath] {
        var metadata = stat()
        guard lstat(path, &metadata) != 0, errno == ENOENT else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the unexpected fixed development residue",
                "Refusing to report unprovision success while a fixed profile path remains: \(path)"
            )
        }
    }
}

private func removeHelperIfPresent(_ path: String) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect development security helper", path)
    }
    guard metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_uid == 0,
          metadata.st_gid == 0,
          metadata.st_nlink == 1,
          metadata.st_mode & 0o022 == 0 else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the fixed helper before cleanup",
            "Refusing to remove an unsafe helper object at \(path)."
        )
    }
    guard unlink(path) == 0 else { throw posixFailure("remove development security helper", path) }
}

private func removeEmptyUnprovisionDirectory(_ path: String) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect unprovision directory", path)
    }
    _ = try secureMetadata(path, type: S_IFDIR, uid: 0, gid: 0, mode: path == signingCustodyRoot ? 0o700 : 0o755)
    let entries = try FileManager.default.contentsOfDirectory(atPath: path)
    guard entries.isEmpty else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the unexpected root-owned development residue before retrying unprovision",
            "Refusing to report unprovision success while \(path) still contains: \(entries.sorted().joined(separator: ", "))"
        )
    }
    guard rmdir(path) == 0 else { throw posixFailure("remove empty unprovision directory", path) }
}

private func requireCompleteInstalledService() throws {
    let missing = [runtimeExecutablePath, desktopApplicationPath, launchDaemonPath].filter {
        !FileManager.default.fileExists(atPath: $0)
    }
    guard missing.isEmpty else {
        throw fail("dev-runtime-service-not-installed", "run pnpm dev:runtime -- --install", "The macOS development Runtime installation is incomplete: \(missing.joined(separator: ", "))")
    }
}

private func removeSocketIfPresent(_ path: String) throws {
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect launchd socket", path)
    }
    guard metadata.st_mode & S_IFMT == S_IFSOCK, metadata.st_uid == 0, metadata.st_gid == 20 else {
        throw fail("runtime-service-repair-required", "inspect the fixed launchd socket before removal", "Refusing to remove an untrusted object at \(path).")
    }
    guard unlink(path) == 0 else { throw posixFailure("remove launchd socket", path) }
}

private func removeFixedTargetIfPresent(_ path: String) throws {
    guard [
        desktopApplicationPath,
        runtimeActiveRoot,
        runtimeStateRoot,
        runtimeRollbackRoot,
        runtimeTransactionRoot,
        "\(runtimeDevRoot)/installer-ledger.json",
        installationJournalPath,
        signingProfilePath,
        signingCustodyRoot,
        runtimeDevRoot,
        launchDaemonPath,
    ].contains(path) else {
        throw fail("runtime-service-repair-required", "inspect fixed uninstall target selection", "Refusing an unrecognized uninstall target.")
    }
    var metadata = stat()
    if lstat(path, &metadata) != 0 {
        if errno == ENOENT { return }
        throw posixFailure("inspect uninstall target", path)
    }
    guard metadata.st_mode & S_IFMT != S_IFLNK else {
        throw fail("runtime-service-repair-required", "remove the conflicting symlink manually after inspection", "Refusing to follow an uninstall symlink at \(path).")
    }
    try FileManager.default.removeItem(atPath: path)
}

func developmentProcessesRunning() throws -> Bool {
    for processName in ["Nimi Dev", "Nimi Local App Host Dev", "nimi-runtime"] {
        let status = try processExitStatusForLifecycle("/usr/bin/pgrep", ["-x", processName])
        if status == 0 { return true }
        guard status == 1 else {
            throw fail(
                "runtime-service-repair-required",
                "restore process inspection before service mutation",
                "pgrep could not prove \(processName) absent (status \(status))."
            )
        }
    }
    return false
}

private func processExitStatusForLifecycle(_ executable: String, _ arguments: [String]) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
    do { try process.run() }
    catch {
        throw fail(
            "runtime-service-repair-required",
            "restore process inspection before service mutation",
            "Cannot execute the fixed process inspection command: \(diagnosticMessage(error))"
        )
    }
    process.waitUntilExit()
    guard process.terminationReason == .exit else {
        throw fail("runtime-service-repair-required", "restore process inspection before service mutation", "The fixed process inspection command terminated abnormally.")
    }
    return process.terminationStatus
}

private func parseJSONObject(_ data: Data, label: String) throws -> [String: Any] {
    guard data.count > 0, data.count <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw fail("runtime-service-repair-required", "inspect \(label) output", "\(label) did not return one bounded JSON object.")
    }
    return value
}
