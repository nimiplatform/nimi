import Darwin
import Foundation

private let serviceRoot = "/Library/Application Support/Nimi/RuntimeDev"
private let activeRoot = "\(serviceRoot)/active"
private let bootstrapRoot = "\(serviceRoot)/bootstrap"
private let journalPath = "\(serviceRoot)/install-transaction.json"
private let socketRoot = "/private/var/run/nimi-dev"
private let localHostApplicationPath = "/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app"
private let installerLockPath = "/private/var/run/nimi-macos-dev-security.lock"

private struct SignedRole {
    let codePath: String
    let executablePath: String
    let identifier: String
}

private let installedRoles = [
    SignedRole(codePath: generatedRuntimeExecutablePath, executablePath: generatedRuntimeExecutablePath, identifier: "ai.nimi.runtime.dev"),
    SignedRole(codePath: generatedDesktopApplicationPath, executablePath: generatedDesktopExecutablePath, identifier: "ai.nimi.apps.nimi.desktop.dev"),
    SignedRole(codePath: localHostApplicationPath, executablePath: generatedLocalAppHostPath, identifier: "ai.nimi.apps.nimi.local-app-host.dev"),
]

private struct RuntimePrincipal { let identifier: uid_t }
private struct UserRecord { let uid: uid_t; let gid: gid_t; let home: String; let shell: String }
private struct GroupRecord { let gid: gid_t }
private struct PrincipalPresence { let user: UserRecord?; let group: GroupRecord? }
private struct InstallJournal: Codable { let schemaVersion: Int; let transactionID: String }
private struct StagingPaths {
    let runtime: String
    let desktop: String
    let helper: String
    let plist: String
    var all: [String] { [runtime, desktop, helper, plist] }
}

func serviceStatus() throws -> [String: Any] {
    let manager = FileManager.default
    let principal = runtimePrincipalPresence()
    let stagingPaths = try knownStagingPaths()
    let observed: [String: Bool] = [
        "helper": manager.fileExists(atPath: generatedInstallerHelperPath),
        "serviceRoot": manager.fileExists(atPath: serviceRoot),
        "runtime": manager.fileExists(atPath: generatedRuntimeExecutablePath),
        "state": manager.fileExists(atPath: generatedRuntimeStateRoot),
        "desktop": manager.fileExists(atPath: generatedDesktopApplicationPath),
        "launchDaemon": manager.fileExists(atPath: generatedLaunchDaemonPath),
        "socketRoot": manager.fileExists(atPath: socketRoot),
        "principal": principal.user != nil || principal.group != nil,
        "journal": manager.fileExists(atPath: journalPath),
        "staging": !stagingPaths.isEmpty,
        "launchdJob": try launchdJobPresent(),
    ]
    if observed.values.allSatisfy({ !$0 }) {
        return ["status": "absent", "state": "stopped", "healthy": false, "serviceName": generatedLaunchDaemonLabel]
    }
    let required = ["helper", "serviceRoot", "runtime", "state", "desktop", "launchDaemon", "socketRoot", "principal", "launchdJob"]
    guard required.allSatisfy({ observed[$0] == true }),
          observed["journal"] == false,
          observed["staging"] == false else {
        return [
            "status": "partial", "state": observed["launchdJob"] == true ? "unknown" : "stopped",
            "healthy": false, "serviceName": generatedLaunchDaemonLabel,
            "reasonCode": "runtime-service-repair-required", "observed": observed,
            "stagingPaths": stagingPaths,
        ]
    }
    return try verifyInstalledService()
}

func installCandidate(root: URL) throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }

    let candidate = try requireCandidateRoot(root)
    try inspectStaticCode(
        codePath: "\(candidate)/installer/nimi-macos-dev-security",
        executablePath: "\(candidate)/installer/nimi-macos-dev-security",
        identifier: generatedInstallerSigningIdentifier
    )
    try requireCleanInstallTarget(candidate: candidate)

    let transactionID = UUID().uuidString.lowercased()
    let staging = stagingPaths(transactionID)
    var protectedStateProvisioned = false
    do {
        try ensureDirectory(serviceRoot, owner: 0, group: 0, mode: 0o755)
        try writeJournal(InstallJournal(schemaVersion: 1, transactionID: transactionID))
        try stageCandidate(candidate, to: staging)
        try verifyStagedCandidate(staging)

        try ensureDirectory((generatedInstallerHelperPath as NSString).deletingLastPathComponent, owner: 0, group: 0, mode: 0o755)
        try renameExact(staging.helper, generatedInstallerHelperPath)
        let principal = try createRuntimePrincipal()
        try ensureDirectory(generatedRuntimeStateRoot, owner: principal.identifier, group: principal.identifier, mode: 0o700)
        try renameExact(staging.runtime, activeRoot)
        try renameExact(staging.desktop, generatedDesktopApplicationPath)
        try renameExact(staging.plist, generatedLaunchDaemonPath)
        try ensureDirectory(socketRoot, owner: 0, group: 0, mode: 0o755)
        try runFixed(generatedRuntimeExecutablePath, ["macos-protected-state-provision"])
        protectedStateProvisioned = true
        try runFixed("/bin/launchctl", ["bootstrap", "system", generatedLaunchDaemonPath])

        let pid = try waitForHealthyRuntime(previousPID: nil)
        try removeIfPresent(journalPath)
        try syncDirectory(serviceRoot)
        return ["status": "installed", "state": "running", "healthy": true, "pid": pid, "serviceName": generatedLaunchDaemonLabel]
    } catch {
        do {
            try rollbackInstallation(
                removeInstalledHelper: true,
                resetProtectedState: protectedStateProvisioned
            )
        } catch let rollbackError {
            throw fail(
                "runtime-service-repair-required",
                "run_the_explicit_uninstall_after_inspecting_the_reported_paths",
                "Installation failed and rollback did not complete.",
                details: ["installFailure": String(describing: error), "rollbackFailure": String(describing: rollbackError)]
            )
        }
        throw error
    }
}

func restartService() throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }
    let before = try launchdPID()
    _ = try verifyInstalledService()
    try runFixed("/bin/launchctl", ["kickstart", "-k", "system/\(generatedLaunchDaemonLabel)"])
    let after = try waitForHealthyRuntime(previousPID: before)
    try requireThat(after != before, "runtime-service-unavailable", "inspect_launchd_logs", "Runtime restart did not produce a new process.")
    return ["status": "restarted", "previousPID": before, "pid": after, "serviceName": generatedLaunchDaemonLabel]
}

func uninstallService() throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }
    try rollbackInstallation(
        removeInstalledHelper: true,
        resetProtectedState: try protectedStateNeedsReset()
    )
    let status = try serviceStatus()
    try requireThat(
        status["status"] as? String == "absent",
        "runtime-service-repair-required", "inspect_the_exact_remaining_nimi_paths",
        "The development Runtime namespace remains after uninstall.", details: ["status": status]
    )
    return ["status": "uninstalled", "state": "stopped", "serviceName": generatedLaunchDaemonLabel]
}

private func requireCandidateRoot(_ root: URL) throws -> String {
    let canonical = root.standardizedFileURL.resolvingSymlinksInPath().path
    let identifier = (canonical as NSString).lastPathComponent
    try requireThat(
        canonical == root.standardizedFileURL.path
            && (canonical as NSString).deletingLastPathComponent == bootstrapRoot
            && UUID(uuidString: identifier) != nil,
        "dev-candidate-path-untrusted", "rebuild_and_stage_the_candidate",
        "The candidate must use one canonical root-owned bootstrap directory."
    )
    try requireRootOwnedTree(canonical)
    try requireExactDirectory(canonical, entries: ["Nimi Dev.app", "installer", "launchd", "runtime"])
    try requireExactDirectory("\(canonical)/installer", entries: ["nimi-macos-dev-security"])
    try requireExactDirectory("\(canonical)/launchd", entries: ["ai.nimi.runtime.dev.plist"])
    try requireExactDirectory("\(canonical)/runtime", entries: ["bin"])
    try requireExactDirectory("\(canonical)/runtime/bin", entries: ["nimi-runtime"])
    let current = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath().path
    try requireThat(
        current == "\(canonical)/installer/nimi-macos-dev-security",
        "dev-candidate-helper-mismatch", "run_the_helper_from_the_root_owned_candidate",
        "The candidate must be installed by its own staged helper."
    )
    return canonical
}

private func requireExactDirectory(_ path: String, entries: Set<String>) throws {
    var metadata = stat()
    let observed = try FileManager.default.contentsOfDirectory(atPath: path)
    let valid = lstat(path, &metadata) == 0 && metadata.st_mode & S_IFMT == S_IFDIR
        && metadata.st_uid == 0 && metadata.st_gid == 0 && metadata.st_mode & 0o022 == 0
        && Set(observed) == entries
    try requireThat(
        valid, "dev-candidate-layout-invalid", "rebuild_the_candidate",
        "The candidate layout is incomplete or unsafe.",
        details: ["path": path, "expected": entries.sorted(), "observed": observed.sorted()]
    )
    try requireNoExtendedACL(path, symbolicLink: false)
}

private func requireCleanInstallTarget(candidate: String) throws {
    let occupied = [
        generatedInstallerHelperPath, activeRoot, generatedRuntimeStateRoot,
        generatedDesktopApplicationPath, generatedLaunchDaemonPath, journalPath, socketRoot,
    ].filter { FileManager.default.fileExists(atPath: $0) }
    let principal = runtimePrincipalPresence()
    let jobPresent = try launchdJobPresent()
    try requireThat(
        occupied.isEmpty && principal.user == nil && principal.group == nil && !jobPresent,
        "runtime-service-repair-required", "run_the_explicit_uninstall_before_install",
        "Install requires an absent development Runtime namespace.", details: ["occupiedPaths": occupied]
    )
    try requireExactDirectory(serviceRoot, entries: ["bootstrap"])
    try requireExactDirectory(
        bootstrapRoot,
        entries: [(candidate as NSString).lastPathComponent]
    )
}

private func stagingPaths(_ id: String) -> StagingPaths {
    StagingPaths(
        runtime: "\(serviceRoot)/.active-\(id).stage",
        desktop: "/Applications/.Nimi Dev.app-\(id).stage",
        helper: "/usr/local/libexec/.nimi-macos-dev-security-\(id).stage",
        plist: "/Library/LaunchDaemons/.ai.nimi.runtime.dev-\(id).stage.plist"
    )
}

private func stageCandidate(_ root: String, to staging: StagingPaths) throws {
    try ensureDirectory(serviceRoot, owner: 0, group: 0, mode: 0o755)
    try ensureDirectory("/usr/local/libexec", owner: 0, group: 0, mode: 0o755)
    let pairs = [
        ("\(root)/runtime", staging.runtime),
        ("\(root)/Nimi Dev.app", staging.desktop),
        ("\(root)/installer/nimi-macos-dev-security", staging.helper),
        ("\(root)/launchd/ai.nimi.runtime.dev.plist", staging.plist),
    ]
    for (source, target) in pairs {
        try requireThat(
            !FileManager.default.fileExists(atPath: target),
            "runtime-service-repair-required", "run_the_explicit_uninstall",
            "An install staging path already exists.", details: ["path": target]
        )
        try FileManager.default.copyItem(atPath: source, toPath: target)
        try secureCopiedTree(target)
    }
}

private func verifyStagedCandidate(_ staging: StagingPaths) throws {
    let roles = [
        SignedRole(codePath: staging.helper, executablePath: staging.helper, identifier: generatedInstallerSigningIdentifier),
        SignedRole(codePath: "\(staging.runtime)/bin/nimi-runtime", executablePath: "\(staging.runtime)/bin/nimi-runtime", identifier: "ai.nimi.runtime.dev"),
        SignedRole(codePath: staging.desktop, executablePath: "\(staging.desktop)/Contents/MacOS/Nimi Dev", identifier: "ai.nimi.apps.nimi.desktop.dev"),
        SignedRole(
            codePath: "\(staging.desktop)/Contents/Frameworks/Nimi Local App Host Dev.app",
            executablePath: "\(staging.desktop)/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev",
            identifier: "ai.nimi.apps.nimi.local-app-host.dev"
        ),
    ]
    for role in roles {
        try inspectStaticCode(
            codePath: role.codePath,
            executablePath: role.executablePath,
            identifier: role.identifier
        )
    }
    let plistSHA256 = try sha256File(staging.plist)
    try requireThat(
        plistSHA256 == generatedLaunchDaemonSHA256,
        "dev-candidate-launchd-definition-mismatch", "discard_the_staging_copy_and_rebuild",
        "The staged LaunchDaemon definition changed."
    )
}

private func verifyInstalledService() throws -> [String: Any] {
    for path in [
        generatedInstallerHelperPath, generatedRuntimeExecutablePath,
        generatedDesktopApplicationPath, generatedDesktopExecutablePath,
        localHostApplicationPath, generatedLocalAppHostPath,
        generatedLaunchDaemonPath, generatedRuntimeStateRoot, socketRoot,
    ] { try requireCanonicalPath(path) }
    try requireFile(generatedInstallerHelperPath, owner: 0, group: 0, mode: 0o755, executable: true)
    try requireFile(generatedLaunchDaemonPath, owner: 0, group: 0, mode: 0o644)
    try requireRootOwnedTree(activeRoot)
    try requireRootOwnedTree(generatedDesktopApplicationPath)
    let plistSHA256 = try sha256File(generatedLaunchDaemonPath)
    try requireThat(
        plistSHA256 == generatedLaunchDaemonSHA256,
        "runtime-service-untrusted", "reinstall_the_fixed_launchdaemon",
        "The installed LaunchDaemon definition changed."
    )

    try inspectStaticCode(
        codePath: generatedInstallerHelperPath,
        executablePath: generatedInstallerHelperPath,
        identifier: generatedInstallerSigningIdentifier
    )
    for role in installedRoles {
        try inspectStaticCode(
            codePath: role.codePath,
            executablePath: role.executablePath,
            identifier: role.identifier
        )
    }

    let principal = try requireRuntimePrincipal()
    var state = stat(), sockets = stat()
    try requireThat(
        lstat(generatedRuntimeStateRoot, &state) == 0 && state.st_mode & S_IFMT == S_IFDIR
            && state.st_uid == principal.identifier && state.st_gid == principal.identifier
            && state.st_mode & 0o777 == 0o700,
        "runtime-service-untrusted", "repair_the_runtime_state_directory",
        "Runtime state is not private to the isolated principal."
    )
    try requireThat(
        lstat(socketRoot, &sockets) == 0 && sockets.st_mode & S_IFMT == S_IFDIR
            && sockets.st_uid == 0 && sockets.st_gid == 0 && sockets.st_mode & 0o777 == 0o755,
        "runtime-service-untrusted", "repair_the_launchd_socket_directory",
        "The launchd socket directory metadata is invalid."
    )
    for path in [generatedDesktopSocketPath, generatedLocalAppSocketPath] {
        var socket = stat()
        try requireThat(
            lstat(path, &socket) == 0 && socket.st_mode & S_IFMT == S_IFSOCK
                && socket.st_uid == 0 && socket.st_gid == 20 && socket.st_mode & 0o777 == 0o660,
            "runtime-service-unavailable", "inspect_launchd_socket_activation",
            "A launchd socket has invalid metadata.", details: ["path": path]
        )
    }
    let pid = try launchdPID()
    try verifyRuntimeProcess(pid, principal: principal)
    return ["status": "present", "state": "running", "healthy": true, "pid": pid, "serviceName": generatedLaunchDaemonLabel]
}

private func verifyRuntimeProcess(_ pid: pid_t, principal: RuntimePrincipal) throws {
    try requireThat(
        runtimeProcessPrincipalMatches(pid, principal: principal),
        "runtime-service-untrusted", "inspect_the_isolated_runtime_principal",
        "The Runtime process does not use the isolated principal."
    )
    var bytes = [CChar](repeating: 0, count: 4096)
    try requireThat(
        proc_pidpath(pid, &bytes, UInt32(bytes.count)) > 0
            && String(cString: bytes) == generatedRuntimeExecutablePath && processIsLive(pid),
        "runtime-service-untrusted", "inspect_the_live_runtime",
        "The Runtime process path or liveness is invalid."
    )
    try inspectRunningCode(pid: pid, identifier: "ai.nimi.runtime.dev")
}

private func runtimeProcessPrincipalMatches(_ pid: pid_t, principal: RuntimePrincipal) -> Bool {
    var information = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    if proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &information, size) == size {
        return information.pbi_pid == pid && information.pbi_uid == principal.identifier
            && information.pbi_ruid == principal.identifier && information.pbi_start_tvsec > 0
    }
    if getuid() == 0 { return false }
    guard let text = try? String(
        data: runFixed("/bin/ps", ["-p", String(pid), "-o", "uid=", "-o", "ruid=", "-o", "gid=", "-o", "rgid=", "-o", "ppid="]),
        encoding: .utf8
    ) else { return false }
    let values = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" })
    guard values.count == 5,
          let uid = uid_t(values[0]), let ruid = uid_t(values[1]),
          let gid = gid_t(values[2]), let rgid = gid_t(values[3]),
          let ppid = pid_t(values[4]) else { return false }
    return uid == principal.identifier && ruid == principal.identifier
        && gid == principal.identifier && rgid == principal.identifier && ppid == 1
}

private func runtimePrincipalPresence() -> PrincipalPresence {
    let user = generatedRuntimeAccountName.withCString { name -> UserRecord? in
        guard let value = getpwnam(name), let home = value.pointee.pw_dir, let shell = value.pointee.pw_shell else { return nil }
        return UserRecord(uid: value.pointee.pw_uid, gid: value.pointee.pw_gid, home: String(cString: home), shell: String(cString: shell))
    }
    let group = generatedRuntimeAccountName.withCString { name -> GroupRecord? in
        guard let value = getgrnam(name) else { return nil }
        return GroupRecord(gid: value.pointee.gr_gid)
    }
    return PrincipalPresence(user: user, group: group)
}

private func requireRuntimePrincipal() throws -> RuntimePrincipal {
    let value = runtimePrincipalPresence()
    guard let user = value.user, let group = value.group,
          user.uid == user.gid, user.uid == group.gid, (450...499).contains(Int(user.uid)),
          user.home == "/var/empty", user.shell == "/usr/bin/false" else {
        throw fail(
            "runtime-service-untrusted", "repair_the_isolated_runtime_principal",
            "The _nimiruntimedev user and group are not the fixed non-login principal."
        )
    }
    return RuntimePrincipal(identifier: user.uid)
}

private func createRuntimePrincipal() throws -> RuntimePrincipal {
    let existing = runtimePrincipalPresence()
    try requireThat(
        existing.user == nil && existing.group == nil,
        "runtime-service-repair-required", "run_the_explicit_uninstall_before_install",
        "The isolated Runtime principal already exists."
    )
    guard let identifier = (450...499).first(where: { getpwuid(uid_t($0)) == nil && getgrgid(gid_t($0)) == nil }) else {
        throw fail("runtime-principal-id-unavailable", "free_one_local_system_identifier_in_the_reserved_range", "No system UID/GID is available.")
    }
    let id = String(identifier)
    var groupCreated = false, userCreated = false
    do {
        try runDirectoryServiceMutation([".", "-create", "/Groups/\(generatedRuntimeAccountName)"])
        groupCreated = true
        try runDirectoryServiceMutation([".", "-create", "/Groups/\(generatedRuntimeAccountName)", "PrimaryGroupID", id])
        try runDirectoryServiceMutation([".", "-create", "/Users/\(generatedRuntimeAccountName)"])
        userCreated = true
        for (attribute, value) in [
            ("UniqueID", id), ("PrimaryGroupID", id), ("NFSHomeDirectory", "/var/empty"),
            ("UserShell", "/usr/bin/false"), ("Password", "*"),
            ("RealName", "Nimi Runtime Development"),
        ] {
            try runDirectoryServiceMutation([".", "-create", "/Users/\(generatedRuntimeAccountName)", attribute, value])
        }
        for _ in 0..<40 {
            if let principal = try? requireRuntimePrincipal() { return principal }
            usleep(50_000)
        }
        throw fail("runtime-principal-creation-failed", "inspect_OpenDirectory", "The isolated Runtime principal is not observable.")
    } catch {
        if userCreated {
            _ = try? deleteDirectoryRecord("/Users/\(generatedRuntimeAccountName)") {
                runtimePrincipalPresence().user == nil
            }
        }
        if groupCreated {
            _ = try? deleteDirectoryRecord("/Groups/\(generatedRuntimeAccountName)") {
                runtimePrincipalPresence().group == nil
            }
        }
        throw error
    }
}

private func deleteRuntimePrincipal() throws {
    let value = runtimePrincipalPresence()
    if let user = value.user {
        try requireThat(
            (450...499).contains(Int(user.uid))
                && user.uid == user.gid
                && user.home == "/var/empty"
                && user.shell == "/usr/bin/false",
            "runtime-service-untrusted", "inspect_the_isolated_runtime_principal",
            "Refusing to delete an unexpected user."
        )
    }
    if let group = value.group {
        try requireThat(
            (450...499).contains(Int(group.gid)),
            "runtime-service-untrusted", "inspect_the_isolated_runtime_principal",
            "Refusing to delete an unexpected group."
        )
    }
    if let user = value.user, let group = value.group {
        try requireThat(
            user.uid == group.gid,
            "runtime-service-untrusted", "inspect_the_isolated_runtime_principal",
            "Refusing to delete a mismatched user and group."
        )
    }
    if let user = value.user, value.group == nil {
        try recreateRuntimeGroupForUserDeletion(gid: user.gid)
    }
    if value.user != nil {
        try deleteDirectoryRecord("/Users/\(generatedRuntimeAccountName)") {
            runtimePrincipalPresence().user == nil
        }
    }
    if runtimePrincipalPresence().group != nil {
        try deleteDirectoryRecord("/Groups/\(generatedRuntimeAccountName)") {
            runtimePrincipalPresence().group == nil
        }
    }
    for _ in 0..<200 {
        let remaining = runtimePrincipalPresence()
        if remaining.user == nil && remaining.group == nil { return }
        usleep(50_000)
    }
    throw fail(
        "runtime-service-repair-required", "inspect_OpenDirectory",
        "The isolated Runtime principal remained observable after deletion."
    )
}

private func recreateRuntimeGroupForUserDeletion(gid: gid_t) throws {
    let name = generatedRuntimeAccountName
    try requireThat(
        (450...499).contains(Int(gid)) && getgrgid(gid) == nil,
        "runtime-service-untrusted", "inspect_the_isolated_runtime_principal",
        "Refusing to recreate a deletion guard group for an unexpected principal."
    )
    let id = String(gid)
    try runDirectoryServiceMutation([".", "-create", "/Groups/\(name)"])
    try runDirectoryServiceMutation([".", "-create", "/Groups/\(name)", "PrimaryGroupID", id])
    try runDirectoryServiceMutation([".", "-create", "/Groups/\(name)", "Password", "*"])
    try runDirectoryServiceMutation([".", "-create", "/Groups/\(name)", "RealName", "Nimi Runtime Development"])
    for _ in 0..<40 {
        if runtimePrincipalPresence().group?.gid == gid { return }
        usleep(50_000)
    }
    throw fail(
        "runtime-service-repair-required", "inspect_OpenDirectory",
        "The deletion guard group for the isolated Runtime principal is not observable."
    )
}

private func runDirectoryServiceMutation(_ arguments: [String]) throws {
    let result = try runFixedResult("/usr/bin/dscl", arguments, timeoutSeconds: 10)
    if result.status == 0 || result.status == 124 { return }
    throw fail(
        "runtime-service-repair-required", "inspect_OpenDirectory",
        String(data: result.stderr.prefix(2000), encoding: .utf8) ?? "A fixed OpenDirectory mutation failed.",
        details: ["status": Int(result.status)]
    )
}

private func deleteDirectoryRecord(_ recordPath: String, isAbsent: () -> Bool) throws {
    let result = try runFixedResult("/usr/bin/dscl", [".", "-delete", recordPath], timeoutSeconds: 10)
    if result.status == 0 { return }
    for _ in 0..<40 {
        if isAbsent() { return }
        usleep(50_000)
    }
    throw fail(
        "runtime-service-repair-required", "inspect_OpenDirectory",
        "A fixed OpenDirectory record could not be deleted.",
        details: ["record": recordPath, "status": Int(result.status)]
    )
}

private func ensureDirectory(_ path: String, owner: uid_t, group: gid_t, mode: mode_t) throws {
    try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
    try removeExtendedACL(path, symbolicLink: false)
    try requireThat(
        chown(path, owner, group) == 0 && chmod(path, mode) == 0,
        "dev-install-path-failed", "inspect_the_exact_install_directory",
        "A fixed directory cannot be secured.", details: ["path": path]
    )
    try requireCanonicalPath(path)
}

private func writeJournal(_ journal: InstallJournal) throws {
    try JSONEncoder().encode(journal).write(to: URL(fileURLWithPath: journalPath), options: .atomic)
    try removeExtendedACL(journalPath, symbolicLink: false)
    try requireThat(
        chown(journalPath, 0, 0) == 0 && chmod(journalPath, 0o600) == 0,
        "runtime-service-repair-required", "inspect_the_install_transaction",
        "The install transaction journal cannot be secured."
    )
    try syncDirectory(serviceRoot)
}

private func renameExact(_ source: String, _ target: String) throws {
    try requireThat(
        !FileManager.default.fileExists(atPath: target) && rename(source, target) == 0,
        "dev-installer-activation-failed", "run_the_explicit_uninstall",
        "A staged item cannot be atomically activated.", details: ["source": source, "target": target, "errno": errno]
    )
}

private func waitForHealthyRuntime(previousPID: pid_t?) throws -> pid_t {
    for _ in 0..<100 {
        usleep(100_000)
        guard let pid = try? launchdPID(), previousPID == nil || pid != previousPID else { continue }
        if (try? verifyInstalledService()) != nil { return pid }
    }
    throw fail("runtime-service-unavailable", "inspect_launchd_logs", "The Runtime did not reach a healthy live process.")
}

private func protectedStateNeedsReset() throws -> Bool {
    guard FileManager.default.fileExists(atPath: generatedRuntimeStateRoot) else { return false }
    return try !FileManager.default.contentsOfDirectory(atPath: generatedRuntimeStateRoot).isEmpty
}

private func rollbackInstallation(removeInstalledHelper: Bool, resetProtectedState: Bool) throws {
    try terminateInstalledDesktopProcesses()
    if try launchdJobPresent() {
        try runFixed("/bin/launchctl", ["bootout", "system/\(generatedLaunchDaemonLabel)"])
        for _ in 0..<200 {
            if try !launchdJobPresent() { break }
            usleep(100_000)
        }
        let stillPresent = try launchdJobPresent()
        try requireThat(!stillPresent, "runtime-service-repair-required", "inspect_the_live_launchd_job", "The Runtime launchd job remained present.")
    }
    for path in [generatedDesktopSocketPath, generatedLocalAppSocketPath] {
        try requireThat(
            unlink(path) == 0 || errno == ENOENT,
            "runtime-service-repair-required", "inspect_the_exact_launchd_socket",
            "A fixed launchd socket cannot be removed.", details: ["path": path]
        )
    }
    if resetProtectedState && FileManager.default.fileExists(atPath: generatedRuntimeExecutablePath) {
        let currentHelper = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath().path
        try inspectStaticCode(
            codePath: currentHelper, executablePath: currentHelper,
            identifier: generatedInstallerSigningIdentifier
        )
        try inspectStaticCode(
            codePath: generatedRuntimeExecutablePath,
            executablePath: generatedRuntimeExecutablePath,
            identifier: "ai.nimi.runtime.dev"
        )
        try runFixed(generatedRuntimeExecutablePath, ["macos-protected-state-reset"])
    }
    for path in [
        generatedLaunchDaemonPath, generatedDesktopApplicationPath, activeRoot,
        generatedRuntimeStateRoot, socketRoot, journalPath, bootstrapRoot,
    ] { try removeIfPresent(path) }
    try removeKnownStagingPaths()
    try deleteRuntimePrincipal()
    if FileManager.default.fileExists(atPath: serviceRoot),
       try FileManager.default.contentsOfDirectory(atPath: serviceRoot).isEmpty {
        try FileManager.default.removeItem(atPath: serviceRoot)
    }
    if removeInstalledHelper { try removeIfPresent(generatedInstallerHelperPath) }
}

private func terminateInstalledDesktopProcesses() throws {
    var processes = try installedDesktopProcessIDs()
    for pid in processes {
        try signalInstalledDesktopProcess(pid, signal: SIGTERM)
    }
    for _ in 0..<50 {
        processes = try installedDesktopProcessIDs()
        if processes.isEmpty { return }
        usleep(100_000)
    }
    for pid in processes {
        try signalInstalledDesktopProcess(pid, signal: SIGKILL)
    }
    for _ in 0..<50 {
        if try installedDesktopProcessIDs().isEmpty { return }
        usleep(100_000)
    }
    throw fail(
        "runtime-service-repair-required",
        "inspect_the_installed_nimi_dev_processes",
        "An installed Nimi Dev process remained live during uninstall.",
        details: ["processIdentifiers": try installedDesktopProcessIDs()]
    )
}

private func installedDesktopProcessIDs() throws -> [pid_t] {
    let elementSize = MemoryLayout<pid_t>.size
    let requiredBytes = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
    try requireThat(
        requiredBytes > 0 && Int(requiredBytes) % elementSize == 0,
        "runtime-service-repair-required",
        "inspect_the_installed_nimi_dev_processes",
        "The process table could not be sized for uninstall."
    )
    var capacityBytes = max(Int(requiredBytes) + (128 * elementSize), 128 * elementSize)
    for _ in 0..<4 {
        try requireThat(
            capacityBytes > 0 && capacityBytes <= Int(Int32.max),
            "runtime-service-repair-required",
            "inspect_the_installed_nimi_dev_processes",
            "The process table capacity is unsafe for uninstall."
        )
        var identifiers = [pid_t](
            repeating: 0,
            count: capacityBytes / elementSize
        )
        let bytesRead = identifiers.withUnsafeMutableBytes { buffer in
            proc_listpids(
                UInt32(PROC_ALL_PIDS),
                0,
                buffer.baseAddress,
                Int32(buffer.count)
            )
        }
        let observedBytes = Int(bytesRead)
        try requireThat(
            bytesRead > 0
                && observedBytes <= capacityBytes
                && observedBytes % elementSize == 0,
            "runtime-service-repair-required",
            "inspect_the_installed_nimi_dev_processes",
            "The process table could not be read for uninstall."
        )
        if observedBytes == capacityBytes {
            capacityBytes *= 2
            continue
        }
        let applicationPrefix = "\(generatedDesktopApplicationPath)/"
        return identifiers
            .prefix(observedBytes / elementSize)
            .filter { $0 > 1 && installedProcessPath($0)?.hasPrefix(applicationPrefix) == true }
            .sorted()
    }
    throw fail(
        "runtime-service-repair-required",
        "inspect_the_installed_nimi_dev_processes",
        "The process table changed too quickly to enumerate safely for uninstall."
    )
}

private func installedProcessPath(_ pid: pid_t) -> String? {
    var bytes = [CChar](repeating: 0, count: 4096)
    guard proc_pidpath(pid, &bytes, UInt32(bytes.count)) > 0 else { return nil }
    return String(cString: bytes)
}

private func signalInstalledDesktopProcess(_ pid: pid_t, signal: Int32) throws {
    guard installedProcessPath(pid)?.hasPrefix("\(generatedDesktopApplicationPath)/") == true else {
        return
    }
    let status = kill(pid, signal)
    try requireThat(
        status == 0 || errno == ESRCH,
        "runtime-service-repair-required",
        "inspect_the_installed_nimi_dev_processes",
        "An installed Nimi Dev process could not be terminated.",
        details: ["processIdentifier": pid, "signal": signal, "errno": errno]
    )
}

private func removeKnownStagingPaths() throws {
    for path in try knownStagingPaths() {
        try FileManager.default.removeItem(atPath: path)
    }
}

private func knownStagingPaths() throws -> [String] {
    let patterns = [
        (serviceRoot, ".active-", ".stage"),
        ("/Applications", ".Nimi Dev.app-", ".stage"),
        ("/usr/local/libexec", ".nimi-macos-dev-security-", ".stage"),
        ("/Library/LaunchDaemons", ".ai.nimi.runtime.dev-", ".stage.plist"),
    ]
    var paths: [String] = []
    for (parent, prefix, suffix) in patterns where FileManager.default.fileExists(atPath: parent) {
        for entry in try FileManager.default.contentsOfDirectory(atPath: parent)
        where entry.hasPrefix(prefix) && entry.hasSuffix(suffix) {
            let id = String(entry.dropFirst(prefix.count).dropLast(suffix.count))
            if UUID(uuidString: id) != nil { paths.append("\(parent)/\(entry)") }
        }
    }
    if FileManager.default.fileExists(atPath: bootstrapRoot) {
        for entry in try FileManager.default.contentsOfDirectory(atPath: bootstrapRoot)
        where UUID(uuidString: entry) != nil {
            paths.append("\(bootstrapRoot)/\(entry)")
        }
    }
    return paths.sorted()
}

private func removeIfPresent(_ path: String) throws {
    if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(atPath: path) }
}

private func acquireInstallerLock() throws -> Int32 {
    let descriptor = open(installerLockPath, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
    let valid = descriptor >= 0 && fchown(descriptor, 0, 0) == 0
        && fchmod(descriptor, 0o600) == 0 && flock(descriptor, LOCK_EX) == 0
    if !valid {
        if descriptor >= 0 { Darwin.close(descriptor) }
        throw fail("macos-dev-installer-lock-failed", "retry_after_the_current_operation_finishes", "The installer lock cannot be acquired.")
    }
    return descriptor
}
