import Darwin
import Foundation

struct RuntimeAccountCreationPlan {
    let identifier: UInt32
    let groupGeneratedUID: String
    let userGeneratedUID: String
}

let runtimeAccountName = "_nimiruntimedev"
let runtimeHomeDirectory = "/var/empty"
let runtimeLoginShell = "/usr/bin/false"
let runtimeDirectoryCacheResetExecutable = "/usr/bin/odutil"
let runtimeLegacyRepairInvocationDeadline = generatedRuntimeLegacyRepairInvocationDeadline
let launchDaemonLabel = generatedLaunchDaemonLabel
let runtimePrincipalCarrierContractVersion = generatedRuntimePrincipalCarrierContractVersion
let runtimeNormalRepairSourcePrincipalCarrierContractVersion = generatedRuntimeNormalRepairSourcePrincipalCarrierContractVersion
let runtimeLegacyRepairSourcePrincipalCarrierContractVersion = generatedRuntimeLegacyRepairSourcePrincipalCarrierContractVersion
let helperInstallPath = "/private/tmp/nimi-native-tests-final-helper-\(getpid())"
let bootstrapHelperInstallPath = "/private/tmp/nimi-native-tests-bootstrap-helper-\(getpid())"

struct DevSecurityFailure: Error {
    let reasonCode: String
    let actionHint: String
    let message: String
    let details: [String: Any]?
}

func fail(
    _ reasonCode: String,
    _ actionHint: String,
    _ message: String,
    details: [String: Any]? = nil
) -> DevSecurityFailure {
    DevSecurityFailure(
        reasonCode: reasonCode,
        actionHint: actionHint,
        message: message,
        details: details
    )
}

func repairFailure(_ message: String) -> DevSecurityFailure {
    fail(
        "runtime-service-repair-required",
        "inspect the exact partial-install repair boundary",
        message
    )
}

func principalDiagnosticFailure(
    _ reasonCode: String,
    _ actionHint: String,
    _ message: String,
    details: [String: Any]
) -> DevSecurityFailure {
    DevSecurityFailure(
        reasonCode: reasonCode,
        actionHint: actionHint,
        message: message,
        details: details
    )
}

func requireTrustedCommandHome(_ path: String) throws {
    guard path == "/var/empty" else {
        throw fail(
            "runtime-service-repair-required",
            "use the native test fixed command home",
            "The native test requested an untrusted command home."
        )
    }
}

func posixFailure(_ operation: String, _ path: String) -> DevSecurityFailure {
    let diagnostic = String(cString: strerror(errno))
    return fail(
        "runtime-service-repair-required",
        "inspect the native fixed-command test boundary",
        "\(operation) failed for \(path): \(diagnostic)"
    )
}
