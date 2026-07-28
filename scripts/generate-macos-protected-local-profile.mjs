#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((value) => value !== '--check')) throw new Error('generator accepts only --check');
const readYAML = async (relative) => YAML.parse(await readFile(path.join(root, relative), 'utf8'));
const SOURCE_RELATIVE = 'config/runtime-macos-protected-local-development-profile.yaml';
const PROFILE_FIELDS = Object.freeze([
  'admission', 'profileId', 'carrier', 'legacyReasonCode', 'environment',
  'identityClass', 'signatureAlgorithm', 'signerPolicyId', 'runtimeServiceLabel',
  'runtimeAccountName', 'runtimeExecutablePath', 'runtimeStateRoot', 'trustRecordRoot',
  'desktopApplicationPath', 'desktopExecutablePath', 'localAppHostPath',
  'launchDaemonPath', 'runtimeSigningIdentifier', 'desktopSigningIdentifier',
  'localAppHostSigningIdentifier', 'installerSigningIdentifier',
  'releaseRecordSchemaVersion', 'architecture', 'runtimeTrustSetId',
  'desktopTrustSetId', 'localAppHostTrustSetId', 'desktopSocketActivationName',
  'localAppSocketActivationName', 'desktopSocketPath', 'localAppSocketPath',
  'keychainService', 'runtimeKeychainAccounts', 'signingKeychainRelativePath',
  'helperPath', 'freshProfileSchemaVersion',
]);
const document = await readYAML(SOURCE_RELATIVE);
if (!document || typeof document !== 'object' || Array.isArray(document) || document.version !== 1) {
  throw new Error('macOS protected-local development profile version must be 1');
}
if (Object.keys(document).some((field) => field !== 'version' && field !== 'profile')) {
  throw new Error('macOS protected-local development profile contains unknown top-level fields');
}
const rawProfile = document.profile;
if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
  throw new Error('macOS protected-local development profile must define profile');
}
for (const field of Object.keys(rawProfile)) {
  if (!PROFILE_FIELDS.includes(field)) throw new Error(`macOS protected-local development profile contains unknown field: ${field}`);
}
for (const field of PROFILE_FIELDS) {
  if (!(field in rawProfile)) throw new Error(`macOS protected-local development profile is missing field: ${field}`);
}
for (const field of PROFILE_FIELDS) {
  if (field === 'carrier' || field === 'releaseRecordSchemaVersion' || field === 'runtimeKeychainAccounts') continue;
  if (typeof rawProfile[field] !== 'string' || rawProfile[field].trim() !== rawProfile[field] || rawProfile[field].length === 0) {
    throw new Error(`macOS protected-local development profile ${field} must be a non-empty trimmed string`);
  }
}
for (const field of ['carrier', 'releaseRecordSchemaVersion']) {
  if (!Number.isInteger(rawProfile[field]) || rawProfile[field] <= 0) {
    throw new Error(`macOS protected-local development profile ${field} must be a positive integer`);
  }
}
if (!Array.isArray(rawProfile.runtimeKeychainAccounts)
  || rawProfile.runtimeKeychainAccounts.length === 0
  || new Set(rawProfile.runtimeKeychainAccounts).size !== rawProfile.runtimeKeychainAccounts.length
  || rawProfile.runtimeKeychainAccounts.some((value) => typeof value !== 'string' || value.trim() !== value || value.length === 0)) {
  throw new Error('macOS protected-local development profile runtimeKeychainAccounts must be unique non-empty strings');
}
const P = Object.freeze(Object.fromEntries(PROFILE_FIELDS.map((field) => [field, rawProfile[field]])));
if (P.carrier !== 4 || P.admission !== 'local_development_candidate_fail_closed_pending_real_acceptance') throw new Error('fresh carrier-4 candidate authority required');
const plist = renderPlist(P);
const outputs = new Map([
  ['runtime/internal/protectedlocal/macos_contract_local_development_darwin.go', renderGo(P)],
  ['kit/shell/protected-local/src/macos_profile_local_development.rs', renderRust(P)],
  ['kit/shell/protected-local/src/macos_profile_local_development.h', renderHeader(P)],
  ['apps/desktop/scripts/generated/macos-local-development-profile.mjs', renderJS(P)],
  ['apps/desktop/macos/generated/macos_local_development_profile.swift', renderSwift(P, sha256(plist))],
  ['apps/desktop/macos/generated/ai.nimi.runtime.dev.plist', plist],
]);
const drift=[];
for(const [relative,content] of outputs){const target=path.join(root,relative);if(check){if(await readFile(target,'utf8').catch(()=>undefined)!==content)drift.push(relative);}else{await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}}
if(drift.length) throw new Error(`macOS protected-local generated profile drift: ${drift.join(', ')}`);
process.stdout.write(`${JSON.stringify({status:check?'current':'generated',outputs:[...outputs.keys()]})}\n`);
function banner(prefix='//'){return `${prefix} Code generated from ${SOURCE_RELATIVE}; canonical constraints live under .nimi/spec; DO NOT EDIT.\n`;}
function renderJS(p){return `${banner()}export const MACOS_LOCAL_DEVELOPMENT_PROFILE = Object.freeze(${JSON.stringify(p,null,2)});\n`;}
function renderSwift(p,plistHash){const q=JSON.stringify;return `${banner()}let generatedProfileID = ${q(p.profileId)}\nlet generatedProfileAdmission = ${q(p.admission)}\nlet generatedProfileEnvironment = ${q(p.environment)}\nlet generatedProfileIdentityClass = ${q(p.identityClass)}\nlet generatedRuntimePrincipalCarrierContractVersion = ${p.carrier}\nlet generatedLegacyProfileReasonCode = ${q(p.legacyReasonCode)}\nlet generatedFreshProfileSchemaVersion = ${q(p.freshProfileSchemaVersion)}\nlet generatedInstallerHelperPath = ${q(p.helperPath)}\nlet generatedInstallerSigningIdentifier = ${q(p.installerSigningIdentifier)}\nlet generatedReleaseRecordSchemaVersion = ${p.releaseRecordSchemaVersion}\nlet generatedRequiredArchitecture = ${q(p.architecture)}\nlet generatedRuntimeExecutablePath = ${q(p.runtimeExecutablePath)}\nlet generatedRuntimeStateRoot = ${q(p.runtimeStateRoot)}\nlet generatedTrustRecordRoot = ${q(p.trustRecordRoot)}\nlet generatedDesktopApplicationPath = ${q(p.desktopApplicationPath)}\nlet generatedDesktopExecutablePath = ${q(p.desktopExecutablePath)}\nlet generatedLocalAppHostPath = ${q(p.localAppHostPath)}\nlet generatedLaunchDaemonPath = ${q(p.launchDaemonPath)}\nlet generatedLaunchDaemonLabel = ${q(p.runtimeServiceLabel)}\nlet generatedLaunchDaemonSHA256 = ${q(plistHash)}\nlet generatedRuntimeAccountName = ${q(p.runtimeAccountName)}\nlet generatedDesktopSocketPath = ${q(p.desktopSocketPath)}\nlet generatedLocalAppSocketPath = ${q(p.localAppSocketPath)}\nlet generatedKeychainService = ${q(p.keychainService)}\nlet generatedRuntimeKeychainAccounts = ${JSON.stringify(p.runtimeKeychainAccounts)}\n`;}
function renderGo(p){return `//go:build darwin && nimi_macos_local_development\n\n${banner()}package protectedlocal\nconst (\n MacOSReleaseRecordSchemaVersion=${p.releaseRecordSchemaVersion}\n MacOSRequiredArchitecture=${JSON.stringify(p.architecture)}\n MacOSRuntimeServiceLabel=${JSON.stringify(p.runtimeServiceLabel)}\n MacOSRuntimeAccountName=${JSON.stringify(p.runtimeAccountName)}\n MacOSRuntimeExecutablePath=${JSON.stringify(p.runtimeExecutablePath)}\n MacOSDesktopExecutablePath=${JSON.stringify(p.desktopExecutablePath)}\n MacOSDesktopApplicationPath=${JSON.stringify(p.desktopApplicationPath)}\n MacOSLocalAppHostPath=${JSON.stringify(p.localAppHostPath)}\n MacOSRuntimeStateRoot=${JSON.stringify(p.runtimeStateRoot)}\n MacOSReleaseTrustRecordRoot=${JSON.stringify(p.trustRecordRoot)}\n MacOSKeychainService=${JSON.stringify(p.keychainService)}\n MacOSDesktopSocketActivationName=${JSON.stringify(p.desktopSocketActivationName)}\n MacOSLocalAppSocketActivationName=${JSON.stringify(p.localAppSocketActivationName)}\n MacOSDesktopSocketPath=${JSON.stringify(p.desktopSocketPath)}\n MacOSLocalAppSocketPath=${JSON.stringify(p.localAppSocketPath)}\n MacOSRuntimeSigningIdentifier=${JSON.stringify(p.runtimeSigningIdentifier)}\n MacOSDesktopSigningIdentifier=${JSON.stringify(p.desktopSigningIdentifier)}\n MacOSLocalAppHostIdentifier=${JSON.stringify(p.localAppHostSigningIdentifier)}\n MacOSDesktopTrustSetID=${JSON.stringify(p.desktopTrustSetId)}\n MacOSRuntimeTrustSetID=${JSON.stringify(p.runtimeTrustSetId)}\n MacOSLocalAppHostTrustSet=${JSON.stringify(p.localAppHostTrustSetId)}\n macOSProfileRequiresTrustedAnchor=false\n macOSProfileRequiresNotarization=false\n)\nfunc validMacOSProfileTeamID(value string)bool{return value==\"\"}\nfunc validMacOSProfileLeafSPKI(value string)bool{return validLowerHex(value,64)}\n`;}
function renderRust(p){return `${banner()}pub(crate) const RECORD_ROOT:&str=${JSON.stringify(p.trustRecordRoot)};\npub(crate) const RECORD_SCHEMA_VERSION:u64=${p.releaseRecordSchemaVersion};\npub(crate) const REQUIRED_ARCHITECTURE:&str=${JSON.stringify(p.architecture)};\npub(crate) const ENVIRONMENT:&str=${JSON.stringify(p.environment)};\npub(crate) const IDENTITY_CLASS:&str=${JSON.stringify(p.identityClass)};\npub(crate) const SIGNATURE_ALGORITHM:&str=${JSON.stringify(p.signatureAlgorithm)};\npub(crate) const SIGNER_POLICY_ID:&str=${JSON.stringify(p.signerPolicyId)};\npub(crate) const RUNTIME_TRUST_SET_ID:&str=${JSON.stringify(p.runtimeTrustSetId)};\npub(crate) const DESKTOP_TRUST_SET_ID:&str=${JSON.stringify(p.desktopTrustSetId)};\npub(crate) const RUNTIME_SIGNING_IDENTIFIER:&str=${JSON.stringify(p.runtimeSigningIdentifier)};\npub(crate) const DESKTOP_SIGNING_IDENTIFIER:&str=${JSON.stringify(p.desktopSigningIdentifier)};\npub(crate) const RUNTIME_SERVICE_PRINCIPAL:&str=${JSON.stringify(p.runtimeAccountName)};\npub(crate) const RUNTIME_SOCKET_PATH:&str=${JSON.stringify(p.desktopSocketPath)};\npub(crate) const LOCAL_APP_SOCKET_PATH:&str=${JSON.stringify(p.localAppSocketPath)};\npub(crate) const RUNTIME_EXECUTABLE_PATH:&str=${JSON.stringify(p.runtimeExecutablePath)};\npub(crate) const DESKTOP_APPLICATION_PATH:&str=${JSON.stringify(p.desktopApplicationPath)};\npub(crate) const LOCAL_APP_HOST_PATH:&str=${JSON.stringify(p.localAppHostPath)};\npub(crate) const REQUIRE_TRUSTED_ANCHOR:bool=false;\npub(crate) const REQUIRE_NOTARIZATION:bool=false;\npub(crate) const ROOT_KEY_ID:Option<&str>=option_env!(\"NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_KEY_ID\");\npub(crate) const ROOT_PUBLIC_KEY_B64URL:Option<&str>=option_env!(\"NIMI_MACOS_LOCAL_DEVELOPMENT_RELEASE_ROOT_PUBLIC_KEY_B64URL\");\n`;}
function renderHeader(p){return `/* Code generated from ${SOURCE_RELATIVE}; canonical constraints live under .nimi/spec; DO NOT EDIT. */\n#define NIMI_MACOS_RUNTIME_ACCOUNT ${JSON.stringify(p.runtimeAccountName)}\n#define NIMI_MACOS_RUNTIME_SOCKET_DIRECTORY \"/private/var/run/nimi-dev\"\n#define NIMI_MACOS_RUNTIME_SOCKET ${JSON.stringify(p.desktopSocketPath)}\n#define NIMI_MACOS_LOCAL_APP_SOCKET ${JSON.stringify(p.localAppSocketPath)}\n#define NIMI_MACOS_RUNTIME_EXECUTABLE ${JSON.stringify(p.runtimeExecutablePath)}\n#define NIMI_MACOS_DESKTOP_APPLICATION ${JSON.stringify(p.desktopApplicationPath)}\n#define NIMI_MACOS_LOCAL_APP_HOST ${JSON.stringify(p.localAppHostPath)}\n#define NIMI_MACOS_LAUNCHD_PLIST ${JSON.stringify(p.launchDaemonPath)}\n#define NIMI_MACOS_SMAPP_PLIST \"\"\n`;}
function renderPlist(p){return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${p.runtimeServiceLabel}</string>\n<key>ProgramArguments</key><array><string>${p.runtimeExecutablePath}</string><string>serve</string></array>\n<key>UserName</key><string>${p.runtimeAccountName}</string><key>GroupName</key><string>${p.runtimeAccountName}</string><key>InitGroups</key><false/>\n<key>Umask</key><integer>63</integer><key>ProcessType</key><string>Standard</string><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>20</integer><key>AbandonProcessGroup</key><false/>\n<key>Sockets</key><dict><key>${p.desktopSocketActivationName}</key><dict><key>SockPathName</key><string>${p.desktopSocketPath}</string><key>SockPathOwner</key><integer>0</integer><key>SockPathGroup</key><integer>20</integer><key>SockPathMode</key><integer>432</integer><key>SockType</key><string>stream</string></dict><key>${p.localAppSocketActivationName}</key><dict><key>SockPathName</key><string>${p.localAppSocketPath}</string><key>SockPathOwner</key><integer>0</integer><key>SockPathGroup</key><integer>20</integer><key>SockPathMode</key><integer>432</integer><key>SockType</key><string>stream</string></dict></dict>\n</dict></plist>\n`;}
function sha256(value){return createHash('sha256').update(value).digest('hex');}
