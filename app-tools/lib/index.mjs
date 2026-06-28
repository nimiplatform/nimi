import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createAppScaffold } from './app-scaffold.mjs';
import { doctorApp, initApp, updateApp } from './app-doctor-update.mjs';

const SDK_VERSION = '^0.6.0';
const NIMICODING_VERSION = '0.2.5';
const KIT_VERSION = '^0.2.0';
const REACT_VERSION = '^19.1.0';
const REACT_DOM_VERSION = '^19.1.0';
const I18NEXT_VERSION = '^25.8.18';
const REACT_I18NEXT_VERSION = '^16.5.8';
const LUCIDE_REACT_VERSION = '^0.577.0';
const TYPESCRIPT_VERSION = '^5.9.3';
const TSX_VERSION = '^4.21.0';
const NODE_TYPES_VERSION = '^24.10.1';
const REACT_TYPES_VERSION = '^19.2.14';
const REACT_DOM_TYPES_VERSION = '^19.2.3';
const THREE_TYPES_VERSION = '^0.184.1';
const VITE_VERSION = '^7.2.4';
const VITE_REACT_PLUGIN_VERSION = '^5.1.1';
const TAILWINDCSS_VERSION = '^4.3.0';
const TAILWINDCSS_VITE_VERSION = '^4.3.0';
const TAURI_API_VERSION = '^2.9.1';
const TAURI_CLI_VERSION = '^2.11.2';
const YAML_VERSION = '^2.9.0';
const NIMI_SHELL_TAURI_VERSION = '0.1.0';
const AI_SDK_VERSION = '^6.0.85';
const APP_TOOLS_VERSION = '^0.1.4';
const ELECTRON_VERSION = '^42.5.0';
const ESBUILD_VERSION = '^0.28.0';
const PLAYWRIGHT_VERSION = '^1.61.0';
const PACKAGE_MANAGER = 'pnpm@10.32.1';

function ensureDirEmptyOrMissing(targetDir) {
  if (!existsSync(targetDir)) {
    return;
  }
  const stat = statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error(`Refusing to scaffold into non-directory path: ${targetDir}`);
  }
  const entries = readdirSync(targetDir);
  if (entries.length === 0) {
    return;
  }
  if (entries.length === 1 && entries[0] === '.git' && statSync(path.join(targetDir, '.git')).isDirectory()) {
    return;
  }
  throw new Error(`Refusing to scaffold into non-empty directory: ${targetDir}`);
}

function createFileTree(baseDir, files) {
  for (const file of files) {
    const targetPath = path.join(baseDir, file.path);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }
}

export function appScaffoldVersions() {
  return {
    sdkVersion: SDK_VERSION,
    appToolsVersion: APP_TOOLS_VERSION,
    nimicodingVersion: NIMICODING_VERSION,
    aiSdkVersion: AI_SDK_VERSION,
    kitVersion: KIT_VERSION,
    reactVersion: REACT_VERSION,
    reactDomVersion: REACT_DOM_VERSION,
    i18nextVersion: I18NEXT_VERSION,
    reactI18nextVersion: REACT_I18NEXT_VERSION,
    lucideReactVersion: LUCIDE_REACT_VERSION,
    tsxVersion: TSX_VERSION,
    typescriptVersion: TYPESCRIPT_VERSION,
    nodeTypesVersion: NODE_TYPES_VERSION,
    reactTypesVersion: REACT_TYPES_VERSION,
    reactDomTypesVersion: REACT_DOM_TYPES_VERSION,
    threeTypesVersion: THREE_TYPES_VERSION,
    viteVersion: VITE_VERSION,
    viteReactPluginVersion: VITE_REACT_PLUGIN_VERSION,
    tailwindcssVersion: TAILWINDCSS_VERSION,
    tailwindcssViteVersion: TAILWINDCSS_VITE_VERSION,
    tauriApiVersion: TAURI_API_VERSION,
    tauriCliVersion: TAURI_CLI_VERSION,
    yamlVersion: YAML_VERSION,
    nimiShellTauriVersion: NIMI_SHELL_TAURI_VERSION,
    electronVersion: ELECTRON_VERSION,
    esbuildVersion: ESBUILD_VERSION,
    playwrightVersion: PLAYWRIGHT_VERSION,
    packageManager: PACKAGE_MANAGER,
  };
}

function runNimicodingSync(targetDir, mode) {
  if (!['apply', 'check'].includes(mode)) {
    throw new Error(`Unsupported nimicoding sync mode: ${mode}`);
  }
  const flag = mode === 'apply' ? '--apply' : '--check';
  const pnpmArgs = ['exec', 'nimicoding', 'sync', flag, '--json'];
  const command =
    process.platform === 'win32'
      ? { binary: 'cmd.exe', args: ['/d', '/c', 'corepack', 'pnpm', ...pnpmArgs] }
      : { binary: 'corepack', args: ['pnpm', ...pnpmArgs] };
  const result = spawnSync(command.binary, command.args, {
    cwd: targetDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const output = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`nimicoding sync ${mode} failed. Run pnpm install before pnpm run init. ${output}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`nimicoding sync ${mode} returned invalid JSON: ${message}`);
  }
}

function appToolRunners() {
  return { runNimicodingSync };
}

export function createApp(cwd, options = {}) {
  createAppScaffold({
    cwd,
    options: {
      dir: options.dir,
      profile: options.profile,
      appId: options.appId,
      name: options.name,
      title: options.title,
      packageName: options.packageName,
      author: options.author,
    },
    versions: appScaffoldVersions(),
    createFileTree,
    ensureDirEmptyOrMissing,
    mkdirSync,
  });
}

export function doctorAppScaffold(cwd, options = {}) {
  return doctorApp(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function initAppScaffold(cwd, options = {}) {
  return initApp(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function updateAppScaffold(cwd, options = {}) {
  return updateApp(cwd, options, appScaffoldVersions(), appToolRunners());
}
