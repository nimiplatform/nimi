import Darwin
import Foundation

struct LaunchdRuntimeState {
    let loaded: Bool
    let running: Bool
    let pid: pid_t?
}

private struct RuntimeProcessSnapshot: Equatable {
    let pid: pid_t
    let parentPID: pid_t
    let effectiveUID: uid_t
    let realUID: uid_t
    let startSeconds: UInt64
    let startMicroseconds: UInt64
    let executablePath: String
    let device: UInt64
    let inode: UInt64
    let size: Int64
    let modifiedSeconds: Int64

    var startIdentity: String { "\(pid):\(startSeconds):\(startMicroseconds)" }
}

func developmentStatus() throws -> [String: Any] {
    let profilePresent = fixedPathExists(signingProfilePath)
    let bootstrapHelperResiduePresent = fixedPathExists(bootstrapHelperInstallPath)
    let installationPresent = try developmentInstallationArtifactsPresent()
    var errors = [[String: String]]()
    if bootstrapHelperResiduePresent {
        errors.append([
            "field": "bootstrapHelperRetired",
            "reasonCode": "runtime-service-repair-required",
            "message": "The non-authorizing provisioning bootstrap remains after its bounded transaction.",
        ])
    }
    let profile: DevelopmentSigningProfile? = profilePresent
        ? probe("signingProfileTrusted", errors: &errors) {
            try DevelopmentCertificateAuthority().validateInstalledProfile(
                requirePrivateCustody: false
            )
        }
        : nil
    let privilegedPrincipalVerification = getuid() == 0 && geteuid() == 0
    let principal = installationPresent && privilegedPrincipalVerification
        ? probe("runtimeAccountTrusted", errors: &errors) { try installedRuntimeAccountIdentity() }
        : nil
    let definitionTrusted = installationPresent
        ? (probe("launchDaemonDefinitionTrusted", errors: &errors) { try verifyInstalledLaunchDaemonDefinition() } != nil)
        : false
    let ledger = installationPresent
        ? probe("installerLedgerTrusted", errors: &errors) { try readInstallerLedger() }
        : nil
    var releaseSet: InstalledDevelopmentReleaseSet?
    if let profile, let ledger {
        releaseSet = probe("installedReleaseSetTrusted", errors: &errors) {
            try verifyInstalledDevelopmentReleaseSet(profile: profile, ledger: ledger)
        }
    }
    let launchState = probe("launchdStateTrusted", errors: &errors) { try inspectLaunchdRuntimeState() }
        ?? LaunchdRuntimeState(loaded: false, running: false, pid: nil)
    let desktopSocketTrusted = installationPresent && probe("desktopSocketTrusted", errors: &errors) {
        try verifyProtectedSocket(generatedDesktopSocketPath)
    } != nil
    let localAppSocketTrusted = installationPresent && probe("localAppSocketTrusted", errors: &errors) {
        try verifyProtectedSocket(generatedLocalAppSocketPath)
    } != nil
    var processSnapshot: RuntimeProcessSnapshot?
    var processTrusted = false
    if let pid = launchState.pid,
       let principal,
       let staticIdentity = releaseSet?.roleIdentities["nimi_runtime_service"] {
        processSnapshot = probe("runtimeProcessTrusted", errors: &errors) {
            try verifyStableRuntimeProcess(pid: pid, principal: principal, staticIdentity: staticIdentity)
        }
        processTrusted = processSnapshot != nil
    }
    let principalTransactionClean = !fixedPathExists(runtimePrincipalJournalPath)
    let transactionClean = !fixedPathExists(installationJournalPath) && principalTransactionClean
    let transactionCommitted = !transactionClean && probe("installationTransactionCommitted", errors: &errors) {
        try verifyCandidateCommittedInstallationJournal()
    } != nil
    if !transactionClean && !transactionCommitted {
        errors.append([
            "field": "installationTransactionClean",
            "reasonCode": "runtime-service-repair-required",
            "message": principalTransactionClean
                ? "An interrupted installation journal remains."
                : "An interrupted Runtime principal journal requires privileged exact recovery.",
        ])
    }
    let runtimePresent = fixedPathExists(runtimeExecutablePath)
    let desktopPresent = fixedPathExists(desktopApplicationPath)
    let launchDaemonPresent = fixedPathExists(launchDaemonPath)
    let releaseSetTrusted = releaseSet != nil
    let baseHealthy = installationPresent && !bootstrapHelperResiduePresent
        && profile != nil && principal != nil && definitionTrusted
        && ledger != nil && releaseSetTrusted && launchState.loaded && launchState.running
        && processTrusted && desktopSocketTrusted && localAppSocketTrusted
    let activationReady = baseHealthy && (transactionClean || transactionCommitted)
    let healthy = baseHealthy && transactionClean
    var result: [String: Any] = [
        "status": installationPresent ? "present" : "absent",
        "state": launchState.running ? "running" : "stopped",
        "healthy": healthy,
        "serviceName": launchDaemonLabel,
        "signingProfile": profilePresent ? "present" : "absent",
        "signingProfileTrusted": profile != nil,
        "bootstrapHelperRetired": !bootstrapHelperResiduePresent,
        "signingCustodyVerification": !profilePresent
            ? "absent"
            : "privileged_transaction_required",
        "runtimePath": runtimeExecutablePath,
        "desktopPath": desktopApplicationPath,
        "runtimeExecutablePresent": runtimePresent,
        "desktopApplicationPresent": desktopPresent,
        "launchDaemonPresent": launchDaemonPresent,
        "runtimeAccountTrusted": principal != nil,
        "runtimeAccountVerification": !installationPresent
            ? "not_applicable"
            : (privilegedPrincipalVerification ? (principal != nil ? "verified" : "failed") : "privileged_required"),
        "runtimePrincipalCarrierContractVersion": runtimePrincipalCarrierContractVersion,
        "runtimePrincipalTransactionClean": principalTransactionClean,
        "launchDaemonDefinitionTrusted": definitionTrusted,
        "installerLedgerTrusted": ledger != nil,
        "installedReleaseSetTrusted": releaseSetTrusted,
        "runtimeExecutableTrusted": releaseSet?.roleIdentities["nimi_runtime_service"] != nil,
        "desktopApplicationTrusted": releaseSet?.roleIdentities["nimi_desktop"] != nil,
        "localAppHostTrusted": releaseSet?.roleIdentities["nimi_local_app_host"] != nil,
        "launchDaemonLoaded": launchState.loaded,
        "runtimeProcessTrusted": processTrusted,
        "desktopSocketPresent": fixedPathExists(generatedDesktopSocketPath),
        "desktopSocketTrusted": desktopSocketTrusted,
        "localAppSocketPresent": fixedPathExists(generatedLocalAppSocketPath),
        "localAppSocketTrusted": localAppSocketTrusted,
        "installationTransactionClean": transactionClean,
        "installationTransactionCommitted": transactionCommitted,
        "activationReady": activationReady,
        "productAdmission": false,
        "tauriAdmission": "fail_closed",
        "errors": errors,
    ]
    if let profile {
        result["rootKeyId"] = profile.rootKeyId
        result["identityClass"] = profile.identityClass
    }
    if let releaseSet {
        result["generation"] = releaseSet.generation
        result["releaseId"] = releaseSet.releaseId
    }
    if let processSnapshot {
        result["runtimePID"] = processSnapshot.pid
        result["runtimeProcessStartIdentity"] = processSnapshot.startIdentity
    }
    return result
}

func waitForHealthyDevelopmentService(
    timeoutSeconds: TimeInterval = 15,
    allowCommittedTransaction: Bool = false
) throws -> [String: Any] {
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    var lastStatus: [String: Any] = [:]
    repeat {
        lastStatus = try developmentStatus()
        let field = allowCommittedTransaction ? "activationReady" : "healthy"
        if lastStatus[field] as? Bool == true { return lastStatus }
        usleep(150_000)
    } while Date() < deadline
    let diagnostic = (try? JSONSerialization.data(withJSONObject: lastStatus, options: [.sortedKeys]))
        .flatMap({ String(data: $0, encoding: .utf8) }) ?? "{}"
    throw fail(
        "runtime-service-repair-required",
        "inspect launchd state, signed artifacts, release records, service account, and protected sockets",
        "The macOS development Runtime did not reach a verified healthy state: \(diagnostic.prefix(2000))"
    )
}

func verifyInstalledLaunchDaemonDefinition() throws {
    _ = try secureMetadata(launchDaemonPath, type: S_IFREG, uid: 0, gid: 0, mode: 0o644, links: 1)
    let data = try Data(contentsOf: URL(fileURLWithPath: launchDaemonPath), options: [.mappedIfSafe])
    guard !data.isEmpty, data.count <= 64 * 1024, sha256(data) == generatedLaunchDaemonSHA256,
          let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          plist["Label"] as? String == launchDaemonLabel,
          plist["ProgramArguments"] as? [String] == [runtimeExecutablePath, "serve"],
          plist["UserName"] as? String == runtimeAccountName,
          plist["GroupName"] as? String == runtimeAccountName else {
        throw fail("runtime-service-untrusted", "reinstall the generated launchd definition", "The installed launchd definition differs from authority-derived bytes.")
    }
}

func inspectLaunchdRuntimeState() throws -> LaunchdRuntimeState {
    let result = try runFixedCommand(
        "/bin/launchctl",
        ["print", "system/\(launchDaemonLabel)"],
        captureLimit: 1024 * 1024,
        timeoutSeconds: 30,
        acceptedExitStatuses: [0, 113]
    )
    if result.status != 0 {
        let diagnostic = String(data: result.stderr + result.stdout, encoding: .utf8) ?? ""
        let exactAbsent = result.status == 113
            && diagnostic.contains("Could not find service \"\(launchDaemonLabel)\" in domain for system")
        guard exactAbsent else {
            throw fail(
                "runtime-service-repair-required",
                "inspect the system launchd domain before service mutation",
                "launchctl could not prove the Runtime job absent (status \(result.status))."
            )
        }
        return LaunchdRuntimeState(loaded: false, running: false, pid: nil)
    }
    guard let output = String(data: result.stdout, encoding: .utf8),
          output.utf8.count <= 1024 * 1024,
          output.contains("system/\(launchDaemonLabel) = {") else {
        throw fail("runtime-service-untrusted", "repair the system launchd job", "launchctl returned an unrecognized job projection.")
    }
    let lines = output.split(separator: "\n", omittingEmptySubsequences: false)
        .map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
    let states = lines.filter({ $0.hasPrefix("state = ") }).map({ String($0.dropFirst("state = ".count)) })
    let paths = lines.filter({ $0.hasPrefix("path = ") }).map({ String($0.dropFirst("path = ".count)) })
    let pids = lines.filter({ $0.hasPrefix("pid = ") }).compactMap({ Int32($0.dropFirst("pid = ".count)) })
    guard states.count == 1, paths == [launchDaemonPath], pids.count <= 1 else {
        throw fail("runtime-service-untrusted", "repair the system launchd job", "launchctl job identity is ambiguous or does not use the fixed definition.")
    }
    let running = states[0] == "running"
    if running {
        guard pids.count == 1, pids[0] > 1 else {
            throw fail("runtime-service-untrusted", "repair the system launchd job", "A running launchd Runtime has no stable pid.")
        }
        return LaunchdRuntimeState(loaded: true, running: true, pid: pids[0])
    }
    return LaunchdRuntimeState(loaded: true, running: false, pid: nil)
}

private func verifyProtectedSocket(_ path: String) throws {
    _ = try secureMetadata(path, type: S_IFSOCK, uid: 0, gid: 20, mode: 0o660, links: 1)
    _ = try secureMetadata((path as NSString).deletingLastPathComponent, type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
}

private func verifyStableRuntimeProcess(
    pid: pid_t,
    principal: (uid: uid_t, gid: gid_t),
    staticIdentity: SignedCodeIdentity
) throws -> RuntimeProcessSnapshot {
    let first = try runtimeProcessSnapshot(pid)
    let dynamicIdentity = try inspectRunningSignedCode(pid)
    usleep(100_000)
    let second = try runtimeProcessSnapshot(pid)
    guard first == second,
          first.pid == pid,
          first.parentPID == 1,
          first.effectiveUID == principal.uid,
          first.realUID == principal.uid,
          first.executablePath == runtimeExecutablePath,
          first.startSeconds > 0,
          sameInstalledIdentity(dynamicIdentity, staticIdentity),
          kill(pid, 0) == 0 || errno == EPERM else {
        throw fail("process-replaced", "restart and repair the fixed Runtime service", "The launchd Runtime process identity changed or failed its dynamic code policy.")
    }
    return first
}

private func runtimeProcessSnapshot(_ pid: pid_t) throws -> RuntimeProcessSnapshot {
    var info = proc_bsdinfo()
    let expectedSize = Int32(MemoryLayout<proc_bsdinfo>.size)
    let actualSize = withUnsafeMutablePointer(to: &info) {
        proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, expectedSize)
    }
    var buffer = [CChar](repeating: 0, count: 4096)
    let pathLength = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard actualSize == expectedSize, pathLength > 0,
          let executablePath = String(validatingUTF8: buffer) else {
        throw fail("runtime-service-untrusted", "repair the fixed Runtime service", "Cannot acquire a complete Runtime process snapshot.")
    }
    let descriptor = open(runtimeExecutablePath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw posixFailure("open installed Runtime executable witness", runtimeExecutablePath) }
    defer { close(descriptor) }
    var opened = stat()
    var linked = stat()
    guard fstat(descriptor, &opened) == 0,
          lstat(runtimeExecutablePath, &linked) == 0,
          opened.st_dev == linked.st_dev,
          opened.st_ino == linked.st_ino,
          opened.st_mode & S_IFMT == S_IFREG,
          opened.st_uid == 0,
          opened.st_gid == 0,
          opened.st_nlink == 1,
          opened.st_mode & 0o022 == 0 else {
        throw fail("process-replaced", "repair the fixed Runtime executable", "The Runtime executable vnode changed or has unsafe metadata.")
    }
    return RuntimeProcessSnapshot(
        pid: pid_t(info.pbi_pid),
        parentPID: pid_t(info.pbi_ppid),
        effectiveUID: uid_t(info.pbi_uid),
        realUID: uid_t(info.pbi_ruid),
        startSeconds: info.pbi_start_tvsec,
        startMicroseconds: info.pbi_start_tvusec,
        executablePath: executablePath,
        device: UInt64(opened.st_dev),
        inode: UInt64(opened.st_ino),
        size: opened.st_size,
        modifiedSeconds: Int64(opened.st_mtimespec.tv_sec)
    )
}

private func sameInstalledIdentity(_ left: SignedCodeIdentity, _ right: SignedCodeIdentity) -> Bool {
    left.identifier == right.identifier && left.teamId == right.teamId && left.cdhash == right.cdhash
        && left.designatedRequirement == right.designatedRequirement
        && left.leafSPKISHA256 == right.leafSPKISHA256 && left.hardenedRuntime && right.hardenedRuntime
}

private func developmentInstallationArtifactsPresent() throws -> Bool {
    let fixedArtifactsPresent = [
        runtimeActiveRoot, runtimeStateRoot, runtimeExecutablePath, desktopApplicationPath,
        launchDaemonPath, generatedDesktopSocketPath, generatedLocalAppSocketPath,
        "\(runtimeDevRoot)/installer-ledger.json", installationJournalPath, runtimePrincipalJournalPath,
    ].contains(where: fixedPathExists)
    if fixedArtifactsPresent { return true }
    return try runtimePOSIXAccountNamePresent(phase: "development-status")
}

private func fixedPathExists(_ path: String) -> Bool {
    var metadata = stat()
    return lstat(path, &metadata) == 0
}

private func probe<T>(
    _ field: String,
    errors: inout [[String: String]],
    _ operation: () throws -> T
) -> T? {
    do { return try operation() }
    catch let failure as DevSecurityFailure {
        errors.append(["field": field, "reasonCode": failure.reasonCode, "message": failure.message])
    } catch {
        errors.append(["field": field, "reasonCode": "runtime-service-repair-required", "message": diagnosticMessage(error)])
    }
    return nil
}
