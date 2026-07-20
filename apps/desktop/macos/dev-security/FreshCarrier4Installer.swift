import CryptoKit
import Darwin
import Foundation
import OpenDirectory
import Security

private let legacyProfilePath = "/Library/Application Support/Nimi/RuntimeDev/dev-signing-profile.json"
private let installationJournalPath = "/Library/Application Support/Nimi/RuntimeDev/installation-transaction.json"
private let installedPublicProfilePath = "/Library/Application Support/Nimi/RuntimeDev/signing-profile-public.json"
private let installerLedgerPath = "/Library/Application Support/Nimi/RuntimeDev/installer-ledger.json"

private struct FreshRole {
    let role: String
    let relativePath: String
    let codePath: String
    let identifier: String
    let trustSetID: String
    let principal: String
    let recordFilename: String
    let expectedEntitlements: [String: Any]
}

private let freshRoles = [
    FreshRole(role: "nimi_runtime_service", relativePath: "runtime/bin/nimi-runtime", codePath: "runtime/bin/nimi-runtime", identifier: "ai.nimi.runtime.dev", trustSetID: "nimi-runtime-macos-local-development-v1", principal: generatedRuntimeAccountName, recordFilename: "nimi_runtime_service.release-trust-record.json", expectedEntitlements: [:]),
    FreshRole(role: "nimi_desktop", relativePath: "Nimi Dev.app/Contents/MacOS/Nimi Dev", codePath: "Nimi Dev.app", identifier: "ai.nimi.apps.nimi.desktop.dev", trustSetID: "nimi-desktop-macos-local-development-v1", principal: "active_console_user", recordFilename: "nimi_desktop.release-trust-record.json", expectedEntitlements: ["com.apple.security.cs.allow-jit": true]),
    FreshRole(role: "nimi_local_app_host", relativePath: "Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev", codePath: "Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app", identifier: "ai.nimi.apps.nimi.local-app-host.dev", trustSetID: "nimi-local-development-host-macos-local-development-v1", principal: "verified_desktop_supervised_active_console_user", recordFilename: "nimi_local_app_host.release-trust-record.json", expectedEntitlements: ["com.apple.security.cs.allow-jit": true]),
]

func freshCarrier4Status() throws -> [String: Any] {
    let manager = FileManager.default
    if manager.fileExists(atPath: legacyProfilePath) {
        return ["status": "blocked", "reasonCode": generatedLegacyProfileReasonCode, "carrier": NSNull(), "legacyProfilePresent": true, "mutation": "none", "productAdmission": false]
    }
    let activationStagingResidue = try freshActivationStagingResidue()
    let runtimePrincipalPOSIXPresent = try freshLookupUser(name: generatedRuntimeAccountName) != nil || freshLookupGroup(name: generatedRuntimeAccountName) != nil
    let objects: [String: Bool] = [
        "helperPresent": manager.fileExists(atPath: generatedInstallerHelperPath),
        "runtimeDevBoundaryPresent": manager.fileExists(atPath: "/Library/Application Support/Nimi/RuntimeDev"),
        "activeRootPresent": manager.fileExists(atPath: "/Library/Application Support/Nimi/RuntimeDev/active"),
        "runtimePresent": manager.fileExists(atPath: generatedRuntimeExecutablePath),
        "runtimeStatePresent": manager.fileExists(atPath: generatedRuntimeStateRoot),
        "bootstrapRootPresent": manager.fileExists(atPath: "/Library/Application Support/Nimi/RuntimeDev/bootstrap"),
        "desktopPresent": manager.fileExists(atPath: generatedDesktopApplicationPath),
        "launchDaemonPresent": manager.fileExists(atPath: generatedLaunchDaemonPath),
        "installationJournalPresent": manager.fileExists(atPath: installationJournalPath),
        "installerLedgerPresent": manager.fileExists(atPath: installerLedgerPath),
        "publicProfilePresent": manager.fileExists(atPath: installedPublicProfilePath),
        "desktopSocketPresent": manager.fileExists(atPath: generatedDesktopSocketPath),
        "localAppSocketPresent": manager.fileExists(atPath: generatedLocalAppSocketPath),
        "socketDirectoryPresent": manager.fileExists(atPath: "/private/var/run/nimi-dev"),
        "runtimePrincipalPOSIXPresent": runtimePrincipalPOSIXPresent,
        "activationStagingResiduePresent": !activationStagingResidue.isEmpty,
    ]
    let installedKeys=["helperPresent","runtimeDevBoundaryPresent","activeRootPresent","runtimePresent","runtimeStatePresent","desktopPresent","launchDaemonPresent","publicProfilePresent","installerLedgerPresent","desktopSocketPresent","localAppSocketPresent","socketDirectoryPresent","runtimePrincipalPOSIXPresent"]
    if installedKeys.allSatisfy({objects[$0]==true}),objects["installationJournalPresent"]==false,objects["bootstrapRootPresent"]==false,objects["activationStagingResiduePresent"]==false{
        if geteuid() != 0{return ["status":"present","state":"verification-required","signingProfile":"present","signingProfileTrusted":false,"runtimeAccountVerification":"privileged_required","runtimePrincipalCarrierContractVersion":generatedRuntimePrincipalCarrierContractVersion,"productAdmission":false,"mutation":"none"]}
        return try verifyFreshInstalledStatus()
    }
    let durableResidue = objects.filter { $0.value }
    if !durableResidue.isEmpty {
        return ["status": "blocked", "reasonCode": "runtime-service-repair-required", "carrier": generatedRuntimePrincipalCarrierContractVersion, "legacyProfilePresent": false, "residue": durableResidue.keys.sorted(), "activationStagingResidue": activationStagingResidue, "mutation": "none", "productAdmission": false]
    }
    return ["status": "absent", "reasonCode": "dev-runtime-service-not-installed", "carrier": generatedRuntimePrincipalCarrierContractVersion, "legacyProfilePresent": false, "helperPresent": objects["helperPresent"]!, "mutation": "none", "productAdmission": false]
}

func freshIsActivationStagingEntry(parent: String, entry: String) -> Bool {
    let patterns: [String: [(String, String)]] = [
        "/Library/Application Support/Nimi/RuntimeDev": [(".active-", ".staging"), (".signing-profile-public.", ".staging")],
        "/Applications": [(".Nimi Dev.app.", ".staging")],
        "/usr/local/libexec": [(".nimi-macos-dev-security.", ".staging")],
        "/Library/LaunchDaemons": [(".ai.nimi.runtime.dev.", ".staging.plist")],
    ]
    guard let alternatives = patterns[parent] else { return false }
    return alternatives.contains { prefix, suffix in
        guard entry.hasPrefix(prefix), entry.hasSuffix(suffix) else { return false }
        let start = entry.index(entry.startIndex, offsetBy: prefix.count)
        let end = entry.index(entry.endIndex, offsetBy: -suffix.count)
        return start < end
    }
}

private func freshActivationStagingResidue() throws -> [String] {
    let parents = ["/Library/Application Support/Nimi/RuntimeDev", "/Applications", "/usr/local/libexec", "/Library/LaunchDaemons"]
    var result = [String]()
    for parent in parents where FileManager.default.fileExists(atPath: parent) {
        for entry in try FileManager.default.contentsOfDirectory(atPath: parent) where freshIsActivationStagingEntry(parent: parent, entry: entry) {
            result.append("\(parent)/\(entry)")
        }
    }
    return result.sorted()
}

private func verifyFreshInstalledStatus()throws->[String:Any]{
    for path in [installedPublicProfilePath,generatedInstallerHelperPath,generatedLaunchDaemonPath,generatedRuntimeExecutablePath,generatedDesktopApplicationPath,generatedDesktopExecutablePath,generatedLocalAppHostPath,generatedTrustRecordRoot,generatedDesktopSocketPath,generatedLocalAppSocketPath]{try freshRequireCanonicalFixedPath(path)}
    let plan=try readFreshInstallerLedger();let profileFile=try retainFreshFile(URL(fileURLWithPath:installedPublicProfilePath)),helperFile=try retainFreshFile(URL(fileURLWithPath:generatedInstallerHelperPath),executable:true),plistFile=try retainFreshFile(URL(fileURLWithPath:generatedLaunchDaemonPath));defer{profileFile.close();helperFile.close();plistFile.close()}
    guard profileFile.sha256==plan.profileSHA256,plistFile.sha256==generatedLaunchDaemonSHA256,[profileFile,helperFile,plistFile].allSatisfy({$0.before.st_uid==0 && $0.before.st_gid==0}),profileFile.before.st_mode&0o777==0o644,helperFile.before.st_mode&0o777==0o755,plistFile.before.st_mode&0o777==0o644 else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Installed helper, profile, or LaunchDaemon metadata is untrusted.")}
    try verifyFreshPrincipal(plan)
    try requireFreshInstalledTree(URL(fileURLWithPath:"/Library/Application Support/Nimi/RuntimeDev/active"));try requireFreshInstalledTree(URL(fileURLWithPath:generatedDesktopApplicationPath))
    let helper=try inspectFreshCode(at:URL(fileURLWithPath:generatedInstallerHelperPath),expectedIdentifier:generatedInstallerSigningIdentifier,retained:helperFile),profile=try verifyFreshSigningProfile(profileFile,installer:helper),rootKey=try freshReleaseRoot(profile)
    var records=[[String:Any]](),identities=[String:FreshCodeIdentity]();for role in freshRoles{let artifactPath:String,codePath:String;switch role.role{case "nimi_runtime_service":artifactPath=generatedRuntimeExecutablePath;codePath=generatedRuntimeExecutablePath;case "nimi_desktop":artifactPath=generatedDesktopExecutablePath;codePath=generatedDesktopApplicationPath;default:artifactPath=generatedLocalAppHostPath;codePath="/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app"};let retained=try retainFreshFile(URL(fileURLWithPath:artifactPath),executable:true);defer{retained.close()};let identity=try inspectFreshCode(at:URL(fileURLWithPath:codePath),expectedIdentifier:role.identifier,retained:retained);guard identity.rootCertificateSHA256==profile.rootCertificateSHA256,identity.leafCertificateSHA256==profile.leafCertificateSHA256[role.role],identity.leafSPKISHA256==profile.leafSPKISHA256[role.role],identity.entitlementsSHA256==SHA256.hash(data:try freshCanonicalJSON(role.expectedEntitlements)).hex else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Installed role identity or entitlements are untrusted.",details:["role":role.role])};let recordFile=try retainFreshFile(URL(fileURLWithPath:"\(generatedTrustRecordRoot)/\(role.recordFilename)"));defer{recordFile.close()};records.append(try verifyFreshReleaseRecord(file:recordFile,role:role,identity:identity,artifactSHA256:retained.sha256,rootKey:rootKey,rootKeyID:profile.rootKeyID));identities[role.role]=identity}
    try verifyFreshPeerCompatibility(records)
    let custody=try runFreshFixed(generatedRuntimeExecutablePath,["macos-protected-state-status"]),custodyObject=try JSONSerialization.jsonObject(with:custody) as? [String:Any];guard Set(custodyObject?.keys.map{$0} ?? [])==Set(["schemaVersion","disposition","stateRoot","runtimePath","custodyACLs"]),custodyObject?["schemaVersion"] as? Int==1,custodyObject?["disposition"] as? String=="verified",custodyObject?["stateRoot"] as? String==generatedRuntimeStateRoot,custodyObject?["runtimePath"] as? String==generatedRuntimeExecutablePath,custodyObject?["custodyACLs"] as? String=="verified" else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Runtime custody and state proof is invalid.")}
    let launch=try runFreshFixed("/bin/launchctl",["print","system/\(generatedLaunchDaemonLabel)"]),text=String(data:launch,encoding:.utf8) ?? "";guard let match=text.range(of:#"pid = ([1-9][0-9]*)"#,options:.regularExpression),let pid=Int32(text[match].split(separator:" ").last!),let expectedRuntime=identities["nimi_runtime_service"] else{throw freshFail("runtime-service-unavailable","inspect_launchd_and_the_exact_principal","Installed Runtime PID is unavailable.")};let running=try verifyFreshRuntimeProcess(pid:pid,identifier:plan.identifier);guard running.identifier==expectedRuntime.identifier,running.cdhash==expectedRuntime.cdhash,running.designatedRequirement==expectedRuntime.designatedRequirement,running.leafSPKISHA256==expectedRuntime.leafSPKISHA256,running.teamID==expectedRuntime.teamID else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","The live Runtime identity differs from the retained installed release identity.")}
    for socket in [generatedDesktopSocketPath,generatedLocalAppSocketPath]{var metadata=stat();guard lstat(socket,&metadata)==0,metadata.st_mode&S_IFMT==S_IFSOCK,metadata.st_uid==0,metadata.st_gid==20,metadata.st_mode&0o777==0o660 else{throw freshFail("runtime-service-unavailable","run_the_exact_reset","Installed launchd socket metadata is invalid.")}}
    return["status":"present","state":"running","healthy":true,"activationReady":true,"signingProfile":"present","signingProfileTrusted":true,"runtimeExecutablePresent":true,"runtimeExecutableTrusted":true,"desktopApplicationPresent":true,"desktopApplicationTrusted":true,"localAppHostTrusted":true,"launchDaemonPresent":true,"launchDaemonDefinitionTrusted":true,"launchDaemonLoaded":true,"runtimeAccountTrusted":true,"runtimePrincipalCarrierContractVersion":4,"installerLedgerTrusted":true,"installedReleaseSetTrusted":true,"runtimeProcessTrusted":true,"desktopSocketPresent":true,"desktopSocketTrusted":true,"localAppSocketPresent":true,"localAppSocketTrusted":true,"installationTransactionClean":true,"installationTransactionCommitted":false,"productAdmission":false,"mutation":"none"]
}

private func verifyFreshRuntimeProcess(pid:Int32,identifier:UInt32)throws->FreshCodeIdentity{var info=proc_bsdinfo();guard proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,Int32(MemoryLayout<proc_bsdinfo>.size))==MemoryLayout<proc_bsdinfo>.size,info.pbi_pid==pid,info.pbi_uid==identifier,info.pbi_ruid==identifier,info.pbi_start_tvsec>0 else{throw freshFail("runtime-service-untrusted","inspect_launchd_and_the_exact_principal","Runtime process principal or start identity is invalid.",details:["pid":pid])};var bytes=[CChar](repeating:0,count:4096);let count=proc_pidpath(pid,&bytes,UInt32(bytes.count));guard count>0,String(cString:bytes)==generatedRuntimeExecutablePath,kill(pid,0)==0 else{throw freshFail("process-replaced","run_the_exact_reset","Runtime process path or liveness changed.",details:["pid":pid])};let retained=try retainFreshFile(URL(fileURLWithPath:generatedRuntimeExecutablePath),executable:true);defer{retained.close()};let identity=try inspectFreshRunningCode(pid:pid,expectedIdentifier:"ai.nimi.runtime.dev",retained:retained);var after=proc_bsdinfo();guard proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&after,Int32(MemoryLayout<proc_bsdinfo>.size))==MemoryLayout<proc_bsdinfo>.size,after.pbi_pid==info.pbi_pid,after.pbi_start_tvsec==info.pbi_start_tvsec,after.pbi_start_tvusec==info.pbi_start_tvusec else{throw freshFail("process-replaced","run_the_exact_reset","Runtime process identity changed during verification.",details:["pid":pid])};try retained.proveStable();return identity}

func verifyFreshCarrier4Candidate(root: URL) throws -> [String: Any] {
    let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
    guard canonical.path == root.standardizedFileURL.path, canonical.path.hasPrefix("/"), canonical.path != "/" else {
        throw freshFail("dev-candidate-path-untrusted", "use_a_canonical_candidate_directory", "Candidate root must be an absolute canonical directory without symlink resolution.")
    }
    try freshRequireExactDirectory(root,entries:["Nimi Dev.app","installer","launchd","layout-manifest.json","runtime","signing-profile.json","trust"])
    try freshRequireExactDirectory(root.appendingPathComponent("installer"),entries:["nimi-macos-dev-security"])
    try freshRequireExactDirectory(root.appendingPathComponent("launchd"),entries:["ai.nimi.runtime.dev.plist"])
    try freshRequireExactDirectory(root.appendingPathComponent("runtime"),entries:["bin"])
    try freshRequireExactDirectory(root.appendingPathComponent("runtime/bin"),entries:["nimi-runtime"])
    try freshRequireExactDirectory(root.appendingPathComponent("trust"),entries:["protected-local"])
    try freshRequireExactDirectory(root.appendingPathComponent("trust/protected-local"),entries:["v1"])
    try freshRequireExactDirectory(root.appendingPathComponent("trust/protected-local/v1"),entries:Set(freshRoles.map(\.recordFilename)))
    let profileURL = root.appendingPathComponent("signing-profile.json")
    let helperURL = root.appendingPathComponent("installer/nimi-macos-dev-security")
    let plistURL = root.appendingPathComponent("launchd/ai.nimi.runtime.dev.plist")
    let profileFile = try retainFreshFile(profileURL)
    let helperFile = try retainFreshFile(helperURL, executable: true)
    let plistFile = try retainFreshFile(plistURL)
    defer { profileFile.close(); helperFile.close(); plistFile.close() }
    guard plistFile.sha256 == generatedLaunchDaemonSHA256 else { throw freshFail("dev-candidate-launchd-definition-mismatch", "regenerate_the_candidate", "Candidate LaunchDaemon does not match generated authority.") }
    let helperIdentity = try inspectFreshCode(at: helperURL, expectedIdentifier: generatedInstallerSigningIdentifier, retained: helperFile)
    let profile = try verifyFreshSigningProfile(profileFile, installer: helperIdentity)
    let rootKey = try freshReleaseRoot(profile)

    var identities = [String: FreshCodeIdentity](), retainedFiles = [FreshRetainedFile](), records = [[String: Any]]()
    defer { retainedFiles.forEach { $0.close() } }
    for role in freshRoles {
        let artifactURL = root.appendingPathComponent(role.relativePath)
        let codeURL = root.appendingPathComponent(role.codePath)
        let retained = try retainFreshFile(artifactURL, executable: true)
        retainedFiles.append(retained)
        let identity = try inspectFreshCode(at: codeURL, expectedIdentifier: role.identifier, retained: retained)
        guard identity.rootCertificateSHA256 == profile.rootCertificateSHA256,
              identity.leafCertificateSHA256 == profile.leafCertificateSHA256[role.role],
              identity.leafSPKISHA256 == profile.leafSPKISHA256[role.role],
              identity.entitlementsSHA256 == SHA256.hash(data: try freshCanonicalJSON(role.expectedEntitlements)).hex else {
            throw freshFail("dev-candidate-role-profile-mismatch", "rebuild_with_the_exact_stable_role_identity", "Candidate code does not match the signed role profile, root, or exact entitlements.", details: ["role": role.role])
        }
        let recordURL = root.appendingPathComponent("trust/protected-local/v1/\(role.recordFilename)")
        let recordFile = try retainFreshFile(recordURL)
        retainedFiles.append(recordFile)
        let record = try verifyFreshReleaseRecord(file: recordFile, role: role, identity: identity, artifactSHA256: retained.sha256, rootKey: rootKey, rootKeyID: profile.rootKeyID)
        identities[role.role] = identity
        records.append(record)
    }
    try verifyFreshPeerCompatibility(records)
    try profileFile.proveStable(); try helperFile.proveStable(); try plistFile.proveStable(); try retainedFiles.forEach { try $0.proveStable() }
    return [
        "status": "verified", "carrier": generatedRuntimePrincipalCarrierContractVersion,
        "candidateRoot": canonical.path, "releaseRecordSchemaVersion": generatedReleaseRecordSchemaVersion,
        "profileSHA256": profileFile.sha256, "launchDaemonSHA256": plistFile.sha256,
        "installer": freshIdentityEvidence(helperIdentity, sha256: helperFile.sha256),
        "runtime": freshIdentityEvidence(identities["nimi_runtime_service"]!, sha256: retainedFiles[0].sha256),
        "desktop": freshIdentityEvidence(identities["nimi_desktop"]!, sha256: identitiesRecordSHA(records, role: "nimi_desktop", field: "artifact_sha256")),
        "localAppHost": freshIdentityEvidence(identities["nimi_local_app_host"]!, sha256: identitiesRecordSHA(records, role: "nimi_local_app_host", field: "artifact_sha256")),
        "retainedVnodePostcondition": "all_fixed_role_record_profile_plist_and_code_vnodes_stable_and_path-identical",
        "teamID": "", "hardenedRuntime": true, "notarized": false, "productAdmission": false, "mutation": "none",
    ]
}

private struct FreshSigningProfile {
    let rootKeyID: String
    let rootPublicKey: String
    let rootCertificateSHA256: String
    let leafCertificateSHA256: [String: String]
    let leafSPKISHA256: [String: String]
}

private func verifyFreshSigningProfile(_ file: FreshRetainedFile, installer: FreshCodeIdentity) throws -> FreshSigningProfile {
    let bytes = try Data(contentsOf: URL(fileURLWithPath: "/dev/fd/\(file.descriptor)"))
    let profileKeys: Set<String> = ["schemaVersion", "profileId", "carrier", "environment", "identityClass", "signatureAlgorithm", "teamId", "notarized", "keychainPath", "rootCertificateSHA256", "rootKeyId", "rootPublicKeyB64URL", "createdAt", "expiresAt", "identities", "profileSignature"]
    guard file.before.st_size <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], Set(value.keys) == profileKeys,
          value["schemaVersion"] as? String == generatedFreshProfileSchemaVersion,
          value["profileId"] as? String == generatedProfileID,
          value["carrier"] as? Int == generatedRuntimePrincipalCarrierContractVersion,
          value["environment"] as? String == generatedProfileEnvironment,
          value["identityClass"] as? String == generatedProfileIdentityClass,
          value["teamId"] as? String == "", value["notarized"] as? Bool == false,
          let rootKeyID = value["rootKeyId"] as? String,
          let rootPublicKey = value["rootPublicKeyB64URL"] as? String,
          let rootCertificate = value["rootCertificateSHA256"] as? String,
          value["signatureAlgorithm"] as? String == "ecdsa_p256_sha256",
          let keychainPath = value["keychainPath"] as? String, keychainPath.hasSuffix("/Library/Keychains/nimi-local-development-signing.keychain-db"), keychainPath.hasPrefix("/Users/"),
          let createdText = value["createdAt"] as? String, let created = ISO8601DateFormatter().date(from: createdText),
          let expiresText = value["expiresAt"] as? String, let expires = ISO8601DateFormatter().date(from: expiresText), created < expires, Date() < expires,
          let identities = value["identities"] as? [String: Any],
          let signatureText = value["profileSignature"] as? String,
          let signatureData = Data(base64URLEncoded: signatureText),
          let signature = try? P256.Signing.ECDSASignature(derRepresentation: signatureData) else {
        throw freshFail("dev-signing-profile-invalid", "reprovision_the_signing_profile", "Candidate signing profile schema or signature encoding is invalid.")
    }
    var unsigned = value; unsigned.removeValue(forKey: "profileSignature")
    guard installer.leafPublicKey.isValidSignature(signature, for: try freshCanonicalJSON(unsigned)),
          installer.rootCertificateSHA256 == rootCertificate else {
        throw freshFail("dev-signing-profile-signature-invalid", "reprovision_the_signing_profile", "Candidate signing profile is not signed by the exact installer role and CA.")
    }
    let expectedRoles = [
        "runtime": ("ai.nimi.runtime.dev", "Nimi Runtime Dev Carrier 4"),
        "desktop": ("ai.nimi.apps.nimi.desktop.dev", "Nimi Desktop Dev Carrier 4"),
        "local_app_host": ("ai.nimi.apps.nimi.local-app-host.dev", "Nimi Local App Host Dev Carrier 4"),
        "installer": (generatedInstallerSigningIdentifier, "Nimi Dev Installer Carrier 4"),
        "release_record": ("ai.nimi.dev-release-record", "Nimi Dev Release Record Carrier 4"),
    ]
    let identityKeys: Set<String> = ["role", "commonName", "signingIdentifier", "certificateSHA1", "certificateSHA256", "leafSPKISHA256", "expiresAt"]
    guard Set(identities.keys) == Set(expectedRoles.keys) else { throw freshFail("dev-signing-profile-invalid", "reprovision_the_signing_profile", "Candidate signing profile role set is not exact.") }
    var certificateHashes = [String: String](), spkiHashes = [String: String](), profileRows = [String: [String: Any]]()
    for (profileRole, expected) in expectedRoles {
        guard let row = identities[profileRole] as? [String: Any], Set(row.keys) == identityKeys,
              row["role"] as? String == profileRole, row["signingIdentifier"] as? String == expected.0, row["commonName"] as? String == expected.1,
              let sha1 = row["certificateSHA1"] as? String, sha1.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
              let certificate = row["certificateSHA256"] as? String, certificate.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              let spki = row["leafSPKISHA256"] as? String, spki.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              let rowExpiry = row["expiresAt"] as? String, ISO8601DateFormatter().date(from: rowExpiry) == expires else {
            throw freshFail("dev-signing-profile-invalid", "reprovision_the_signing_profile", "Candidate signing profile contains a malformed or mismatched role identity.", details: ["role": profileRole])
        }
        profileRows[profileRole] = row
    }
    let roleMap = ["nimi_runtime_service": "runtime", "nimi_desktop": "desktop", "nimi_local_app_host": "local_app_host"]
    for (recordRole, profileRole) in roleMap {
        guard let row = profileRows[profileRole],
              let certificate = row["certificateSHA256"] as? String,
              let spki = row["leafSPKISHA256"] as? String else { throw freshFail("dev-signing-profile-invalid", "reprovision_the_signing_profile", "Candidate signing profile lacks an exact role identity.") }
        certificateHashes[recordRole] = certificate; spkiHashes[recordRole] = spki
    }
    guard let installerRow = identities["installer"] as? [String: Any], installerRow["certificateSHA256"] as? String == installer.leafCertificateSHA256 else {
        throw freshFail("dev-signing-profile-installer-mismatch", "rebuild_the_installer", "Signed profile installer identity does not match the running verifier candidate.")
    }
    guard let rootDER = Data(base64URLEncoded: rootPublicKey), SHA256.hash(data: rootDER).hex == profileRows["release_record"]?["leafSPKISHA256"] as? String,
          rootKeyID == "nimi-macos-dev-record-\(SHA256.hash(data: rootDER).hex.prefix(20))" else {
        throw freshFail("dev-release-record-root-invalid", "reprovision_the_signing_profile", "Release-record public root is not the exact stable release-record role identity.")
    }
    return FreshSigningProfile(rootKeyID: rootKeyID, rootPublicKey: rootPublicKey, rootCertificateSHA256: rootCertificate, leafCertificateSHA256: certificateHashes, leafSPKISHA256: spkiHashes)
}

private func freshReleaseRoot(_ profile: FreshSigningProfile) throws -> P256.Signing.PublicKey {
    guard let der = Data(base64URLEncoded: profile.rootPublicKey), let key = try? P256.Signing.PublicKey(derRepresentation: der) else { throw freshFail("dev-release-record-root-invalid", "reprovision_the_signing_profile", "Release-record root is not canonical P-256 SPKI.") }
    return key
}

private func verifyFreshReleaseRecord(file: FreshRetainedFile, role: FreshRole, identity: FreshCodeIdentity, artifactSHA256: String, rootKey: P256.Signing.PublicKey, rootKeyID: String) throws -> [String: Any] {
    let encoded = try Data(contentsOf: URL(fileURLWithPath: "/dev/fd/\(file.descriptor)"))
    let recordKeys: Set<String> = ["artifact_sha256", "build_id", "compatible_peer_release_ids", "environment", "executable_role", "expires_at", "generation", "identity_class", "linux_manifest_key_id", "macos_architecture", "macos_cdhash", "macos_designated_requirement", "macos_entitlements_sha256", "macos_hardened_runtime_required", "macos_leaf_spki_sha256", "macos_notarization_required", "macos_team_id", "os_profile", "os_service_principal", "protected_local_protocol_version", "release_id", "root_key_id", "schema_version", "signature", "signature_algorithm", "signer_policy_id", "trust_set_id", "valid_from", "windows_chain_policy_ref", "windows_leaf_spki_sha256"]
    guard file.before.st_size <= 64 * 1024,
          let value = try JSONSerialization.jsonObject(with: encoded) as? [String: Any], Set(value.keys) == recordKeys, try freshCanonicalJSON(value) == encoded,
          value["schema_version"] as? Int == generatedReleaseRecordSchemaVersion,
          value["environment"] as? String == generatedProfileEnvironment,
          value["identity_class"] as? String == generatedProfileIdentityClass,
          value["signature_algorithm"] as? String == "ecdsa_p256_sha256",
          value["executable_role"] as? String == role.role, value["trust_set_id"] as? String == role.trustSetID,
          value["os_profile"] as? String == "macos", value["os_service_principal"] as? String == role.principal,
          value["signer_policy_id"] as? String == "nimi-macos-local-development-signing-policy",
          value["protected_local_protocol_version"] as? String == "1",
          value["windows_leaf_spki_sha256"] as? String == "", value["windows_chain_policy_ref"] as? String == "", value["linux_manifest_key_id"] as? String == "",
          value["root_key_id"] as? String == rootKeyID,
          value["artifact_sha256"] as? String == artifactSHA256,
          value["macos_designated_requirement"] as? String == identity.designatedRequirement,
          value["macos_team_id"] as? String == "", value["macos_leaf_spki_sha256"] as? String == identity.leafSPKISHA256,
          value["macos_cdhash"] as? String == identity.cdhash, value["macos_hardened_runtime_required"] as? Bool == true,
          value["macos_notarization_required"] as? Bool == false, value["macos_architecture"] as? String == identity.architecture,
          value["macos_entitlements_sha256"] as? String == identity.entitlementsSHA256,
          let validFromText = value["valid_from"] as? String, let expiresText = value["expires_at"] as? String,
          let validFrom = ISO8601DateFormatter().date(from: validFromText), let expires = ISO8601DateFormatter().date(from: expiresText),
          validFrom < expires, validFrom <= Date(), Date() < expires, (value["generation"] as? Int ?? 0) > 0,
          let buildID = value["build_id"] as? String, freshReleaseText(buildID),
          let releaseID = value["release_id"] as? String, freshReleaseText(releaseID),
          let signatureText = value["signature"] as? String, let signatureData = Data(base64URLEncoded: signatureText),
          let signature = try? P256.Signing.ECDSASignature(derRepresentation: signatureData) else {
        throw freshFail("dev-release-record-invalid", "rebuild_the_candidate", "A role release record is noncanonical, expired, or mismatched.", details: ["role": role.role])
    }
    var unsigned = value; unsigned.removeValue(forKey: "signature")
    guard rootKey.isValidSignature(signature, for: try freshCanonicalJSON(unsigned)) else { throw freshFail("dev-release-record-signature-invalid", "rebuild_the_candidate", "A role release-record signature is invalid.", details: ["role": role.role]) }
    return value
}

private func freshReleaseText(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        && value.unicodeScalars.allSatisfy { (0x21...0x7e).contains($0.value) && $0 != "/" && $0 != "\\" }
}

private func verifyFreshPeerCompatibility(_ records: [[String: Any]]) throws {
    let releaseIDs = Set(records.compactMap { $0["release_id"] as? String })
    guard releaseIDs.count == records.count else { throw freshFail("dev-release-record-compatibility-invalid", "rebuild_the_candidate", "Role release IDs are missing or duplicated.") }
    for record in records {
        guard let own = record["release_id"] as? String, let peers = record["compatible_peer_release_ids"] as? [String], peers == peers.sorted(), Set(peers) == releaseIDs.subtracting([own]) else {
            throw freshFail("dev-release-record-compatibility-invalid", "rebuild_the_candidate", "Role release records are not mutually compatible.")
        }
    }
}

private func freshIdentityEvidence(_ identity: FreshCodeIdentity, sha256: String) -> [String: Any] {
    ["sha256": sha256, "cdhash": identity.cdhash, "designatedRequirement": identity.designatedRequirement, "leafSPKISHA256": identity.leafSPKISHA256, "rootCertificateSHA256": identity.rootCertificateSHA256, "architecture": identity.architecture, "entitlementsSHA256": identity.entitlementsSHA256, "hardenedRuntime": identity.hardenedRuntime, "teamID": identity.teamID]
}
private func identitiesRecordSHA(_ records: [[String: Any]], role: String, field: String) -> String { records.first { $0["executable_role"] as? String == role }?[field] as? String ?? "" }

func installFreshCarrier4Candidate(root: URL) throws -> [String: Any] {
    try freshRequireRoot()
    let expectedPrefix = "/Library/Application Support/Nimi/RuntimeDev/bootstrap/"
    guard root.path.hasPrefix(expectedPrefix), UUID(uuidString: root.lastPathComponent) != nil else {
        throw freshFail("dev-candidate-staging-path-invalid", "copy_the_preverified_candidate_to_the_fixed_root_owned_bootstrap_root", "Privileged installation accepts only one UUID child of the fixed bootstrap root.")
    }
    try requireRootOwnedCandidateTree(root)
    let verification = try verifyFreshCarrier4Candidate(root: root)
    let plan = try createFreshInstallPlan(candidateRoot: root.path, profileSHA256: verification["profileSHA256"] as! String)
    let lockFD = try acquireFreshInstallerLock()
    defer { flock(lockFD, LOCK_UN); Darwin.close(lockFD) }
    try requireFreshSystemBaseline(plan)
    try writeFreshJournal(plan)
    do {
        try stageFreshInstall(plan)
        try installFreshHelper(plan)
        try createFreshPrincipal(plan)
        try installFreshPayload(plan)
        try installFreshDesktop(plan)
        try installFreshPlist(plan)
        try provisionFreshCustody()
        try freshLaunchctl(["bootstrap", "system", generatedLaunchDaemonPath])
        try proveFreshInstalledPostcondition(plan)
        try syncFreshCommitDirectories()
        try writeFreshInstallerLedger(plan)
        _ = try verifyFreshInstalledStatus()
        try FileManager.default.removeItem(atPath: plan.candidateRoot)
        try removeEmptyFreshDirectory((plan.candidateRoot as NSString).deletingLastPathComponent)
        try syncFreshDirectory("/Library/Application Support/Nimi/RuntimeDev")
        try removeFreshJournal()
        _ = try freshCarrier4Status()
        return ["status": "installed", "carrier": 4, "transactionID": plan.transactionID, "serviceName": generatedLaunchDaemonLabel, "state": "running", "rollbackState": "not-required", "productAdmission": false]
    } catch {
        let primary = error
        do {
            try rollbackFreshInstall(plan)
        } catch {
            throw freshFail("runtime-service-repair-required", "run_the_explicit_exact_carrier_4_reset", "Fresh installation failed and exact rollback was incomplete.", details: ["primary": String(describing: primary), "rollback": String(describing: error), "transactionID": plan.transactionID])
        }
        throw freshFail("dev-runtime-install-rolled-back", "inspect_the_bounded_failure_before_one_new_attempt", "Fresh installation failed and returned to the proved clean baseline.", details: ["primary": String(describing: primary), "terminalState": "unchanged"])
    }
}

private struct FreshInstallPlan: Codable {
    let schemaVersion: String
    let transactionID: String
    let candidateRoot: String
    let profileSHA256: String
    let identifier: UInt32
    let userGeneratedUID: String
    let groupGeneratedUID: String
}
private struct FreshStagingPaths {
    let runtime: String
    let desktop: String
    let helper: String
    let profile: String
    let plist: String
}
private func freshStagingPaths(_ plan: FreshInstallPlan) -> FreshStagingPaths {
    let suffix = plan.transactionID
    return FreshStagingPaths(
        runtime: "/Library/Application Support/Nimi/RuntimeDev/.active-\(suffix).staging",
        desktop: "/Applications/.Nimi Dev.app.\(suffix).staging",
        helper: "/usr/local/libexec/.nimi-macos-dev-security.\(suffix).staging",
        profile: "/Library/Application Support/Nimi/RuntimeDev/.signing-profile-public.\(suffix).staging",
        plist: "/Library/LaunchDaemons/.ai.nimi.runtime.dev.\(suffix).staging.plist"
    )
}
enum FreshMutationEffect: String, CaseIterable, Hashable { case bootstrap, journal, staging, principal, payload, desktop, helper, plist, custody, launchd, ledger }
enum FreshRecoveryDisposition: Equatable { case clean, rollbackExactEffects, resetRequired }
// This closed model exists solely to exhaust every current mutation boundary and
// effect-ahead combination. Without it, an effect committed before its in-memory
// flag could escape rollback. Native tests enumerate all 2048 subsets; production
// uses the same reverse order while probing actual postconditions.
func freshRollbackOrder(_ observed: Set<FreshMutationEffect>) -> [FreshMutationEffect] {
    [.launchd,.custody,.plist,.desktop,.payload,.principal,.staging,.bootstrap,.ledger,.journal,.helper].filter(observed.contains)
}
func freshRecoveryDisposition(journalPresent:Bool, observed:Set<FreshMutationEffect>, witnessMatches:Bool)->FreshRecoveryDisposition{
    if !journalPresent && observed.isEmpty{return .clean};if journalPresent && witnessMatches{return .rollbackExactEffects};return .resetRequired
}

private func acquireFreshInstallerLock() throws -> Int32 {
    let boundary = "/Library/Application Support/Nimi/RuntimeDev"
    var metadata = stat()
    let fd = open(boundary, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
    guard fd >= 0, fstat(fd, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_uid == 0, metadata.st_gid == 0, metadata.st_mode & 0o777 == 0o755, metadata.st_nlink > 0 else {
        if fd >= 0 { Darwin.close(fd) }
        throw freshFail("runtime-service-repair-required", "inspect_the_fixed_RuntimeDev_boundary", "The shared installer serialization boundary is untrusted.")
    }
    guard fd >= 0, flock(fd, LOCK_EX | LOCK_NB) == 0 else { if fd >= 0 { Darwin.close(fd) }; throw freshFail("dev-runtime-installer-busy", "wait_for_the_exact_existing_transaction", "The exact running installer vnode is already locked.") }
    return fd
}

private func requireRootOwnedCandidateTree(_ root: URL) throws {
    var isDirectory: ObjCBool = false
    var rootMetadata=stat()
    guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue,lstat(root.path,&rootMetadata)==0,rootMetadata.st_uid==0,rootMetadata.st_gid==0,rootMetadata.st_mode&0o022==0 else { throw freshFail("dev-candidate-staging-path-invalid", "repeat_the_fixed_staging_copy", "Root-owned candidate staging is absent.") }
    var traversalError:Error?;let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil, options: [], errorHandler: { _,error in traversalError=error;return false })
    while let url = enumerator?.nextObject() as? URL {
        var metadata=stat(); guard lstat(url.path,&metadata)==0, metadata.st_uid==0, metadata.st_gid==0 else { throw freshFail("dev-candidate-staging-metadata-invalid", "repeat_the_fixed_staging_copy", "Staged candidate ownership is unsafe.", details:["path":url.path]) }
        if metadata.st_mode&S_IFMT == S_IFLNK {
            let target = try FileManager.default.destinationOfSymbolicLink(atPath:url.path)
            guard !target.hasPrefix("/"), !target.split(separator:"/").contains("..") else { throw freshFail("dev-candidate-staging-metadata-invalid", "repeat_the_fixed_staging_copy", "Staged candidate contains an escaping symlink.",details:["path":url.path]) }
        } else if metadata.st_mode&0o022 != 0 { throw freshFail("dev-candidate-staging-metadata-invalid", "repeat_the_fixed_staging_copy", "Staged candidate is group- or world-writable.",details:["path":url.path]) }
    }
    guard traversalError==nil else{throw freshFail("dev-candidate-staging-metadata-invalid","repeat_the_fixed_staging_copy","Staged candidate traversal was incomplete.")}
}
private func requireFreshInstalledTree(_ root:URL)throws{var traversalError:Error?;let urls=[root]+((FileManager.default.enumerator(at:root,includingPropertiesForKeys:nil,errorHandler:{_,error in traversalError=error;return false})?.allObjects as? [URL]) ?? []);for url in urls{var metadata=stat();guard lstat(url.path,&metadata)==0,metadata.st_uid==0,metadata.st_gid==0 else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Installed tree ownership is untrusted.",details:["path":url.path])};if metadata.st_mode&S_IFMT==S_IFLNK{let target=try FileManager.default.destinationOfSymbolicLink(atPath:url.path);guard !target.hasPrefix("/"),!target.split(separator:"/").contains("..") else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Installed tree symlink escapes its root.",details:["path":url.path])}}else if metadata.st_mode&0o022 != 0{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Installed tree is group- or world-writable.",details:["path":url.path])}};guard traversalError==nil else{throw freshFail("runtime-service-untrusted","run_the_exact_reset","Installed tree traversal was incomplete.")}}

private func requireFreshSystemBaseline(_ plan: FreshInstallPlan) throws {
    try freshRequireInstallerParent()
    guard !FileManager.default.fileExists(atPath: legacyProfilePath) else { throw freshFail(generatedLegacyProfileReasonCode, "run_only_the_identity_bound_local_delete_only_cutover", "Exact legacy profile blocks normal carrier-4 installation.") }
    let forbidden = [generatedRuntimeExecutablePath, generatedRuntimeStateRoot, generatedDesktopApplicationPath, generatedLaunchDaemonPath, installationJournalPath, installerLedgerPath, installedPublicProfilePath, generatedDesktopSocketPath, generatedLocalAppSocketPath, generatedInstallerHelperPath, "/private/var/run/nimi-dev"]
    let posixNameAbsent = try freshLookupUser(name: generatedRuntimeAccountName)==nil && freshLookupGroup(name: generatedRuntimeAccountName)==nil
    let authorityAbsent = try freshODPrincipalAbsent() && freshCustodyItemsAbsent()
    guard forbidden.allSatisfy({ !FileManager.default.fileExists(atPath: $0) }), posixNameAbsent, authorityAbsent else {
        throw freshFail("runtime-service-repair-required", "run_the_explicit_exact_carrier_4_reset", "Fresh-install principal, payload, service, socket, custody, journal, or helper baseline is not absent.")
    }
    let staging = freshStagingPaths(plan)
    guard [staging.runtime, staging.desktop, staging.helper, staging.profile, staging.plist].allSatisfy({ !FileManager.default.fileExists(atPath: $0) }) else {
        throw freshFail("runtime-service-repair-required", "remove_only_the_exact_interrupted_staging_after_inspection", "Transaction-scoped activation staging residue exists.")
    }
    let bootstrap = "/Library/Application Support/Nimi/RuntimeDev/bootstrap"
    let children = try FileManager.default.contentsOfDirectory(atPath: bootstrap)
    guard children == [plan.transactionID] else {
        throw freshFail("runtime-service-repair-required", "inspect_the_fixed_bootstrap_root", "Bootstrap root contains an unknown or concurrent candidate.", details: ["entries": children.sorted()])
    }
}

func freshRequireInstallerParent()throws{let parent=(generatedInstallerHelperPath as NSString).deletingLastPathComponent,fd=open(parent,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);var metadata=stat();guard fd>=0,fstat(fd,&metadata)==0,metadata.st_mode&S_IFMT==S_IFDIR,metadata.st_uid==0,metadata.st_gid==0,metadata.st_mode&0o777==0o755,metadata.st_nlink>0 else{if fd>=0{Darwin.close(fd)};throw freshFail("dev-installer-parent-untrusted","prepare_the_fixed_root_owned_installer_parent_before_the_single_retry","The existing fixed installer parent is absent or untrusted.",details:["path":parent])};Darwin.close(fd)}

private func freshCustodyItemsAbsent() throws -> Bool {
    var keychain: SecKeychain?; let openStatus=SecKeychainOpen("/Library/Keychains/System.keychain",&keychain)
    guard openStatus==errSecSuccess, let keychain else { throw freshFail("runtime-service-repair-required", "inspect_System_Keychain_availability", "System Keychain inventory cannot be opened.") }
    for account in generatedRuntimeKeychainAccounts {
        let query:[CFString:Any]=[kSecClass:kSecClassGenericPassword,kSecAttrService:generatedKeychainService,kSecAttrAccount:account,kSecMatchSearchList:[keychain],kSecMatchLimit:kSecMatchLimitOne,kSecReturnAttributes:true]
        let status=SecItemCopyMatching(query as CFDictionary,nil); if status==errSecSuccess{return false}; if status != errSecItemNotFound { throw freshFail("runtime-service-repair-required", "inspect_Runtime_custody_inventory", "Runtime custody inventory query failed.",details:["status":status]) }
    }
    return true
}

private func createFreshInstallPlan(candidateRoot:String,profileSHA256:String)throws->FreshInstallPlan {
    var used=Set<UInt32>(); for id in UInt32(450)...UInt32(499) { let posixUsed=try freshLookupUser(uid:uid_t(id)) != nil || freshLookupGroup(gid:gid_t(id)) != nil;let directoryUsed=try freshODIdentifierUsed(id);if posixUsed || directoryUsed { used.insert(id) } }
    guard let identifier=(UInt32(450)...UInt32(499)).reversed().first(where:{!used.contains($0)}) else { throw freshFail("runtime-principal-identifier-unavailable", "free_one_collision_free_role_account_identifier", "No collision-free role-account UID/GID exists in 450...499.") }
    guard let transactionID=UUID(uuidString:(candidateRoot as NSString).lastPathComponent)?.uuidString.lowercased() else{throw freshFail("dev-candidate-staging-path-invalid","repeat_the_fixed_staging_copy","Candidate staging transaction identifier is invalid.")};return FreshInstallPlan(schemaVersion:"nimi.macos-fresh-install-journal/v1",transactionID:transactionID,candidateRoot:candidateRoot,profileSHA256:profileSHA256,identifier:identifier,userGeneratedUID:UUID().uuidString,groupGeneratedUID:UUID().uuidString)
}

private func writeFreshJournal(_ plan:FreshInstallPlan)throws {
    let data=try JSONEncoder().encode(plan); let parent=(installationJournalPath as NSString).deletingLastPathComponent
    try FileManager.default.createDirectory(atPath:parent,withIntermediateDirectories:true,attributes:[.posixPermissions:0o755,.ownerAccountID:0,.groupOwnerAccountID:0])
    let fd=open(installationJournalPath,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0o600);guard fd>=0 else{throw freshFail("runtime-service-repair-required","inspect_the_install_journal_path","Fresh install journal cannot be created.")}
    let written=data.withUnsafeBytes({Darwin.write(fd,$0.baseAddress,$0.count)}),synced=written==data.count ? fsync(fd):-1;Darwin.close(fd)
    let dir=open(parent,O_RDONLY|O_DIRECTORY|O_CLOEXEC)
    guard written==data.count,synced==0,dir>=0,fsync(dir)==0 else {
        if dir>=0{Darwin.close(dir)}
        if unlink(installationJournalPath)==0{let cleanup=open(parent,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if cleanup>=0{_ = fsync(cleanup);Darwin.close(cleanup)}}
        guard !FileManager.default.fileExists(atPath:installationJournalPath) else{throw freshFail("runtime-service-repair-required","inspect_the_install_journal_storage","Fresh install journal write failed and partial durable state remains.")}
        throw freshFail("dev-install-journal-write-rolled-back","inspect_the_bounded_storage_failure","Fresh install journal could not be durably written; no later effect occurred.")
    }
    Darwin.close(dir)
}

private struct FreshInstallerLedger:Codable{let schemaVersion:String;let transactionID:String;let profileSHA256:String;let identifier:UInt32;let userGeneratedUID:String;let groupGeneratedUID:String}
private func writeFreshInstallerLedger(_ plan:FreshInstallPlan)throws{let ledger=FreshInstallerLedger(schemaVersion:"nimi.macos-fresh-installer-ledger/v1",transactionID:plan.transactionID,profileSHA256:plan.profileSHA256,identifier:plan.identifier,userGeneratedUID:plan.userGeneratedUID,groupGeneratedUID:plan.groupGeneratedUID);let data=try JSONEncoder().encode(ledger);let fd=open(installerLedgerPath,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0o600);guard fd>=0 else{throw freshFail("runtime-service-repair-required","run_the_exact_reset","Installer ledger cannot be created.")};let written=data.withUnsafeBytes({Darwin.write(fd,$0.baseAddress,$0.count)}),synced=written==data.count ? fsync(fd):-1;Darwin.close(fd);guard written==data.count,synced==0 else{throw freshFail("runtime-service-repair-required","run_the_exact_reset","Installer ledger cannot be durably committed.")};try syncFreshDirectory("/Library/Application Support/Nimi/RuntimeDev")}
private func readFreshInstallerLedger()throws->FreshInstallPlan{let retained=try retainFreshFile(URL(fileURLWithPath:installerLedgerPath));defer{retained.close()};guard retained.before.st_uid==0,retained.before.st_gid==0,retained.before.st_mode&0o777==0o600 else{throw freshFail("runtime-service-repair-required","run_the_exact_reset","Installer ledger metadata is invalid.")};let data=try Data(contentsOf:URL(fileURLWithPath:"/dev/fd/\(retained.descriptor)"));let object=try JSONSerialization.jsonObject(with:data) as? [String:Any];guard Set(object?.keys.map{$0} ?? [])==Set(["schemaVersion","transactionID","profileSHA256","identifier","userGeneratedUID","groupGeneratedUID"]),let ledger=try? JSONDecoder().decode(FreshInstallerLedger.self,from:data),ledger.schemaVersion=="nimi.macos-fresh-installer-ledger/v1",UUID(uuidString:ledger.transactionID) != nil,UUID(uuidString:ledger.userGeneratedUID) != nil,UUID(uuidString:ledger.groupGeneratedUID) != nil,(450...499).contains(ledger.identifier) else{throw freshFail("runtime-service-repair-required","run_the_exact_reset","Installer ledger schema or principal witness is invalid.")};return FreshInstallPlan(schemaVersion:"nimi.macos-fresh-install-journal/v1",transactionID:ledger.transactionID,candidateRoot:"/Library/Application Support/Nimi/RuntimeDev/bootstrap/\(ledger.transactionID)",profileSHA256:ledger.profileSHA256,identifier:ledger.identifier,userGeneratedUID:ledger.userGeneratedUID,groupGeneratedUID:ledger.groupGeneratedUID)}

private func createFreshPrincipal(_ plan:FreshInstallPlan)throws {
    let session=try ODSession(options:nil), node=try ODNode(session:session,name:"/Local/Default"), id=String(plan.identifier)
    let group:[AnyHashable:Any]=[kODAttributeTypePrimaryGroupID:[id],kODAttributeTypeFullName:["Nimi Runtime Development Service"],kODAttributeTypeGUID:[plan.groupGeneratedUID]]
    let user:[AnyHashable:Any]=[kODAttributeTypeUniqueID:[id],kODAttributeTypePrimaryGroupID:[id],kODAttributeTypeFullName:["Nimi Runtime Development Service"],kODAttributeTypeNFSHomeDirectory:["/var/empty"],kODAttributeTypeUserShell:["/usr/bin/false"],kODAttributeTypePassword:["*"],kODAttributeTypeGUID:[plan.userGeneratedUID],"dsAttrTypeNative:IsHidden":["YES"]]
    let groupRecord=try node.createRecord(withRecordType:kODRecordTypeGroups,name:generatedRuntimeAccountName,attributes:group);try groupRecord.synchronize()
    do{let userRecord=try node.createRecord(withRecordType:kODRecordTypeUsers,name:generatedRuntimeAccountName,attributes:user);try userRecord.synchronize()}catch{try? groupRecord.delete();throw error}
    try verifyFreshPrincipal(plan)
}

private let freshForbiddenUserAttributes=[kODAttributeTypeAuthenticationAuthority,"dsAttrTypeNative:ShadowHashData",kODAttributeTypePasswordPlus,kODAttributeTypeAltSecurityIdentities,"dsAttrTypeStandard:AuthCredential","dsAttrTypeStandard:AuthMethod",kODAttributeTypeAuthenticationHint,"dsAttrTypeStandard:KDCAuthKey","dsAttrTypeStandard:KerberosServices","dsAttrTypeStandard:KerberosRealm","dsAttrTypeNative:KerberosKeys","dsAttrTypeNative:HeimdalSRPKey","dsAttrTypeNative:SecureTokenVerifierHistory","dsAttrTypeNative:AutoGrantSecureToken","dsAttrTypeNative:LinkedIdentity"]
private let freshMaximumPOSIXLookupBufferSize=1_048_576
struct FreshPOSIXUser:Equatable{let name:String;let uid:UInt32;let gid:UInt32;let home:String;let shell:String}
struct FreshPOSIXGroup:Equatable{let name:String;let gid:UInt32}
private func freshInitialPOSIXBuffer(_ selector:Int32)->Int{let suggested=sysconf(selector);return suggested>0 ? min(max(Int(suggested),16_384),freshMaximumPOSIXLookupBufferSize):16_384}
func freshLookupUser(name:String)throws->FreshPOSIXUser?{try name.withCString{namePointer in try freshLookupUser(probe:"getpwnam_r"){entry,buffer,count,result in getpwnam_r(namePointer,entry,buffer,count,result)}}}
func freshLookupUser(uid:uid_t)throws->FreshPOSIXUser?{try freshLookupUser(probe:"getpwuid_r"){entry,buffer,count,result in getpwuid_r(uid,entry,buffer,count,result)}}
private func freshLookupUser(probe:String,call:(UnsafeMutablePointer<passwd>,UnsafeMutablePointer<CChar>,Int,UnsafeMutablePointer<UnsafeMutablePointer<passwd>?>)->Int32)throws->FreshPOSIXUser?{var size=freshInitialPOSIXBuffer(_SC_GETPW_R_SIZE_MAX);while true{var entry=passwd(),result:UnsafeMutablePointer<passwd>?;var buffer=[CChar](repeating:0,count:size);let code=buffer.withUnsafeMutableBufferPointer{storage in withUnsafeMutablePointer(to:&entry){entryPointer in withUnsafeMutablePointer(to:&result){resultPointer in call(entryPointer,storage.baseAddress!,storage.count,resultPointer)}}};if code==0{guard let record=result else{return nil};guard let name=record.pointee.pw_name,let home=record.pointee.pw_dir,let shell=record.pointee.pw_shell else{throw freshFail("runtime-principal-posix-query-failed","inspect_the_POSIX_identity_projection","POSIX user projection contains null fields.",details:["probe":probe])};return FreshPOSIXUser(name:String(cString:name),uid:UInt32(record.pointee.pw_uid),gid:UInt32(record.pointee.pw_gid),home:String(cString:home),shell:String(cString:shell))};if code==ERANGE,size<freshMaximumPOSIXLookupBufferSize{size=min(size*2,freshMaximumPOSIXLookupBufferSize);continue};throw freshFail("runtime-principal-posix-query-failed","inspect_the_POSIX_identity_projection","POSIX user lookup failed and cannot be treated as absence.",details:["probe":probe,"returnCode":code])}}
func freshLookupGroup(name:String)throws->FreshPOSIXGroup?{try name.withCString{namePointer in try freshLookupGroup(probe:"getgrnam_r"){entry,buffer,count,result in getgrnam_r(namePointer,entry,buffer,count,result)}}}
func freshLookupGroup(gid:gid_t)throws->FreshPOSIXGroup?{try freshLookupGroup(probe:"getgrgid_r"){entry,buffer,count,result in getgrgid_r(gid,entry,buffer,count,result)}}
private func freshLookupGroup(probe:String,call:(UnsafeMutablePointer<group>,UnsafeMutablePointer<CChar>,Int,UnsafeMutablePointer<UnsafeMutablePointer<group>?>)->Int32)throws->FreshPOSIXGroup?{var size=freshInitialPOSIXBuffer(_SC_GETGR_R_SIZE_MAX);while true{var entry=group(),result:UnsafeMutablePointer<group>?;var buffer=[CChar](repeating:0,count:size);let code=buffer.withUnsafeMutableBufferPointer{storage in withUnsafeMutablePointer(to:&entry){entryPointer in withUnsafeMutablePointer(to:&result){resultPointer in call(entryPointer,storage.baseAddress!,storage.count,resultPointer)}}};if code==0{guard let record=result else{return nil};guard let name=record.pointee.gr_name else{throw freshFail("runtime-principal-posix-query-failed","inspect_the_POSIX_identity_projection","POSIX group projection contains a null name.",details:["probe":probe])};return FreshPOSIXGroup(name:String(cString:name),gid:UInt32(record.pointee.gr_gid))};if code==ERANGE,size<freshMaximumPOSIXLookupBufferSize{size=min(size*2,freshMaximumPOSIXLookupBufferSize);continue};throw freshFail("runtime-principal-posix-query-failed","inspect_the_POSIX_identity_projection","POSIX group lookup failed and cannot be treated as absence.",details:["probe":probe,"returnCode":code])}}
private func freshLocalNode()throws->ODNode{try ODNode(session:ODSession(options:nil),name:"/Local/Default")}
private func freshODQuery(_ type:String,_ attribute:String,_ value:String,_ returned:[String])throws->[ODRecord]{let query=try ODQuery(node:freshLocalNode(),forRecordTypes:type,attribute:attribute,matchType:ODMatchType(kODMatchEqualTo),queryValues:value,returnAttributes:returned,maximumResults:2);guard let records=try query.resultsAllowingPartial(false) as? [ODRecord] else{throw freshFail("runtime-principal-directory-query-failed","inspect_OpenDirectory","OpenDirectory returned an invalid projection.")};return records}
private func freshODPrincipalAbsent()throws->Bool{try freshODQuery(kODRecordTypeUsers,kODAttributeTypeRecordName,generatedRuntimeAccountName,[]).isEmpty && freshODQuery(kODRecordTypeGroups,kODAttributeTypeRecordName,generatedRuntimeAccountName,[]).isEmpty}
private func freshODIdentifierUsed(_ id:UInt32)throws->Bool{let value=String(id);return try !freshODQuery(kODRecordTypeUsers,kODAttributeTypeUniqueID,value,[]).isEmpty || !freshODQuery(kODRecordTypeGroups,kODAttributeTypePrimaryGroupID,value,[]).isEmpty}
private func freshODWitnessUsed(_ plan:FreshInstallPlan)throws->Bool{try freshODIdentifierUsed(plan.identifier) || !freshODQuery(kODRecordTypeUsers,kODAttributeTypeGUID,plan.userGeneratedUID,[]).isEmpty || !freshODQuery(kODRecordTypeGroups,kODAttributeTypeGUID,plan.groupGeneratedUID,[]).isEmpty}
private func freshPrincipalProjectionAbsent(_ plan:FreshInstallPlan)throws->Bool{try freshODPrincipalAbsent() && !freshODWitnessUsed(plan) && freshLookupUser(name:generatedRuntimeAccountName)==nil && freshLookupUser(uid:uid_t(plan.identifier))==nil && freshLookupGroup(name:generatedRuntimeAccountName)==nil && freshLookupGroup(gid:gid_t(plan.identifier))==nil}
private func verifyFreshPrincipal(_ plan: FreshInstallPlan) throws {
    let users = try freshODQuery(kODRecordTypeUsers, kODAttributeTypeRecordName, generatedRuntimeAccountName, [kODAttributeTypeUniqueID, kODAttributeTypePrimaryGroupID, kODAttributeTypeGUID, kODAttributeTypeNFSHomeDirectory, kODAttributeTypeUserShell, kODAttributeTypePassword, "dsAttrTypeNative:IsHidden"] + freshForbiddenUserAttributes)
    let groups = try freshODQuery(kODRecordTypeGroups, kODAttributeTypeRecordName, generatedRuntimeAccountName, [kODAttributeTypePrimaryGroupID, kODAttributeTypeGUID, kODAttributeTypeGroupMembership, kODAttributeTypeGroupMembers, kODAttributeTypeNestedGroups])
    guard users.count == 1, groups.count == 1 else { throw freshFail("runtime-principal-directory-state-mismatch", "run_the_exact_reset", "Runtime principal records are absent or ambiguous.") }
    let user = try users[0].recordDetails(forAttributes: nil), group = try groups[0].recordDetails(forAttributes: nil), id = String(plan.identifier)
    func one(_ values: [AnyHashable: Any], _ key: String) -> String? { guard let raw = values[key] as? [Any], raw.count == 1 else { return nil }; return raw[0] as? String }
    func absent(_ values: [AnyHashable: Any], _ key: String) -> Bool { guard let raw = values[key] else { return true }; guard let list = raw as? [Any] else { return false }; return list.isEmpty }
    guard one(user, kODAttributeTypeUniqueID) == id, one(user, kODAttributeTypePrimaryGroupID) == id,
          one(user, kODAttributeTypeGUID) == plan.userGeneratedUID, one(user, kODAttributeTypeNFSHomeDirectory) == "/var/empty",
          one(user, kODAttributeTypeUserShell) == "/usr/bin/false", one(user, kODAttributeTypePassword) == "*", one(user, "dsAttrTypeNative:IsHidden") == "YES",
          one(group, kODAttributeTypePrimaryGroupID) == id, one(group, kODAttributeTypeGUID) == plan.groupGeneratedUID,
          freshForbiddenUserAttributes.allSatisfy({ absent(user, $0) }),
          [kODAttributeTypeGroupMembership, kODAttributeTypeGroupMembers, kODAttributeTypeNestedGroups].allSatisfy({ absent(group, $0) }),
          user.allSatisfy({ !String(describing: $0.key).hasPrefix("dsAttrTypeNative:_writers") || absent(user, String(describing: $0.key)) }) else {
        throw freshFail("runtime-principal-directory-state-mismatch", "run_the_exact_reset", "Runtime principal raw attributes violate the fresh profile.")
    }
    try proveFreshNoExplicitGroupMembership(plan)
    let expectedUser=FreshPOSIXUser(name:generatedRuntimeAccountName,uid:plan.identifier,gid:plan.identifier,home:"/var/empty",shell:"/usr/bin/false"),expectedGroup=FreshPOSIXGroup(name:generatedRuntimeAccountName,gid:plan.identifier)
    let userByName=try freshLookupUser(name:generatedRuntimeAccountName),userByID=try freshLookupUser(uid:uid_t(plan.identifier)),groupByName=try freshLookupGroup(name:generatedRuntimeAccountName),groupByID=try freshLookupGroup(gid:gid_t(plan.identifier))
    guard userByName==expectedUser,userByID==expectedUser,groupByName==expectedGroup,groupByID==expectedGroup else {
        throw freshFail("runtime-principal-directory-state-mismatch", "run_the_exact_reset", "Created Runtime principal failed its POSIX postcondition.")
    }
}

private func proveFreshNoExplicitGroupMembership(_ plan: FreshInstallPlan) throws {
    let query = try ODQuery(node: freshLocalNode(), forRecordTypes: kODRecordTypeGroups, attribute: kODAttributeTypeRecordName, matchType: ODMatchType(kODMatchAny), queryValues: nil, returnAttributes: [kODAttributeTypeRecordName, kODAttributeTypeGroupMembership, kODAttributeTypeGroupMembers, kODAttributeTypeNestedGroups], maximumResults: 0)
    guard let records = try query.resultsAllowingPartial(false) as? [ODRecord] else { throw freshFail("runtime-principal-directory-query-failed", "inspect_OpenDirectory", "The full local-group projection is invalid.") }
    let forbidden = [kODAttributeTypeGroupMembership: generatedRuntimeAccountName, kODAttributeTypeGroupMembers: plan.userGeneratedUID, kODAttributeTypeNestedGroups: plan.groupGeneratedUID]
    for record in records {
        let details = try record.recordDetails(forAttributes: Array(forbidden.keys))
        for (attribute, expected) in forbidden {
            guard let raw = details[attribute] else { continue }
            guard let values = raw as? [Any], values.allSatisfy({ $0 is String }) else { throw freshFail("runtime-principal-directory-state-mismatch", "run_the_exact_reset", "A local-group membership projection is malformed.", details: ["attribute": attribute]) }
            guard !values.compactMap({ $0 as? String }).contains(expected) else { throw freshFail("runtime-principal-directory-state-mismatch", "run_the_exact_reset", "The Runtime principal has a forbidden explicit local-group attachment.", details: ["attribute": attribute]) }
        }
    }
}

private func stageFreshInstall(_ plan: FreshInstallPlan) throws {
    let staging = freshStagingPaths(plan)
    try FileManager.default.createDirectory(atPath: staging.runtime, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755, .ownerAccountID: 0, .groupOwnerAccountID: 0])
    try copyFreshItem("\(plan.candidateRoot)/runtime/bin", "\(staging.runtime)/bin")
    try copyFreshItem("\(plan.candidateRoot)/trust", "\(staging.runtime)/trust")
    try copyFreshItem("\(plan.candidateRoot)/Nimi Dev.app", staging.desktop)
    try copyFreshItem("\(plan.candidateRoot)/installer/nimi-macos-dev-security", staging.helper)
    try copyFreshItem("\(plan.candidateRoot)/signing-profile.json", staging.profile)
    try copyFreshItem("\(plan.candidateRoot)/launchd/ai.nimi.runtime.dev.plist", staging.plist)
    guard chmod(staging.helper, 0o755) == 0, chmod(staging.profile, 0o644) == 0, chmod(staging.plist, 0o644) == 0 else {
        throw freshFail("dev-candidate-staging-metadata-invalid", "run_the_exact_reset", "Transaction-scoped staging modes could not be secured.")
    }
    try proveFreshStagingPostcondition(plan, staging: staging)
}

private func proveFreshStagingPostcondition(_ plan: FreshInstallPlan, staging: FreshStagingPaths) throws {
    let pairs = [
        ("\(plan.candidateRoot)/runtime/bin/nimi-runtime", "\(staging.runtime)/bin/nimi-runtime", "ai.nimi.runtime.dev"),
        ("\(plan.candidateRoot)/Nimi Dev.app/Contents/MacOS/Nimi Dev", "\(staging.desktop)/Contents/MacOS/Nimi Dev", "ai.nimi.apps.nimi.desktop.dev"),
        ("\(plan.candidateRoot)/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev", "\(staging.desktop)/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev", "ai.nimi.apps.nimi.local-app-host.dev"),
        ("\(plan.candidateRoot)/installer/nimi-macos-dev-security", staging.helper, generatedInstallerSigningIdentifier),
    ]
    for (source, target, identifier) in pairs {
        let left = try retainFreshFile(URL(fileURLWithPath: source), executable: true)
        let right = try retainFreshFile(URL(fileURLWithPath: target), executable: true)
        defer { left.close(); right.close() }
        guard left.sha256 == right.sha256 else { throw freshFail("dev-candidate-staging-verification-mismatch", "run_the_exact_reset", "Root-owned staged code differs from the verified candidate.", details: ["path": target]) }
        let codePath = target.contains("/Contents/MacOS/") ? String(target[..<target.range(of: "/Contents/MacOS/")!.lowerBound]) : target
        _ = try inspectFreshCode(at: URL(fileURLWithPath: codePath), expectedIdentifier: identifier, retained: right)
    }
    for (source, target) in [("\(plan.candidateRoot)/signing-profile.json", staging.profile), ("\(plan.candidateRoot)/launchd/ai.nimi.runtime.dev.plist", staging.plist)] {
        let left = try retainFreshFile(URL(fileURLWithPath: source)), right = try retainFreshFile(URL(fileURLWithPath: target)); defer { left.close(); right.close() }
        guard left.sha256 == right.sha256 else { throw freshFail("dev-candidate-staging-verification-mismatch", "run_the_exact_reset", "Root-owned staged metadata differs from the verified candidate.", details: ["path": target]) }
    }
    for record in freshRoles.map(\.recordFilename) {
        let left = try retainFreshFile(URL(fileURLWithPath: "\(plan.candidateRoot)/trust/protected-local/v1/\(record)")), right = try retainFreshFile(URL(fileURLWithPath: "\(staging.runtime)/trust/protected-local/v1/\(record)")); defer { left.close(); right.close() }
        guard left.sha256 == right.sha256 else { throw freshFail("dev-candidate-staging-verification-mismatch", "run_the_exact_reset", "Root-owned staged release record differs from the verified candidate.", details: ["record": record]) }
    }
}

private func installFreshPayload(_ plan:FreshInstallPlan)throws { let staging=freshStagingPaths(plan);guard rename(staging.runtime,"/Library/Application Support/Nimi/RuntimeDev/active")==0 else{throw freshFail("dev-installer-activation-failed","run_the_exact_reset","Runtime staging could not be atomically activated.")};try FileManager.default.createDirectory(atPath:generatedRuntimeStateRoot,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700,.ownerAccountID:plan.identifier,.groupOwnerAccountID:plan.identifier]) }
private func installFreshDesktop(_ plan:FreshInstallPlan)throws{let staging=freshStagingPaths(plan);guard rename(staging.desktop,generatedDesktopApplicationPath)==0 else{throw freshFail("dev-installer-activation-failed","run_the_exact_reset","Desktop staging could not be atomically activated.")}}
private func installFreshHelper(_ plan:FreshInstallPlan)throws{let staging=freshStagingPaths(plan);guard rename(staging.helper,generatedInstallerHelperPath)==0,rename(staging.profile,installedPublicProfilePath)==0 else{throw freshFail("dev-installer-activation-failed","run_the_exact_reset","Final helper or public profile staging could not be atomically activated.")}}
private func installFreshPlist(_ plan:FreshInstallPlan)throws{let staging=freshStagingPaths(plan);guard rename(staging.plist,generatedLaunchDaemonPath)==0 else{throw freshFail("dev-launchd-install-failed","run_the_exact_reset","LaunchDaemon staging could not be atomically activated.")};try FileManager.default.createDirectory(atPath:"/private/var/run/nimi-dev",withIntermediateDirectories:false,attributes:[.posixPermissions:0o755,.ownerAccountID:0,.groupOwnerAccountID:0])}
private func copyFreshItem(_ source:String,_ target:String)throws{guard !FileManager.default.fileExists(atPath:target) else{throw freshFail("runtime-service-repair-required","run_the_exact_reset","An installation target unexpectedly exists.",details:["path":target])};try FileManager.default.copyItem(atPath:source,toPath:target);try recursivelySecureFreshPath(target)}
private func recursivelySecureFreshPath(_ root:String)throws{let urls=[URL(fileURLWithPath:root)]+((FileManager.default.enumerator(at:URL(fileURLWithPath:root),includingPropertiesForKeys:nil)?.allObjects as? [URL]) ?? []);for url in urls{var s=stat();guard lstat(url.path,&s)==0 else{throw freshFail("dev-install-copy-failed","run_the_exact_reset","Copied path cannot be inspected.")};if s.st_mode&S_IFMT != S_IFLNK{guard chown(url.path,0,0)==0 else{throw freshFail("dev-install-copy-failed","run_the_exact_reset","Copied path ownership could not be secured.")};let mode:mode_t=s.st_mode&S_IFMT==S_IFDIR ? 0o755 : ((s.st_mode&0o111) != 0 ? 0o755:0o644);guard chmod(url.path,mode)==0 else{throw freshFail("dev-install-copy-failed","run_the_exact_reset","Copied path mode could not be secured.")}}}}

private func provisionFreshCustody()throws{_ = try runFreshFixed(generatedRuntimeExecutablePath,["macos-protected-state-provision"])}
private func freshLaunchctl(_ arguments:[String])throws{_ = try runFreshFixed("/bin/launchctl",arguments)}
private struct FreshFixedResult { let status: Int32; let stdout: Data; let stderr: Data }
private func runFreshFixedResult(_ executable:String,_ arguments:[String])throws->FreshFixedResult{let process=Process();process.executableURL=URL(fileURLWithPath:executable);process.arguments=arguments;process.environment=["HOME":"/var/empty","LANG":"en_US.UTF-8","PATH":"/usr/bin:/bin:/usr/sbin:/sbin","TMPDIR":"/private/tmp"];let output=Pipe(),errors=Pipe();process.standardInput=FileHandle.nullDevice;process.standardOutput=output;process.standardError=errors;try process.run();process.waitUntilExit();return FreshFixedResult(status:process.terminationStatus,stdout:output.fileHandleForReading.readDataToEndOfFile(),stderr:errors.fileHandleForReading.readDataToEndOfFile())}
private func runFreshFixed(_ executable:String,_ arguments:[String])throws->Data{let result=try runFreshFixedResult(executable,arguments);guard result.status==0 else{throw freshFail("dev-install-fixed-operation-failed","run_the_exact_reset",String(data:result.stderr.prefix(2000),encoding:.utf8) ?? "Fixed operation failed.",details:["executable":executable,"status":result.status])};return result.stdout}
private func freshLaunchdJobPresent()throws->Bool{let result=try runFreshFixedResult("/bin/launchctl",["print","system/\(generatedLaunchDaemonLabel)"]);if result.status==0{return true};if result.status==113{return false};throw freshFail("runtime-service-repair-required","inspect_launchd_system_domain","launchd job presence could not be proved.",details:["status":result.status])}
private func stopFreshLaunchdAndProveAbsent()throws{if try freshLaunchdJobPresent(){try freshLaunchctl(["bootout","system/\(generatedLaunchDaemonLabel)"])};for _ in 0..<100{if try !freshLaunchdJobPresent(){return};usleep(50_000)};throw freshFail("runtime-service-repair-required","inspect_the_live_launchd_job","The Runtime launchd job or process remained present after bootout.")}
private func syncFreshDirectory(_ path:String)throws{let fd=open(path,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);guard fd>=0 else{throw freshFail("runtime-service-repair-required","inspect_the_exact_install_directory","A transaction directory cannot be opened for durability.",details:["path":path,"errno":errno])};let status=fsync(fd);Darwin.close(fd);guard status==0 else{throw freshFail("runtime-service-repair-required","inspect_the_exact_install_directory","A transaction directory could not be durably synchronized.",details:["path":path,"errno":errno])}}
private func syncFreshCommitDirectories()throws{for path in ["/Library/Application Support/Nimi/RuntimeDev","/Applications","/usr/local/libexec","/Library/LaunchDaemons","/private/var/run/nimi-dev"]{try syncFreshDirectory(path)}}
private func proveFreshInstalledPostcondition(_ plan:FreshInstallPlan)throws{
    let pairs=[("\(plan.candidateRoot)/runtime/bin/nimi-runtime",generatedRuntimeExecutablePath),("\(plan.candidateRoot)/Nimi Dev.app/Contents/MacOS/Nimi Dev",generatedDesktopExecutablePath),("\(plan.candidateRoot)/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev",generatedLocalAppHostPath),("\(plan.candidateRoot)/installer/nimi-macos-dev-security",generatedInstallerHelperPath),("\(plan.candidateRoot)/launchd/ai.nimi.runtime.dev.plist",generatedLaunchDaemonPath)]
    for (source,target) in pairs{let left=try retainFreshFile(URL(fileURLWithPath:source),executable:source != "\(plan.candidateRoot)/launchd/ai.nimi.runtime.dev.plist"),right=try retainFreshFile(URL(fileURLWithPath:target),executable:target != generatedLaunchDaemonPath);defer{left.close();right.close()};guard left.sha256==right.sha256 else{throw freshFail("dev-installed-postcondition-mismatch","run_the_exact_reset","Installed artifact differs from the retained verified candidate.",details:["path":target])};try right.proveStable()}
    for record in freshRoles.map(\.recordFilename){let source=try retainFreshFile(URL(fileURLWithPath:"\(plan.candidateRoot)/trust/protected-local/v1/\(record)")),target=try retainFreshFile(URL(fileURLWithPath:"\(generatedTrustRecordRoot)/\(record)"));defer{source.close();target.close()};guard source.sha256==target.sha256 else{throw freshFail("dev-installed-postcondition-mismatch","run_the_exact_reset","Installed release record differs from the retained candidate.",details:["record":record])}}
    let installedRoles=[(generatedRuntimeExecutablePath,"ai.nimi.runtime.dev"),(generatedDesktopApplicationPath,"ai.nimi.apps.nimi.desktop.dev"),("/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app","ai.nimi.apps.nimi.local-app-host.dev"),(generatedInstallerHelperPath,generatedInstallerSigningIdentifier)]
    for (codePath,identifier) in installedRoles{let executablePath=codePath.hasSuffix(".app") ? (identifier=="ai.nimi.apps.nimi.desktop.dev" ? generatedDesktopExecutablePath:generatedLocalAppHostPath):codePath;let retained=try retainFreshFile(URL(fileURLWithPath:executablePath),executable:true);defer{retained.close()};_ = try inspectFreshCode(at:URL(fileURLWithPath:codePath),expectedIdentifier:identifier,retained:retained)}
    for socket in [generatedDesktopSocketPath,generatedLocalAppSocketPath]{var metadata=stat();guard lstat(socket,&metadata)==0,metadata.st_mode&S_IFMT==S_IFSOCK,metadata.st_uid==0,metadata.st_gid==20,metadata.st_mode&0o777==0o660 else{throw freshFail("runtime-service-unavailable","run_the_exact_reset","launchd socket postcondition is invalid.",details:["path":socket])}}
    let output=try runFreshFixed("/bin/launchctl",["print","system/\(generatedLaunchDaemonLabel)"]);guard let text=String(data:output,encoding:.utf8),let match=text.range(of:#"pid = ([1-9][0-9]*)"#,options:.regularExpression),let pid=Int32(text[match].split(separator:" ").last!),kill(pid,0)==0 else{throw freshFail("runtime-service-unavailable","run_the_exact_reset","Installed service did not reach explicit launchd PID liveness.")}
}

private func freshObservedEffects(_ plan:FreshInstallPlan)throws->Set<FreshMutationEffect>{
    let staging=freshStagingPaths(plan);var observed=Set<FreshMutationEffect>()
    if FileManager.default.fileExists(atPath:plan.candidateRoot)||FileManager.default.fileExists(atPath:(plan.candidateRoot as NSString).deletingLastPathComponent){observed.insert(.bootstrap)}
    if FileManager.default.fileExists(atPath:installationJournalPath){observed.insert(.journal)}
    if [staging.runtime,staging.desktop,staging.helper,staging.profile,staging.plist].contains(where:{FileManager.default.fileExists(atPath:$0)}){observed.insert(.staging)}
    if try !freshPrincipalProjectionAbsent(plan){observed.insert(.principal)}
    if [generatedRuntimeExecutablePath,generatedRuntimeStateRoot,installedPublicProfilePath].contains(where:{FileManager.default.fileExists(atPath:$0)}){observed.insert(.payload)}
    if FileManager.default.fileExists(atPath:generatedDesktopApplicationPath){observed.insert(.desktop)}
    if FileManager.default.fileExists(atPath:generatedInstallerHelperPath){observed.insert(.helper)}
    if [generatedLaunchDaemonPath,"/private/var/run/nimi-dev"].contains(where:{FileManager.default.fileExists(atPath:$0)}){observed.insert(.plist)}
    if try !freshCustodyItemsAbsent(){observed.insert(.custody)}
    if try freshLaunchdJobPresent(){observed.insert(.launchd)}
    if FileManager.default.fileExists(atPath:installerLedgerPath){observed.insert(.ledger)}
    return observed
}

private func rollbackFreshInstall(_ plan:FreshInstallPlan)throws{
    let staging=freshStagingPaths(plan),observed=try freshObservedEffects(plan),effective=observed.union([.journal,.helper])
    for effect in freshRollbackOrder(effective){
        do{
            switch effect{
            case .launchd:
                try stopFreshLaunchdAndProveAbsent()
                for path in [generatedDesktopSocketPath,generatedLocalAppSocketPath]{if unlink(path) != 0 && errno != ENOENT{throw freshFail("runtime-service-repair-required","inspect_the_exact_launchd_socket","A fixed launchd socket could not be removed.",details:["path":path])}}
            case .custody:
                guard FileManager.default.fileExists(atPath:generatedRuntimeExecutablePath) else{throw freshFail("runtime-service-repair-required","preserve_the_recovery_witness","Runtime custody exists without the verified Runtime needed for exact reset.")}
                _ = try runFreshFixed(generatedRuntimeExecutablePath,["macos-protected-state-reset"])
            case .plist:
                if FileManager.default.fileExists(atPath:generatedLaunchDaemonPath){try FileManager.default.removeItem(atPath:generatedLaunchDaemonPath)}
                if FileManager.default.fileExists(atPath:"/private/var/run/nimi-dev"){try FileManager.default.removeItem(atPath:"/private/var/run/nimi-dev")}
            case .desktop:
                if FileManager.default.fileExists(atPath:generatedDesktopApplicationPath){try FileManager.default.removeItem(atPath:generatedDesktopApplicationPath)}
            case .payload:
                for path in [installedPublicProfilePath,"/Library/Application Support/Nimi/RuntimeDev/active",generatedRuntimeStateRoot]{if FileManager.default.fileExists(atPath:path){try FileManager.default.removeItem(atPath:path)}}
            case .principal:
                try deleteFreshPrincipal(plan)
            case .staging:
                for path in [staging.runtime,staging.desktop,staging.helper,staging.profile,staging.plist]{if FileManager.default.fileExists(atPath:path){try FileManager.default.removeItem(atPath:path)}}
            case .bootstrap:
                if FileManager.default.fileExists(atPath:plan.candidateRoot){try FileManager.default.removeItem(atPath:plan.candidateRoot)}
                try removeEmptyFreshDirectory((plan.candidateRoot as NSString).deletingLastPathComponent)
            case .ledger:
                try proveFreshReadyForWitnessRemoval(plan)
                if FileManager.default.fileExists(atPath:installerLedgerPath){try FileManager.default.removeItem(atPath:installerLedgerPath)}
                try syncFreshDirectory("/Library/Application Support/Nimi/RuntimeDev")
            case .journal:
                try proveFreshReadyForWitnessRemoval(plan)
                try removeFreshJournal();try removeEmptyFreshDirectory("/Library/Application Support/Nimi/RuntimeDev")
            case .helper:
                try removeFreshRecoveryHelperLast()
            }
        }catch{throw freshFail("runtime-service-repair-required","retry_only_the_explicit_exact_carrier_4_reset","Rollback stopped at the first failed observed effect and retained all later recovery authority.",details:["effect":effect.rawValue,"failure":String(describing:error),"observedEffects":observed.map(\.rawValue).sorted()])}
    }
    try proveFreshCleanTerminal(plan)
}
private func deleteFreshPrincipal(_ plan: FreshInstallPlan) throws {
    try proveFreshNoExplicitGroupMembership(plan)
    let user = try freshDeletionRecord(type:kODRecordTypeUsers, plan:plan),group = try freshDeletionRecord(type:kODRecordTypeGroups, plan:plan)
    if let user { try user.delete() }
    if let group { try group.delete() }
    guard try freshPrincipalProjectionAbsent(plan) else { throw freshFail("runtime-principal-directory-state-mismatch", "inspect_the_exact_principal", "Principal deletion did not prove raw OpenDirectory and POSIX name, UID/GID, and GeneratedUID witness absence.") }
}

private func freshDeletionRecord(type:String,plan:FreshInstallPlan)throws->ODRecord?{
    let isUser=type==kODRecordTypeUsers,id=String(plan.identifier),guid=isUser ? plan.userGeneratedUID:plan.groupGeneratedUID,idAttribute=isUser ? kODAttributeTypeUniqueID:kODAttributeTypePrimaryGroupID
    let returned=[kODAttributeTypeRecordName,kODAttributeTypeGUID,kODAttributeTypeUniqueID,kODAttributeTypePrimaryGroupID]
    let byName=try freshODQuery(type,kODAttributeTypeRecordName,generatedRuntimeAccountName,returned),byID=try freshODQuery(type,idAttribute,id,returned),byGUID=try freshODQuery(type,kODAttributeTypeGUID,guid,returned)
    if byName.isEmpty && byID.isEmpty && byGUID.isEmpty{return nil}
    guard byName.count==1,byID.count==1,byGUID.count==1 else{throw freshFail("runtime-principal-directory-state-mismatch","inspect_the_exact_principal","Principal name, UID/GID, and GeneratedUID indexes are incomplete or ambiguous before deletion.",details:["recordType":type,"nameCount":byName.count,"identifierCount":byID.count,"guidCount":byGUID.count])}
    for record in [byName[0],byID[0],byGUID[0]]{let details=try record.recordDetails(forAttributes:returned);let nameExact=(details[kODAttributeTypeRecordName] as? [String])==[generatedRuntimeAccountName],guidExact=(details[kODAttributeTypeGUID] as? [String])==[guid],identifierExact=isUser ? (details[kODAttributeTypeUniqueID] as? [String])==[id] && (details[kODAttributeTypePrimaryGroupID] as? [String])==[id]:(details[kODAttributeTypePrimaryGroupID] as? [String])==[id];guard nameExact,guidExact,identifierExact else{throw freshFail("runtime-principal-directory-state-mismatch","inspect_the_exact_principal","Principal name, UID/GID, or GeneratedUID witness mismatch blocks every deletion.",details:["recordType":type])}}
    return byName[0]
}
func restartFreshCarrier4Service()throws->[String:Any]{try freshRequireRoot();let lock=try acquireFreshInstallerLock();defer{flock(lock,LOCK_UN);Darwin.close(lock)};_ = try verifyFreshInstalledStatus();let before=try freshLaunchdPID();try freshLaunchctl(["kickstart","-k","system/\(generatedLaunchDaemonLabel)"]);for _ in 0..<100{usleep(100_000);if let after=try? freshLaunchdPID(),after != before{return["status":"restarted","previousPID":before,"pid":after,"serviceName":generatedLaunchDaemonLabel,"productAdmission":false]}};throw freshFail("runtime-service-unavailable","inspect_launchd_logs","Runtime did not reach a new live PID after restart.")}
func uninstallFreshCarrier4Service()throws->[String:Any]{
    try freshRequireRoot();let lock=try acquireFreshInstallerLock();defer{flock(lock,LOCK_UN);Darwin.close(lock)};_ = try verifyFreshInstalledStatus();let plan=try readFreshInstallerLedger();try rollbackFreshInstall(plan)
    return["status":"uninstalled","terminalState":"clean-unprovisioned","signingIdentitiesPreserved":true,"productAdmission":false]
}
private func freshLaunchdPID()throws->Int32{let data=try runFreshFixed("/bin/launchctl",["print","system/\(generatedLaunchDaemonLabel)"]),text=String(data:data,encoding:.utf8) ?? "";guard let match=text.range(of:#"pid = ([1-9][0-9]*)"#,options:.regularExpression),let pid=Int32(text[match].split(separator:" ").last!),kill(pid,0)==0 else{throw freshFail("runtime-service-unavailable","inspect_launchd_logs","Runtime launchd PID is absent or not live.")};return pid}

func resetFreshCarrier4CurrentState()throws->[String:Any]{
    try freshRequireRoot();guard !FileManager.default.fileExists(atPath:legacyProfilePath) else{throw freshFail(generatedLegacyProfileReasonCode,"run_only_the_identity_bound_local_delete_only_cutover","Normal carrier-4 reset cannot delete a legacy profile.")};let lockFD=try acquireFreshInstallerLock();defer{flock(lockFD,LOCK_UN);Darwin.close(lockFD)};let plan=FileManager.default.fileExists(atPath:installationJournalPath) ? try readFreshJournal():try readFreshInstallerLedger();try rollbackFreshInstall(plan);return["status":"reset","carrier":4,"transactionID":plan.transactionID,"terminalState":"clean-unprovisioned","signingIdentitiesPreserved":true,"productAdmission":false]
}
private func readFreshJournal()throws->FreshInstallPlan{let retained=try retainFreshFile(URL(fileURLWithPath:installationJournalPath));defer{retained.close()};guard retained.before.st_uid==0,retained.before.st_gid==0,retained.before.st_mode&0o777==0o600 else{throw freshFail("runtime-service-repair-required","inspect_the_exact_install_journal","Install journal metadata is invalid.")};let data=try Data(contentsOf:URL(fileURLWithPath:"/dev/fd/\(retained.descriptor)"));let object=try JSONSerialization.jsonObject(with:data) as? [String:Any];guard Set(object?.keys.map { $0 } ?? [])==Set(["schemaVersion","transactionID","candidateRoot","profileSHA256","identifier","userGeneratedUID","groupGeneratedUID"]),let plan=try? JSONDecoder().decode(FreshInstallPlan.self,from:data),plan.schemaVersion=="nimi.macos-fresh-install-journal/v1",UUID(uuidString:plan.transactionID) != nil,plan.candidateRoot=="/Library/Application Support/Nimi/RuntimeDev/bootstrap/\(plan.transactionID)" else{throw freshFail("runtime-service-repair-required","inspect_the_exact_install_journal","Install journal schema or fixed bindings are invalid.")};return plan}
private func removeEmptyFreshDirectory(_ path:String)throws{if rmdir(path) != 0 && errno != ENOENT{throw freshFail("runtime-service-repair-required","inspect_the_exact_empty_directory","An exact transaction directory was nonempty or could not be removed.",details:["path":path,"errno":errno])}}
private func removeFreshJournal()throws{if unlink(installationJournalPath) != 0 && errno != ENOENT{throw freshFail("runtime-service-repair-required","inspect_the_install_journal","Install journal could not be removed.")};try syncFreshDirectory("/Library/Application Support/Nimi/RuntimeDev")}
private func removeFreshRecoveryHelperLast()throws{if FileManager.default.fileExists(atPath:generatedInstallerHelperPath){try FileManager.default.removeItem(atPath:generatedInstallerHelperPath)};if FileManager.default.fileExists(atPath:"/usr/local/libexec"){try syncFreshDirectory("/usr/local/libexec")};guard !FileManager.default.fileExists(atPath:generatedInstallerHelperPath) else{throw freshFail("runtime-service-repair-required","inspect_the_recovery_helper_path","The recovery helper could not be removed after all other effects were absent.")}}
private func proveFreshReadyForWitnessRemoval(_ plan:FreshInstallPlan)throws{let authorityAbsent=try !freshLaunchdJobPresent() && freshPrincipalProjectionAbsent(plan) && freshCustodyItemsAbsent(),stagingAbsent=try freshActivationStagingResidue().isEmpty;guard authorityAbsent,stagingAbsent,[generatedRuntimeExecutablePath,generatedRuntimeStateRoot,generatedDesktopApplicationPath,generatedLaunchDaemonPath,installedPublicProfilePath,generatedDesktopSocketPath,generatedLocalAppSocketPath,"/private/var/run/nimi-dev","/Library/Application Support/Nimi/RuntimeDev/bootstrap"].allSatisfy({!FileManager.default.fileExists(atPath:$0)}) else{throw freshFail("runtime-service-repair-required","preserve_the_recovery_witness","Rollback cannot remove its ledger or journal until every external effect is proved absent.")}}
private func proveFreshCleanTerminal(_ plan:FreshInstallPlan)throws{let authorityAbsent=try !freshLaunchdJobPresent() && freshPrincipalProjectionAbsent(plan) && freshCustodyItemsAbsent(),stagingAbsent=try freshActivationStagingResidue().isEmpty;guard authorityAbsent,stagingAbsent,[generatedRuntimeExecutablePath,generatedDesktopApplicationPath,generatedLaunchDaemonPath,generatedInstallerHelperPath,installedPublicProfilePath,installerLedgerPath,installationJournalPath,generatedDesktopSocketPath,generatedLocalAppSocketPath,"/private/var/run/nimi-dev","/Library/Application Support/Nimi/RuntimeDev"].allSatisfy({!FileManager.default.fileExists(atPath:$0)}) else{throw freshFail("runtime-service-repair-required","inspect_the_exact_carrier_4_namespace","The current carrier-4 namespace did not reach the proved clean terminal state.")}}

private extension Digest { var hex: String { map { String(format: "%02x", $0) }.joined() } }
private extension Data {
    init?(base64URLEncoded value: String) { guard value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return nil }; let padding=String(repeating:"=",count:(4-value.count%4)%4); self.init(base64Encoded:value.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")+padding) }
}
