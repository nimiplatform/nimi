import Darwin
import Foundation

struct RepairProcessWitness: Equatable, Sendable {
    let pid: pid_t
    let parentPID: pid_t
    let realUID: uid_t
    let effectiveUID: uid_t
    let savedUID: uid_t
    let startSeconds: UInt64
    let startMicroseconds: UInt64
    let executablePath: String

    var startIdentity: String {
        "\(pid):\(startSeconds):\(startMicroseconds)"
    }
}

func readRepairProcessWitness(_ pid: pid_t) throws -> RepairProcessWitness {
    guard pid > 1 else {
        throw repairProcessWitnessFailure(state: "invalid-pid", pid: pid)
    }
    var info = proc_bsdinfo()
    let expectedSize = Int32(MemoryLayout<proc_bsdinfo>.size)
    let informationSize = withUnsafeMutablePointer(to: &info) {
        proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, expectedSize)
    }
    guard informationSize == expectedSize else {
        throw repairProcessWitnessFailure(state: "bsd-info-unavailable", pid: pid)
    }
    // Darwin exposes PROC_PIDPATHINFO_MAXSIZE as a C macro that Swift cannot
    // import. Its ABI definition is four times MAXPATHLEN.
    var path = [CChar](repeating: 0, count: Int(PATH_MAX) * 4)
    let pathLength = proc_pidpath(pid, &path, UInt32(path.count))
    guard pathLength > 0 else {
        throw repairProcessWitnessFailure(state: "executable-path-unavailable", pid: pid)
    }
    let executablePath = String(cString: path)
    guard executablePath.hasPrefix("/"), !executablePath.contains("\0") else {
        throw repairProcessWitnessFailure(state: "executable-path-invalid", pid: pid)
    }
    return RepairProcessWitness(
        pid: pid,
        parentPID: pid_t(info.pbi_ppid),
        realUID: uid_t(info.pbi_ruid),
        effectiveUID: uid_t(info.pbi_uid),
        savedUID: uid_t(info.pbi_svuid),
        startSeconds: info.pbi_start_tvsec,
        startMicroseconds: info.pbi_start_tvusec,
        executablePath: executablePath
    )
}

private func repairProcessWitnessFailure(
    state: String,
    pid: pid_t
) -> DevSecurityFailure {
    fail(
        "process-replaced",
        "restart from the exact journal-bound repair bootstrap",
        "The repair process identity could not be proven stable.",
        details: [
            "phase": "repair-invocation",
            "probe": "process-start-witness",
            "state": state,
            "verifier_pid": pid,
            "child_reaped": true,
        ]
    )
}
