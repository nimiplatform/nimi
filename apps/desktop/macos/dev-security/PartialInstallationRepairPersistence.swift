import Darwin
import Foundation

struct PartialInstallRepairPersistenceInterruption: Error, Equatable {
    let boundary: PartialInstallRepairJournalCrashPoint
}

struct PartialInstallRepairJournalPersistence {
    typealias FailureFactory = (_ probe: String, _ state: String, _ message: String) -> Error
    typealias POSIXFailureFactory = (_ operation: String, _ path: String, _ errorCode: Int32) -> Error
    typealias BoundaryHook = (_ boundary: PartialInstallRepairJournalCrashPoint) throws -> Void

    let parentPath: String
    let journalName: String
    let stagingName: String
    let owner: uid_t
    let group: gid_t
    let parentMode: mode_t
    let fileMode: mode_t
    let maximumSize: Int
    let failure: FailureFactory
    let posixFailure: POSIXFailureFactory

    func contains(_ name: String) throws -> Bool {
        let parentDescriptor = try openParent()
        defer { close(parentDescriptor) }
        return try entryMetadata(parentDescriptor: parentDescriptor, name: name) != nil
    }

    func recoverInterruptedWrite() throws {
        let parentDescriptor = try openParent()
        defer { close(parentDescriptor) }
        guard let staging = try openValidatedFile(
            parentDescriptor: parentDescriptor,
            name: stagingName,
            required: false
        ) else { return }
        defer { close(staging.descriptor) }
        try requirePathStillNamesOpenedVnode(
            parentDescriptor: parentDescriptor,
            name: stagingName,
            descriptorMetadata: staging.metadata
        )
        let unlinkStatus = stagingName.withCString { unlinkat(parentDescriptor, $0, 0) }
        guard unlinkStatus == 0 else {
            throw posixFailure("remove exact interrupted journal staging", path(stagingName), errno)
        }
        guard try entryMetadata(parentDescriptor: parentDescriptor, name: stagingName) == nil else {
            throw failure("journal-staging-recovery", "entry-remains-after-unlink", "The interrupted journal staging entry remains after unlinkat.")
        }
        var removedMetadata = stat()
        guard fstat(staging.descriptor, &removedMetadata) == 0,
              sameVnode(staging.metadata, removedMetadata),
              removedMetadata.st_nlink == 0 else {
            throw failure("journal-staging-recovery", "unlinked-vnode-unproven", "The unlinked journal staging node was not the validated opened vnode.")
        }
        try syncParent(parentDescriptor)
    }

    func writeAtomically(
        _ data: Data,
        validateExisting: (Data) throws -> Void,
        boundaryHook: BoundaryHook = { _ in }
    ) throws {
        guard !data.isEmpty, data.count <= maximumSize else {
            throw failure("journal-size", "write-size-invalid", "The journal exceeds its admitted write budget.")
        }
        let parentDescriptor = try openParent()
        defer { close(parentDescriptor) }
        guard try entryMetadata(parentDescriptor: parentDescriptor, name: stagingName) == nil else {
            throw failure("journal-staging", "preexisting", "The fixed journal staging path is not clean before a write.")
        }
        let existing = try openAndValidateExistingJournal(parentDescriptor, validate: validateExisting)
        defer { if let existing { close(existing.descriptor) } }

        let descriptor = stagingName.withCString {
            openat(parentDescriptor, $0, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, fileMode)
        }
        guard descriptor >= 0 else { throw posixFailure("create journal staging", path(stagingName), errno) }
        var descriptorOpen = true
        defer { if descriptorOpen { close(descriptor) } }
        do {
            try boundaryHook(.stagingCreated)
            try writeAll(data, descriptor: descriptor)
            try boundaryHook(.stagingBytesWritten)
            guard fchown(descriptor, owner, group) == 0,
                  fchmod(descriptor, fileMode) == 0,
                  fsync(descriptor) == 0 else {
                throw posixFailure("secure and sync journal staging", path(stagingName), errno)
            }
            try boundaryHook(.stagingFileSynced)
            var descriptorMetadata = stat()
            guard fstat(descriptor, &descriptorMetadata) == 0 else {
                throw posixFailure("inspect written journal staging vnode", path(stagingName), errno)
            }
            try requireSecureFileMetadata(descriptorMetadata, expectedSize: data.count)
            try requirePathStillNamesOpenedVnode(
                parentDescriptor: parentDescriptor,
                name: stagingName,
                descriptorMetadata: descriptorMetadata
            )
            try boundaryHook(.beforeRename)
            try requirePathStillNamesOpenedVnode(
                parentDescriptor: parentDescriptor,
                name: stagingName,
                descriptorMetadata: descriptorMetadata
            )
            if let existing {
                try requirePathStillNamesOpenedVnode(
                    parentDescriptor: parentDescriptor,
                    name: journalName,
                    descriptorMetadata: existing.metadata
                )
            } else if try entryMetadata(parentDescriptor: parentDescriptor, name: journalName) != nil {
                throw failure("journal-commit", "destination-appeared", "A journal destination appeared after the absence proof.")
            }
            let renameStatus = stagingName.withCString { staging in
                journalName.withCString { journal in
                    renameat(parentDescriptor, staging, parentDescriptor, journal)
                }
            }
            guard renameStatus == 0 else { throw posixFailure("commit journal", path(journalName), errno) }
            try boundaryHook(.afterRenameBeforeDirectorySync)
            guard let committedMetadata = try entryMetadata(
                parentDescriptor: parentDescriptor,
                name: journalName
            ), sameVnode(descriptorMetadata, committedMetadata) else {
                throw failure("journal-commit", "committed-vnode-mismatch", "The committed journal path does not name the fsynced staging vnode.")
            }
            guard try entryMetadata(parentDescriptor: parentDescriptor, name: stagingName) == nil else {
                throw failure("journal-commit", "staging-remains-after-rename", "The journal staging entry remains after renameat commit.")
            }
            if let existing {
                var replacedMetadata = stat()
                guard fstat(existing.descriptor, &replacedMetadata) == 0,
                      sameVnode(existing.metadata, replacedMetadata),
                      replacedMetadata.st_nlink == 0 else {
                    throw failure("journal-commit", "replaced-vnode-unproven", "The replaced journal was not the validated opened vnode.")
                }
            }
            try syncParent(parentDescriptor)
            try boundaryHook(.journalDirectorySynced)
            guard close(descriptor) == 0 else {
                descriptorOpen = false
                throw posixFailure("close committed journal", path(journalName), errno)
            }
            descriptorOpen = false
        } catch let interruption as PartialInstallRepairPersistenceInterruption {
            if descriptorOpen {
                close(descriptor)
                descriptorOpen = false
            }
            throw interruption
        } catch {
            if descriptorOpen {
                close(descriptor)
                descriptorOpen = false
            }
            try? recoverInterruptedWrite()
            throw error
        }
    }

    func read() throws -> Data {
        let parentDescriptor = try openParent()
        defer { close(parentDescriptor) }
        guard let opened = try openValidatedFile(
            parentDescriptor: parentDescriptor,
            name: journalName,
            required: true
        ) else { throw failure("journal-file", "absent", "The journal is absent.") }
        defer { close(opened.descriptor) }
        return try readFile(
            descriptor: opened.descriptor,
            parentDescriptor: parentDescriptor,
            name: journalName,
            initialMetadata: opened.metadata
        )
    }

    func remove(
        validate: (Data) throws -> Void,
        boundaryHook: BoundaryHook = { _ in }
    ) throws {
        let parentDescriptor = try openParent()
        defer { close(parentDescriptor) }
        guard let opened = try openValidatedFile(
            parentDescriptor: parentDescriptor,
            name: journalName,
            required: true
        ) else { throw failure("journal-final-unlink", "journal-absent", "The journal is absent before exact removal.") }
        defer { close(opened.descriptor) }
        let data = try readFile(
            descriptor: opened.descriptor,
            parentDescriptor: parentDescriptor,
            name: journalName,
            initialMetadata: opened.metadata
        )
        try validate(data)
        try requirePathStillNamesOpenedVnode(
            parentDescriptor: parentDescriptor,
            name: journalName,
            descriptorMetadata: opened.metadata
        )
        let unlinkStatus = journalName.withCString { unlinkat(parentDescriptor, $0, 0) }
        guard unlinkStatus == 0 else { throw posixFailure("remove journal", path(journalName), errno) }
        try boundaryHook(.afterFinalUnlinkBeforeDirectorySync)
        guard try entryMetadata(parentDescriptor: parentDescriptor, name: journalName) == nil else {
            throw failure("journal-final-unlink", "entry-remains-after-unlink", "The journal entry remains after unlinkat.")
        }
        var removedMetadata = stat()
        guard fstat(opened.descriptor, &removedMetadata) == 0,
              sameVnode(opened.metadata, removedMetadata),
              removedMetadata.st_nlink == 0 else {
            throw failure("journal-final-unlink", "unlinked-vnode-unproven", "The unlinked journal was not the validated opened vnode.")
        }
        try syncParent(parentDescriptor)
        try boundaryHook(.finalUnlinkDirectorySynced)
    }

    private func openAndValidateExistingJournal(
        _ parentDescriptor: Int32,
        validate: (Data) throws -> Void
    ) throws -> (descriptor: Int32, metadata: stat)? {
        guard let existing = try openValidatedFile(
            parentDescriptor: parentDescriptor,
            name: journalName,
            required: false
        ) else { return nil }
        do {
            let data = try readFile(
                descriptor: existing.descriptor,
                parentDescriptor: parentDescriptor,
                name: journalName,
                initialMetadata: existing.metadata
            )
            guard !data.isEmpty else {
                throw failure("journal-size", "existing-empty", "The existing journal is empty.")
            }
            try validate(data)
        } catch {
            close(existing.descriptor)
            throw error
        }
        return existing
    }

    private func openParent() throws -> Int32 {
        let descriptor = open(parentPath, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw posixFailure("open journal parent", parentPath, errno) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              metadata.st_mode & S_IFMT == S_IFDIR,
              metadata.st_uid == owner,
              metadata.st_gid == group,
              metadata.st_mode & 0o777 == parentMode else {
            close(descriptor)
            throw failure("journal-parent", "metadata-invalid", "The journal parent is not the expected fixed directory.")
        }
        return descriptor
    }

    private func entryMetadata(parentDescriptor: Int32, name: String) throws -> stat? {
        var metadata = stat()
        let status = name.withCString { fstatat(parentDescriptor, $0, &metadata, AT_SYMLINK_NOFOLLOW) }
        if status == 0 { return metadata }
        let statusError = errno
        if statusError == ENOENT { return nil }
        errno = statusError
        throw posixFailure("inspect journal directory entry", path(name), statusError)
    }

    private func openValidatedFile(
        parentDescriptor: Int32,
        name: String,
        required: Bool
    ) throws -> (descriptor: Int32, metadata: stat)? {
        let descriptor = name.withCString {
            openat(parentDescriptor, $0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        }
        if descriptor < 0 {
            let openError = errno
            if !required, openError == ENOENT { return nil }
            errno = openError
            throw posixFailure("open journal vnode", path(name), openError)
        }
        do {
            var descriptorMetadata = stat()
            guard fstat(descriptor, &descriptorMetadata) == 0 else {
                throw posixFailure("inspect opened journal vnode", path(name), errno)
            }
            try requireSecureFileMetadata(descriptorMetadata)
            guard let namedMetadata = try entryMetadata(parentDescriptor: parentDescriptor, name: name),
                  sameVnode(descriptorMetadata, namedMetadata) else {
                throw failure("journal-file", "opened-vnode-mismatch", "The journal path no longer names its opened vnode.")
            }
            return (descriptor, descriptorMetadata)
        } catch {
            close(descriptor)
            throw error
        }
    }

    private func requireSecureFileMetadata(_ metadata: stat, expectedSize: Int? = nil) throws {
        guard metadata.st_mode & S_IFMT == S_IFREG,
              metadata.st_uid == owner,
              metadata.st_gid == group,
              metadata.st_mode & 0o777 == fileMode,
              metadata.st_nlink == 1,
              metadata.st_size >= 0,
              metadata.st_size <= maximumSize,
              expectedSize.map({ metadata.st_size == $0 }) ?? true else {
            throw failure("journal-file-metadata", "unsafe", "A journal node has unsafe file metadata.")
        }
    }

    private func readFile(
        descriptor: Int32,
        parentDescriptor: Int32,
        name: String,
        initialMetadata: stat
    ) throws -> Data {
        guard lseek(descriptor, 0, SEEK_SET) == 0 else {
            throw posixFailure("seek opened journal vnode", path(name), errno)
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = buffer.withUnsafeMutableBytes {
                Darwin.read(descriptor, $0.baseAddress, $0.count)
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw posixFailure("read opened journal vnode", path(name), errno)
            }
            if count == 0 { break }
            guard data.count + count <= maximumSize else {
                throw failure("journal-size", "read-size-invalid", "The journal exceeds its admitted read budget.")
            }
            data.append(contentsOf: buffer[0..<count])
        }
        var finalMetadata = stat()
        guard fstat(descriptor, &finalMetadata) == 0,
              sameFileSnapshot(initialMetadata, finalMetadata),
              finalMetadata.st_size == data.count else {
            throw failure("journal-file", "changed-during-read", "The opened journal vnode changed while it was read.")
        }
        try requirePathStillNamesOpenedVnode(
            parentDescriptor: parentDescriptor,
            name: name,
            descriptorMetadata: finalMetadata
        )
        return data
    }

    private func requirePathStillNamesOpenedVnode(
        parentDescriptor: Int32,
        name: String,
        descriptorMetadata: stat
    ) throws {
        guard let pathMetadata = try entryMetadata(parentDescriptor: parentDescriptor, name: name),
              sameVnode(descriptorMetadata, pathMetadata) else {
            throw failure("journal-file", "directory-entry-replaced", "The journal directory entry changed after its vnode was opened.")
        }
    }

    private func writeAll(_ data: Data, descriptor: Int32) throws {
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw posixFailure("write journal staging", path(stagingName), errno) }
                offset += count
            }
        }
    }

    private func syncParent(_ descriptor: Int32) throws {
        guard fsync(descriptor) == 0 else {
            throw posixFailure("sync journal parent directory", parentPath, errno)
        }
    }

    private func path(_ name: String) -> String { "\(parentPath)/\(name)" }

    private func sameVnode(_ left: stat, _ right: stat) -> Bool {
        left.st_dev == right.st_dev && left.st_ino == right.st_ino
    }

    private func sameFileSnapshot(_ left: stat, _ right: stat) -> Bool {
        sameVnode(left, right)
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
}
