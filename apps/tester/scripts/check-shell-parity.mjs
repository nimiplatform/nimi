#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`${label} missing ${text}`);
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`${label} must not match ${pattern}`);
}

function validateShellParity() {
  const packageJson = JSON.parse(read('package.json'));
  const electronMain = read('src-electron/main.ts');
  const electronPreload = read('src-electron/preload.cts');
  const tauriMain = read('src-tauri/src/main.rs');
  const tauriProduct = tauriMain.split('#[cfg(test)]')[0];
  const runtimePlatform = read('src/shell/auth/runtime-platform.ts');
  const electronAppBridge = readRepo('kit/shell/electron/src/main/app-bridge.ts');
  const tauriRegistration = readRepo('kit/shell/tauri/src/command_registration.rs');
  const rendererBridge = readRepo('kit/shell/renderer/src/bridge/installed-app.ts');

  if (packageJson.scripts.dev !== 'nimi-app dev --shell tauri') {
    throw new Error('Tester pnpm dev must enter the official Tauri launcher');
  }
  if (packageJson.scripts['dev:shell'] !== 'nimi-app dev') {
    throw new Error('Tester dev:shell must enter the official launcher');
  }
  if (packageJson.scripts['dev:electron'] !== 'nimi-app dev --shell electron') {
    throw new Error('Tester Electron development must enter the official launcher');
  }

  requireText(electronMain, 'registerNimiElectronAppBridge', 'Electron app host');
  requireText(electronPreload, 'installNimiElectronRuntimeBridge', 'Electron preload transport');
  forbid(electronMain, /registerNimiElectronRuntimeBridge|[r]untimeEndpoint|NIMI_RUNTIME_GRPC_ADDR|createGrpcClient/, 'Electron generic Runtime bridge');

  requireText(tauriProduct, 'nimi_shell_tauri_installed_app_standard_shell_handler![', 'Tauri app host');
  forbid(tauriProduct, /nimi_shell_tauri_runtime_bridge_handler|runtime_bridge_unary/, 'Tauri generic Runtime bridge');

  requireText(runtimePlatform, 'testerInstalledAppBootstrap.appHost.bootstrap()', 'Renderer app-host bootstrap');
  requireText(runtimePlatform, 'artifacts.readRuntimeBytes(status.bootstrapArtifactId)', 'Renderer protected artifact proof');
  forbid(runtimePlatform, /readonly client:|readonly auth:|new Runtime|createNimiClient/, 'Renderer generic authority');

  requireText(electronAppBridge, "const APP_HOST_PROTECTED_LOCAL_ENDPOINT_SENTINEL = 'app-host-protected-local-only'", 'Electron protected-local carrier');
  requireText(electronAppBridge, 'electron-app-host-ordinary-grpc-forbidden', 'Electron direct gRPC denial');
  const installedMacro = tauriRegistration.match(/macro_rules! nimi_shell_tauri_installed_app_standard_shell_handler[\s\S]*?\n}\n/);
  if (!installedMacro) throw new Error('Tauri installed app handler macro missing');
  requireText(installedMacro[0], 'app_host_bootstrap', 'Tauri app-host bootstrap');
  requireText(installedMacro[0], 'artifacts_read_runtime_bytes', 'Tauri protected artifact operation');
  forbid(installedMacro[0], /runtime_bridge_|oauth_|account|realm|agent|media|realtime/, 'Tauri installed app protected surface');
  requireText(rendererBridge, "const APP_HOST_BOOTSTRAP_COMMAND = 'nimi.app-host.bootstrap'", 'Renderer typed app-host command');
}

try {
  validateShellParity();
  process.stdout.write('[tester-shell-parity] app-host parity passed\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[tester-shell-parity] failed: ${message}\n`);
  process.exit(1);
}
