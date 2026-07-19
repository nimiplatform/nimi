import Darwin
import Foundation
import Security

@main
struct NimiMacOSDevelopmentSecurity {
    static func main() {
        do {
            let interactionStatus = SecKeychainSetUserInteractionAllowed(false)
            guard interactionStatus == errSecSuccess else {
                throw securityFailure("disable interactive Keychain fallback", interactionStatus)
            }
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else {
                throw fail("macos-dev-helper-argument-invalid", "select one documented helper command", "A helper command is required.")
            }
            switch command {
            case "provision-signing-profile":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: true)
                try ensureProvisioningRoots()
                let profile = try DevelopmentCertificateAuthority(
                    authorizingHelperPath: bootstrapHelperInstallPath
                ).provision()
                try retireProvisioningBootstrapHelper()
                try emitJSON([
                    "status": "provisioned",
                    "profileId": profile.profileId,
                    "rootKeyId": profile.rootKeyId,
                    "identityClass": profile.identityClass,
                    "privateKeyCustody": "non_durable_CA_key_plus_all_five_roles_in_locked_signing_Keychain_plus_zero_System_profile_private_keys",
                    "productAdmission": false,
                ])
            case "status":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try developmentStatus())
            case "verify-signing-profile":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try requireRootMutationContext()
                let profile = try DevelopmentCertificateAuthority().validateInstalledProfile(
                    requirePrivateCustody: true
                )
                try emitJSON([
                    "status": "verified",
                    "profileId": profile.profileId,
                    "rootKeyId": profile.rootKeyId,
                    "signingCustodyVerification": "verified",
                    "productAdmission": false,
                ])
            case "finalize-signing-custody":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try requireProvisioningFinalizerMutationContext()
                let profile = try DevelopmentCertificateAuthority().finalizeProvisioningCustody()
                try emitJSON([
                    "status": "custody-finalized",
                    "profileId": profile.profileId,
                    "rootKeyId": profile.rootKeyId,
                    "signingCustodyVerification": "final_helper_only",
                    "transitionalACLs": 0,
                    "productAdmission": false,
                ])
            case "install-candidate":
                guard arguments.count == 2 else { throw argumentFailure(command) }
                let receipt = try withRuntimeServiceMutationLock {
                    try installDevelopmentCandidate(arguments[1])
                }
                try emitJSON([
                    "status": "installed",
                    "serviceName": launchDaemonLabel,
                    "generation": receipt.generation,
                    "releaseId": receipt.releaseId,
                    "runtimeBinarySha256": receipt.runtimeSHA256,
                    "desktopCDHash": receipt.desktopCDHash,
                    "productAdmission": false,
                ])
            case "verify-runtime-principal-transaction":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try verifyRuntimePrincipalTransactionInFreshProcess())
            case "verify-runtime-principal-removal-transaction":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try verifyRuntimePrincipalRemovalTransactionInFreshProcess())
            case "sign-release-record":
                guard arguments.count == 3, arguments[1] == "--key-id" else { throw argumentFailure(command) }
                try requireRootMutationContext()
                let payload = FileHandle.standardInput.readDataToEndOfFile()
                let signature = try withRuntimeServiceMutationLock {
                    try DevelopmentCertificateAuthority().signReleaseRecord(payload, keyId: arguments[2])
                }
                try FileHandle.standardOutput.write(contentsOf: Data(signature.base64URLEncodedString().utf8) + Data([0x0a]))
            case "restart-service":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try withRuntimeServiceMutationLock { try restartDevelopmentService() })
            case "reset-service-state":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try withRuntimeServiceMutationLock { try resetDevelopmentServiceState() })
            case "uninstall-service":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try withRuntimeServiceMutationLock { try uninstallDevelopmentService() })
            case "unprovision-signing-profile":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                let result = try withRuntimeServiceMutationLock { try unprovisionDevelopmentTrust() }
                try emitJSON(result)
            case "prepare-stranded-unprovision":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try emitJSON(try prepareStrandedDevelopmentTrustUnprovision())
            case "verify-partial-install-repair-principal-removal":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: false)
                try emitJSON(try verifyPartialInstallRepairPrincipalRemovalInFreshProcess())
            case "repair-partial-runtime-install":
                guard arguments.count == 1 else { throw argumentFailure(command) }
                try requireProvisioningBootstrapMutationContext(unsignedFinalCandidateRequired: false)
                let result = try withRuntimeServiceMutationLock {
                    let result = try repairExactPartialRuntimeInstallation()
                    try retireProvisioningBootstrapHelper()
                    return result
                }
                try emitJSON(result)
            default:
                throw fail("macos-dev-helper-argument-invalid", "select one documented helper command", "Unsupported helper command: \(command)")
            }
        } catch let failure as DevSecurityFailure {
            try? emitJSON([
                "status": "failed",
                "reasonCode": failure.reasonCode,
                "actionHint": failure.actionHint,
                "message": failure.message,
            ], to: .standardError)
            exit(1)
        } catch {
            try? emitJSON([
                "status": "failed",
                "reasonCode": "macos-dev-security-helper-failed",
                "actionHint": "inspect_macos_dev_security_helper_failure",
                "message": diagnosticMessage(error),
            ], to: .standardError)
            exit(1)
        }
    }
}

private func ensureProvisioningRoots() throws {
    if !FileManager.default.fileExists(atPath: "/Library/Application Support/Nimi") {
        try ensureDirectory("/Library/Application Support/Nimi", owner: 0, group: 0, mode: 0o755)
    } else {
        _ = try secureMetadata("/Library/Application Support/Nimi", type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
    }
    if !FileManager.default.fileExists(atPath: runtimeDevRoot) {
        try ensureDirectory(runtimeDevRoot, owner: 0, group: 0, mode: 0o755)
    } else {
        _ = try secureMetadata(runtimeDevRoot, type: S_IFDIR, uid: 0, gid: 0, mode: 0o755)
    }
    if !FileManager.default.fileExists(atPath: signingCustodyRoot) {
        try ensureDirectory(signingCustodyRoot, owner: 0, group: 0, mode: 0o700)
    } else {
        _ = try secureMetadata(signingCustodyRoot, type: S_IFDIR, uid: 0, gid: 0, mode: 0o700)
    }
}

private func argumentFailure(_ command: String) -> DevSecurityFailure {
    fail("macos-dev-helper-argument-invalid", "use the exact documented helper command shape", "Invalid arguments for helper command \(command).")
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
