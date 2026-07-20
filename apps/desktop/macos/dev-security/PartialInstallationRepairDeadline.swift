import Darwin
import Dispatch
import Foundation

/// Owns the hard wall-clock boundary for one privileged delete-only repair.
///
/// The Node launcher deliberately does not time out or signal the sudo process:
/// it waits until sudo has observed this helper exit. Every child spawned by the
/// repair is separately bounded and reaped by `runFixedCommand`. Before such a
/// child is launched, this deadline proves that the child's complete timeout and
/// escalation budget fits inside the remaining outer deadline. Consequently the
/// hard deadline can only terminate a helper that is not waiting past an admitted
/// child budget; durable journal recovery owns every possible effect-ahead state.
final class PartialInstallationRepairDeadline {
    static let admittedTimeoutSeconds = 600

    private enum InvocationLifecycle {
        case neverStarted
        case active
        case expired
        case finished
    }

    private static let stateLock = NSLock()
    private static var active: PartialInstallationRepairDeadline?
    private static var invocationLifecycle = InvocationLifecycle.neverStarted

    private let timer: DispatchSourceTimer
    private let expiresAt: DispatchTime
    private let timeoutSeconds: Int
    private let termination: (_ childReaped: Bool, _ childPID: pid_t?) -> Void
    private var finished = false
    private var cancelled = false
    private var childLaunchInProgress = false
    private struct ActiveChild {
        let process: Process?
        let pid: pid_t
        let ownedProcessGroupID: pid_t?
    }

    private var activeChild: ActiveChild?

    private init(
        timeoutSeconds: Int,
        termination: @escaping (_ childReaped: Bool, _ childPID: pid_t?) -> Void
    ) {
        self.timeoutSeconds = timeoutSeconds
        expiresAt = .now() + .seconds(timeoutSeconds)
        self.termination = termination
        timer = DispatchSource.makeTimerSource(
            flags: .strict,
            queue: DispatchQueue(label: "ai.nimi.runtime.dev.partial-install-repair-deadline")
        )
        timer.schedule(deadline: expiresAt, leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.expire() }
    }

    static func start(
        timeoutSeconds: Int = admittedTimeoutSeconds,
        termination: ((_ childReaped: Bool, _ childPID: pid_t?) -> Void)? = nil
    ) throws -> PartialInstallationRepairDeadline {
        guard runtimeLegacyRepairInvocationDeadline == "root_repair_helper_owns_one_hard_600-second_deadline;_every_child_has_a_shorter_bounded_timeout_and_must_fit_inside_the_remaining_outer_budget;_direct-child_commands_atomically_reserve_one_launch-slot_before_Process.run_and_bind_the_child_PID_before_input_or-wait;_bootstrap-owned_process-group_commands_use_posix_spawn_with_POSIX_SPAWN_SETPGROUP_and_POSIX_SPAWN_CLOEXEC_DEFAULT_while_the_deadline-lock-is-held_so_a-successful-spawn-and-PID/PGID-binding-are-one-atomic-transition;_an-expired-repair-invocation_fails-before-the-next-spawn;_timeout-or-output-overflow_signals-the-whole-owned-PGID_TERM-then-KILL_reaps-the-direct-child_drains-both-pipes-to-EOF_and-requires-kill-minus-PGID-zero-to-return-ESRCH_before-child_reaped-true;_any-unbound-or-unreaped-state_is-quiescence-unproven_and-forbids-wrapper-cleanup;_the_Node-launcher_never-times-out-sudo_or-cleans-up-before-sudo-has-observed-the-root-helper-exit;_deadline-termination_preserves-the-exact-journal-for-effect-ahead-recovery",
              timeoutSeconds > 0, timeoutSeconds <= admittedTimeoutSeconds else {
            throw fail(
                "runtime-service-repair-required",
                "repair the bounded partial-install repair deadline",
                "The partial-install repair requested a non-admitted hard deadline."
            )
        }
        let deadline = PartialInstallationRepairDeadline(
            timeoutSeconds: timeoutSeconds,
            termination: termination ?? hardTerminateAfterDeadline
        )
        stateLock.lock()
        defer { stateLock.unlock() }
        guard active == nil else {
            throw fail(
                "runtime-service-repair-required",
                "wait for the active partial-install repair deadline owner",
                "A partial-install repair deadline is already active in this helper process."
            )
        }
        active = deadline
        invocationLifecycle = .active
        deadline.timer.resume()
        return deadline
    }

    func finish() {
        Self.stateLock.lock()
        if !finished { finished = true }
        if Self.active === self {
            Self.active = nil
            Self.invocationLifecycle = .finished
        }
        let shouldCancel = !cancelled
        cancelled = true
        Self.stateLock.unlock()
        if shouldCancel {
            timer.setEventHandler {}
            timer.cancel()
        }
    }

    /// Atomically validates the complete child budget and reserves the only
    /// launch slot. Keeping both decisions under `stateLock` prevents an outer
    /// deadline from expiring between a successful budget check and
    /// `Process.run()`.
    static func beginSubprocessLaunch(
        timeoutSeconds: Int,
        escalationSeconds: Int = 8
    ) throws -> Bool {
        guard timeoutSeconds > 0, escalationSeconds >= 0 else {
            throw fail(
                "runtime-service-repair-required",
                "repair the bounded partial-install subprocess budget",
                "The partial-install repair requested a non-admitted subprocess budget."
            )
        }
        stateLock.lock()
        guard let deadline = active else {
            let lifecycle = invocationLifecycle
            stateLock.unlock()
            if lifecycle == .expired {
                throw fail(
                    "runtime-service-repair-required",
                    "stop before launching another partial-install repair subprocess",
                    "The partial-install repair deadline expired before the next child launch could be reserved.",
                    details: [
                        "phase": "repair-invocation",
                        "probe": "atomic-child-launch-reservation",
                        "state": "deadline-expired-before-launch",
                        "timeout_seconds": admittedTimeoutSeconds,
                        "verifier_pid": getpid(),
                        "child_reaped": true,
                    ]
                )
            }
            return false
        }
        guard invocationLifecycle == .active,
              !deadline.finished,
              !deadline.childLaunchInProgress,
              deadline.activeChild == nil else {
            stateLock.unlock()
            throw fail(
                "runtime-service-repair-required",
                "repair the bounded partial-install child ownership",
                "The partial-install repair could not reserve one exact child launch inside its outer deadline."
            )
        }
        let required = timeoutSeconds + escalationSeconds
        let remaining = deadline.remainingWholeSeconds()
        guard remaining > required else {
            stateLock.unlock()
            throw fail(
                "runtime-service-repair-required",
                "retry only from the journal-bound repair boundary",
                "The partial-install repair did not have enough outer deadline remaining to start another bounded subprocess.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "subprocess-budget",
                    "state": "deadline-budget-exhausted",
                    "timeout_seconds": deadline.timeoutSeconds,
                    "elapsed_ms": max(0, (deadline.timeoutSeconds - remaining) * 1_000),
                    "verifier_pid": getpid(),
                    "child_reaped": true,
                ]
            )
        }
        deadline.childLaunchInProgress = true
        stateLock.unlock()
        return true
    }

    static func cancelSubprocessLaunch(_ deadlineOwned: Bool) {
        guard deadlineOwned else { return }
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let deadline = active, !deadline.finished else { return }
        deadline.childLaunchInProgress = false
    }

    /// Performs the one `posix_spawn` that creates a bootstrap-owned process
    /// group while the deadline state lock is still held. The timer therefore
    /// observes either no child before the spawn or the exact PID/PGID after it;
    /// it can never observe a successful spawn with no signalable witness.
    static func atomicallySpawnOwnedProcessGroup(
        timeoutSeconds: Int,
        escalationSeconds: Int = 8,
        spawn: () throws -> pid_t
    ) throws -> (pid: pid_t, deadlineOwned: Bool) {
        guard timeoutSeconds > 0, escalationSeconds >= 0 else {
            throw fail(
                "runtime-service-repair-required",
                "repair the bounded partial-install subprocess budget",
                "The partial-install repair requested a non-admitted subprocess budget.",
                details: ["child_reaped": true]
            )
        }
        stateLock.lock()
        guard let deadline = active else {
            let lifecycle = invocationLifecycle
            stateLock.unlock()
            if lifecycle == .expired {
                throw fail(
                    "runtime-service-repair-required",
                    "stop before launching another partial-install repair subprocess",
                    "The partial-install repair deadline expired before the next child launch could be reserved.",
                    details: [
                        "phase": "repair-invocation",
                        "probe": "atomic-process-group-spawn",
                        "state": "deadline-expired-before-launch",
                        "timeout_seconds": admittedTimeoutSeconds,
                        "verifier_pid": getpid(),
                        "child_reaped": true,
                    ]
                )
            }
            let pid = try spawn()
            guard pid > 1 else {
                throw invalidAtomicSpawnPID(pid)
            }
            return (pid, false)
        }
        guard invocationLifecycle == .active,
              !deadline.finished,
              !deadline.childLaunchInProgress,
              deadline.activeChild == nil else {
            stateLock.unlock()
            throw fail(
                "runtime-service-repair-required",
                "repair the bounded partial-install child ownership",
                "The partial-install repair could not reserve one exact child launch inside its outer deadline.",
                details: ["child_reaped": true]
            )
        }
        let required = timeoutSeconds + escalationSeconds
        let remaining = deadline.remainingWholeSeconds()
        guard remaining > required else {
            stateLock.unlock()
            throw fail(
                "runtime-service-repair-required",
                "retry only from the journal-bound repair boundary",
                "The partial-install repair did not have enough outer deadline remaining to start another bounded subprocess.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "subprocess-budget",
                    "state": "deadline-budget-exhausted",
                    "timeout_seconds": deadline.timeoutSeconds,
                    "elapsed_ms": max(0, (deadline.timeoutSeconds - remaining) * 1_000),
                    "verifier_pid": getpid(),
                    "child_reaped": true,
                ]
            )
        }
        deadline.childLaunchInProgress = true
        do {
            let pid = try spawn()
            guard pid > 1 else {
                deadline.childLaunchInProgress = false
                stateLock.unlock()
                throw invalidAtomicSpawnPID(pid)
            }
            deadline.childLaunchInProgress = false
            deadline.activeChild = ActiveChild(
                process: nil,
                pid: pid,
                ownedProcessGroupID: pid
            )
            stateLock.unlock()
            return (pid, true)
        } catch {
            if deadline.childLaunchInProgress {
                deadline.childLaunchInProgress = false
                stateLock.unlock()
            }
            throw error
        }
    }

    static func bindLaunchedSubprocess(
        _ process: Process,
        deadlineOwned: Bool,
        ownedProcessGroupID: pid_t? = nil
    ) throws {
        guard deadlineOwned else { return }
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let deadline = active,
              !deadline.finished,
              deadline.childLaunchInProgress,
              deadline.activeChild == nil,
              process.processIdentifier > 1 else {
            throw fail(
                "runtime-service-repair-required",
                "stop after preserving the journal-bound repair state",
                "The launched repair subprocess could not be atomically bound to its outer deadline.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "child-launch-bind",
                    "state": "quiescence-unproven",
                    "verifier_pid": process.processIdentifier,
                    "child_reaped": false,
                ]
            )
        }
        deadline.childLaunchInProgress = false
        guard ownedProcessGroupID == nil || ownedProcessGroupID == process.processIdentifier else {
            throw fail(
                "runtime-service-repair-required",
                "stop after preserving the journal-bound repair state",
                "The repair subprocess process-group witness does not equal its direct child PID.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "child-process-group-bind",
                    "state": "mismatch",
                    "verifier_pid": process.processIdentifier,
                    "child_reaped": false,
                ]
            )
        }
        deadline.activeChild = ActiveChild(
            process: process,
            pid: process.processIdentifier,
            ownedProcessGroupID: ownedProcessGroupID
        )
    }

    static func clearSubprocess(_ process: Process, childReaped: Bool) throws {
        try clearSubprocess(pid: process.processIdentifier, childReaped: childReaped)
    }

    static func clearSubprocess(pid: pid_t, childReaped: Bool) throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let deadline = active else { return }
        guard !deadline.finished,
              deadline.activeChild?.pid == pid, childReaped else {
            throw fail(
                "runtime-service-repair-required",
                "stop after preserving the journal-bound repair state",
                "The partial-install repair child was not proven reaped inside its outer deadline.",
                details: [
                    "phase": "repair-invocation",
                    "probe": "child-reap",
                    "state": "unproven",
                    "verifier_pid": pid,
                    "child_reaped": childReaped,
                ]
            )
        }
        deadline.activeChild = nil
    }

    private func remainingWholeSeconds() -> Int {
        let now = DispatchTime.now().uptimeNanoseconds
        let end = expiresAt.uptimeNanoseconds
        guard end > now else { return 0 }
        return Int((end - now) / 1_000_000_000)
    }

    private func expire() {
        Self.stateLock.lock()
        guard !finished, Self.active === self else {
            Self.stateLock.unlock()
            return
        }
        finished = true
        Self.active = nil
        Self.invocationLifecycle = .expired
        let launchInProgress = childLaunchInProgress
        childLaunchInProgress = false
        let child = activeChild
        activeChild = nil
        Self.stateLock.unlock()
        let childPID = child?.pid
        let childAlreadyReaped = launchInProgress ? false : (child.map {
            ($0.process.map { !$0.isRunning } ?? false)
                && ownedProcessGroupIsAbsent($0.ownedProcessGroupID)
        } ?? true)
        if let child, !childAlreadyReaped {
            if let group = child.ownedProcessGroupID {
                _ = Darwin.kill(-group, SIGKILL)
            }
            _ = Darwin.kill(child.pid, SIGKILL)
        }
        termination(childAlreadyReaped, childPID)
    }

    private static func invalidAtomicSpawnPID(_ pid: pid_t) -> DevSecurityFailure {
        fail(
            "runtime-service-repair-required",
            "stop after preserving the exact repair bootstrap and journal",
            "The atomic repair process-group spawn returned an invalid direct-child PID.",
            details: [
                "phase": "repair-invocation",
                "probe": "atomic-process-group-spawn",
                "state": "invalid-child-pid",
                "verifier_pid": pid,
                "child_reaped": false,
            ]
        )
    }

    private static func hardTerminateAfterDeadline(
        childReaped: Bool,
        childPID: pid_t?
    ) -> Void {
        let pid = getpid()
        let verifierPID = childPID ?? pid
        let diagnostic = "{\"status\":\"failed\",\"reasonCode\":\"runtime-service-repair-required\",\"actionHint\":\"inspect_the_journal_bound_partial_install_repair_deadline\",\"message\":\"The privileged partial-install repair exceeded its hard 600-second deadline and was terminated; no automatic retry is permitted.\",\"details\":{\"phase\":\"repair-invocation\",\"probe\":\"hard-deadline\",\"state\":\"expired\",\"timeout_seconds\":600,\"verifier_pid\":\(verifierPID),\"child_reaped\":\(childReaped)}}\n"
        diagnostic.withCString { pointer in
            _ = Darwin.write(STDERR_FILENO, pointer, strlen(pointer))
        }
        _ = Darwin.kill(pid, SIGKILL)
        _exit(124)
    }
}
