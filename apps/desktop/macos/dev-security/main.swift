import Foundation

@main
struct NimiMacOSDevSecurityInstaller {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else {
                throw fail(
                    "macos-dev-helper-argument-invalid",
                    "select_a_documented_command",
                    "A helper command is required."
                )
            }
            switch command {
            case "status":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emit(try serviceStatus())
            case "install-candidate":
                guard arguments.count == 2 else { throw argumentFailure(command) }
                try emit(
                    try installCandidate(
                        root: URL(fileURLWithPath: arguments[1], isDirectory: true)
                    )
                )
            case "update-candidate":
                guard arguments.count == 2 else { throw argumentFailure(command) }
                try emit(
                    try updateCandidate(
                        root: URL(fileURLWithPath: arguments[1], isDirectory: true)
                    )
                )
            case "restart-service":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emit(try restartService())
            case "uninstall-service":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emit(try uninstallService())
            default:
                throw argumentFailure(command)
            }
        } catch let failure as InstallerFailure {
            var response: [String: Any] = [
                "status": "failed",
                "reasonCode": failure.reasonCode,
                "actionHint": failure.actionHint,
                "message": failure.message,
            ]
            if !failure.details.isEmpty { response["details"] = failure.details }
            try? emit(response, to: .standardError)
            exit(1)
        } catch {
            try? emit([
                "status": "failed",
                "reasonCode": "macos-dev-security-helper-failed",
                "actionHint": "inspect_the_nonsecret_helper_failure",
                "message": String(describing: error),
            ], to: .standardError)
            exit(1)
        }
    }

    private static func argumentFailure(_ command: String) -> InstallerFailure {
        fail(
            "macos-dev-helper-argument-invalid",
            "use_the_exact_documented_command_shape",
            "Invalid arguments for helper command \(command)."
        )
    }
}
