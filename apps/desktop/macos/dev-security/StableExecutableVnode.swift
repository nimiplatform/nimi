import CryptoKit
import Darwin
import Foundation

struct StableExecutableVnodeWitness: Equatable, Sendable {
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

func withStableExecutableVnode<T>(
    path: String,
    owner: uid_t,
    group: gid_t,
    mode: mode_t,
    maximumSize: Int64 = 64 * 1024 * 1024,
    attributeEventRevalidator: ((StableExecutableVnodeWitness) throws -> Void)? = nil,
    operation: (StableExecutableVnodeWitness) throws -> T
) throws -> T {
    let parentPath = (path as NSString).deletingLastPathComponent
    let name = (path as NSString).lastPathComponent
    guard path.hasPrefix("/"), !name.isEmpty, name != ".", name != ".." else {
        throw stableExecutableFailure("path-invalid")
    }
    let parentDescriptor = open(parentPath, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
    guard parentDescriptor >= 0 else {
        throw posixFailure("open stable executable parent vnode", parentPath)
    }
    defer { close(parentDescriptor) }
    try requireStableExecutableParent(
        descriptor: parentDescriptor,
        path: parentPath,
        owner: owner,
        group: group
    )
    let descriptor = name.withCString {
        openat(parentDescriptor, $0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    }
    guard descriptor >= 0 else { throw posixFailure("open stable executable vnode", path) }
    defer { close(descriptor) }

    let eventQueue = kqueue()
    guard eventQueue >= 0 else { throw posixFailure("create stable executable vnode witness", path) }
    defer { close(eventQueue) }
    var change = kevent(
        ident: UInt(descriptor),
        filter: Int16(EVFILT_VNODE),
        flags: UInt16(EV_ADD | EV_CLEAR),
        fflags: UInt32(NOTE_DELETE | NOTE_WRITE | NOTE_EXTEND | NOTE_ATTRIB | NOTE_LINK | NOTE_RENAME | NOTE_REVOKE),
        data: 0,
        udata: nil
    )
    let registrationStatus = withUnsafePointer(to: &change) {
        nimiMutationLockKevent(eventQueue, $0, 1, nil, 0, nil)
    }
    guard registrationStatus == 0 else {
        throw posixFailure("register stable executable vnode witness", path)
    }

    let before = try stableExecutableMetadata(
        descriptor: descriptor,
        parentDescriptor: parentDescriptor,
        name: name,
        path: path,
        owner: owner,
        group: group,
        mode: mode,
        maximumSize: maximumSize
    )
    let beforeHash = try sha256OpenedExecutable(
        descriptor: descriptor,
        size: before.st_size,
        path: path
    )
    let witness = StableExecutableVnodeWitness(
        device: UInt64(before.st_dev),
        inode: UInt64(before.st_ino),
        size: before.st_size,
        modifiedSeconds: Int64(before.st_mtimespec.tv_sec),
        modifiedNanoseconds: Int64(before.st_mtimespec.tv_nsec),
        changedSeconds: Int64(before.st_ctimespec.tv_sec),
        changedNanoseconds: Int64(before.st_ctimespec.tv_nsec),
        fileFlags: UInt32(before.st_flags),
        sha256: beforeHash
    )
    let result = Result { try operation(witness) }
    let after = try stableExecutableMetadata(
        descriptor: descriptor,
        parentDescriptor: parentDescriptor,
        name: name,
        path: path,
        owner: owner,
        group: group,
        mode: mode,
        maximumSize: maximumSize
    )
    let afterHash = try sha256OpenedExecutable(
        descriptor: descriptor,
        size: after.st_size,
        path: path
    )
    guard sameStableExecutableMetadata(before, after), beforeHash == afterHash else {
        throw stableExecutableFailure("opened-vnode-changed")
    }
    try requireStableExecutableVnodeEventIsBenignOrAbsent(
        eventQueue,
        path: path,
        locked: before,
        observed: after,
        sha256: beforeHash,
        witness: witness,
        attributeEventRevalidator: attributeEventRevalidator
    )
    // Revalidate the name after consuming vnode notifications so a
    // rename/delete-and-restore sequence cannot hide behind equal final bytes.
    let final = try stableExecutableMetadata(
        descriptor: descriptor,
        parentDescriptor: parentDescriptor,
        name: name,
        path: path,
        owner: owner,
        group: group,
        mode: mode,
        maximumSize: maximumSize
    )
    let finalHash = try sha256OpenedExecutable(
        descriptor: descriptor,
        size: final.st_size,
        path: path
    )
    guard sameStableExecutableMetadata(before, final), beforeHash == finalHash else {
        throw stableExecutableFailure("opened-vnode-changed-after-event-proof")
    }
    try requireStableExecutableVnodeEventIsBenignOrAbsent(
        eventQueue,
        path: path,
        locked: before,
        observed: final,
        sha256: beforeHash,
        witness: witness,
        attributeEventRevalidator: attributeEventRevalidator
    )
    return try result.get()
}

private func stableExecutableMetadata(
    descriptor: Int32,
    parentDescriptor: Int32,
    name: String,
    path: String,
    owner: uid_t,
    group: gid_t,
    mode: mode_t,
    maximumSize: Int64
) throws -> stat {
    var opened = stat()
    var named = stat()
    let namedStatus = name.withCString {
        fstatat(parentDescriptor, $0, &named, AT_SYMLINK_NOFOLLOW)
    }
    guard fstat(descriptor, &opened) == 0, namedStatus == 0 else {
        throw posixFailure("inspect stable executable vnode", path)
    }
    guard opened.st_mode & S_IFMT == S_IFREG,
          opened.st_uid == owner,
          opened.st_gid == group,
          opened.st_mode & 0o7777 == mode,
          opened.st_nlink == 1,
          opened.st_size > 0,
          opened.st_size <= maximumSize,
          sameStableExecutableMetadata(opened, named) else {
        throw stableExecutableFailure("named-vnode-mismatch")
    }
    return opened
}

private func requireStableExecutableParent(
    descriptor: Int32,
    path: String,
    owner: uid_t,
    group: gid_t
) throws {
    var opened = stat()
    var named = stat()
    guard fstat(descriptor, &opened) == 0, lstat(path, &named) == 0 else {
        throw posixFailure("inspect stable executable parent vnode", path)
    }
    guard opened.st_mode & S_IFMT == S_IFDIR,
          opened.st_uid == owner,
          opened.st_gid == group,
          opened.st_mode & 0o022 == 0,
          sameStableExecutableMetadata(opened, named),
          let resolved = realpath(path, nil) else {
        throw stableExecutableFailure("parent-vnode-unsafe")
    }
    defer { free(resolved) }
    guard String(cString: resolved) == path else {
        throw stableExecutableFailure("parent-path-noncanonical")
    }
}

private func requireStableExecutableVnodeEventIsBenignOrAbsent(
    _ eventQueue: Int32,
    path: String,
    locked: stat,
    observed: stat,
    sha256: String,
    witness: StableExecutableVnodeWitness,
    attributeEventRevalidator: ((StableExecutableVnodeWitness) throws -> Void)?
) throws {
    guard let event = try nextStableVnodeEvent(
        eventQueue,
        path: path,
        operation: "inspect stable executable vnode witness"
    ) else { return }
    guard stableVnodeEventIsAttributeOnly(event),
          sameStableExecutableMetadata(locked, observed),
          let attributeEventRevalidator else {
        throw stableExecutableFailure(
            "security-relevant-vnode-event",
            locked: locked,
            observed: observed,
            sha256: sha256,
            event: event
        )
    }
    do {
        try attributeEventRevalidator(witness)
    } catch {
        throw stableExecutableFailure(
            "attribute-event-revalidation-failed",
            locked: locked,
            observed: observed,
            sha256: sha256,
            event: event,
            primaryError: error
        )
    }
}

private func stableExecutableFailure(
    _ state: String,
    locked: stat? = nil,
    observed: stat? = nil,
    sha256: String? = nil,
    event: StableVnodeEventObservation? = nil,
    primaryError: Error? = nil
) -> DevSecurityFailure {
    var details: [String: Any] = [
        "phase": "repair-authority",
        "probe": "source-helper-open-vnode",
        "state": state,
        "verifier_pid": getpid(),
        "child_reaped": true,
    ]
    if let locked, let observed {
        details["lock_device"] = String(UInt64(locked.st_dev))
        details["lock_inode"] = String(UInt64(locked.st_ino))
        details["lock_before_ctime"] = "\(locked.st_ctimespec.tv_sec).\(locked.st_ctimespec.tv_nsec)"
        details["lock_after_ctime"] = "\(observed.st_ctimespec.tv_sec).\(observed.st_ctimespec.tv_nsec)"
    }
    if let sha256 { details["lock_sha256"] = sha256 }
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
    return fail(
        "runtime-service-untrusted",
        "restore the exact fixed development security helper vnode",
        "The final-helper path and opened vnode are not one stable immutable authority witness.",
        details: details
    )
}

private func sameStableExecutableMetadata(_ left: stat, _ right: stat) -> Bool {
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

func sha256OpenedExecutable(
    descriptor: Int32,
    size: Int64,
    path: String
) throws -> String {
    var hasher = SHA256()
    var offset: Int64 = 0
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while offset < size {
        let requested = min(buffer.count, Int(size - offset))
        let count = buffer.withUnsafeMutableBytes { bytes in
            pread(descriptor, bytes.baseAddress, requested, off_t(offset))
        }
        guard count > 0 else {
            if count == 0 { errno = EIO }
            throw posixFailure("hash stable executable vnode", path)
        }
        hasher.update(data: Data(buffer[0..<count]))
        offset += Int64(count)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}
