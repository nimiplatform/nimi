#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

const STATIC_TESTER_SHELL_COMMANDS = [
  'resolve_world_tour_fixture',
  'claim_world_tour_viewer_launch',
  'save_world_tour_viewer_preset',
  'open_world_tour_window',
];

const NIMI_STANDARD_SHELL_COMMANDS = extractStandardShellCommands();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label} missing ${needle}`);
  }
}

function assertMatch(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`${label} does not match ${pattern}`);
  }
}

function assertNotMatch(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`${label} must not match ${pattern}`);
  }
}

function assertEqualSet(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (actualSorted.length !== expectedSorted.length || actualSorted.some((entry, index) => entry !== expectedSorted[index])) {
    throw new Error(`${label} mismatch: actual=${actualSorted.join(',')} expected=${expectedSorted.join(',')}`);
  }
}

function extractStandardShellCommands() {
  const catalogSource = readRepo('kit/shell/capabilities/src/catalog.ts');
  return new Set([...catalogSource.matchAll(/command:\s*'([^']+)'/g)].map((entry) => entry[1]));
}

function collectSourceFiles(relativeDir) {
  const dir = path.join(root, relativeDir);
  const files = [];
  const walk = (currentDir) => {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) {
        files.push(fullPath);
      }
    }
  };
  walk(dir);
  return files;
}

function extractElectronCommands(source) {
  const match = source.match(/return\s+\{([\s\S]*?)\n\s+\};/);
  if (!match) {
    throw new Error('Electron command handler map not found');
  }
  return new Set([...match[1].matchAll(/^\s*([a-z0-9_]+):/gm)].map((entry) => entry[1]));
}

function extractTauriCommands(source) {
  return new Set([...source.matchAll(/\b(?:tester_storage|world_tour)::([a-z0-9_]+)/g)].map((entry) => entry[1]));
}

function extractRendererCommands() {
  const source = collectSourceFiles('src/tester')
    .map((filePath) => readFileSync(filePath, 'utf8'))
    .join('\n');
  return new Set(STATIC_TESTER_SHELL_COMMANDS.filter((command) => source.includes(`'${command}'`) || source.includes(`"${command}"`)));
}

function validateStandardShellBridgeCatalog() {
  const electronMain = read('src-electron/main.ts');
  const tauriMain = read('src-tauri/src/main.rs');
  const electronAuth = readRepo('kit/shell/electron/src/main/auth.ts');
  const electronHost = readRepo('kit/shell/electron/src/main/host.ts');
  const electronRuntime = readRepo('kit/shell/electron/src/main/runtime.ts');
  const tauriCommandRegistration = readRepo('kit/shell/tauri/src/command_registration.rs');
  const tauriRendererApi = readRepo('kit/shell/renderer/src/bridge/tauri-api.ts');

  for (const command of [
    'nimi.shell.runtime.unary',
    'nimi.shell.runtimeLifecycle.status',
    'nimi.shell.runtimeDefaults.get',
    'nimi.shell.auth.session.load',
    'nimi.shell.oauth.openExternalUrl',
    'nimi.shell.config.get',
  ]) {
    if (!NIMI_STANDARD_SHELL_COMMANDS.has(command)) {
      throw new Error(`Kit standard shell catalog missing ${command}`);
    }
  }

  assertIncludes(electronMain, 'registerNimiElectronRuntimeBridge', 'Tester Electron standard shell host');
  assertIncludes(electronHost, 'NIMI_STANDARD_SHELL_COMMANDS', 'Kit Electron standard shell catalog');
  assertIncludes(electronRuntime, "standardCommand('runtime.unary')", 'Kit Electron runtime bridge command');
  assertIncludes(electronRuntime, "standardCommand('runtime-lifecycle.status')", 'Kit Electron runtime lifecycle command');
  assertIncludes(electronRuntime, "standardCommand('config.get')", 'Kit Electron config command');
  assertIncludes(electronAuth, "NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad']", 'Kit Electron auth custody hardcut');
  assertIncludes(electronHost, 'isElectronRuntimeAccountCustodyCommand', 'Kit Electron auth custody hardcut');
  assertIncludes(electronHost, "NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']", 'Kit Electron OAuth command');
  assertIncludes(electronHost, "NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']", 'Kit Electron local-agent command');

  assertIncludes(tauriMain, 'nimi_shell_tauri_runtime_bridge_handler![', 'Tester Tauri standard shell host');
  assertIncludes(tauriCommandRegistration, 'pub const RUNTIME_BRIDGE_COMMANDS', 'Kit Tauri runtime bridge catalog');
  assertIncludes(tauriCommandRegistration, 'runtime_bridge_unary', 'Kit Tauri runtime bridge command');
  assertIncludes(tauriCommandRegistration, 'auth_session_load', 'Kit Tauri auth command');
  assertIncludes(tauriCommandRegistration, 'open_external_url', 'Kit Tauri OAuth command');
  assertIncludes(tauriRendererApi, 'NIMI_STANDARD_SHELL_COMMANDS', 'Kit renderer standard shell catalog');
  assertIncludes(tauriRendererApi, "NIMI_STANDARD_SHELL_COMMANDS['runtime.unary']", 'Kit renderer Tauri runtime alias');
  assertIncludes(tauriRendererApi, "NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad']", 'Kit renderer Tauri auth alias');
}

function validateShellParity() {
  const packageJson = JSON.parse(read('package.json'));
  const appIdentity = read('src/shell/auth/app-identity.ts');
  const runtimePlatform = read('src/shell/auth/runtime-platform.ts');
  const runtimeTransport = read('src/shell/auth/runtime-transport.ts');
  const electronMain = read('src-electron/main.ts');
  const electronPreload = read('src-electron/preload.cts');
  const electronCommands = read('src-electron/commands/tester-commands.ts');
  const tauriMain = read('src-tauri/src/main.rs');
  const tauriConfig = read('src-tauri/tauri.conf.json');

  assertIncludes(packageJson.scripts['dev:electron'], 'electron', 'Electron dev script');
  assertIncludes(packageJson.scripts['dev:shell'], 'run-tauri-dev.mjs', 'Tauri dev script');
  assertIncludes(packageJson.scripts['check:shell-static-parity'], 'check-shell-parity.mjs', 'Shell static parity script');
  assertIncludes(packageJson.scripts['test:e2e:tauri'], 'run-tauri-acceptance.mjs', 'Tauri runtime acceptance script');
  assertIncludes(appIdentity, "appId = 'nimi.tester'", 'renderer app identity');
  assertIncludes(electronMain, "const APP_ID = 'nimi.tester'", 'Electron app identity');
  assertIncludes(tauriConfig, '"identifier": "ai.nimi.apps.nimi.tester"', 'Tauri bundle identity');

  assertIncludes(electronMain, 'registerNimiElectronRuntimeBridge', 'Electron runtime bridge');
  assertIncludes(electronMain, 'trustedRuntimeMetadataProvider', 'Electron runtime auth');
  assertIncludes(electronMain, 'createTesterElectronCommandHandlers', 'Electron tester commands');
  assertIncludes(electronPreload, 'installNimiElectronRuntimeBridge', 'Electron preload bridge');
  assertIncludes(tauriMain, 'nimi_shell_tauri_runtime_bridge_handler![', 'Tauri runtime bridge');
  assertMatch(tauriMain, /capabilities::diagnostics::build_renderer_entry_probe_script/, 'Tauri renderer probe');
  assertMatch(tauriMain, /RendererEntryProbeScriptConfig/, 'Tauri renderer probe config');
  assertNotMatch(tauriMain, /tauri::generate_handler!\[/, 'Tauri handler bypass');

  assertIncludes(runtimeTransport, "type: 'electron-ipc'", 'Runtime transport');
  assertIncludes(runtimeTransport, "type: 'tauri-ipc'", 'Runtime transport');
  assertIncludes(runtimeTransport, "commandNamespace: RUNTIME_BRIDGE_NAMESPACE", 'Tauri bridge namespace');
  assertIncludes(runtimePlatform, "resolveTesterRuntimeHostKind() === 'electron'", 'Runtime auth metadata split');
  assertIncludes(runtimePlatform, 'authMetadata: createRuntimeAppSessionMetadataProvider', 'Runtime auth metadata split');

  validateStandardShellBridgeCatalog();
  assertEqualSet(extractElectronCommands(electronCommands), STATIC_TESTER_SHELL_COMMANDS, 'Electron tester command surface');
  assertEqualSet(extractTauriCommands(tauriMain), STATIC_TESTER_SHELL_COMMANDS, 'Tauri tester command surface');
  assertEqualSet(extractRendererCommands(), STATIC_TESTER_SHELL_COMMANDS, 'Renderer tester command calls');
}

try {
  validateShellParity();
  process.stdout.write(`[tester-shell-parity] passed (${STATIC_TESTER_SHELL_COMMANDS.length} app commands)\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[tester-shell-parity] failed: ${message}\n`);
  process.exit(1);
}
