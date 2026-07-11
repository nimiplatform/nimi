#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = process.cwd();
const violations = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, relativePath, fragments) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      violations.push(`${relativePath}: missing ${JSON.stringify(fragment)}`);
    }
  }
}

function requireExcludes(source, relativePath, fragments) {
  for (const fragment of fragments) {
    if (source.includes(fragment)) {
      violations.push(`${relativePath}: forbidden ${JSON.stringify(fragment)}`);
    }
  }
}

const contractPath = '.nimi/spec/platform/kernel/kit-contract.md';
const registryPath = '.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml';
const capabilityPath = '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml';
const electronPath = 'kit/shell/electron/src/main/installed-host.ts';
const electronArtifactPath = 'kit/shell/electron/src/main/installed-artifacts.ts';
const electronIndexPath = 'kit/shell/electron/src/main/index.ts';
const electronAccountPath = 'kit/shell/electron/src/main/runtime-account-auth.ts';
const tauriPath = 'kit/shell/tauri/src/runtime_bridge/installed_host.rs';
const tauriArtifactPath = 'kit/shell/tauri/src/standard_installed_artifacts.rs';
const tauriRegistrationPath = 'kit/shell/tauri/src/command_registration.rs';
const rendererPath = 'kit/shell/renderer/src/bridge/installed-app.ts';
const rendererBootstrapPath = 'kit/shell/renderer/src/bootstrap/runtime-bridge.ts';
const electronPreloadCjsPath = 'kit/shell/electron/src/preload/cjs.cts';
const sdkBootstrapPath = 'sdks/typescript/core/app/installed-app-bootstrap.ts';
const sdkAppSessionPath = 'sdks/typescript/runtime/app-session.ts';
const sdkAccountCallerPath = 'sdks/typescript/runtime/account-caller.ts';
const testerBootstrapPath = 'apps/tester/src/shell/installed-app-bootstrap.ts';
const nativePath = 'kit/shell/protected-local-node/src/lib.rs';
const nativeManifestPath = 'kit/shell/protected-local-node/Cargo.toml';
const nativePackagePath = 'kit/shell/protected-local-node/npm/win32-x64/package.json';
const nativeLoaderPath = 'kit/shell/protected-local-node/npm/win32-x64/index.cjs';
const releaseWorkflowPath = '.github/workflows/release-kit.yml';

requireIncludes(read(contractPath), contractPath, [
  'The Electron A.4 host adapter has the same host-only artifact surface.',
  '@nimiplatform/kit-protected-local-win32-x64',
  '`artifacts.readRuntimeBytes`',
]);
requireIncludes(read(registryPath), registryPath, [
  'fixed @nimiplatform/kit-protected-local-win32-x64 optional package',
  'Windows arm64, macOS, and Linux remain fail-closed',
]);

const capabilityTable = parseYaml(read(capabilityPath));
const installedSet = capabilityTable.capability_sets?.find(
  (entry) => entry?.set_id === 'installed-nimi-app-standard-shell-v1',
);
if (JSON.stringify(installedSet?.allowed_operations) !== JSON.stringify(['artifacts.readRuntimeBytes'])) {
  violations.push(`${capabilityPath}: installed capability set must admit only artifacts.readRuntimeBytes`);
}

const electron = read(electronPath);
requireIncludes(electron, electronPath, [
  "const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';",
  'createRequire(import.meta.url)(packageName)',
  'openInstalledAppSession',
  'readInstalledArtifactBytes',
  'readArtifactBytes',
  'this.sessionReady = true',
  "throw new NimiElectronInstalledHostError('protected-carrier-required', false)",
]);
requireExcludes(electron, electronPath, [
  'methodId',
  'requestBytes',
  'sessionId',
  'sessionProof',
  'accountGeneration',
  'releaseDigest',
  'runtimeEndpoint',
  'authorization',
]);
requireIncludes(read(electronArtifactPath), electronArtifactPath, [
  'readElectronInstalledArtifact',
  "case 'installed-artifact-forbidden': return 'runtime-permission-denied'",
  "case 'installed-artifact-too-large': return 'resource-exhausted'",
  'Buffer.from(artifact.bytes).toString',
]);
requireIncludes(read(electronIndexPath), electronIndexPath, [
  'createNimiElectronInstalledHost',
  "from './installed-host.js'",
]);
requireIncludes(read(electronAccountPath), electronAccountPath, [
  'return protectedCarrierRequiredProvider();',
  'app-owned launch binding cannot approximate a protected carrier',
]);

const tauri = read(tauriPath);
requireIncludes(tauri, tauriPath, [
  'session: OnceCell<Arc<dyn NimiInstalledAppSession>>',
  'open_installed_app_session().await?',
  'read_artifact_bytes',
]);
requireExcludes(tauri, tauriPath, ['#[tauri::command]']);
requireIncludes(read(tauriArtifactPath), tauriArtifactPath, [
  'artifacts_read_runtime_bytes_for_host',
  'deny_unknown_fields',
  'BASE64_STANDARD.encode',
  '"installed-artifact-forbidden" => "runtime-permission-denied"',
]);
const installedMacro = read(tauriRegistrationPath).match(
  /macro_rules! nimi_shell_tauri_installed_app_standard_shell_handler \{([\s\S]*?)\n\}/u,
)?.[1] ?? '';
requireIncludes(installedMacro, tauriRegistrationPath, [
  '$crate::capabilities::artifacts::artifacts_read_runtime_bytes',
]);
requireExcludes(installedMacro, tauriRegistrationPath, [
  'runtime_bridge_unary',
  'storage_read_json',
  'ai_config_get',
  'desktop_open_intent_open_intent',
]);
for (const macroName of [
  'nimi_shell_tauri_runtime_bridge_handler',
  'nimi_shell_tauri_oauth_runtime_bridge_handler',
]) {
  const genericMacro = read(tauriRegistrationPath).match(
    new RegExp(`macro_rules! ${macroName} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )?.[1] ?? '';
  requireExcludes(genericMacro, tauriRegistrationPath, [
    'artifacts_read_runtime_bytes',
  ]);
}
requireIncludes(read(rendererPath), rendererPath, [
  "NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes']",
  'readRuntimeBytes: readInstalledRuntimeArtifactBytes',
  'decodeCanonicalBase64',
]);
requireExcludes(read(rendererPath), rendererPath, [
  'InstalledNimiAppLaunchBinding',
  'readInstalledNimiAppLaunchBinding',
  'launchNonce',
  'realmBaseUrl',
]);
requireExcludes(read(rendererBootstrapPath), rendererBootstrapPath, [
  'installedAppLaunchBinding',
  'launchNonce',
]);
requireExcludes(read(electronPreloadCjsPath), electronPreloadCjsPath, [
  'installedAppLaunchBinding',
  '--nimi-installed-app-launch-binding=',
  'launchNonce',
  'realmBaseUrl',
]);

requireIncludes(read(sdkBootstrapPath), sdkBootstrapPath, [
  'InstalledNimiAppArtifactReader',
  'SDK_INSTALLED_APP_BOOTSTRAP_INPUT_FORBIDDEN',
  'SDK_INSTALLED_APP_PROTECTED_CARRIER_REQUIRED',
  'SDK_INSTALLED_ARTIFACT_PROJECTION_INVALID',
  'readRuntimeBytes.call',
]);
requireExcludes(read(sdkBootstrapPath), sdkBootstrapPath, [
  'launchBinding',
  'NimiRuntimeAccountCaller',
  'RuntimeAccountMediatedRealmRuntime',
  'createRuntimeAccountMediatedRealmTransport',
]);
requireExcludes(read(sdkAppSessionPath), sdkAppSessionPath, [
  'NimiRuntimeInstalledAppLaunchBinding',
  'createNimiRuntimeInstalledAppSessionMetadataProvider',
]);
requireIncludes(read(sdkAccountCallerPath), sdkAccountCallerPath, [
  "'third-party-nimi-app': null",
]);
requireExcludes(read(sdkAccountCallerPath), sdkAccountCallerPath, [
  'NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID',
  'NimiDesktopLaunchedNimiAppRuntimeAccountCallerInput',
  'createNimiDesktopLaunchedNimiAppRuntimeAccountCaller',
]);
requireIncludes(read(testerBootstrapPath), testerBootstrapPath, [
  'createInstalledNimiAppBootstrap',
  'createInstalledNimiAppStandardShellSurface',
  'standardShell: createInstalledNimiAppStandardShellSurface()',
]);

const native = read(nativePath);
requireIncludes(native, nativePath, [
  'WindowsInstalledAppCarrier',
  'OnceCell<Arc<dyn NimiInstalledAppSession>>',
  '#[napi(js_name = "openInstalledAppSession")]',
  '#[napi(js_name = "readInstalledArtifactBytes")]',
]);
const napiExports = [...native.matchAll(/#\[napi\(js_name = "([^"]+)"\)\]/g)].map((match) => match[1]).sort();
if (JSON.stringify(napiExports) !== JSON.stringify(['openInstalledAppSession', 'readInstalledArtifactBytes'])) {
  violations.push(`${nativePath}: native export set must remain exact, got ${napiExports.join(', ')}`);
}
requireExcludes(native, nativePath, [
  'method_id',
  'request_bytes',
  'session_id',
  'session_proof',
  'account_generation',
  'release_digest',
  'runtime_endpoint',
]);
requireIncludes(read(nativeManifestPath), nativeManifestPath, [
  'nimi-shell-protected-local = { path = "../protected-local" }',
  'crate-type = ["cdylib"]',
]);

const nativePackage = JSON.parse(read(nativePackagePath));
if (nativePackage.name !== '@nimiplatform/kit-protected-local-win32-x64') {
  violations.push(`${nativePackagePath}: unexpected package name`);
}
if (JSON.stringify(nativePackage.os) !== JSON.stringify(['win32']) || JSON.stringify(nativePackage.cpu) !== JSON.stringify(['x64'])) {
  violations.push(`${nativePackagePath}: native package must be restricted to win32/x64`);
}
if (nativePackage.main !== 'index.cjs' || !nativePackage.files?.includes('nimi_shell_protected_local.node')) {
  violations.push(`${nativePackagePath}: native binary package surface is incomplete`);
}
requireIncludes(read(nativeLoaderPath), nativeLoaderPath, [
  "require('./nimi_shell_protected_local.node')",
]);

const kitPackage = JSON.parse(read('kit/package.json'));
if (kitPackage.optionalDependencies?.['@nimiplatform/kit-protected-local-win32-x64'] !== 'workspace:*') {
  violations.push('kit/package.json: fixed protected-local optional dependency is missing');
}
requireIncludes(read('pnpm-workspace.yaml'), 'pnpm-workspace.yaml', [
  "'kit/shell/protected-local-node/npm/win32-x64'",
]);
requireIncludes(read(releaseWorkflowPath), releaseWorkflowPath, [
  'native-windows-x64:',
  'cargo test --manifest-path kit/shell/protected-local-node/Cargo.toml --locked',
  'node kit/shell/protected-local-node/scripts/build-windows-x64-package.mjs',
  'npm publish kit/shell/protected-local-node/npm/win32-x64 --access public --provenance',
  'needs: [resolve, native-windows-x64]',
]);

for (const rendererBoundaryPath of [
  'kit/shell/electron/src/main/host.ts',
  'kit/shell/electron/src/preload/index.ts',
  'kit/shell/electron/src/preload/cjs.cts',
]) {
  requireExcludes(read(rendererBoundaryPath), rendererBoundaryPath, [
    'createNimiElectronInstalledHost',
    'readInstalledArtifactBytes',
  ]);
}

if (violations.length > 0) {
  process.stderr.write('Installed host carrier parity violations found:\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Installed host carrier parity check passed\n');
}
