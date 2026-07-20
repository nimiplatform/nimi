import CryptoKit
import Darwin
import Foundation

@_silgen_name("kevent")
func nimiMutationLockKevent(
    _ queue: Int32,
    _ changes: UnsafePointer<kevent>?,
    _ changeCount: Int32,
    _ events: UnsafeMutablePointer<kevent>?,
    _ eventCount: Int32,
    _ timeout: UnsafePointer<timespec>?
) -> Int32

struct RuntimeServiceMutationLockWitness: Equatable, Sendable {
    let device: UInt64
    let inode: UInt64
    let size: Int64
    let modifiedSeconds: Int64
    let modifiedNanoseconds: Int64
    let changedSeconds: Int64
    let changedNanoseconds: Int64
    let fileFlags: UInt32
    let sha256: String
}

struct StableMutationLockTerminalCommit<Output> {
    let beforeFinalProof: () throws -> Void
    let commit: () throws -> Output
}

struct StableVnodeEventObservation: Equatable, Sendable {
    let eventFlags: UInt16
    let vnodeFlags: UInt32

    var names: String {
        stableVnodeEventNames(eventFlags: eventFlags, vnodeFlags: vnodeFlags)
            .joined(separator: "|")
    }
}

func withStableMutationLockVnode<T>(
    path: String,
    owner: uid_t,
    group: gid_t,
    requireExecutable: Bool,
    requireStableNamedVnodeAtExit: Bool,
    attributeEventRevalidator: ((RuntimeServiceMutationLockWitness) throws -> Void)? = nil,
    diagnosticDetails: @escaping () -> [String: Any] = { [:] },
    operation: (RuntimeServiceMutationLockWitness) throws -> T
) throws -> T {
    try withStableMutationLockVnodeTransaction(
        path: path,
        owner: owner,
        group: group,
        requireExecutable: requireExecutable,
        requireStableNamedVnodeAtExit: requireStableNamedVnodeAtExit,
        attributeEventRevalidator: attributeEventRevalidator,
        diagnosticDetails: diagnosticDetails
    ) { witness in
        let value = try operation(witness)
        return StableMutationLockTerminalCommit(
            beforeFinalProof: {},
            commit: { value }
        )
    }
}

func withStableMutationLockVnodeTransaction<T>(
    path: String,
    owner: uid_t,
    group: gid_t,
    requireExecutable: Bool,
    requireStableNamedVnodeAtExit: Bool,
    attributeEventRevalidator: ((RuntimeServiceMutationLockWitness) throws -> Void)? = nil,
    diagnosticDetails: @escaping () -> [String: Any] = { [:] },
    prepare: (RuntimeServiceMutationLockWitness) throws -> StableMutationLockTerminalCommit<T>
) throws -> T {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw posixFailure("open the fixed mutation-lock helper vnode", path) }
    defer { close(descriptor) }

    let eventQueue: Int32
    if requireStableNamedVnodeAtExit {
        eventQueue = try mutationLockEventQueue(descriptor: descriptor, path: path)
    } else {
        eventQueue = -1
    }
    defer {
        if eventQueue >= 0 { close(eventQueue) }
    }

    let before = try mutationLockMetadata(
        descriptor: descriptor,
        path: path,
        owner: owner,
        group: group,
        requireExecutable: requireExecutable
    )
    let beforeHash = try sha256OpenedExecutable(
        descriptor: descriptor,
        size: before.st_size,
        path: path
    )
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
        if errno == EWOULDBLOCK {
            throw fail(
                "runtime-service-repair-required",
                "wait for the existing macOS development security transaction to finish",
                "Another exact development security helper transaction already owns the mutation lock."
            )
        }
        throw posixFailure("lock the fixed development security helper vnode", path)
    }
    defer { flock(descriptor, LOCK_UN) }

    let locked = try mutationLockMetadata(
        descriptor: descriptor,
        path: path,
        owner: owner,
        group: group,
        requireExecutable: requireExecutable
    )
    let lockedHash = try sha256OpenedExecutable(
        descriptor: descriptor,
        size: locked.st_size,
        path: path
    )
    guard sameMutationLockVnode(before, locked), beforeHash == lockedHash else {
        throw mutationLockFailure(
            "changed-before-lock-binding",
            locked: before,
            observed: locked,
            sha256: beforeHash,
            event: nil,
            extraDetails: diagnosticDetails(),
            primaryError: nil
        )
    }

    let witness = RuntimeServiceMutationLockWitness(
        device: UInt64(locked.st_dev),
        inode: UInt64(locked.st_ino),
        size: locked.st_size,
        modifiedSeconds: Int64(locked.st_mtimespec.tv_sec),
        modifiedNanoseconds: Int64(locked.st_mtimespec.tv_nsec),
        changedSeconds: Int64(locked.st_ctimespec.tv_sec),
        changedNanoseconds: Int64(locked.st_ctimespec.tv_nsec),
        fileFlags: UInt32(locked.st_flags),
        sha256: lockedHash
    )
    if eventQueue >= 0 {
        try validateMutationLockCheckpoint(
            queue: eventQueue,
            descriptor: descriptor,
            path: path,
            owner: owner,
            group: group,
            requireExecutable: requireExecutable,
            locked: locked,
            lockedHash: lockedHash,
            witness: witness,
            attributeEventRevalidator: attributeEventRevalidator,
            extraDetails: diagnosticDetails,
            primaryError: nil
        )
    }

    let terminal: StableMutationLockTerminalCommit<T>
    do {
        terminal = try prepare(witness)
    } catch {
        if eventQueue >= 0 {
            try validateMutationLockCheckpoint(
                queue: eventQueue,
                descriptor: descriptor,
                path: path,
                owner: owner,
                group: group,
                requireExecutable: requireExecutable,
                locked: locked,
                lockedHash: lockedHash,
                witness: witness,
                attributeEventRevalidator: attributeEventRevalidator,
                extraDetails: diagnosticDetails,
                primaryError: error
            )
        }
        throw error
    }

    if requireStableNamedVnodeAtExit {
        try validateMutationLockCheckpoint(
            queue: eventQueue,
            descriptor: descriptor,
            path: path,
            owner: owner,
            group: group,
            requireExecutable: requireExecutable,
            locked: locked,
            lockedHash: lockedHash,
            witness: witness,
            attributeEventRevalidator: attributeEventRevalidator,
            extraDetails: diagnosticDetails,
            primaryError: nil
        )
    }

    do {
        try terminal.beforeFinalProof()
    } catch {
        if eventQueue >= 0 {
            try validateMutationLockCheckpoint(
                queue: eventQueue,
                descriptor: descriptor,
                path: path,
                owner: owner,
                group: group,
                requireExecutable: requireExecutable,
                locked: locked,
                lockedHash: lockedHash,
                witness: witness,
                attributeEventRevalidator: attributeEventRevalidator,
                extraDetails: diagnosticDetails,
                primaryError: error
            )
        }
        throw error
    }

    if requireStableNamedVnodeAtExit {
        try validateMutationLockCheckpoint(
            queue: eventQueue,
            descriptor: descriptor,
            path: path,
            owner: owner,
            group: group,
            requireExecutable: requireExecutable,
            locked: locked,
            lockedHash: lockedHash,
            witness: witness,
            attributeEventRevalidator: attributeEventRevalidator,
            extraDetails: diagnosticDetails,
            primaryError: nil
        )
    }
    return try terminal.commit()
}

func mutationLockWitnessMatchesExecutableVnode(
    _ lock: RuntimeServiceMutationLockWitness,
    _ executable: StableExecutableVnodeWitness
) -> Bool {
    executable.device == lock.device
        && executable.inode == lock.inode
        && executable.size == lock.size
        && executable.modifiedSeconds == lock.modifiedSeconds
        && executable.modifiedNanoseconds == lock.modifiedNanoseconds
        && executable.changedSeconds == lock.changedSeconds
        && executable.changedNanoseconds == lock.changedNanoseconds
        && executable.fileFlags == lock.fileFlags
        && executable.sha256 == lock.sha256
}

private func mutationLockMetadata(
    descriptor: Int32,
    path: String,
    owner: uid_t,
    group: gid_t,
    requireExecutable: Bool
) throws -> stat {
    var opened = stat()
    var named = stat()
    guard fstat(descriptor, &opened) == 0,
          lstat(path, &named) == 0,
          mutationLockMetadataIsSecure(
              opened,
              owner: owner,
              group: group,
              requireExecutable: requireExecutable
          ),
          sameMutationLockVnode(opened, named) else {
        throw mutationLockFailure("unsafe-or-named-vnode-mismatch")
    }
    return opened
}

private func mutationLockMetadataIsSecure(
    _ metadata: stat,
    owner: uid_t,
    group: gid_t,
    requireExecutable: Bool
) -> Bool {
    metadata.st_mode & S_IFMT == S_IFREG
        && metadata.st_uid == owner
        && metadata.st_gid == group
        && metadata.st_nlink == 1
        && metadata.st_mode & 0o022 == 0
        && (!requireExecutable || metadata.st_mode & 0o111 != 0)
        && metadata.st_size > 0
        && metadata.st_size <= 64 * 1024 * 1024
}

private func sameMutationLockVnode(_ left: stat, _ right: stat) -> Bool {
    left.st_dev == right.st_dev
        && left.st_ino == right.st_ino
        && left.st_mode == right.st_mode
        && left.st_uid == right.st_uid
        && left.st_gid == right.st_gid
        && left.st_nlink == right.st_nlink
        && left.st_size == right.st_size
        && left.st_mtimespec.tv_sec == right.st_mtimespec.tv_sec
        && left.st_mtimespec.tv_nsec == right.st_mtimespec.tv_nsec
        && left.st_ctimespec.tv_sec == right.st_ctimespec.tv_sec
        && left.st_ctimespec.tv_nsec == right.st_ctimespec.tv_nsec
        && left.st_flags == right.st_flags
}

private func mutationLockEventQueue(descriptor: Int32, path: String) throws -> Int32 {
    let queue = kqueue()
    guard queue >= 0 else { throw posixFailure("create mutation-lock vnode witness", path) }
    var change = kevent(
        ident: UInt(descriptor),
        filter: Int16(EVFILT_VNODE),
        flags: UInt16(EV_ADD | EV_CLEAR),
        fflags: UInt32(NOTE_DELETE | NOTE_WRITE | NOTE_EXTEND | NOTE_ATTRIB | NOTE_LINK | NOTE_RENAME | NOTE_REVOKE),
        data: 0,
        udata: nil
    )
    let status = withUnsafePointer(to: &change) {
        nimiMutationLockKevent(queue, $0, 1, nil, 0, nil)
    }
    guard status == 0 else {
        close(queue)
        throw posixFailure("register mutation-lock vnode witness", path)
    }
    return queue
}

func nextStableVnodeEvent(
    _ queue: Int32,
    path: String,
    operation: String
) throws -> StableVnodeEventObservation? {
    var event = kevent()
    var timeout = timespec(tv_sec: 0, tv_nsec: 0)
    let count = withUnsafeMutablePointer(to: &event) { eventPointer in
        withUnsafePointer(to: &timeout) { timeoutPointer in
            nimiMutationLockKevent(queue, nil, 0, eventPointer, 1, timeoutPointer)
        }
    }
    if count < 0 { throw posixFailure(operation, path) }
    guard count == 1 else { return nil }
    return StableVnodeEventObservation(
        eventFlags: event.flags,
        vnodeFlags: event.fflags
    )
}

func stableVnodeEventNames(eventFlags: UInt16, vnodeFlags: UInt32) -> [String] {
    var names: [String] = []
    let vnodeNames: [(UInt32, String)] = [
        (UInt32(NOTE_DELETE), "NOTE_DELETE"),
        (UInt32(NOTE_WRITE), "NOTE_WRITE"),
        (UInt32(NOTE_EXTEND), "NOTE_EXTEND"),
        (UInt32(NOTE_ATTRIB), "NOTE_ATTRIB"),
        (UInt32(NOTE_LINK), "NOTE_LINK"),
        (UInt32(NOTE_RENAME), "NOTE_RENAME"),
        (UInt32(NOTE_REVOKE), "NOTE_REVOKE"),
    ]
    for (flag, name) in vnodeNames where vnodeFlags & flag != 0 { names.append(name) }
    if eventFlags & UInt16(EV_ERROR) != 0 { names.append("EV_ERROR") }
    if eventFlags & UInt16(EV_EOF) != 0 { names.append("EV_EOF") }
    if names.isEmpty { names.append("UNCLASSIFIED") }
    return names
}

func stableVnodeEventIsAttributeOnly(_ event: StableVnodeEventObservation) -> Bool {
    event.eventFlags & UInt16(EV_ERROR | EV_EOF) == 0
        && event.vnodeFlags == UInt32(NOTE_ATTRIB)
}

private func validateMutationLockCheckpoint(
    queue: Int32,
    descriptor: Int32,
    path: String,
    owner: uid_t,
    group: gid_t,
    requireExecutable: Bool,
    locked: stat,
    lockedHash: String,
    witness: RuntimeServiceMutationLockWitness,
    attributeEventRevalidator: ((RuntimeServiceMutationLockWitness) throws -> Void)?,
    extraDetails: () -> [String: Any],
    primaryError: Error?
) throws {
    var cleanPasses = 0
    for _ in 0..<8 {
        let observed = try mutationLockMetadata(
            descriptor: descriptor,
            path: path,
            owner: owner,
            group: group,
            requireExecutable: requireExecutable
        )
        let observedHash = try sha256OpenedExecutable(
            descriptor: descriptor,
            size: observed.st_size,
            path: path
        )
        guard sameMutationLockVnode(locked, observed), observedHash == lockedHash else {
            throw mutationLockFailure(
                "opened-or-named-vnode-changed",
                locked: locked,
                observed: observed,
                sha256: lockedHash,
                event: nil,
                extraDetails: extraDetails(),
                primaryError: primaryError
            )
        }
        guard let event = try nextStableVnodeEvent(
            queue,
            path: path,
            operation: "inspect mutation-lock vnode witness"
        ) else {
            cleanPasses += 1
            if cleanPasses == 2 { return }
            continue
        }
        cleanPasses = 0
        guard stableVnodeEventIsAttributeOnly(event), let attributeEventRevalidator else {
            throw mutationLockFailure(
                "security-relevant-vnode-event",
                locked: locked,
                observed: observed,
                sha256: lockedHash,
                event: event,
                extraDetails: extraDetails(),
                primaryError: primaryError
            )
        }
        do {
            try attributeEventRevalidator(witness)
        } catch {
            throw mutationLockFailure(
                "attribute-event-revalidation-failed",
                locked: locked,
                observed: observed,
                sha256: lockedHash,
                event: event,
                extraDetails: extraDetails(),
                primaryError: error
            )
        }
    }
    throw mutationLockFailure(
        "vnode-event-quiescence-unproven",
        locked: locked,
        observed: locked,
        sha256: lockedHash,
        event: nil,
        extraDetails: extraDetails(),
        primaryError: primaryError
    )
}

private func mutationLockFailure(
    _ state: String,
    locked: stat,
    observed: stat,
    sha256: String,
    event: StableVnodeEventObservation?,
    extraDetails: [String: Any],
    primaryError: Error?
) -> DevSecurityFailure {
    var details: [String: Any] = [
        "phase": "repair-authority",
        "probe": "source-helper-mutation-lock-vnode",
        "state": state,
        "verifier_pid": getpid(),
        "child_reaped": true,
        "lock_device": String(UInt64(locked.st_dev)),
        "lock_inode": String(UInt64(locked.st_ino)),
        "lock_sha256": sha256,
        "lock_before_ctime": "\(locked.st_ctimespec.tv_sec).\(locked.st_ctimespec.tv_nsec)",
        "lock_after_ctime": "\(observed.st_ctimespec.tv_sec).\(observed.st_ctimespec.tv_nsec)",
    ]
    if let event {
        details["kevent_event_flags"] = Int(event.eventFlags)
        details["vnode_event_flags"] = Int(event.vnodeFlags)
        details["vnode_event_names"] = event.names
    }
    if let primary = primaryError as? DevSecurityFailure {
        details["primary_reason_code"] = primary.reasonCode
        if let probe = primary.details?["probe"] as? String {
            details["primary_probe"] = probe
        }
    } else if let primaryError {
        details["primary_reason_code"] = "unstructured-error"
        details["primary_probe"] = String(describing: type(of: primaryError))
    }
    for (key, value) in extraDetails where details[key] == nil { details[key] = value }
    let message = state == "security-relevant-vnode-event"
        ? "The final helper emitted a security-relevant vnode mutation event while its repair authority lock was held."
        : "The final helper lock witness could not prove one unchanged named vnode and static code identity."
    return fail(
        "runtime-service-untrusted",
        "restore the exact locked development security helper vnode",
        message,
        details: details
    )
}

private func mutationLockFailure(_ state: String) -> DevSecurityFailure {
    fail(
        "runtime-service-untrusted",
        "restore the exact locked development security helper vnode",
        "The final helper path and opened vnode do not form one secure mutation-lock authority.",
        details: [
            "phase": "repair-authority",
            "probe": "source-helper-mutation-lock-vnode",
            "state": state,
            "verifier_pid": getpid(),
            "child_reaped": true,
        ]
    )
}
