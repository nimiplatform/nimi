import CryptoKit
import Darwin
import Foundation

private let maximumPOSIXIdentityLookupBufferSize = 1_048_576
private let defaultPOSIXIdentityLookupBufferSize = 16_384

private func initialPOSIXIdentityLookupBufferSize(_ selector: Int32) -> Int {
    let suggested = sysconf(selector)
    guard suggested > 0 else { return defaultPOSIXIdentityLookupBufferSize }
    return min(max(Int(suggested), defaultPOSIXIdentityLookupBufferSize), maximumPOSIXIdentityLookupBufferSize)
}

private func nextPOSIXIdentityLookupBufferSize(_ current: Int, returnCode: Int32) -> Int? {
    guard returnCode == ERANGE, current < maximumPOSIXIdentityLookupBufferSize else { return nil }
    return min(current * 2, maximumPOSIXIdentityLookupBufferSize)
}

func lookupPOSIXUser(name: String, target: POSIXIdentityProjectionTarget) -> POSIXIdentityLookupResult {
    name.withCString { namePointer in
        lookupPOSIXUser(target: target, selector: _SC_GETPW_R_SIZE_MAX) { entry, buffer, count, result in
            getpwnam_r(namePointer, entry, buffer, count, result)
        }
    }
}

func lookupPOSIXUser(uid: uid_t, target: POSIXIdentityProjectionTarget) -> POSIXIdentityLookupResult {
    lookupPOSIXUser(target: target, selector: _SC_GETPW_R_SIZE_MAX) { entry, buffer, count, result in
        getpwuid_r(uid, entry, buffer, count, result)
    }
}

private func lookupPOSIXUser(
    target: POSIXIdentityProjectionTarget,
    selector: Int32,
    call: (
        UnsafeMutablePointer<passwd>,
        UnsafeMutablePointer<CChar>,
        Int,
        UnsafeMutablePointer<UnsafeMutablePointer<passwd>?>
    ) -> Int32
) -> POSIXIdentityLookupResult {
    var bufferSize = initialPOSIXIdentityLookupBufferSize(selector)
    while true {
        var entry = passwd()
        var result: UnsafeMutablePointer<passwd>?
        var buffer = [CChar](repeating: 0, count: bufferSize)
        let lookup = buffer.withUnsafeMutableBufferPointer { storage -> POSIXIdentityLookupResult in
            withUnsafeMutablePointer(to: &entry) { entryPointer in
                withUnsafeMutablePointer(to: &result) { resultPointer -> POSIXIdentityLookupResult in
                    let returnCode = call(entryPointer, storage.baseAddress!, storage.count, resultPointer)
                    guard returnCode == 0, let record = resultPointer.pointee else {
                        return POSIXIdentityLookupResult(returnCode: returnCode, observed: nil)
                    }
                    return POSIXIdentityLookupResult(
                        returnCode: 0,
                        observed: .user(POSIXUserLookupProjection(
                            nameSHA256: posixIdentityCStringSHA256(record.pointee.pw_name),
                            uid: UInt32(record.pointee.pw_uid),
                            primaryGID: UInt32(record.pointee.pw_gid),
                            homeDirectoryMatches: posixIdentityCStringEquals(record.pointee.pw_dir, target.homeDirectory),
                            loginShellMatches: posixIdentityCStringEquals(record.pointee.pw_shell, target.loginShell)
                        ))
                    )
                }
            }
        }
        if let next = nextPOSIXIdentityLookupBufferSize(bufferSize, returnCode: lookup.returnCode) {
            bufferSize = next
            continue
        }
        return lookup
    }
}

func lookupPOSIXGroup(name: String) -> POSIXIdentityLookupResult {
    name.withCString { namePointer in
        lookupPOSIXGroup(selector: _SC_GETGR_R_SIZE_MAX) { entry, buffer, count, result in
            getgrnam_r(namePointer, entry, buffer, count, result)
        }
    }
}

func lookupPOSIXGroup(gid: gid_t) -> POSIXIdentityLookupResult {
    lookupPOSIXGroup(selector: _SC_GETGR_R_SIZE_MAX) { entry, buffer, count, result in
        getgrgid_r(gid, entry, buffer, count, result)
    }
}

private func lookupPOSIXGroup(
    selector: Int32,
    call: (
        UnsafeMutablePointer<group>,
        UnsafeMutablePointer<CChar>,
        Int,
        UnsafeMutablePointer<UnsafeMutablePointer<group>?>
    ) -> Int32
) -> POSIXIdentityLookupResult {
    var bufferSize = initialPOSIXIdentityLookupBufferSize(selector)
    while true {
        var entry = group()
        var result: UnsafeMutablePointer<group>?
        var buffer = [CChar](repeating: 0, count: bufferSize)
        let lookup = buffer.withUnsafeMutableBufferPointer { storage -> POSIXIdentityLookupResult in
            withUnsafeMutablePointer(to: &entry) { entryPointer in
                withUnsafeMutablePointer(to: &result) { resultPointer -> POSIXIdentityLookupResult in
                    let returnCode = call(entryPointer, storage.baseAddress!, storage.count, resultPointer)
                    guard returnCode == 0, let record = resultPointer.pointee else {
                        return POSIXIdentityLookupResult(returnCode: returnCode, observed: nil)
                    }
                    return POSIXIdentityLookupResult(
                        returnCode: 0,
                        observed: .group(POSIXGroupLookupProjection(
                            nameSHA256: posixIdentityCStringSHA256(record.pointee.gr_name),
                            gid: UInt32(record.pointee.gr_gid)
                        ))
                    )
                }
            }
        }
        if let next = nextPOSIXIdentityLookupBufferSize(bufferSize, returnCode: lookup.returnCode) {
            bufferSize = next
            continue
        }
        return lookup
    }
}

private func posixIdentityCStringSHA256(_ value: UnsafePointer<CChar>?) -> String {
    guard let value else { return posixIdentitySHA256(Data()) }
    return posixIdentitySHA256(Data(bytes: value, count: strlen(value)))
}

private func posixIdentityCStringEquals(_ value: UnsafePointer<CChar>?, _ expected: String) -> Bool {
    guard let value else { return false }
    return expected.withCString { expectedPointer in strcmp(value, expectedPointer) == 0 }
}

func posixIdentitySHA256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func stablePOSIXProjectionDigest(_ probes: [POSIXIdentityProbeDiagnostic]) -> String {
    let canonical = probes.map { probe in
        [
            probe.probe.rawValue,
            probe.api,
            probe.state.rawValue,
            String(probe.returnCode),
            probe.errorName ?? "-",
            probe.expectedNameSHA256,
            probe.observedNameSHA256 ?? "-",
            String(probe.expectedIdentifier),
            probe.observedUID.map(String.init) ?? "-",
            probe.observedGID.map(String.init) ?? "-",
            probe.supplementalAttributesMatch.map { $0 ? "true" : "false" } ?? "-",
        ].joined(separator: "\u{1f}")
    }.joined(separator: "\n")
    return posixIdentitySHA256(Data(canonical.utf8))
}

func posixIdentityErrorName(_ code: Int32) -> String {
    switch code {
    case E2BIG: return "E2BIG"
    case EACCES: return "EACCES"
    case EAGAIN: return "EAGAIN"
    case EBADF: return "EBADF"
    case EFAULT: return "EFAULT"
    case EINTR: return "EINTR"
    case EINVAL: return "EINVAL"
    case EIO: return "EIO"
    case ENOENT: return "ENOENT"
    case ENOMEM: return "ENOMEM"
    case EPERM: return "EPERM"
    case ERANGE: return "ERANGE"
    case ESRCH: return "ESRCH"
    case ETIMEDOUT: return "ETIMEDOUT"
    default: return "ERRNO_\(code)"
    }
}
