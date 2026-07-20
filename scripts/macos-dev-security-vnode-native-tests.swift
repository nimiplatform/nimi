import Darwin
import Foundation
import Security

private struct StableVnodeNativeTestFailure: Error {
    let message: String
}

private struct StableVnodeNativeInjectedFailure: Error {}

func runMacOSDevSecurityStableVnodeNativeTests() throws -> Int {
    try testStableExecutableVnodeAcceptsUnchangedFile()
    try testStableExecutableVnodeRejectsWrite()
    try testStableExecutableVnodeRejectsRenameAndRestore()
    try testMutationLockWitnessRejectsDifferentExecutableVnode()
    try testStableMutationLockRejectsRenameAndRestore()
    try testStableMutationLockAcceptsSelfExecutionAttributeEventAfterRevalidation()
    try testStableMutationLockRejectsSelfExecutionAttributeEventWithoutRevalidation()
    try testStableVnodeEventClassificationRejectsEverySecurityRelevantFlag()
    try testStableMutationTransactionWithholdsCommitWhenRetirementFails()
    try testStableMutationTransactionWithholdsCommitWhenFinalProofDetectsReplacement()
    return 10
}

private func testStableMutationTransactionWithholdsCommitWhenRetirementFails() throws {
    try withStableVnodeFixture { path, owner, group in
        var committed = false
        do {
            _ = try withStableMutationLockVnodeTransaction(
                path: path,
                owner: owner,
                group: group,
                requireExecutable: true,
                requireStableNamedVnodeAtExit: true
            ) { _ in
                StableMutationLockTerminalCommit(
                    beforeFinalProof: { throw StableVnodeNativeInjectedFailure() },
                    commit: {
                        committed = true
                        return "forbidden"
                    }
                )
            }
            throw StableVnodeNativeTestFailure(message: "a retirement failure reached terminal commit")
        } catch is StableVnodeNativeInjectedFailure {}
        try stableVnodeRequire(
            !committed,
            "a bootstrap-retirement failure must preserve the journal-owned boundary and withhold terminal commit"
        )
    }
}

private func testStableMutationTransactionWithholdsCommitWhenFinalProofDetectsReplacement() throws {
    try withStableVnodeFixture { path, owner, group in
        let backup = "\(path).terminal-renamed"
        var committed = false
        do {
            _ = try withStableMutationLockVnodeTransaction(
                path: path,
                owner: owner,
                group: group,
                requireExecutable: true,
                requireStableNamedVnodeAtExit: true
            ) { _ in
                StableMutationLockTerminalCommit(
                    beforeFinalProof: {
                        guard rename(path, backup) == 0, rename(backup, path) == 0 else {
                            throw StableVnodeNativeTestFailure(message: "rename terminal-proof fixture")
                        }
                    },
                    commit: {
                        committed = true
                        return "forbidden"
                    }
                )
            }
            throw StableVnodeNativeTestFailure(message: "a failed final vnode proof reached terminal commit")
        } catch let failure as DevSecurityFailure {
            if FileManager.default.fileExists(atPath: backup),
               !FileManager.default.fileExists(atPath: path) {
                _ = rename(backup, path)
            }
            let state = failure.details?["state"] as? String
            let eventNames = failure.details?["vnode_event_names"] as? String
            try stableVnodeRequire(
                failure.reasonCode == "runtime-service-untrusted"
                    && (state == "opened-or-named-vnode-changed"
                        || eventNames?.contains("NOTE_RENAME") == true),
                "the final proof must retain either the exact metadata divergence or the observed replacement event"
            )
        }
        try stableVnodeRequire(
            !committed,
            "a final vnode replacement proof failure must withhold terminal journal unlink"
        )
    }
}

private func testStableMutationLockAcceptsSelfExecutionAttributeEventAfterRevalidation() throws {
    try withStableMachOFixture { path, owner, group in
        var processExecuted = false
        var postExecutionRevalidations = 0
        _ = try withStableMutationLockVnode(
            path: path,
            owner: owner,
            group: group,
            requireExecutable: true,
            requireStableNamedVnodeAtExit: true,
            attributeEventRevalidator: { lockWitness in
                try requireValidStaticMachO(at: path)
                let executableWitness = try withStableExecutableVnode(
                    path: path,
                    owner: owner,
                    group: group,
                    mode: 0o700
                ) { $0 }
                try stableVnodeRequire(
                    mutationLockWitnessMatchesExecutableVnode(lockWitness, executableWitness),
                    "a pure attribute event must retain the exact opened-vnode and SHA-256 witness"
                )
                if processExecuted { postExecutionRevalidations += 1 }
            }
        ) { _ in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: path)
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run()
            process.waitUntilExit()
            try stableVnodeRequire(
                process.terminationReason == .exit && process.terminationStatus == 0,
                "the exact Mach-O self-execution fixture must exit successfully"
            )
            processExecuted = true
        }
        try stableVnodeRequire(
            postExecutionRevalidations > 0,
            "executing the exact unchanged Mach-O must expose NOTE_ATTRIB and force full identity revalidation"
        )
    }
}

private func testStableMutationLockRejectsSelfExecutionAttributeEventWithoutRevalidation() throws {
    try withStableMachOFixture { path, owner, group in
        do {
            _ = try withStableMutationLockVnode(
                path: path,
                owner: owner,
                group: group,
                requireExecutable: true,
                requireStableNamedVnodeAtExit: true
            ) { _ in
                let process = Process()
                process.executableURL = URL(fileURLWithPath: path)
                process.standardInput = FileHandle.nullDevice
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                try process.run()
                process.waitUntilExit()
                try stableVnodeRequire(process.terminationStatus == 0, "the negative self-execution fixture must run")
            }
            throw StableVnodeNativeTestFailure(
                message: "a pure attribute event was accepted without an admitted identity revalidator"
            )
        } catch let failure as DevSecurityFailure {
            try stableVnodeRequire(
                failure.reasonCode == "runtime-service-untrusted"
                    && failure.details?["vnode_event_names"] as? String == "NOTE_ATTRIB"
                    && failure.details?["vnode_event_flags"] as? Int == Int(NOTE_ATTRIB)
                    && failure.details?["kevent_event_flags"] as? Int != nil,
                "NOTE_ATTRIB without a full identity revalidator must fail with exact kevent flags, vnode fflags, and name"
            )
        }
    }
}

private func testStableVnodeEventClassificationRejectsEverySecurityRelevantFlag() throws {
    let hardVnodeFlags: [(UInt32, String)] = [
        (UInt32(NOTE_DELETE), "NOTE_DELETE"),
        (UInt32(NOTE_WRITE), "NOTE_WRITE"),
        (UInt32(NOTE_EXTEND), "NOTE_EXTEND"),
        (UInt32(NOTE_LINK), "NOTE_LINK"),
        (UInt32(NOTE_RENAME), "NOTE_RENAME"),
        (UInt32(NOTE_REVOKE), "NOTE_REVOKE"),
    ]
    for (flag, name) in hardVnodeFlags {
        let event = StableVnodeEventObservation(eventFlags: 0, vnodeFlags: flag)
        try stableVnodeRequire(
            !stableVnodeEventIsAttributeOnly(event) && event.names == name,
            "\(name) must remain a hard-rejected and exactly named vnode event"
        )
    }
    for (flag, name) in [(UInt16(EV_ERROR), "EV_ERROR"), (UInt16(EV_EOF), "EV_EOF")] {
        let event = StableVnodeEventObservation(
            eventFlags: flag,
            vnodeFlags: UInt32(NOTE_ATTRIB)
        )
        try stableVnodeRequire(
            !stableVnodeEventIsAttributeOnly(event) && event.names.contains(name),
            "\(name) must hard-reject even when NOTE_ATTRIB is also present"
        )
    }
}

private func testMutationLockWitnessRejectsDifferentExecutableVnode() throws {
    try withStableVnodeFixture { path, owner, group in
        let otherPath = "\(path).other"
        try persistStableVnodeFixture(at: otherPath)
        try withStableMutationLockVnode(
            path: path,
            owner: owner,
            group: group,
            requireExecutable: true,
            requireStableNamedVnodeAtExit: true
        ) { lockWitness in
            let otherWitness = try withStableExecutableVnode(
                path: otherPath,
                owner: owner,
                group: group,
                mode: 0o700,
                maximumSize: 4096
            ) { $0 }
            try stableVnodeRequire(
                !mutationLockWitnessMatchesExecutableVnode(lockWitness, otherWitness),
                "a different executable vnode must not match the transaction lock witness"
            )
        }
    }
}

private func testStableMutationLockRejectsRenameAndRestore() throws {
    try withStableVnodeFixture { path, owner, group in
        let backup = "\(path).mutation-lock-renamed"
        do {
            _ = try withStableMutationLockVnode(
                path: path,
                owner: owner,
                group: group,
                requireExecutable: true,
                requireStableNamedVnodeAtExit: true
            ) { _ in
                guard rename(path, backup) == 0, rename(backup, path) == 0 else {
                    throw StableVnodeNativeTestFailure(message: "rename mutation-lock fixture")
                }
            }
            throw StableVnodeNativeTestFailure(
                message: "a mutation-lock rename-and-restore sequence was accepted"
            )
        } catch let failure as DevSecurityFailure {
            if FileManager.default.fileExists(atPath: backup),
               !FileManager.default.fileExists(atPath: path) {
                _ = rename(backup, path)
            }
            try stableVnodeRequire(
                failure.reasonCode == "runtime-service-untrusted"
                    && failure.details?["probe"] as? String
                        == "source-helper-mutation-lock-vnode",
                "transaction-wide named-path replacement must fail as an untrusted lock witness"
            )
        }
    }
}

private func testStableExecutableVnodeAcceptsUnchangedFile() throws {
    try withStableVnodeFixture { path, owner, group in
        let witness = try withStableExecutableVnode(
            path: path,
            owner: owner,
            group: group,
            mode: 0o700,
            maximumSize: 4096
        ) { $0 }
        try stableVnodeRequire(
            witness.size == 16 && witness.sha256.count == 64,
            "an unchanged opened executable must produce one bounded SHA-256 witness"
        )
    }
}

private func testStableExecutableVnodeRejectsWrite() throws {
    try withStableVnodeFixture { path, owner, group in
        do {
            _ = try withStableExecutableVnode(
                path: path,
                owner: owner,
                group: group,
                mode: 0o700,
                maximumSize: 4096
            ) { _ in
                let descriptor = open(path, O_WRONLY | O_APPEND | O_CLOEXEC | O_NOFOLLOW)
                guard descriptor >= 0 else { throw StableVnodeNativeTestFailure(message: "open write fixture") }
                defer { close(descriptor) }
                var byte: UInt8 = 0x78
                guard Darwin.write(descriptor, &byte, 1) == 1, fsync(descriptor) == 0 else {
                    throw StableVnodeNativeTestFailure(message: "write fixture")
                }
            }
            throw StableVnodeNativeTestFailure(message: "a write to the opened vnode was accepted")
        } catch let failure as DevSecurityFailure {
            try stableVnodeRequire(
                failure.reasonCode == "runtime-service-untrusted",
                "opened-vnode mutation must fail as untrusted"
            )
        }
    }
}

private func testStableExecutableVnodeRejectsRenameAndRestore() throws {
    try withStableVnodeFixture { path, owner, group in
        let backup = "\(path).renamed"
        do {
            _ = try withStableExecutableVnode(
                path: path,
                owner: owner,
                group: group,
                mode: 0o700,
                maximumSize: 4096
            ) { _ in
                guard rename(path, backup) == 0, rename(backup, path) == 0 else {
                    throw StableVnodeNativeTestFailure(message: "rename fixture")
                }
            }
            throw StableVnodeNativeTestFailure(message: "a rename-and-restore sequence was accepted")
        } catch let failure as DevSecurityFailure {
            if FileManager.default.fileExists(atPath: backup),
               !FileManager.default.fileExists(atPath: path) {
                _ = rename(backup, path)
            }
            try stableVnodeRequire(
                failure.reasonCode == "runtime-service-untrusted",
                "rename-and-restore must fail as untrusted even when final bytes match"
            )
        }
    }
}

private func withStableVnodeFixture(
    _ operation: (String, uid_t, gid_t) throws -> Void
) throws {
    let root = "/private/tmp/nimi-stable-vnode-native-\(UUID().uuidString.lowercased())"
    guard mkdir(root, 0o700) == 0 else {
        throw StableVnodeNativeTestFailure(message: "create fixture directory")
    }
    defer { try? FileManager.default.removeItem(atPath: root) }
    let path = "\(root)/helper"
    try persistStableVnodeFixture(at: path)
    var parentMetadata = stat()
    var fileMetadata = stat()
    guard lstat(root, &parentMetadata) == 0,
          lstat(path, &fileMetadata) == 0,
          parentMetadata.st_uid == fileMetadata.st_uid,
          parentMetadata.st_gid == fileMetadata.st_gid else {
        throw StableVnodeNativeTestFailure(message: "inspect fixture ownership")
    }
    try operation(path, parentMetadata.st_uid, parentMetadata.st_gid)
}

private func withStableMachOFixture(
    _ operation: (String, uid_t, gid_t) throws -> Void
) throws {
    let root = "/private/tmp/nimi-stable-macho-native-\(UUID().uuidString.lowercased())"
    guard mkdir(root, 0o700) == 0 else {
        throw StableVnodeNativeTestFailure(message: "create Mach-O fixture directory")
    }
    defer { try? FileManager.default.removeItem(atPath: root) }
    let path = "\(root)/helper"
    try FileManager.default.copyItem(atPath: "/usr/bin/true", toPath: path)
    guard chmod(path, 0o700) == 0 else {
        throw StableVnodeNativeTestFailure(message: "set Mach-O fixture mode")
    }
    var parentMetadata = stat()
    var fileMetadata = stat()
    guard lstat(root, &parentMetadata) == 0,
          lstat(path, &fileMetadata) == 0,
          parentMetadata.st_uid == fileMetadata.st_uid,
          parentMetadata.st_gid == fileMetadata.st_gid else {
        throw StableVnodeNativeTestFailure(message: "inspect Mach-O fixture ownership")
    }
    try requireValidStaticMachO(at: path)
    try operation(path, parentMetadata.st_uid, parentMetadata.st_gid)
}

private func requireValidStaticMachO(at path: String) throws {
    var code: SecStaticCode?
    let createStatus = SecStaticCodeCreateWithPath(
        URL(fileURLWithPath: path) as CFURL,
        SecCSFlags(),
        &code
    )
    guard createStatus == errSecSuccess, let code else {
        throw StableVnodeNativeTestFailure(message: "create static-code fixture witness")
    }
    let validityStatus = SecStaticCodeCheckValidity(
        code,
        SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures),
        nil
    )
    guard validityStatus == errSecSuccess else {
        throw StableVnodeNativeTestFailure(message: "validate static-code fixture witness")
    }
}

private func persistStableVnodeFixture(at path: String) throws {
    let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o700)
    guard descriptor >= 0 else { throw StableVnodeNativeTestFailure(message: "create fixture file") }
    var bytes = Array("stable-vnode-v1\n".utf8)
    let written = bytes.withUnsafeMutableBytes { buffer in
        Darwin.write(descriptor, buffer.baseAddress, buffer.count)
    }
    let syncStatus = fsync(descriptor)
    let closeStatus = close(descriptor)
    guard written == bytes.count, syncStatus == 0, closeStatus == 0 else {
        throw StableVnodeNativeTestFailure(message: "persist fixture file")
    }
}

private func stableVnodeRequire(
    _ condition: @autoclosure () -> Bool,
    _ message: String
) throws {
    if !condition() { throw StableVnodeNativeTestFailure(message: message) }
}
