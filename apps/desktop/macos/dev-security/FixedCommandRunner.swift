import Darwin
import Dispatch
import Foundation

struct CommandResult {
    let stdout: Data
    let stderr: Data
    let pid: pid_t
    let status: Int32
}

enum FixedCommandProcessTreePolicy: Equatable {
    case directChild
    case bootstrapOwnedProcessGroup
}

@discardableResult
func runFixedCommand(
    _ executable: String,
    _ arguments: [String],
    input: Data? = nil,
    captureLimit: Int = 4 * 1024 * 1024,
    homeDirectory: String = "/var/empty",
    timeoutSeconds: Int = 300,
    acceptedExitStatuses: [Int32] = [0],
    processTreePolicy: FixedCommandProcessTreePolicy = .directChild
) throws -> CommandResult {
    let acceptedStatuses = Set(acceptedExitStatuses)
    guard executable.hasPrefix("/"), arguments.allSatisfy({ !$0.contains("\0") }),
          timeoutSeconds > 0, timeoutSeconds <= 1_800,
          captureLimit > 0, captureLimit <= 64 * 1024 * 1024,
          !acceptedStatuses.isEmpty,
          acceptedStatuses.count == acceptedExitStatuses.count,
          acceptedStatuses.contains(0),
          acceptedStatuses.allSatisfy({ $0 >= 0 && $0 <= 255 }),
          processTreePolicy == .directChild || (
              executable == bootstrapHelperInstallPath
                  && repairBootstrapCommandOwnsProcessGroup(arguments)
          ) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the fixed helper command",
            "A non-canonical helper subprocess was requested.",
            details: ["child_reaped": true]
        )
    }
    try requireTrustedCommandHome(homeDirectory)
    let commandEnvironment = [
        "HOME": homeDirectory,
        "LANG": "en_US.UTF-8",
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": "/private/tmp",
    ]
    if processTreePolicy == .bootstrapOwnedProcessGroup {
        return try runFixedBootstrapProcessGroupCommand(
            executable,
            arguments,
            input: input,
            captureLimit: captureLimit,
            timeoutSeconds: timeoutSeconds,
            acceptedStatuses: acceptedStatuses,
            environment: commandEnvironment
        )
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = commandEnvironment
    let output = try unlinkedCaptureFile()
    let errors = try unlinkedCaptureFile()
    defer {
        try? output.close()
        try? errors.close()
    }
    process.standardOutput = output
    process.standardError = errors
    let completion = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in completion.signal() }
    let inputPipe: Pipe?
    if input != nil {
        let source = Pipe()
        process.standardInput = source
        inputPipe = source
    } else {
        process.standardInput = FileHandle.nullDevice
        inputPipe = nil
    }
    let deadlineOwnedLaunch = try PartialInstallationRepairDeadline.beginSubprocessLaunch(
        timeoutSeconds: timeoutSeconds
    )
    do {
        try process.run()
    } catch {
        let value = error as NSError
        if process.processIdentifier > 1 {
            if process.isRunning { process.terminate() }
            let recovery = waitForBoundedProcess(
                process,
                completion: completion,
                timeoutSeconds: 1,
                terminateGraceSeconds: 1,
                killGraceSeconds: 2,
                ownedProcessGroupID: processTreePolicy == .bootstrapOwnedProcessGroup
                    ? process.processIdentifier
                    : nil
            )
            if recovery.childReaped {
                PartialInstallationRepairDeadline.cancelSubprocessLaunch(deadlineOwnedLaunch)
            }
            throw fail(
                "runtime-service-repair-required",
                "stop after preserving the exact repair bootstrap and journal",
                "The fixed helper subprocess launch returned ambiguously after a child PID was assigned.",
                details: [
                    "return_code": value.code,
                    "verifier_pid": process.processIdentifier,
                    "timeout_seconds": 4,
                    "sent_sigkill": recovery.sentSIGKILL,
                    "child_reaped": recovery.childReaped,
                ]
            )
        }
        PartialInstallationRepairDeadline.cancelSubprocessLaunch(deadlineOwnedLaunch)
        throw fail(
            "runtime-service-repair-required",
            "inspect the fixed macOS helper subprocess launch",
            "The fixed helper subprocess could not be launched.",
            details: ["return_code": value.code, "child_reaped": true]
        )
    }
    let ownedProcessGroupID = processTreePolicy == .bootstrapOwnedProcessGroup
        ? process.processIdentifier
        : nil
    do {
        try PartialInstallationRepairDeadline.bindLaunchedSubprocess(
            process,
            deadlineOwned: deadlineOwnedLaunch,
            ownedProcessGroupID: ownedProcessGroupID
        )
    } catch {
        if process.isRunning { process.terminate() }
        let recovery = waitForBoundedProcess(
            process,
            completion: completion,
            timeoutSeconds: 1,
            terminateGraceSeconds: 1,
            killGraceSeconds: 2,
            ownedProcessGroupID: ownedProcessGroupID
        )
        if !recovery.childReaped {
            throw fail(
                "runtime-service-repair-required",
                "stop after preserving the exact repair bootstrap and journal",
                "A launched helper subprocess could not be bound to the outer deadline or proven reaped.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "child-launch-bind-recovery",
                    "state": "quiescence-unproven",
                    "verifier_pid": process.processIdentifier,
                    "timeout_seconds": 4,
                    "sent_sigkill": recovery.sentSIGKILL,
                    "child_reaped": false,
                ]
            )
        }
        PartialInstallationRepairDeadline.cancelSubprocessLaunch(deadlineOwnedLaunch)
        throw fixedCommandFailureWithReapEvidence(
            error,
            verifierPID: process.processIdentifier,
            timeoutSeconds: 4,
            waitResult: recovery
        )
    }
    if let input, let inputPipe {
        do {
            try inputPipe.fileHandleForWriting.write(contentsOf: input)
            try inputPipe.fileHandleForWriting.close()
        } catch {
            try? inputPipe.fileHandleForWriting.close()
            if process.isRunning { process.terminate() }
            let recovery = waitForBoundedProcess(
                process,
                completion: completion,
                timeoutSeconds: 1,
                terminateGraceSeconds: 1,
                killGraceSeconds: 2,
                ownedProcessGroupID: ownedProcessGroupID
            )
            try PartialInstallationRepairDeadline.clearSubprocess(
                process,
                childReaped: recovery.childReaped
            )
            let value = error as NSError
            throw fail(
                "runtime-service-repair-required",
                "inspect the fixed macOS helper subprocess input",
                "The launched helper subprocess could not receive its bounded input.",
                details: [
                    "return_code": value.code,
                    "verifier_pid": process.processIdentifier,
                    "timeout_seconds": 4,
                    "sent_sigkill": recovery.sentSIGKILL,
                    "child_reaped": recovery.childReaped,
                ]
            )
        }
    }
    let waitResult = waitForBoundedProcess(
        process,
        completion: completion,
        timeoutSeconds: timeoutSeconds,
        ownedProcessGroupID: ownedProcessGroupID
    )
    try PartialInstallationRepairDeadline.clearSubprocess(
        process,
        childReaped: waitResult.childReaped
    )
    if waitResult.timedOut {
        let childPID = process.processIdentifier
        throw fail(
            "runtime-service-repair-required",
            "inspect the bounded macOS helper subprocess timeout",
            "The fixed helper subprocess exceeded its admitted execution deadline and was terminated.",
            details: [
                "return_code": Int(ETIMEDOUT),
                "verifier_pid": childPID,
                "timeout_seconds": timeoutSeconds,
                "sent_sigkill": waitResult.sentSIGKILL,
                "child_reaped": waitResult.childReaped,
            ]
        )
    }
    let stdout: Data
    let stderr: Data
    do {
        stdout = try boundedCaptureData(output, limit: captureLimit)
        stderr = try boundedCaptureData(errors, limit: captureLimit)
    } catch {
        throw fixedCommandFailureWithReapEvidence(
            error,
            verifierPID: process.processIdentifier,
            timeoutSeconds: timeoutSeconds,
            waitResult: waitResult
        )
    }
    guard stdout.count <= captureLimit, stderr.count <= captureLimit else {
        throw fixedCommandFailureWithReapEvidence(
            fail("runtime-service-repair-required", "inspect the bounded helper subprocess", "A helper subprocess exceeded its output budget."),
            verifierPID: process.processIdentifier,
            timeoutSeconds: timeoutSeconds,
            waitResult: waitResult
        )
    }
    guard process.terminationReason == .exit,
          acceptedStatuses.contains(process.terminationStatus) else {
        if [helperInstallPath, bootstrapHelperInstallPath].contains(executable),
           let childFailure = structuredCommandFailure(stderr) {
            throw fixedCommandFailureWithReapEvidence(
                childFailure,
                verifierPID: process.processIdentifier,
                timeoutSeconds: timeoutSeconds,
                waitResult: waitResult
            )
        }
        throw fail(
            "runtime-service-repair-required",
            "inspect the macOS development helper subprocess failure",
            "\((executable as NSString).lastPathComponent) failed with status \(process.terminationStatus).",
            details: [
                "return_code": Int(process.terminationStatus),
                "verifier_pid": process.processIdentifier,
                "timeout_seconds": timeoutSeconds,
                "sent_sigkill": waitResult.sentSIGKILL,
                "child_reaped": waitResult.childReaped,
            ]
        )
    }
    return CommandResult(
        stdout: stdout,
        stderr: stderr,
        pid: process.processIdentifier,
        status: process.terminationStatus
    )
}

private func runFixedBootstrapProcessGroupCommand(
    _ executable: String,
    _ arguments: [String],
    input: Data?,
    captureLimit: Int,
    timeoutSeconds: Int,
    acceptedStatuses: Set<Int32>,
    environment: [String: String]
) throws -> CommandResult {
    let execution = try runAtomicBootstrapProcessGroup(
        executable: executable,
        arguments: arguments,
        environment: environment,
        input: input,
        captureLimit: captureLimit,
        timeoutSeconds: timeoutSeconds
    )
    let waitEvidence = BoundedProcessWaitResult(
        timedOut: execution.timedOut,
        sentSIGKILL: execution.sentSIGKILL,
        childReaped: execution.childReaped
    )
    if let stream = execution.outputOverflowStream {
        throw fixedCommandFailureWithReapEvidence(
            fail(
                "runtime-service-repair-required",
                "inspect the bounded repair bootstrap output",
                "The repair bootstrap process group exceeded its output budget.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "\(stream)-capture",
                    "state": "output-budget-exceeded",
                    "return_code": Int(EFBIG),
                ]
            ),
            verifierPID: execution.pid,
            timeoutSeconds: timeoutSeconds,
            waitResult: waitEvidence
        )
    }
    if let monitorError = execution.monitorError {
        throw fixedCommandFailureWithReapEvidence(
            fail(
                "runtime-service-repair-required",
                "inspect the atomic repair process-group monitor",
                "The repair bootstrap process group could not be monitored to a proven terminal boundary.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "process-group-monitor",
                    "state": "monitor-failed",
                    "return_code": Int(monitorError),
                ]
            ),
            verifierPID: execution.pid,
            timeoutSeconds: timeoutSeconds,
            waitResult: waitEvidence
        )
    }
    if execution.timedOut {
        throw fail(
            "runtime-service-repair-required",
            "inspect the bounded macOS helper subprocess timeout",
            "The fixed helper subprocess exceeded its admitted execution deadline and was terminated.",
            details: [
                "return_code": Int(ETIMEDOUT),
                "verifier_pid": execution.pid,
                "timeout_seconds": timeoutSeconds,
                "sent_sigkill": execution.sentSIGKILL,
                "child_reaped": execution.childReaped,
            ]
        )
    }
    guard let exitStatus = execution.exitStatus,
          execution.terminationSignal == nil,
          acceptedStatuses.contains(exitStatus) else {
        if let childFailure = structuredCommandFailure(execution.stderr) {
            throw fixedCommandFailureWithReapEvidence(
                childFailure,
                verifierPID: execution.pid,
                timeoutSeconds: timeoutSeconds,
                waitResult: waitEvidence
            )
        }
        let returnCode = execution.exitStatus ?? execution.terminationSignal ?? ECHILD
        throw fail(
            "runtime-service-repair-required",
            "inspect the macOS development helper subprocess failure",
            "\((executable as NSString).lastPathComponent) failed with status \(returnCode).",
            details: [
                "return_code": Int(returnCode),
                "verifier_pid": execution.pid,
                "timeout_seconds": timeoutSeconds,
                "sent_sigkill": execution.sentSIGKILL,
                "child_reaped": execution.childReaped,
            ]
        )
    }
    return CommandResult(
        stdout: execution.stdout,
        stderr: execution.stderr,
        pid: execution.pid,
        status: exitStatus
    )
}

func fixedCommandFailureWithReapEvidence(
    _ error: Error,
    verifierPID: pid_t,
    timeoutSeconds: Int,
    waitResult: BoundedProcessWaitResult
) -> DevSecurityFailure {
    let underlying = error as? DevSecurityFailure ?? fail(
        "runtime-service-repair-required",
        "inspect the bounded macOS helper subprocess failure",
        error.localizedDescription
    )
    var details = underlying.details ?? [:]
    details["verifier_pid"] = verifierPID
    details["timeout_seconds"] = timeoutSeconds
    details["sent_sigkill"] = waitResult.sentSIGKILL
    details["child_reaped"] = waitResult.childReaped
    return fail(
        underlying.reasonCode,
        underlying.actionHint,
        underlying.message,
        details: details
    )
}

private func structuredCommandFailure(_ stderr: Data) -> DevSecurityFailure? {
    guard stderr.count <= 4 * 1024 * 1024,
          let text = String(data: stderr, encoding: .utf8) else { return nil }
    for line in text.split(separator: "\n", omittingEmptySubsequences: true).reversed() {
        guard let data = String(line).data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["status"] as? String == "failed",
              let reasonCode = value["reasonCode"] as? String,
              let actionHint = value["actionHint"] as? String,
              let message = value["message"] as? String,
              !reasonCode.isEmpty, !actionHint.isEmpty, !message.isEmpty,
              reasonCode.count <= 128, actionHint.count <= 512, message.count <= 4096 else {
            continue
        }
        let details = value["details"] as? [String: Any]
        return fail(reasonCode, actionHint, message, details: details)
    }
    return nil
}

private func unlinkedCaptureFile() throws -> FileHandle {
    var template = Array("/private/tmp/nimi-dev-security-capture.XXXXXX".utf8CString)
    let descriptor = template.withUnsafeMutableBufferPointer { pointer in
        mkstemp(pointer.baseAddress!)
    }
    guard descriptor >= 0 else {
        throw posixFailure("create bounded helper capture", "/private/tmp")
    }
    let path = String(cString: template)
    guard fchmod(descriptor, 0o600) == 0, unlink(path) == 0 else {
        let failure = posixFailure("secure bounded helper capture", path)
        close(descriptor)
        throw failure
    }
    return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
}

private func boundedCaptureData(_ handle: FileHandle, limit: Int) throws -> Data {
    let size = try handle.seekToEnd()
    guard size <= UInt64(limit) else {
        throw fail(
            "runtime-service-repair-required",
            "inspect the bounded helper subprocess",
            "A helper subprocess exceeded its output budget."
        )
    }
    try handle.seek(toOffset: 0)
    return try handle.readToEnd() ?? Data()
}
