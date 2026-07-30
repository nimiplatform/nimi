import Darwin
import Foundation

private let serviceRoot = "/Library/Application Support/Nimi/RuntimeDev"
private let activeRoot = "\(serviceRoot)/active"
private let bootstrapRoot = "\(serviceRoot)/bootstrap"
private let socketRoot = "/private/var/run/nimi-dev"
private let installerLockPath = "/private/var/run/nimi-macos-dev-security.lock"

private struct RuntimePrincipal { let identifier: uid_t }
private struct UserRecord { let uid: uid_t; let gid: gid_t; let home: String; let shell: String }
private struct GroupRecord { let gid: gid_t }
private struct PrincipalPresence { let user: UserRecord?; let group: GroupRecord? }

func serviceStatus() throws -> [String: Any] {
    let manager = FileManager.default
    let principal = runtimePrincipalPresence()
    let launchdJob = try launchdJobPresent()
    let observed: [String: Bool] = [
        "helper": manager.fileExists(atPath: generatedInstallerHelperPath),
        "serviceRoot": manager.fileExists(atPath: serviceRoot),
        "runtime": manager.fileExists(atPath: generatedRuntimeExecutablePath),
        "state": manager.fileExists(atPath: generatedRuntimeStateRoot),
        "desktop": manager.fileExists(atPath: generatedDesktopApplicationPath),
        "launchDaemon": manager.fileExists(atPath: generatedLaunchDaemonPath),
        "socketRoot": manager.fileExists(atPath: socketRoot),
        "principalUser": principal.user != nil,
        "principalGroup": principal.group != nil,
        "launchdJob": launchdJob,
    ]
    if observed.values.allSatisfy({ !$0 }) {
        return ["status": "absent", "state": "stopped", "serviceName": generatedLaunchDaemonLabel]
    }
    let required = [
        "helper", "serviceRoot", "runtime", "state", "desktop",
        "launchDaemon", "socketRoot", "principalUser", "principalGroup",
    ]
    guard required.allSatisfy({ observed[$0] == true }) else {
        return [
            "status": "partial", "state": (try? launchdPID()) == nil ? "stopped" : "running",
            "serviceName": generatedLaunchDaemonLabel,
            "reasonCode": "runtime-service-repair-required", "observed": observed,
        ]
    }
    if let pid = try? launchdPID() {
        return [
            "status": "present", "state": "running", "pid": pid,
            "serviceName": generatedLaunchDaemonLabel,
        ]
    }
    return ["status": "present", "state": "stopped", "serviceName": generatedLaunchDaemonLabel]
}

func installCandidate(root: URL) throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }

    let candidate = try requireCandidateRoot(root)
    try requireCleanInstallTarget(candidate: candidate)

    try ensureDirectory(serviceRoot, owner: 0, group: 0, mode: 0o755)
    try ensureDirectory(
        (generatedInstallerHelperPath as NSString).deletingLastPathComponent,
        owner: 0, group: 0, mode: 0o755
    )
    let principal = try createRuntimePrincipal()
    try ensureDirectory(
        generatedRuntimeStateRoot,
        owner: principal.identifier, group: principal.identifier, mode: 0o700
    )
    try installExact("\(candidate)/runtime", activeRoot)
    try installExact("\(candidate)/Nimi Dev.app", generatedDesktopApplicationPath)
    try removeLocalDevelopmentTransferMetadata(generatedDesktopApplicationPath)
    try installExact(
        "\(candidate)/launchd/ai.nimi.runtime.dev.plist",
        generatedLaunchDaemonPath
    )
    try installExact(
        "\(candidate)/installer/nimi-macos-dev-security",
        generatedInstallerHelperPath
    )
    try ensureDirectory(socketRoot, owner: 0, group: 0, mode: 0o755)
    try runFixed(generatedRuntimeExecutablePath, ["macos-protected-state-provision"])
    try runFixed("/bin/launchctl", ["bootstrap", "system", generatedLaunchDaemonPath])
    let pid = try waitForRuntime(previousPID: nil)
    return [
        "status": "installed", "state": "running", "pid": pid,
        "serviceName": generatedLaunchDaemonLabel,
    ]
}

func updateCandidate(root: URL) throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }

    let candidate = try requireCandidateRoot(root)
    let status = try serviceStatus()
    try requireThat(
        status["status"] as? String == "present",
        "runtime-service-repair-required", "run_the_explicit_uninstall_before_update",
        "Update requires one complete installed development Runtime."
    )
    let principal = try requireRuntimePrincipal()
    try requireRuntimeStateDirectory(principal)
    let previousPID = try? launchdPID()

    try terminateInstalledDesktopProcesses()
    try stopLaunchdJob()
    try removeLaunchdSockets()
    for path in [
        generatedLaunchDaemonPath, generatedDesktopApplicationPath,
        activeRoot, generatedInstallerHelperPath,
    ] {
        try removeIfPresent(path)
    }
    try installExact("\(candidate)/runtime", activeRoot)
    try installExact("\(candidate)/Nimi Dev.app", generatedDesktopApplicationPath)
    try removeLocalDevelopmentTransferMetadata(generatedDesktopApplicationPath)
    try installExact(
        "\(candidate)/launchd/ai.nimi.runtime.dev.plist",
        generatedLaunchDaemonPath
    )
    try installExact(
        "\(candidate)/installer/nimi-macos-dev-security",
        generatedInstallerHelperPath
    )
    try runFixed("/bin/launchctl", ["bootstrap", "system", generatedLaunchDaemonPath])
    let pid = try waitForRuntime(previousPID: previousPID)
    return [
        "status": "updated", "state": "running", "pid": pid,
        "serviceName": generatedLaunchDaemonLabel,
    ]
}

func restartService() throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }
    let before = try launchdPID()
    try runFixed("/bin/launchctl", ["kickstart", "-k", "system/\(generatedLaunchDaemonLabel)"])
    let after = try waitForRuntime(previousPID: before)
    try requireThat(after != before, "runtime-service-unavailable", "inspect_launchd_logs", "Runtime restart did not produce a new process.")
    return ["status": "restarted", "previousPID": before, "pid": after, "serviceName": generatedLaunchDaemonLabel]
}

func uninstallService() throws -> [String: Any] {
    try requireRoot()
    let lock = try acquireInstallerLock()
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }
    try terminateInstalledDesktopProcesses()
    try stopLaunchdJob()
    try removeLaunchdSockets()
    if try protectedStateNeedsReset(),
       FileManager.default.fileExists(atPath: generatedRuntimeExecutablePath) {
        try runFixed(generatedRuntimeExecutablePath, ["macos-protected-state-reset"])
    }
    for path in [
        generatedLaunchDaemonPath, generatedDesktopApplicationPath, activeRoot,
        generatedRuntimeStateRoot, socketRoot, bootstrapRoot,
    ] {
        try removeIfPresent(path)
    }
    try deleteRuntimePrincipal()
    if FileManager.default.fileExists(atPath: serviceRoot),
       try FileManager.default.contentsOfDirectory(atPath: serviceRoot).isEmpty {
        try FileManager.default.removeItem(atPath: serviceRoot)
    }
    try removeIfPresent(generatedInstallerHelperPath)
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
        generatedDesktopApplicationPath, generatedLaunchDaemonPath, socketRoot,
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

private func installExact(_ source: String, _ target: String) throws {
    try requireThat(
        !FileManager.default.fileExists(atPath: target),
        "runtime-service-repair-required", "run_the_explicit_uninstall",
        "A fixed install target is already occupied.", details: ["path": target]
    )
    try FileManager.default.copyItem(atPath: source, toPath: target)
    try secureCopiedTree(target)
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

private func requireRuntimeStateDirectory(_ principal: RuntimePrincipal) throws {
    var state = stat()
    try requireThat(
        lstat(generatedRuntimeStateRoot, &state) == 0
            && state.st_mode & S_IFMT == S_IFDIR
            && state.st_uid == principal.identifier
            && state.st_gid == principal.identifier
            && state.st_mode & 0o777 == 0o700,
        "runtime-service-repair-required", "run_the_explicit_uninstall_before_update",
        "The installed Runtime state directory is not owned by the isolated principal."
    )
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
            try? runDirectoryServiceMutation([
                ".", "-delete", "/Users/\(generatedRuntimeAccountName)",
            ])
        }
        if groupCreated {
            try? runDirectoryServiceMutation([
                ".", "-delete", "/Groups/\(generatedRuntimeAccountName)",
            ])
        }
        _ = try? resetOpenDirectoryCache()
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
    if value.user != nil {
        try runDirectoryServiceMutation([
            ".", "-delete", "/Users/\(generatedRuntimeAccountName)",
        ])
    }
    if value.group != nil {
        try runDirectoryServiceMutation([
            ".", "-delete", "/Groups/\(generatedRuntimeAccountName)",
        ])
    }
    if value.user != nil || value.group != nil {
        try resetOpenDirectoryCache()
    }
}

private func runDirectoryServiceMutation(_ arguments: [String]) throws {
    let result = try runFixedResult("/usr/bin/dscl", arguments, timeoutSeconds: 30)
    if result.status == 0 { return }
    throw fail(
        "runtime-service-repair-required", "inspect_OpenDirectory",
        String(data: result.stderr.prefix(2000), encoding: .utf8) ?? "A fixed OpenDirectory mutation failed.",
        details: ["status": Int(result.status)]
    )
}

private func resetOpenDirectoryCache() throws {
    let result = try runFixedResult(
        "/usr/bin/odutil", ["reset", "cache"], timeoutSeconds: 10
    )
    try requireThat(
        result.status == 0,
        "runtime-service-repair-required", "inspect_OpenDirectory",
        "The OpenDirectory cache could not be reset.",
        details: ["status": Int(result.status)]
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

private func waitForRuntime(previousPID: pid_t?) throws -> pid_t {
    for _ in 0..<100 {
        usleep(100_000)
        guard let pid = try? launchdPID(), previousPID == nil || pid != previousPID else { continue }
        return pid
    }
    throw fail(
        "runtime-service-unavailable", "inspect_launchd_logs",
        "launchd did not produce a live Runtime process."
    )
}

private func protectedStateNeedsReset() throws -> Bool {
    guard FileManager.default.fileExists(atPath: generatedRuntimeStateRoot) else { return false }
    return try !FileManager.default.contentsOfDirectory(atPath: generatedRuntimeStateRoot).isEmpty
}

private func stopLaunchdJob() throws {
    if try launchdJobPresent() {
        try runFixed("/bin/launchctl", ["bootout", "system/\(generatedLaunchDaemonLabel)"])
        for _ in 0..<200 {
            if try !launchdJobPresent() { break }
            usleep(100_000)
        }
        let stillPresent = try launchdJobPresent()
        try requireThat(!stillPresent, "runtime-service-repair-required", "inspect_the_live_launchd_job", "The Runtime launchd job remained present.")
    }
}

private func removeLaunchdSockets() throws {
    for path in [generatedDesktopSocketPath, generatedLocalAppSocketPath] {
        try requireThat(
            unlink(path) == 0 || errno == ENOENT,
            "runtime-service-repair-required", "inspect_the_exact_launchd_socket",
            "A fixed launchd socket cannot be removed.", details: ["path": path]
        )
    }
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
