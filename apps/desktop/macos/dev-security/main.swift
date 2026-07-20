import Foundation

@main
struct NimiMacOSFreshCarrier4Installer {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else {
                throw freshFail("macos-dev-helper-argument-invalid", "select_a_documented_command", "A helper command is required.")
            }
            switch command {
            case "status":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try freshEmit(try freshCarrier4Status())
            case "verify-candidate":
                guard arguments.count == 2 else { throw argumentFailure(command) }
                try freshEmit(try verifyFreshCarrier4Candidate(root: URL(fileURLWithPath: arguments[1], isDirectory: true)))
            case "install-candidate":
                guard arguments.count == 2 else { throw argumentFailure(command) }
                try freshEmit(try installFreshCarrier4Candidate(root: URL(fileURLWithPath: arguments[1], isDirectory: true)))
            case "restart-service":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try freshEmit(try restartFreshCarrier4Service())
            case "reset-service-state":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try freshEmit(try resetFreshCarrier4CurrentState())
            case "uninstall-service":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try freshEmit(try uninstallFreshCarrier4Service())
            default:
                throw argumentFailure(command)
            }
        } catch let failure as FreshCarrier4Failure {
            var response: [String: Any] = [
                "status": "failed",
                "reasonCode": failure.reasonCode,
                "actionHint": failure.actionHint,
                "message": failure.message,
            ]
            if !failure.details.isEmpty { response["details"] = failure.details }
            try? freshEmit(response, to: .standardError)
            exit(1)
        } catch {
            try? freshEmit([
                "status": "failed",
                "reasonCode": "macos-dev-security-helper-failed",
                "actionHint": "inspect_the_nonsecret_helper_failure",
                "message": String(describing: error),
            ], to: .standardError)
            exit(1)
        }
    }

    private static func argumentFailure(_ command: String) -> FreshCarrier4Failure {
        freshFail("macos-dev-helper-argument-invalid", "use_the_exact_documented_command_shape", "Invalid arguments for helper command \(command).")
    }
}
