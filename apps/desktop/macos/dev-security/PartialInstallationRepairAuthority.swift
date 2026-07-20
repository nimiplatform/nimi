import Darwin
import CryptoKit
import Foundation

struct PartialInstallRepairStaticAuthority {
    let rootKeyId: String
    let sourceHelperSHA256: String
    let sourceHelperCDHash: String
    let policyDigest: String
}

struct PartialInstallRepairParentCustodyProof {
    let staticAuthorityBindingSHA256: String
    let journalTerminalProofBindingSHA256: String
    let mutationLockVnodeBindingSHA256: String
    let parentPID: pid_t
    let parentProcessStartIdentity: String
    let verifierPID: pid_t
}

private var admittedPartialInstallRepairSourceCarriers: [Int] {
    [
        runtimeNormalRepairSourcePrincipalCarrierContractVersion,
        runtimeLegacyRepairSourcePrincipalCarrierContractVersion,
    ]
}

func currentPartialInstallRepairAuthorityFromSourceStatus(
    lockWitness: RuntimeServiceMutationLockWitness
) throws -> PartialInstallRepairAuthority {
    let before = try currentPartialInstallRepairStaticAuthority(lockWitness: lockWitness)
    let status = try runFixedCommand(
        bootstrapHelperInstallPath,
        ["run-repair-source-helper-status"],
        captureLimit: 256 * 1024,
        timeoutSeconds: 30,
        processTreePolicy: .bootstrapOwnedProcessGroup
    )
    guard status.pid > 1, status.pid != getpid() else {
        throw partialInstallRepairSourceStatusFailure(probe: "status-process", state: "invalid")
    }
    guard let value = try? JSONSerialization.jsonObject(with: status.stdout) as? [String: Any] else {
        throw partialInstallRepairSourceStatusFailure(probe: "status-json", state: "invalid")
    }
    let statusChecks: [(String, Bool)] = [
        ("status-root-key", value["rootKeyId"] as? String == before.rootKeyId),
        ("status-identity-class", value["identityClass"] as? String == "local_ca"),
        ("status-product-admission", (value["productAdmission"] as? NSNumber)?.boolValue == false),
        ("status-signing-trust", (value["signingProfileTrusted"] as? NSNumber)?.boolValue == true),
        ("status-service", value["serviceName"] as? String == launchDaemonLabel),
    ]
    if let failed = statusChecks.first(where: { !$0.1 }) {
        throw partialInstallRepairSourceStatusFailure(probe: failed.0, state: "mismatch")
    }
    guard let sourceCarrier = (value["runtimePrincipalCarrierContractVersion"] as? NSNumber)?.intValue,
          admittedPartialInstallRepairSourceCarriers.contains(sourceCarrier) else {
        throw partialInstallRepairSourceStatusFailure(probe: "status-source-carrier", state: "unadmitted")
    }
    let after = try currentPartialInstallRepairStaticAuthority(lockWitness: lockWitness)
    let stableChecks: [(String, Bool)] = [
        ("status-stable-root-key", before.rootKeyId == after.rootKeyId),
        ("status-stable-helper-sha256", before.sourceHelperSHA256 == after.sourceHelperSHA256),
        ("status-stable-helper-cdhash", before.sourceHelperCDHash == after.sourceHelperCDHash),
        ("status-stable-policy", before.policyDigest == after.policyDigest),
    ]
    if let failed = stableChecks.first(where: { !$0.1 }) {
        throw partialInstallRepairSourceStatusFailure(probe: failed.0, state: "changed-during-status")
    }
    return PartialInstallRepairAuthority(
        rootKeyId: before.rootKeyId,
        sourceHelperSHA256: before.sourceHelperSHA256,
        sourceHelperCDHash: before.sourceHelperCDHash,
        sourcePrincipalCarrierContractVersion: sourceCarrier,
        policyDigest: before.policyDigest
    )
}

@discardableResult
func requireCurrentPartialInstallRepairAuthority(
    _ journal: PartialInstallRepairJournal,
    lockWitness: RuntimeServiceMutationLockWitness? = nil
) throws -> PartialInstallRepairStaticAuthority {
    guard admittedPartialInstallRepairSourceCarriers.contains(
        journal.sourcePrincipalCarrierContractVersion
    ) else {
        throw partialInstallRepairJournalAuthorityFailure(
            journal: journal,
            probe: "source-carrier",
            state: "unadmitted"
        )
    }
    let current = try currentPartialInstallRepairStaticAuthority(
        lockWitness: lockWitness
    )
    let checks: [(String, Bool)] = [
        ("source-helper-sha256", journal.sourceHelperSHA256 == current.sourceHelperSHA256),
        ("source-helper-cdhash", journal.sourceHelperCDHash == current.sourceHelperCDHash),
        ("residue-class", journal.residueClass == repairResidueClass(for: journal.sourcePrincipalCarrierContractVersion)?.rawValue),
        ("plan-digest", journal.planDigest == partialInstallRepairPlanDigest(journal.plan)),
        ("group-generated-uid", journal.groupGeneratedUID == journal.plan.groupGeneratedUID),
        ("user-generated-uid", journal.userGeneratedUID == journal.plan.userGeneratedUID),
        ("root-key", journal.rootKeyId == current.rootKeyId),
        ("policy-digest", journal.policyDigest == current.policyDigest),
    ]
    if let failed = checks.first(where: { !$0.1 }) {
        throw partialInstallRepairJournalAuthorityFailure(
            journal: journal,
            probe: failed.0,
            state: "mismatch"
        )
    }
    return current
}

func currentPartialInstallRepairStaticAuthority(
    lockWitness: RuntimeServiceMutationLockWitness? = nil
) throws -> PartialInstallRepairStaticAuthority {
    try withStableExecutableVnode(
        path: helperInstallPath,
        owner: 0,
        group: 0,
        mode: 0o755,
        attributeEventRevalidator: { vnode in
            _ = try inspectPartialInstallRepairStaticAuthority(
                vnode: vnode,
                lockWitness: lockWitness
            )
        }
    ) { vnode in
        try inspectPartialInstallRepairStaticAuthority(
            vnode: vnode,
            lockWitness: lockWitness
        )
    }
}

private func inspectPartialInstallRepairStaticAuthority(
    vnode: StableExecutableVnodeWitness,
    lockWitness: RuntimeServiceMutationLockWitness?
) throws -> PartialInstallRepairStaticAuthority {
    if let lockWitness {
        guard mutationLockWitnessMatchesExecutableVnode(lockWitness, vnode) else {
            throw partialInstallRepairHelperAuthorityFailure(
                probe: "source-helper-mutation-lock-vnode",
                state: "mismatch"
            )
        }
    }
    try requireSecureInstalledHelper()
    let profile = try DevelopmentCertificateAuthority().validateInstalledProfile(
        requirePrivateCustody: false
    )
    let sourceHelper = try inspectSignedCode(helperInstallPath)
    guard let helperIdentity = profile.identities["helper"] else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "helper-profile-role",
            state: "missing"
        )
    }
    guard sourceHelper.identifier == helperIdentity.signingIdentifier else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "helper-signing-identifier",
            state: "mismatch"
        )
    }
    guard sourceHelper.teamId.isEmpty else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "helper-team-id",
            state: "unexpected-nonempty"
        )
    }
    guard sourceHelper.leafSPKISHA256 == helperIdentity.leafSPKISHA256 else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "helper-leaf-spki",
            state: "mismatch"
        )
    }
    try requireSignedCodeCertificateRequirement(
        helperInstallPath,
        identifier: helperIdentity.signingIdentifier,
        leafCertificateSHA1: helperIdentity.certificateSHA1
    )
    let chain = try signedCodeCertificateChainDER(helperInstallPath)
    guard chain.count == 2,
          digestHex(Insecure.SHA1.hash(data: chain[0]))
              == helperIdentity.certificateSHA1,
          digestHex(SHA256.hash(data: chain[0]))
              == helperIdentity.certificateSHA256,
          digestHex(SHA256.hash(data: chain[1]))
              == profile.rootCertificateSHA256 else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "helper-certificate-chain",
            state: "mismatch"
        )
    }
    guard sourceHelper.hardenedRuntime else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "helper-hardened-runtime",
            state: "absent"
        )
    }
    try requireSecureInstalledHelper()
    let stableSourceHelper = try inspectSignedCode(helperInstallPath)
    let stabilityChecks: [(String, Bool)] = [
        ("stable-helper-identifier", sourceHelper.identifier == stableSourceHelper.identifier),
        ("stable-helper-team-id", sourceHelper.teamId == stableSourceHelper.teamId),
        ("stable-helper-cdhash", sourceHelper.cdhash == stableSourceHelper.cdhash),
        ("stable-helper-designated-requirement", sourceHelper.designatedRequirement == stableSourceHelper.designatedRequirement),
        ("stable-helper-leaf-spki", sourceHelper.leafSPKISHA256 == stableSourceHelper.leafSPKISHA256),
        ("stable-helper-hardened-runtime", sourceHelper.hardenedRuntime == stableSourceHelper.hardenedRuntime),
    ]
    if let failed = stabilityChecks.first(where: { !$0.1 }) {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: failed.0,
            state: "changed-during-verification"
        )
    }
    return PartialInstallRepairStaticAuthority(
        rootKeyId: profile.rootKeyId,
        sourceHelperSHA256: vnode.sha256,
        sourceHelperCDHash: sourceHelper.cdhash,
        policyDigest: sha256(Data(runtimePartialInstallRepairPolicy.utf8))
    )
}

func establishPartialInstallRepairParentCustodyProof(
    staticAuthority: PartialInstallRepairStaticAuthority,
    journal: PartialInstallRepairJournal,
    lockWitness: RuntimeServiceMutationLockWitness
) throws -> PartialInstallRepairParentCustodyProof {
    let parentBefore = try requireRepairParentSelfWitness()
    let journalBinding = partialInstallRepairTerminalProofBinding(journal)
    let result = try runFixedCommand(
        bootstrapHelperInstallPath,
        ["run-repair-final-helper-private-custody"],
        captureLimit: 64 * 1024,
        timeoutSeconds: 60,
        processTreePolicy: .bootstrapOwnedProcessGroup
    )
    guard result.pid > 1, result.pid != getpid(),
          let value = try? JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          Set(value.keys) == Set([
              "status", "profileId", "rootKeyId",
              "signingCustodyVerification", "productAdmission",
          ]),
          value["status"] as? String == "verified",
          value["profileId"] as? String == "macos_local_development_v1",
          value["rootKeyId"] as? String == staticAuthority.rootKeyId,
          value["signingCustodyVerification"] as? String == "verified",
          (value["productAdmission"] as? NSNumber)?.boolValue == false else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "parent-private-custody-receipt",
            state: "invalid"
        )
    }
    let after = try currentPartialInstallRepairStaticAuthority(
        lockWitness: lockWitness
    )
    let parentAfter = try requireRepairParentSelfWitness()
    guard partialInstallRepairStaticAuthorityBinding(after)
            == partialInstallRepairStaticAuthorityBinding(staticAuthority),
          parentAfter == parentBefore else {
        throw partialInstallRepairHelperAuthorityFailure(
            probe: "parent-private-custody-authority-binding",
            state: "changed-during-proof"
        )
    }
    return PartialInstallRepairParentCustodyProof(
        staticAuthorityBindingSHA256: partialInstallRepairStaticAuthorityBinding(after),
        journalTerminalProofBindingSHA256: journalBinding,
        mutationLockVnodeBindingSHA256: partialInstallRepairMutationLockBinding(
            lockWitness
        ),
        parentPID: parentAfter.pid,
        parentProcessStartIdentity: parentAfter.startIdentity,
        verifierPID: result.pid
    )
}

func requirePartialInstallRepairParentCustodyProof(
    _ proof: PartialInstallRepairParentCustodyProof,
    journal: PartialInstallRepairJournal,
    staticAuthority: PartialInstallRepairStaticAuthority,
    lockWitness: RuntimeServiceMutationLockWitness
) throws {
    let expectedStaticBinding = partialInstallRepairStaticAuthorityBinding(staticAuthority)
    let parent = try requireRepairParentSelfWitness()
    guard proof.verifierPID > 1,
          proof.verifierPID != getpid(),
          proof.staticAuthorityBindingSHA256 == expectedStaticBinding,
          proof.journalTerminalProofBindingSHA256
            == partialInstallRepairTerminalProofBinding(journal),
          proof.mutationLockVnodeBindingSHA256
            == partialInstallRepairMutationLockBinding(lockWitness),
          proof.parentPID == parent.pid,
          proof.parentProcessStartIdentity == parent.startIdentity,
          journal.sourceHelperSHA256 == staticAuthority.sourceHelperSHA256,
          journal.sourceHelperCDHash == staticAuthority.sourceHelperCDHash,
          journal.rootKeyId == staticAuthority.rootKeyId,
          journal.policyDigest == staticAuthority.policyDigest else {
        throw partialInstallRepairJournalAuthorityFailure(
            journal: journal,
            probe: "parent-private-custody-binding",
            state: "mismatch"
        )
    }
}

private func partialInstallRepairMutationLockBinding(
    _ witness: RuntimeServiceMutationLockWitness
) -> String {
    sha256(Data([
        "nimi.macos-local-development-repair-mutation-lock/v2",
        String(witness.device),
        String(witness.inode),
        String(witness.size),
        String(witness.modifiedSeconds),
        String(witness.modifiedNanoseconds),
        String(witness.changedSeconds),
        String(witness.changedNanoseconds),
        String(witness.fileFlags),
        witness.sha256,
    ].joined(separator: "\u{0}").utf8))
}

private func partialInstallRepairStaticAuthorityBinding(
    _ authority: PartialInstallRepairStaticAuthority
) -> String {
    sha256(Data([
        "nimi.macos-local-development-repair-static-authority/v1",
        authority.rootKeyId,
        authority.sourceHelperSHA256,
        authority.sourceHelperCDHash,
        authority.policyDigest,
    ].joined(separator: "\u{0}").utf8))
}

private func partialInstallRepairHelperAuthorityFailure(
    probe: String,
    state: String
) -> DevSecurityFailure {
    fail(
        "runtime-service-untrusted",
        "rebuild, sign, and reinstall the exact development security helper",
        "The installed final helper does not match the repair-bound local-development code authority.",
        details: [
            "phase": "repair-authority",
            "probe": probe,
            "state": state,
            "verifier_pid": getpid(),
        ]
    )
}

private func partialInstallRepairSourceStatusFailure(
    probe: String,
    state: String
) -> DevSecurityFailure {
    principalDiagnosticFailure(
        "runtime-principal-journal-invalid",
        "inspect the exact source-helper carrier receipt before repair",
        "The source helper did not return one repair-admitted pre-deletion carrier receipt.",
        details: [
            "phase": "repair-authority",
            "probe": probe,
            "state": state,
            "verifier_pid": getpid(),
        ]
    )
}

private func partialInstallRepairJournalAuthorityFailure(
    journal: PartialInstallRepairJournal,
    probe: String,
    state: String
) -> DevSecurityFailure {
    principalDiagnosticFailure(
        "runtime-principal-journal-invalid",
        "inspect the exact journal-bound repair authority before retrying repair",
        "The partial-install repair journal does not match the current static helper authority.",
        details: [
            "phase": journal.phase,
            "probe": probe,
            "state": state,
            "projection_sha256": partialInstallRepairTerminalProofBinding(journal),
            "verifier_pid": getpid(),
        ]
    )
}

private func digestHex<D: Digest>(_ digest: D) -> String {
    digest.map { String(format: "%02x", $0) }.joined()
}
