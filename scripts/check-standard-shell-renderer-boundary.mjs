import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgeRoot = path.join(repoRoot, 'kit/shell/renderer/src/bridge');
const bootstrapRoot = path.join(repoRoot, 'kit/shell/renderer/src/bootstrap');
const avatarRendererRoot = path.join(repoRoot, 'apps/avatar/src/shell/renderer');
const failures = [];
const allowedRawTauriBootstrapFiles = new Set([
  'kit/shell/renderer/src/bootstrap/runtime-bridge.ts',
]);

const standardCommandFiles = [
  'auth-session.ts',
  'installed-app.ts',
  'oauth.ts',
  'runtime-daemon.ts',
  'runtime-defaults.ts',
  'ui.ts',
];

for (const file of collectSourceFiles(bridgeRoot)) {
  const relative = slash(path.relative(repoRoot, file));
  const content = readFileSync(file, 'utf8');
  reject(content, /@tauri-apps\/api/u, relative, 'renderer bridge must not import raw Tauri APIs');
  reject(content, /__TAURI_INTERNALS__|__TAURI_IPC__/u, relative, 'renderer bridge must not probe raw Tauri globals');
  reject(content, /\bwindow\.open\b|\bwindow\.confirm\b/u, relative, 'renderer bridge must not use browser UI fallbacks');
  reject(content, /\bOFFLINE_STATUS\b/u, relative, 'renderer bridge must not return offline daemon fallback status');
  reject(content, /(?<!nimi-shell-)file:\/\//u, relative, 'renderer bridge must not expose raw file:// URLs');
  reject(content, /return\s+fileUrl\s*;/u, relative, 'renderer bridge must not return raw local file URLs as a fallback');
  reject(content, /\binvoke(?:Checked)?\(\s*['"`]/u, relative, 'renderer bridge command names must be sourced from shell/capabilities');
}

for (const file of collectSourceFiles(bootstrapRoot)) {
  const relative = slash(path.relative(repoRoot, file));
  const content = readFileSync(file, 'utf8');
  if (!/@tauri-apps\/api/u.test(content)) {
    continue;
  }
  if (!allowedRawTauriBootstrapFiles.has(relative)) {
    failures.push(`${relative}: raw Tauri bootstrap imports are only allowed in the standard shell runtime adapter seam`);
  }
}

for (const file of collectSourceFiles(avatarRendererRoot)) {
  const relative = slash(path.relative(repoRoot, file));
  const content = readFileSync(file, 'utf8');
  reject(content, /@tauri-apps\/api/u, relative, 'Avatar renderer must use the app-owned host bridge instead of raw Tauri APIs');
  reject(content, /__TAURI_INTERNALS__|__TAURI_IPC__/u, relative, 'Avatar renderer must not probe raw Tauri globals');
  if (relative.endsWith('/app-shell/tauri-commands.ts')) {
    reject(content, /if\s*\(\s*!\s*hasAvatarHostRuntime\(\)\s*\)\s*return\b/u, relative, 'Avatar host commands must fail closed when no host is installed');
    reject(content, /\bfallback\s*:/u, relative, 'Avatar host commands must not synthesize no-host fallback success');
  }
}

for (const fileName of standardCommandFiles) {
  const relative = `kit/shell/renderer/src/bridge/${fileName}`;
  const content = readFileSync(path.join(bridgeRoot, fileName), 'utf8');
  if (!content.includes('NIMI_STANDARD_SHELL_COMMANDS')) {
    failures.push(`${relative}: standard shell wrapper must source command names from @nimiplatform/kit/shell/capabilities`);
  }
}

const invokeSource = readFileSync(path.join(bridgeRoot, 'invoke.ts'), 'utf8');
if (!/code:\s*'capability-unavailable'/u.test(invokeSource)
  || !/reasonCode:\s*'renderer-standard-shell-host-unavailable'/u.test(invokeSource)) {
  failures.push('kit/shell/renderer/src/bridge/invoke.ts: missing standard no-host unavailable envelope');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

function reject(content, pattern, relative, message) {
  if (pattern.test(content)) {
    failures.push(`${relative}: ${message}`);
  }
}

function collectSourceFiles(root) {
  const files = [];
  walk(root, files);
  return files;
}

function walk(target, files) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-electron' || entry === '__snapshots__') {
        continue;
      }
      walk(path.join(target, entry), files);
    }
    return;
  }
  if (/\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/u.test(target)) {
    return;
  }
  if (/\.(?:ts|tsx|js|mjs)$/u.test(target)) {
    files.push(target);
  }
}

function slash(value) {
  return value.replace(/\\/gu, '/');
}
