#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sourceTree(relativePath) {
  const absolute = path.join(root, relativePath);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return sourceTree(child);
    return /\.(?:ts|tsx|cts|rs)$/u.test(entry.name) ? [read(child)] : [];
  }).join('\n');
}

function requireText(source, value, label) {
  if (!source.includes(value)) throw new Error(`${label} missing ${value}`);
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
  const localAppClient = read('src/shell/local-app-runtime-platform.ts');
  const electronAppBridge = readRepo('kit/shell/electron/src/main/app-bridge.ts');
  const tauriRegistration = readRepo('kit/shell/tauri/src/command_registration.rs');
  const rendererBridge = readRepo('kit/shell/renderer/src/bridge/local-app.ts');
  const productionSources = [sourceTree('src'), sourceTree('src-electron'), tauriProduct].join('\n');

  if (packageJson.scripts.dev !== 'nimi-app dev --shell electron') {
    throw new Error('Tester pnpm dev must enter the proven Electron launcher');
  }
  if (packageJson.scripts['dev:shell'] !== 'nimi-app dev') {
    throw new Error('Tester dev:shell must enter the official launcher');
  }
  if (packageJson.scripts['dev:electron'] !== 'nimi-app dev --shell electron') {
    throw new Error('Tester Electron development must enter the official launcher');
  }
  if (packageJson.scripts['dev:tauri'] !== 'nimi-app dev --shell tauri') {
    throw new Error('Tester Tauri development must retain the official dual-shell launcher');
  }

  requireText(electronMain, 'registerNimiElectronAppBridge', 'Electron local-app host');
  requireText(electronPreload, 'installNimiElectronRuntimeBridge', 'Electron preload carrier');
  forbid(electronMain, /registerNimiElectronRuntimeBridge|[r]untimeEndpoint|NIMI_RUNTIME_GRPC_ADDR|createGrpcClient/u, 'Electron generic Runtime bridge');

  requireText(tauriProduct, 'nimi_shell_tauri_local_app_standard_shell_handler![', 'Tauri local-app host');
  requireText(tauriProduct, 'RuntimeBridgeLocalAppHost::platform_default()', 'Tauri protected carrier state');
  forbid(tauriProduct, /nimi_shell_tauri_runtime_bridge_handler|runtime_bridge_unary/u, 'Tauri generic Runtime bridge');

  requireText(localAppClient, 'createNimiClient', 'Renderer SDK client');
  requireText(localAppClient, 'createNimiLocalAppStandardShellSurface', 'Renderer Kit carrier');
  requireText(runtimePlatform, 'testerLocalAppClient.auth.status()', 'Renderer auth projection');
  requireText(runtimePlatform, 'status.sessionBound', 'Renderer session binding');
  forbid(runtimePlatform, /readonly client:|new Runtime|[r]untimeEndpoint/u, 'Renderer generic authority');

  requireText(electronAppBridge, "const LOCAL_APP_PROTECTED_CARRIER_SENTINEL = 'local-app-protected-carrier-only'", 'Electron protected-local carrier');
  requireText(electronAppBridge, 'electron-local-app-ordinary-grpc-forbidden', 'Electron direct gRPC denial');
  const localAppMacro = tauriRegistration.match(/macro_rules! nimi_shell_tauri_local_app_standard_shell_handler[\s\S]*?\n\}\n/u);
  if (!localAppMacro) throw new Error('Tauri local-app handler macro missing');
  for (const operation of [
    'local_app_session_status',
    'local_app_permission_status',
    'local_app_permission_request',
    'storage_read_json',
    'storage_write_json',
    'storage_remove_json',
  ]) {
    requireText(localAppMacro[0], operation, 'Tauri local-app operation set');
  }
  requireText(rendererBridge, "NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus']", 'Renderer local-app status command');
  requireText(rendererBridge, "NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionStatus']", 'Renderer local-app permission status command');
  requireText(rendererBridge, "NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']", 'Renderer app-private storage command');

  // Explicit negative fixture: retired installed/developer vocabulary may not
  // appear in Tester production sources after the atomic local-app hardcut.
  forbid(productionSources, /createInstalledNimiApp|third-party-nimi-app|nimi_shell_tauri_installed_app_standard_shell_handler|installed-app-bootstrap/iu, 'Tester production hardcut');
}

try {
  validateShellParity();
  process.stdout.write('[tester-shell-parity] local-app carrier parity passed\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[tester-shell-parity] failed: ${message}\n`);
  process.exit(1);
}
