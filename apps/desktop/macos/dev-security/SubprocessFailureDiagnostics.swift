import Foundation

/// Preserves the authority-admitted, non-sensitive child-quiescence witness
/// while a low-level fixed-command failure is assigned a domain-specific
/// Runtime principal reason code.
func principalSubprocessFailureDetails(
    _ base: [String: Any],
    failure: DevSecurityFailure
) -> [String: Any] {
    var result = base
    for key in [
        "return_code", "verifier_pid", "timeout_seconds", "sent_sigkill", "child_reaped",
    ] {
        if let value = failure.details?[key] { result[key] = value }
    }
    return result
}
