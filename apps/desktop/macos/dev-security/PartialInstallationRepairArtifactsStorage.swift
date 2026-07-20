import Darwin
import Foundation

func repairSocketRoot() throws -> String {
    let desktopRoot = (generatedDesktopSocketPath as NSString).deletingLastPathComponent
    let hostRoot = (generatedLocalAppSocketPath as NSString).deletingLastPathComponent
    guard desktopRoot == hostRoot, desktopRoot == "/private/var/run/nimi-dev" else {
        throw repairFailure("The generated protected socket roots diverge from the fixed repair target.")
    }
    return desktopRoot
}

private struct OpenedPartialInstallRepairDirectory {
    let parentDescriptor: Int32
    let descriptor: Int32
    let name: String
    let metadata: stat
}

private func repairStorageSameVnode(_ left: stat, _ right: stat) -> Bool {
    left.st_dev == right.st_dev && left.st_ino == right.st_ino
}

private func repairStorageSameFileSnapshot(_ left: stat, _ right: stat) -> Bool {
    repairStorageSameVnode(left, right)
        && left.st_mode == right.st_mode
        && left.st_uid == right.st_uid
        && left.st_gid == right.st_gid
        && left.st_nlink == right.st_nlink
        && left.st_size == right.st_size
        && left.st_mtimespec.tv_sec == right.st_mtimespec.tv_sec
        && left.st_mtimespec.tv_nsec == right.st_mtimespec.tv_nsec
        && left.st_ctimespec.tv_sec == right.st_ctimespec.tv_sec
        && left.st_ctimespec.tv_nsec == right.st_ctimespec.tv_nsec
}

private func openRepairStorageParent(_ path: String, group: gid_t?, mode: mode_t?) throws -> Int32 {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
    guard descriptor >= 0 else { throw posixFailure("open fixed partial-install parent directory", path) }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_uid == 0,
          group.map({ metadata.st_gid == $0 }) ?? true,
          metadata.st_mode & 0o002 == 0,
          mode.map({ metadata.st_mode & 0o777 == $0 }) ?? true else {
        close(descriptor)
        throw repairFailure("A fixed partial-install parent directory has unsafe metadata: \(path)")
    }
    return descriptor
}

private func openPartialInstallRepairDirectory(
    _ path: String,
    owner: uid_t,
    group: gid_t,
    mode: mode_t,
    required: Bool
) throws -> OpenedPartialInstallRepairDirectory? {
    let parentPath = (path as NSString).deletingLastPathComponent
    let name = (path as NSString).lastPathComponent
    let admittedRuntimeDirectories = [runtimeStateRoot, runtimeTransactionRoot, runtimeRollbackRoot]
    let parentDescriptor: Int32
    if parentPath == runtimeDevRoot, admittedRuntimeDirectories.contains(path) {
        parentDescriptor = try openRepairStorageParent(parentPath, group: 0, mode: 0o755)
    } else if path == (try repairSocketRoot()), parentPath == "/private/var/run", name == "nimi-dev" {
        parentDescriptor = try openRepairStorageParent(parentPath, group: nil, mode: nil)
    } else {
        throw repairFailure("A partial-install directory target is outside the admitted fixed namespace.")
    }

    let descriptor = name.withCString {
        openat(parentDescriptor, $0, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
    }
    if descriptor < 0 {
        let openError = errno
        close(parentDescriptor)
        if !required, openError == ENOENT { return nil }
        errno = openError
        throw posixFailure("open fixed partial-install repair directory vnode", path)
    }
    do {
        var openedMetadata = stat()
        var namedMetadata = stat()
        let namedStatus = name.withCString {
            fstatat(parentDescriptor, $0, &namedMetadata, AT_SYMLINK_NOFOLLOW)
        }
        guard fstat(descriptor, &openedMetadata) == 0,
              namedStatus == 0,
              openedMetadata.st_mode & S_IFMT == S_IFDIR,
              openedMetadata.st_uid == owner,
              openedMetadata.st_gid == group,
              openedMetadata.st_mode & 0o777 == mode,
              repairStorageSameVnode(openedMetadata, namedMetadata) else {
            throw repairFailure("A fixed partial-install repair directory no longer names its expected opened vnode: \(path)")
        }
        return OpenedPartialInstallRepairDirectory(
            parentDescriptor: parentDescriptor,
            descriptor: descriptor,
            name: name,
            metadata: openedMetadata
        )
    } catch {
        close(descriptor)
        close(parentDescriptor)
        throw error
    }
}

private func requireOpenedRepairDirectoryEmpty(
    _ opened: OpenedPartialInstallRepairDirectory,
    path: String
) throws {
    let enumerationDescriptor = fcntl(opened.descriptor, F_DUPFD_CLOEXEC, 0)
    guard enumerationDescriptor >= 0 else {
        throw posixFailure("duplicate partial-install repair directory vnode for enumeration", path)
    }
    guard let directory = fdopendir(enumerationDescriptor) else {
        let directoryError = errno
        close(enumerationDescriptor)
        errno = directoryError
        throw posixFailure("enumerate opened partial-install repair directory vnode", path)
    }
    defer { closedir(directory) }
    errno = 0
    while let entry = readdir(directory) {
        let entryName = withUnsafePointer(to: &entry.pointee.d_name) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) {
                String(cString: $0)
            }
        }
        if entryName != ".", entryName != ".." {
            throw repairFailure("Repair target directory is not empty: \(path)")
        }
        errno = 0
    }
    let enumerationError = errno
    guard enumerationError == 0 else {
        errno = enumerationError
        throw posixFailure("complete opened partial-install repair directory enumeration", path)
    }
}

private func requireOpenedRepairDirectoryStillNamed(
    _ opened: OpenedPartialInstallRepairDirectory,
    path: String
) throws {
    var currentMetadata = stat()
    var namedMetadata = stat()
    let namedStatus = opened.name.withCString {
        fstatat(opened.parentDescriptor, $0, &namedMetadata, AT_SYMLINK_NOFOLLOW)
    }
    guard fstat(opened.descriptor, &currentMetadata) == 0,
          namedStatus == 0,
          repairStorageSameFileSnapshot(opened.metadata, currentMetadata),
          repairStorageSameVnode(currentMetadata, namedMetadata) else {
        throw repairFailure("The fixed partial-install repair directory changed before exact removal: \(path)")
    }
}

func requireEmptyRepairDirectory(_ path: String, owner: uid_t, group: gid_t, mode: mode_t) throws {
    guard let opened = try openPartialInstallRepairDirectory(
        path,
        owner: owner,
        group: group,
        mode: mode,
        required: true
    ) else { throw repairFailure("A required partial-install repair directory is absent: \(path)") }
    defer {
        close(opened.descriptor)
        close(opened.parentDescriptor)
    }
    try requireOpenedRepairDirectoryEmpty(opened, path: path)
    try requireOpenedRepairDirectoryStillNamed(opened, path: path)
}

func removeEmptyRepairDirectoryIfPresent(_ path: String, owner: uid_t, group: gid_t, mode: mode_t) throws {
    guard let opened = try openPartialInstallRepairDirectory(
        path,
        owner: owner,
        group: group,
        mode: mode,
        required: false
    ) else { return }
    defer {
        close(opened.descriptor)
        close(opened.parentDescriptor)
    }
    try requireOpenedRepairDirectoryEmpty(opened, path: path)
    try requireOpenedRepairDirectoryStillNamed(opened, path: path)
    let removalStatus = opened.name.withCString {
        unlinkat(opened.parentDescriptor, $0, AT_REMOVEDIR)
    }
    guard removalStatus == 0 else {
        throw posixFailure("remove exact empty partial-install repair directory vnode", path)
    }
    var removedMetadata = stat()
    var absentMetadata = stat()
    let absentStatus = opened.name.withCString {
        fstatat(opened.parentDescriptor, $0, &absentMetadata, AT_SYMLINK_NOFOLLOW)
    }
    let absentError = errno
    guard fstat(opened.descriptor, &removedMetadata) == 0,
          repairStorageSameVnode(opened.metadata, removedMetadata),
          absentStatus != 0,
          absentError == ENOENT else {
        throw repairFailure("The exact partial-install repair directory removal was not proven: \(path)")
    }
    guard fsync(opened.parentDescriptor) == 0 else {
        throw posixFailure("sync exact partial-install repair directory parent", parentPath(path))
    }
}

private func parentPath(_ path: String) -> String {
    (path as NSString).deletingLastPathComponent
}

private func readStableRepairStorageFile(
    descriptor: Int32,
    parentDescriptor: Int32,
    name: String,
    path: String,
    initialMetadata: stat,
    maximumSize: Int
) throws -> Data {
    guard lseek(descriptor, 0, SEEK_SET) == 0 else {
        throw posixFailure("seek opened partial-install repair file vnode", path)
    }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress, $0.count)
        }
        if count < 0 {
            if errno == EINTR { continue }
            throw posixFailure("read opened partial-install repair file vnode", path)
        }
        if count == 0 { break }
        guard data.count + count <= maximumSize else {
            throw repairFailure("A partial-install repair file exceeds its admitted read budget: \(path)")
        }
        data.append(contentsOf: buffer[0..<count])
    }
    var finalMetadata = stat()
    var namedMetadata = stat()
    let namedStatus = name.withCString {
        fstatat(parentDescriptor, $0, &namedMetadata, AT_SYMLINK_NOFOLLOW)
    }
    guard fstat(descriptor, &finalMetadata) == 0,
          repairStorageSameFileSnapshot(initialMetadata, finalMetadata),
          finalMetadata.st_size == data.count,
          namedStatus == 0,
          repairStorageSameVnode(finalMetadata, namedMetadata) else {
        throw repairFailure("An opened partial-install repair file vnode changed while it was read: \(path)")
    }
    return data
}

func removeRepairLaunchDaemonIfPresent() throws {
    let parent = parentPath(launchDaemonPath)
    let name = (launchDaemonPath as NSString).lastPathComponent
    guard parent == "/Library/LaunchDaemons", name == "ai.nimi.runtime.dev.plist" else {
        throw repairFailure("The generated LaunchDaemon repair target is outside the fixed admitted path.")
    }
    let parentDescriptor = try openRepairStorageParent(parent, group: 0, mode: 0o755)
    defer { close(parentDescriptor) }
    let descriptor = name.withCString {
        openat(parentDescriptor, $0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    }
    if descriptor < 0 {
        let openError = errno
        if openError == ENOENT { return }
        errno = openError
        throw posixFailure("open partial LaunchDaemon definition vnode", launchDaemonPath)
    }
    defer { close(descriptor) }
    var openedMetadata = stat()
    var namedMetadata = stat()
    let namedStatus = name.withCString {
        fstatat(parentDescriptor, $0, &namedMetadata, AT_SYMLINK_NOFOLLOW)
    }
    guard fstat(descriptor, &openedMetadata) == 0,
          namedStatus == 0,
          openedMetadata.st_mode & S_IFMT == S_IFREG,
          openedMetadata.st_uid == 0,
          openedMetadata.st_gid == 0,
          openedMetadata.st_mode & 0o777 == 0o644,
          openedMetadata.st_nlink == 1,
          openedMetadata.st_size > 0,
          openedMetadata.st_size <= 64 * 1024,
          repairStorageSameVnode(openedMetadata, namedMetadata) else {
        throw repairFailure("The partial LaunchDaemon definition is not the exact secure opened vnode.")
    }
    let data = try readStableRepairStorageFile(
        descriptor: descriptor,
        parentDescriptor: parentDescriptor,
        name: name,
        path: launchDaemonPath,
        initialMetadata: openedMetadata,
        maximumSize: 64 * 1024
    )
    guard sha256(data) == generatedLaunchDaemonSHA256,
          let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          plist["Label"] as? String == launchDaemonLabel,
          plist["ProgramArguments"] as? [String] == [runtimeExecutablePath, "serve"],
          plist["UserName"] as? String == runtimeAccountName,
          plist["GroupName"] as? String == runtimeAccountName else {
        throw repairFailure("The partial LaunchDaemon definition differs from authority-derived bytes.")
    }
    var stableMetadata = stat()
    var stableNamedMetadata = stat()
    let stableNamedStatus = name.withCString {
        fstatat(parentDescriptor, $0, &stableNamedMetadata, AT_SYMLINK_NOFOLLOW)
    }
    guard fstat(descriptor, &stableMetadata) == 0,
          stableNamedStatus == 0,
          repairStorageSameFileSnapshot(openedMetadata, stableMetadata),
          repairStorageSameVnode(stableMetadata, stableNamedMetadata) else {
        throw repairFailure("The partial LaunchDaemon definition changed before exact removal.")
    }
    let unlinkStatus = name.withCString { unlinkat(parentDescriptor, $0, 0) }
    guard unlinkStatus == 0 else {
        throw posixFailure("remove partial LaunchDaemon definition vnode", launchDaemonPath)
    }
    var removedMetadata = stat()
    var absentMetadata = stat()
    let absentStatus = name.withCString {
        fstatat(parentDescriptor, $0, &absentMetadata, AT_SYMLINK_NOFOLLOW)
    }
    let absentError = errno
    guard fstat(descriptor, &removedMetadata) == 0,
          repairStorageSameVnode(openedMetadata, removedMetadata),
          removedMetadata.st_nlink == 0,
          absentStatus != 0,
          absentError == ENOENT else {
        throw repairFailure("The exact partial LaunchDaemon definition removal was not proven.")
    }
    guard fsync(parentDescriptor) == 0 else {
        throw posixFailure("sync fixed LaunchDaemon parent directory", parent)
    }
}
