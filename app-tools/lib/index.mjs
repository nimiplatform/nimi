import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAppScaffold } from './app-scaffold.mjs';
import { doctorApp, updateApp } from './app-doctor-update.mjs';

const SDK_VERSION = '^0.5.15';
const APP_TOOLS_VERSION = '^0.1.3';
const KIT_VERSION = '^0.1.0';
const REACT_VERSION = '^19.1.0';
const REACT_DOM_VERSION = '^19.1.0';
const TYPESCRIPT_VERSION = '^5.9.3';
const TSX_VERSION = '^4.21.0';
const NODE_TYPES_VERSION = '^24.10.1';
const REACT_TYPES_VERSION = '^19.2.14';
const REACT_DOM_TYPES_VERSION = '^19.2.3';
const VITE_VERSION = '^7.2.4';
const VITE_REACT_PLUGIN_VERSION = '^5.1.1';
const TAURI_API_VERSION = '^2.9.1';
const TAURI_CLI_VERSION = '^2.11.2';
const NIMI_SHELL_TAURI_VERSION = '0.1.0';
const AI_SDK_VERSION = '^6.0.85';

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

function appScaffoldVersions() {
  return {
    sdkVersion: SDK_VERSION,
    appToolsVersion: APP_TOOLS_VERSION,
    aiSdkVersion: AI_SDK_VERSION,
    kitVersion: KIT_VERSION,
    reactVersion: REACT_VERSION,
    reactDomVersion: REACT_DOM_VERSION,
    tsxVersion: TSX_VERSION,
    typescriptVersion: TYPESCRIPT_VERSION,
    nodeTypesVersion: NODE_TYPES_VERSION,
    reactTypesVersion: REACT_TYPES_VERSION,
    reactDomTypesVersion: REACT_DOM_TYPES_VERSION,
    viteVersion: VITE_VERSION,
    viteReactPluginVersion: VITE_REACT_PLUGIN_VERSION,
    tauriApiVersion: TAURI_API_VERSION,
    tauriCliVersion: TAURI_CLI_VERSION,
    nimiShellTauriVersion: NIMI_SHELL_TAURI_VERSION,
  };
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
  return doctorApp(cwd, options, appScaffoldVersions());
}

export function updateAppScaffold(cwd, options = {}) {
  return updateApp(cwd, options, appScaffoldVersions());
}
