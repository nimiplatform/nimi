import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAgentCenterParity } from './lib/standard-shell-agent-center-parity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const retiredRootModules = [
  'agent_center_avatar_asset',
  'auth_session_commands',
  'desktop_paths',
  'governed_config',
  'nimi_data_directory',
  'oauth_commands',
  'platform_catalog',
  'platform_projection',
  'renderer_entry_probe',
  'runtime_account_caller',
  'runtime_ai_config_projection',
  'runtime_app_storage',
  'runtime_bridge',
  'runtime_defaults',
  'runtime_local_agent_identity',
  'runtime_local_assets',
  'session_logging',
];

const retiredRootPathPattern = new RegExp(
  String.raw`\bnimi_shell_tauri::(${retiredRootModules.join('|')})(?:::|\b)`,
  'u',
);
const sourceRoots = ['apps', 'kit'];
const failures = [];

failures.push(...verifyAgentCenterParity({
  canonical: readRepo('config/platform-standard-shell-capabilities.yaml'),
  typescriptCatalog: readRepo('kit/shell/capabilities/src/catalog.ts'),
  rustCatalog: readRepo('kit/shell/tauri/src/capabilities/catalog.rs'),
  rendererAliases: readRepo('kit/shell/renderer/src/bridge/tauri-api.ts'),
  tauriRegistration: readRepo('kit/shell/tauri/src/command_registration.rs'),
  electronHost: readRepo('kit/shell/electron/src/main/agent-center.ts'),
}));

for (const file of collectSourceFiles(sourceRoots)) {
  const relative = slash(path.relative(repoRoot, file));
  const content = readFileSync(file, 'utf8');
  const match = content.match(retiredRootPathPattern);
  if (match) {
    failures.push(`${relative}: use nimi_shell_tauri::capabilities::* instead of root module path ${match[0]}`);
  }
}

const tauriLib = readFileSync(path.join(repoRoot, 'kit/shell/tauri/src/lib.rs'), 'utf8');
for (const moduleName of retiredRootModules) {
  const pattern = new RegExp(String.raw`^\s*pub\s+mod\s+${moduleName}\s*;`, 'mu');
  if (pattern.test(tauriLib)) {
    failures.push(`kit/shell/tauri/src/lib.rs: retired root module remains public: ${moduleName}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function collectSourceFiles(roots) {
  const files = [];
  for (const root of roots) {
    walk(path.join(repoRoot, root), files);
  }
  return files;
}

function walk(target, files) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if ([
        'node_modules',
        'target',
        'dist',
        'dist-electron',
        '.turbo',
        '.vite',
      ].includes(entry)) {
        continue;
      }
      walk(path.join(target, entry), files);
    }
    return;
  }
  if (/\.(?:rs|ts|tsx|cts|js|mjs|cjs|md)$/u.test(target)) {
    files.push(target);
  }
}

function slash(value) {
  return value.replace(/\\/gu, '/');
}
