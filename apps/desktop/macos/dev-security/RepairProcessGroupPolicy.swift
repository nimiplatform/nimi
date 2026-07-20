import Darwin
import Dispatch
import Foundation

let repairProcessGroupBootstrapCommands = Set([
    "run-repair-final-helper-private-custody",
    "run-repair-source-helper-status",
    "verify-partial-install-repair-principal-removal",
])

func repairBootstrapCommandOwnsProcessGroup(_ arguments: [String]) -> Bool {
    arguments.count == 1 && repairProcessGroupBootstrapCommands.contains(arguments[0])
}

/// Called by the new bootstrap before any command that may exec a preserved
/// legacy helper or perform a fresh proof. No descendant-producing operation is
/// reachable until this succeeds, so the parent can always signal `-getpid()`.
func establishRepairBootstrapProcessGroup() throws {
    let pid = getpid()
    guard pid > 1, getpgrp() == pid else {
        throw repairProcessGroupFailure(state: "atomic-pgid-missing")
    }
}

func execPreservedFinalHelperForRepair(_ command: String) throws -> Never {
    guard getpid() > 1,
          getpgrp() == getpid(),
          ["verify-signing-profile", "status"].contains(command) else {
        throw repairProcessGroupFailure(state: "exec-without-owned-process-group")
    }
    var pointers: [UnsafeMutablePointer<CChar>?] = [
        strdup(helperInstallPath),
        strdup(command),
    ]
    guard pointers.allSatisfy({ $0 != nil }) else {
        pointers.forEach { free($0) }
        throw repairProcessGroupFailure(state: "exec-argv-allocation-failed")
    }
    pointers.append(nil)
    let status = helperInstallPath.withCString { executable in
        pointers.withUnsafeMutableBufferPointer { arguments in
            execv(executable, arguments.baseAddress!)
        }
    }
    let returnCode = errno
    pointers.dropLast().forEach { free($0) }
    guard status == -1 else { _exit(127) }
    throw repairProcessGroupFailure(
        state: "final-helper-exec-failed",
        returnCode: returnCode
    )
}

private func repairProcessGroupFailure(
    state: String,
    returnCode: Int32? = nil
) -> DevSecurityFailure {
    var details: [String: Any] = [
        "phase": "repair-invocation",
        "probe": "bootstrap-process-group",
        "state": state,
        "verifier_pid": getpid(),
        "child_reaped": true,
    ]
    if let returnCode { details["return_code"] = Int(returnCode) }
    return fail(
        "runtime-service-repair-required",
        "preserve the journal and inspect bootstrap process-group ownership",
        "The repair bootstrap could not establish its required descendant process group.",
        details: details
    )
}

struct AtomicProcessGroupExecutionResult {
    let stdout: Data
    let stderr: Data
    let pid: pid_t
    let exitStatus: Int32?
    let terminationSignal: Int32?
    let timedOut: Bool
    let outputOverflowStream: String?
    let monitorError: Int32?
    let sentSIGKILL: Bool
    let childReaped: Bool
}

/// Spawns one admitted repair bootstrap with its PGID established by the
/// kernel as part of `posix_spawn`. No bootstrap instruction can run before the
/// child is a leader of the process group owned by its direct-child PID.
func runAtomicBootstrapProcessGroup(
    executable: String,
    arguments: [String],
    environment: [String: String],
    input: Data?,
    captureLimit: Int,
    timeoutSeconds: Int
) throws -> AtomicProcessGroupExecutionResult {
    guard executable == bootstrapHelperInstallPath,
          repairBootstrapCommandOwnsProcessGroup(arguments),
          captureLimit > 0 else {
        throw repairProcessGroupFailure(state: "unadmitted-atomic-spawn")
    }
    let standardInput = try AtomicSpawnInput(input)
    let standardOutput = try BoundedSpawnCapture(limit: captureLimit)
    let standardError = try BoundedSpawnCapture(limit: captureLimit)
    defer {
        standardInput.close()
        standardOutput.close()
        standardError.close()
    }

    var actions: posix_spawn_file_actions_t?
    let actionsStatus = posix_spawn_file_actions_init(&actions)
    guard actionsStatus == 0 else {
        throw atomicSpawnSetupFailure(state: "file-actions-init-failed", returnCode: actionsStatus)
    }
    defer { _ = posix_spawn_file_actions_destroy(&actions) }
    try standardInput.addFileAction(&actions, target: STDIN_FILENO)
    try standardOutput.addFileActions(&actions, target: STDOUT_FILENO)
    try standardError.addFileActions(&actions, target: STDERR_FILENO)

    var attributes: posix_spawnattr_t?
    let attributesStatus = posix_spawnattr_init(&attributes)
    guard attributesStatus == 0 else {
        throw atomicSpawnSetupFailure(state: "attributes-init-failed", returnCode: attributesStatus)
    }
    defer { _ = posix_spawnattr_destroy(&attributes) }
    let flags = Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)
    let flagsStatus = posix_spawnattr_setflags(&attributes, flags)
    guard flagsStatus == 0 else {
        throw atomicSpawnSetupFailure(state: "attributes-flags-failed", returnCode: flagsStatus)
    }
    let groupStatus = posix_spawnattr_setpgroup(&attributes, 0)
    guard groupStatus == 0 else {
        throw atomicSpawnSetupFailure(state: "attributes-pgroup-failed", returnCode: groupStatus)
    }

    let argumentValues = [executable] + arguments
    let environmentValues = environment.keys.sorted().map { "\($0)=\(environment[$0]!)" }
    let launch = try withOwnedCStringVector(argumentValues) { argumentVector in
        try withOwnedCStringVector(environmentValues) { environmentVector in
            try PartialInstallationRepairDeadline.atomicallySpawnOwnedProcessGroup(
                timeoutSeconds: timeoutSeconds
            ) {
                var childPID: pid_t = 0
                let status = executable.withCString { path in
                    posix_spawn(
                        &childPID,
                        path,
                        &actions,
                        &attributes,
                        argumentVector,
                        environmentVector
                    )
                }
                guard status == 0 else {
                    throw atomicSpawnFailure(returnCode: status)
                }
                return childPID
            }
        }
    }
    standardOutput.closeParentWriter()
    standardError.closeParentWriter()
    standardInput.close()

    let wait = waitForAtomicProcessGroup(
        pid: launch.pid,
        standardOutput: standardOutput,
        standardError: standardError,
        timeoutSeconds: timeoutSeconds
    )
    do {
        try PartialInstallationRepairDeadline.clearSubprocess(
            pid: launch.pid,
            childReaped: wait.childReaped
        )
    } catch {
        throw fixedCommandFailureWithReapEvidence(
            error,
            verifierPID: launch.pid,
            timeoutSeconds: timeoutSeconds,
            waitResult: BoundedProcessWaitResult(
                timedOut: wait.timedOut,
                sentSIGKILL: wait.sentSIGKILL,
                childReaped: wait.childReaped
            )
        )
    }
    return AtomicProcessGroupExecutionResult(
        stdout: standardOutput.data,
        stderr: standardError.data,
        pid: launch.pid,
        exitStatus: atomicWaitExitStatus(wait.rawWaitStatus),
        terminationSignal: atomicWaitTerminationSignal(wait.rawWaitStatus),
        timedOut: wait.timedOut,
        outputOverflowStream: wait.outputOverflowStream,
        monitorError: wait.monitorError,
        sentSIGKILL: wait.sentSIGKILL,
        childReaped: wait.childReaped
    )
}

private struct AtomicProcessGroupWaitResult {
    let rawWaitStatus: Int32?
    let timedOut: Bool
    let outputOverflowStream: String?
    let monitorError: Int32?
    let sentSIGKILL: Bool
    let childReaped: Bool
}

private func waitForAtomicProcessGroup(
    pid: pid_t,
    standardOutput: BoundedSpawnCapture,
    standardError: BoundedSpawnCapture,
    timeoutSeconds: Int,
    terminateGraceSeconds: Int = 2,
    killGraceSeconds: Int = 5
) -> AtomicProcessGroupWaitResult {
    var rawWaitStatus: Int32?
    var waitError: Int32?
    var outputOverflowStream: String?
    var monitorError: Int32?
    var timedOut = false
    let executionDeadline = DispatchTime.now() + .seconds(timeoutSeconds)

    while true {
        drainAtomicCaptures(
            standardOutput,
            standardError,
            overflowStream: &outputOverflowStream,
            monitorError: &monitorError
        )
        pollAtomicDirectChild(pid, rawWaitStatus: &rawWaitStatus, waitError: &waitError)
        if outputOverflowStream != nil || monitorError != nil || waitError != nil {
            break
        }
        if atomicProcessGroupQuiescent(
            pid: pid,
            rawWaitStatus: rawWaitStatus,
            standardOutput: standardOutput,
            standardError: standardError
        ) {
            return AtomicProcessGroupWaitResult(
                rawWaitStatus: rawWaitStatus,
                timedOut: false,
                outputOverflowStream: nil,
                monitorError: nil,
                sentSIGKILL: false,
                childReaped: true
            )
        }
        if rawWaitStatus != nil {
            // A direct child that exits while descendants remain has violated
            // the owned-tree completion boundary and is handled as a timeout.
            timedOut = true
            break
        }
        if DispatchTime.now() >= executionDeadline {
            timedOut = true
            break
        }
        usleep(10_000)
    }

    signalAtomicProcessGroup(pid, signal: SIGTERM, directChildReaped: rawWaitStatus != nil)
    let terminateDeadline = DispatchTime.now() + .seconds(terminateGraceSeconds)
    while DispatchTime.now() < terminateDeadline {
        drainAtomicCaptures(
            standardOutput,
            standardError,
            overflowStream: &outputOverflowStream,
            monitorError: &monitorError
        )
        pollAtomicDirectChild(pid, rawWaitStatus: &rawWaitStatus, waitError: &waitError)
        if atomicProcessGroupQuiescent(
            pid: pid,
            rawWaitStatus: rawWaitStatus,
            standardOutput: standardOutput,
            standardError: standardError
        ) {
            return AtomicProcessGroupWaitResult(
                rawWaitStatus: rawWaitStatus,
                timedOut: timedOut,
                outputOverflowStream: outputOverflowStream,
                monitorError: monitorError ?? waitError,
                sentSIGKILL: false,
                childReaped: true
            )
        }
        usleep(10_000)
    }

    signalAtomicProcessGroup(pid, signal: SIGKILL, directChildReaped: rawWaitStatus != nil)
    let killDeadline = DispatchTime.now() + .seconds(killGraceSeconds)
    while DispatchTime.now() < killDeadline {
        drainAtomicCaptures(
            standardOutput,
            standardError,
            overflowStream: &outputOverflowStream,
            monitorError: &monitorError
        )
        pollAtomicDirectChild(pid, rawWaitStatus: &rawWaitStatus, waitError: &waitError)
        if atomicProcessGroupQuiescent(
            pid: pid,
            rawWaitStatus: rawWaitStatus,
            standardOutput: standardOutput,
            standardError: standardError
        ) {
            return AtomicProcessGroupWaitResult(
                rawWaitStatus: rawWaitStatus,
                timedOut: timedOut,
                outputOverflowStream: outputOverflowStream,
                monitorError: monitorError ?? waitError,
                sentSIGKILL: true,
                childReaped: true
            )
        }
        usleep(10_000)
    }
    drainAtomicCaptures(
        standardOutput,
        standardError,
        overflowStream: &outputOverflowStream,
        monitorError: &monitorError
    )
    pollAtomicDirectChild(pid, rawWaitStatus: &rawWaitStatus, waitError: &waitError)
    return AtomicProcessGroupWaitResult(
        rawWaitStatus: rawWaitStatus,
        timedOut: timedOut,
        outputOverflowStream: outputOverflowStream,
        monitorError: monitorError ?? waitError,
        sentSIGKILL: true,
        childReaped: atomicProcessGroupQuiescent(
            pid: pid,
            rawWaitStatus: rawWaitStatus,
            standardOutput: standardOutput,
            standardError: standardError
        )
    )
}

private func atomicProcessGroupQuiescent(
    pid: pid_t,
    rawWaitStatus: Int32?,
    standardOutput: BoundedSpawnCapture,
    standardError: BoundedSpawnCapture
) -> Bool {
    rawWaitStatus != nil
        && ownedProcessGroupIsAbsent(pid)
        && standardOutput.reachedEOF
        && standardError.reachedEOF
}

private func pollAtomicDirectChild(
    _ pid: pid_t,
    rawWaitStatus: inout Int32?,
    waitError: inout Int32?
) {
    guard rawWaitStatus == nil, waitError == nil else { return }
    while true {
        var status: Int32 = 0
        let result = waitpid(pid, &status, WNOHANG)
        if result == pid {
            rawWaitStatus = status
            return
        }
        if result == 0 { return }
        if result == -1 && errno == EINTR { continue }
        waitError = errno
        return
    }
}

private func signalAtomicProcessGroup(
    _ pid: pid_t,
    signal: Int32,
    directChildReaped: Bool
) {
    guard pid > 1 else { return }
    errno = 0
    let groupResult = kill(-pid, signal)
    if groupResult == 0 || errno != ESRCH { return }
    if !directChildReaped { _ = kill(pid, signal) }
}

private func drainAtomicCaptures(
    _ standardOutput: BoundedSpawnCapture,
    _ standardError: BoundedSpawnCapture,
    overflowStream: inout String?,
    monitorError: inout Int32?
) {
    if let error = standardOutput.drain(), monitorError == nil { monitorError = error }
    if let error = standardError.drain(), monitorError == nil { monitorError = error }
    if standardOutput.overflowed { overflowStream = overflowStream ?? "stdout" }
    if standardError.overflowed { overflowStream = overflowStream ?? "stderr" }
}

private func atomicWaitExitStatus(_ rawStatus: Int32?) -> Int32? {
    guard let rawStatus, rawStatus & 0x7f == 0 else { return nil }
    return (rawStatus >> 8) & 0xff
}

private func atomicWaitTerminationSignal(_ rawStatus: Int32?) -> Int32? {
    guard let rawStatus else { return nil }
    let signal = rawStatus & 0x7f
    return signal == 0 || signal == 0x7f ? nil : signal
}

private final class BoundedSpawnCapture {
    private var readDescriptor: Int32
    private var writeDescriptor: Int32
    private let limit: Int
    private(set) var data = Data()
    private(set) var overflowed = false
    private(set) var reachedEOF = false

    init(limit: Int) throws {
        var descriptors: [Int32] = [-1, -1]
        let status = descriptors.withUnsafeMutableBufferPointer { pointer in
            pipe(pointer.baseAddress!)
        }
        guard status == 0 else { throw posixFailure("create bounded process-group capture", "/private/tmp") }
        readDescriptor = descriptors[0]
        writeDescriptor = descriptors[1]
        self.limit = limit
        do {
            try requireCloseOnExec(readDescriptor, label: "capture-read")
            try requireCloseOnExec(writeDescriptor, label: "capture-write")
            let currentFlags = fcntl(readDescriptor, F_GETFL)
            guard currentFlags >= 0, fcntl(readDescriptor, F_SETFL, currentFlags | O_NONBLOCK) == 0 else {
                throw posixFailure("make bounded process-group capture nonblocking", "/private/tmp")
            }
        } catch {
            close()
            throw error
        }
    }

    func addFileActions(_ actions: inout posix_spawn_file_actions_t?, target: Int32) throws {
        try requireSpawnSetupStatus(
            posix_spawn_file_actions_addclose(&actions, readDescriptor),
            state: "capture-read-close-failed"
        )
        try requireSpawnSetupStatus(
            posix_spawn_file_actions_adddup2(&actions, writeDescriptor, target),
            state: "capture-dup-failed"
        )
        if writeDescriptor != target {
            try requireSpawnSetupStatus(
                posix_spawn_file_actions_addclose(&actions, writeDescriptor),
                state: "capture-write-close-failed"
            )
        }
    }

    func closeParentWriter() {
        if writeDescriptor >= 0 {
            _ = Darwin.close(writeDescriptor)
            writeDescriptor = -1
        }
    }

    func drain() -> Int32? {
        guard readDescriptor >= 0, !reachedEOF else { return nil }
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { bytes in
                Darwin.read(readDescriptor, bytes.baseAddress, bytes.count)
            }
            if count > 0 {
                let accepted = min(count, max(0, limit - data.count))
                if accepted > 0 {
                    data.append(contentsOf: buffer.prefix(accepted))
                }
                if accepted < count { overflowed = true }
                continue
            }
            if count == 0 {
                reachedEOF = true
                return nil
            }
            if errno == EINTR { continue }
            if errno == EAGAIN || errno == EWOULDBLOCK { return nil }
            return errno
        }
    }

    func close() {
        closeParentWriter()
        if readDescriptor >= 0 {
            _ = Darwin.close(readDescriptor)
            readDescriptor = -1
        }
    }

    deinit { close() }
}

private final class AtomicSpawnInput {
    private var descriptor: Int32

    init(_ input: Data?) throws {
        if let input {
            var template = Array("/private/tmp/nimi-dev-security-input.XXXXXX".utf8CString)
            descriptor = template.withUnsafeMutableBufferPointer { pointer in
                mkstemp(pointer.baseAddress!)
            }
            guard descriptor >= 0 else { throw posixFailure("create bounded process-group input", "/private/tmp") }
            let path = String(cString: template)
            guard fchmod(descriptor, 0o600) == 0, unlink(path) == 0 else {
                let failure = posixFailure("secure bounded process-group input", path)
                close()
                throw failure
            }
            do {
                try requireCloseOnExec(descriptor, label: "input")
                try writeAll(input, to: descriptor)
                guard lseek(descriptor, 0, SEEK_SET) == 0 else {
                    throw posixFailure("rewind bounded process-group input", path)
                }
            } catch {
                close()
                throw error
            }
        } else {
            descriptor = open("/dev/null", O_RDONLY | O_CLOEXEC)
            guard descriptor >= 0 else { throw posixFailure("open fixed process-group stdin", "/dev/null") }
        }
    }

    func addFileAction(_ actions: inout posix_spawn_file_actions_t?, target: Int32) throws {
        try requireSpawnSetupStatus(
            posix_spawn_file_actions_adddup2(&actions, descriptor, target),
            state: "input-dup-failed"
        )
        if descriptor != target {
            try requireSpawnSetupStatus(
                posix_spawn_file_actions_addclose(&actions, descriptor),
                state: "input-close-failed"
            )
        }
    }

    func close() {
        if descriptor >= 0 {
            _ = Darwin.close(descriptor)
            descriptor = -1
        }
    }

    deinit { close() }
}

private func writeAll(_ data: Data, to descriptor: Int32) throws {
    try data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            let count = Darwin.write(
                descriptor,
                bytes.baseAddress!.advanced(by: offset),
                bytes.count - offset
            )
            if count > 0 {
                offset += count
            } else if count == -1 && errno == EINTR {
                continue
            } else {
                throw posixFailure("write bounded process-group input", "/private/tmp")
            }
        }
    }
}

private func requireCloseOnExec(_ descriptor: Int32, label: String) throws {
    guard fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0 else {
        throw posixFailure("set (label) close-on-exec", "/private/tmp")
    }
}

private func withOwnedCStringVector<T>(
    _ values: [String],
    body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) throws -> T
) throws -> T {
    var pointers = [UnsafeMutablePointer<CChar>?]()
    pointers.reserveCapacity(values.count + 1)
    for value in values {
        guard let pointer = strdup(value) else {
            pointers.forEach { free($0) }
            throw atomicSpawnSetupFailure(state: "cstring-allocation-failed", returnCode: ENOMEM)
        }
        pointers.append(pointer)
    }
    defer { pointers.forEach { free($0) } }
    pointers.append(nil)
    return try pointers.withUnsafeMutableBufferPointer { buffer in
        try body(buffer.baseAddress!)
    }
}

private func requireSpawnSetupStatus(_ status: Int32, state: String) throws {
    guard status == 0 else {
        throw atomicSpawnSetupFailure(state: state, returnCode: status)
    }
}

private func atomicSpawnSetupFailure(state: String, returnCode: Int32) -> DevSecurityFailure {
    fail(
        "runtime-service-repair-required",
        "inspect the fixed atomic process-group configuration",
        "The repair bootstrap process-group launch could not be configured.",
        details: [
            "phase": "repair-invocation",
            "probe": "atomic-process-group-spawn",
            "state": state,
            "return_code": Int(returnCode),
            "child_reaped": true,
        ]
    )
}

private func atomicSpawnFailure(returnCode: Int32) -> DevSecurityFailure {
    fail(
        "runtime-service-repair-required",
        "inspect the fixed repair bootstrap executable and spawn boundary",
        "The repair bootstrap process group could not be spawned.",
        details: [
            "phase": "repair-invocation",
            "probe": "atomic-process-group-spawn",
            "state": "spawn-failed",
            "return_code": Int(returnCode),
            "child_reaped": true,
        ]
    )
}
