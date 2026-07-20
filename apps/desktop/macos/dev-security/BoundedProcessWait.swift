import Darwin
import Dispatch
import Foundation

struct BoundedProcessWaitResult: Equatable {
    let timedOut: Bool
    let sentSIGKILL: Bool
    let childReaped: Bool
}

/// Waits for one already-started fixed subprocess without permitting an
/// unbounded privileged transaction. The same implementation is used by the
/// production command runner and native fault tests.
func waitForBoundedProcess(
    _ process: Process,
    completion: DispatchSemaphore,
    timeoutSeconds: Int,
    terminateGraceSeconds: Int = 2,
    killGraceSeconds: Int = 5,
    ownedProcessGroupID: pid_t? = nil
) -> BoundedProcessWaitResult {
    precondition(timeoutSeconds > 0)
    precondition(terminateGraceSeconds >= 0)
    precondition(killGraceSeconds >= 0)

    if completion.wait(timeout: .now() + .seconds(timeoutSeconds)) == .success {
        process.waitUntilExit()
        var groupAbsent = waitForOwnedProcessGroupAbsence(
            ownedProcessGroupID,
            timeoutSeconds: killGraceSeconds
        )
        let groupKillRequired = !groupAbsent
        if groupKillRequired, let ownedProcessGroupID {
            _ = kill(-ownedProcessGroupID, SIGKILL)
            groupAbsent = waitForOwnedProcessGroupAbsence(
                ownedProcessGroupID,
                timeoutSeconds: killGraceSeconds
            )
        }
        return BoundedProcessWaitResult(
            timedOut: groupKillRequired,
            sentSIGKILL: groupKillRequired,
            childReaped: groupAbsent && ownedProcessGroupIsAbsent(ownedProcessGroupID)
        )
    }

    let childPID = process.processIdentifier
    signalBoundedProcess(
        childPID,
        ownedProcessGroupID: ownedProcessGroupID,
        signal: SIGTERM
    )
    if completion.wait(timeout: .now() + .seconds(terminateGraceSeconds)) == .success {
        process.waitUntilExit()
        var groupAbsent = waitForOwnedProcessGroupAbsence(
            ownedProcessGroupID,
            timeoutSeconds: killGraceSeconds
        )
        let groupKillRequired = !groupAbsent
        if groupKillRequired, let ownedProcessGroupID {
            _ = kill(-ownedProcessGroupID, SIGKILL)
            groupAbsent = waitForOwnedProcessGroupAbsence(
                ownedProcessGroupID,
                timeoutSeconds: killGraceSeconds
            )
        }
        return BoundedProcessWaitResult(
            timedOut: true,
            sentSIGKILL: groupKillRequired,
            childReaped: groupAbsent && ownedProcessGroupIsAbsent(ownedProcessGroupID)
        )
    }

    signalBoundedProcess(
        childPID,
        ownedProcessGroupID: ownedProcessGroupID,
        signal: SIGKILL
    )
    let reaped = completion.wait(timeout: .now() + .seconds(killGraceSeconds)) == .success
    if reaped { process.waitUntilExit() }
    let groupAbsent = reaped && waitForOwnedProcessGroupAbsence(
        ownedProcessGroupID,
        timeoutSeconds: killGraceSeconds
    )
    return BoundedProcessWaitResult(
        timedOut: true,
        sentSIGKILL: true,
        childReaped: reaped && groupAbsent
    )
}

/// A nil PGID denotes a direct-child-only command. A non-nil PGID is accepted
/// only when the bootstrap child established a group whose id equals its PID
/// before it could exec a descendant-producing legacy helper.
func ownedProcessGroupIsAbsent(_ processGroupID: pid_t?) -> Bool {
    guard let processGroupID else { return true }
    guard processGroupID > 1 else { return false }
    errno = 0
    let status = kill(-processGroupID, 0)
    return status == -1 && errno == ESRCH
}

private func waitForOwnedProcessGroupAbsence(
    _ processGroupID: pid_t?,
    timeoutSeconds: Int
) -> Bool {
    guard processGroupID != nil else { return true }
    let deadline = DispatchTime.now() + .seconds(max(0, timeoutSeconds))
    repeat {
        if ownedProcessGroupIsAbsent(processGroupID) { return true }
        usleep(20_000)
    } while DispatchTime.now() < deadline
    return ownedProcessGroupIsAbsent(processGroupID)
}

private func signalBoundedProcess(
    _ childPID: pid_t,
    ownedProcessGroupID: pid_t?,
    signal: Int32
) {
    guard childPID > 1 else { return }
    if let ownedProcessGroupID, ownedProcessGroupID == childPID {
        if kill(-ownedProcessGroupID, signal) == 0 || errno != ESRCH { return }
    }
    _ = kill(childPID, signal)
}
