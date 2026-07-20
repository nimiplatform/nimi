import Darwin
import Foundation

#if NIMI_PLATFORM_XATTR_STANDALONE_TESTS
@main
private struct PlatformManagedXattrStandaloneTests {
    static func main() throws {
        let count = try runMacOSPlatformManagedXattrNativeTests()
        print(
            "{\"status\":\"passed\",\"suite\":\"macos-platform-managed-xattr-native\",\"tests\":\(count)}"
        )
    }
}
#endif

func runMacOSPlatformManagedXattrNativeTests() throws -> Int {
    try testPlatformManagedXattrAbsentAndPresentAreStable()
    try testPlatformManagedXattrTamperFailsClosed()
    try testUnknownPlatformXattrFailsClosed()
    try testObserverAcceptsClosedNodeLocalStream()
    return 4
}

private struct PlatformManagedXattrNativeFailure: Error {
    let probe: String
    let state: String
    let returnCode: Int32?
}

private enum PlatformManagedXattrNativeAssertion: Error {
    case failed(String)
}

private func testPlatformManagedXattrAbsentAndPresentAreStable() throws {
    try withPlatformManagedXattrFixture { descriptor in
        let absent = try platformManagedXattrObservation(
            descriptor, probe: "absent"
        )
        try requirePlatformManagedNonAuthorizingXattrsStable(
            absent,
            current: platformManagedXattrObservation(
                descriptor, probe: "absent-current"
            ),
            probe: "absent-boundary",
            failure: platformManagedXattrFailure
        )

        try setPlatformManagedXattr(
            descriptor,
            name: "com.apple.provenance",
            value: Data("opaque-platform-bytes".utf8)
        )
        let present = try platformManagedXattrObservation(
            descriptor, probe: "present"
        )
        try requirePlatformManagedNonAuthorizingXattrsStable(
            present,
            current: platformManagedXattrObservation(
                descriptor, probe: "present-current"
            ),
            probe: "present-boundary",
            failure: platformManagedXattrFailure
        )
    }
}

private func testPlatformManagedXattrTamperFailsClosed() throws {
    let before = PlatformManagedNonAuthorizingXattrObservation(
        values: ["com.apple.provenance": Data("before".utf8)]
    )
    let after = PlatformManagedNonAuthorizingXattrObservation(
        values: ["com.apple.provenance": Data("after".utf8)]
    )
    try requirePlatformManagedXattrFailure(
        state: "platform-xattr-observation-changed"
    ) {
        try requirePlatformManagedNonAuthorizingXattrsStable(
            before,
            current: after,
            probe: "tamper-boundary",
            failure: platformManagedXattrFailure
        )
    }
}

private func testUnknownPlatformXattrFailsClosed() throws {
    try withPlatformManagedXattrFixture { descriptor in
        try setPlatformManagedXattr(
            descriptor,
            name: "com.nimi.unknown-test-xattr",
            value: Data("unknown".utf8)
        )
        try requirePlatformManagedXattrFailure(
            state: "xattr-name-set-oversized",
            alternateState: "unknown-or-missing-xattr"
        ) {
            _ = try platformManagedXattrObservation(
                descriptor, probe: "unknown"
            )
        }
    }
}

private func testObserverAcceptsClosedNodeLocalStream() throws {
    var descriptors = [Int32](repeating: -1, count: 2)
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0 else {
        throw PlatformManagedXattrNativeFailure(
            probe: "observer-stdin-socketpair",
            state: "failed",
            returnCode: errno
        )
    }
    let originalStdin = dup(STDIN_FILENO)
    guard originalStdin >= 0 else {
        close(descriptors[0])
        close(descriptors[1])
        throw PlatformManagedXattrNativeFailure(
            probe: "observer-stdin-duplicate",
            state: "failed",
            returnCode: errno
        )
    }
    defer {
        _ = dup2(originalStdin, STDIN_FILENO)
        close(originalStdin)
    }
    guard close(descriptors[1]) == 0,
          dup2(descriptors[0], STDIN_FILENO) == STDIN_FILENO else {
        close(descriptors[0])
        throw PlatformManagedXattrNativeFailure(
            probe: "observer-stdin-map",
            state: "failed",
            returnCode: errno
        )
    }
    close(descriptors[0])
    try requirePlatformManagedNonAuthorizingXattrObserverEmptyInput()
}

private func platformManagedXattrObservation(
    _ descriptor: Int32,
    probe: String
) throws -> PlatformManagedNonAuthorizingXattrObservation {
    try observePlatformManagedNonAuthorizingXattrs(
        descriptor: descriptor,
        expectedNimiNames: [],
        probe: probe,
        failure: platformManagedXattrFailure
    )
}

private func platformManagedXattrFailure(
    _ probe: String,
    _ state: String,
    _ returnCode: Int32?
) -> Error {
    PlatformManagedXattrNativeFailure(
        probe: probe,
        state: state,
        returnCode: returnCode
    )
}

private func requirePlatformManagedXattrFailure(
    state: String,
    alternateState: String? = nil,
    _ operation: () throws -> Void
) throws {
    do {
        try operation()
        throw PlatformManagedXattrNativeAssertion.failed(
            "expected platform-managed xattr failure \(state)"
        )
    } catch let error as PlatformManagedXattrNativeFailure {
        guard error.state == state || error.state == alternateState else {
            throw PlatformManagedXattrNativeAssertion.failed(
                "unexpected platform-managed xattr failure \(error.state)"
            )
        }
    }
}

private func withPlatformManagedXattrFixture(
    _ operation: (Int32) throws -> Void
) throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
        "nimi-platform-xattr-\(UUID().uuidString.lowercased())",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("fixture")
    guard FileManager.default.createFile(
        atPath: file.path,
        contents: Data("fixture".utf8)
    ) else {
        throw PlatformManagedXattrNativeAssertion.failed(
            "create xattr fixture"
        )
    }
    let descriptor = open(file.path, O_RDWR | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else {
        throw PlatformManagedXattrNativeFailure(
            probe: "fixture-open",
            state: "failed",
            returnCode: errno
        )
    }
    defer { close(descriptor) }
    try operation(descriptor)
}

private func setPlatformManagedXattr(
    _ descriptor: Int32,
    name: String,
    value: Data
) throws {
    let result = name.withCString { key in
        value.withUnsafeBytes {
            fsetxattr(
                descriptor,
                key,
                $0.baseAddress,
                $0.count,
                0,
                0
            )
        }
    }
    guard result == 0 else {
        throw PlatformManagedXattrNativeFailure(
            probe: "fixture-setxattr",
            state: "failed",
            returnCode: errno
        )
    }
}
