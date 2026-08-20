import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  buildAppScaffoldCandidateCreatePlan,
  buildAppScaffoldCreatePlan,
  createAppScaffold,
  createAppScaffoldCandidate,
  resolveAppScaffoldCandidateCreateInput,
  resolveAppScaffoldCreateInput,
} from './app-scaffold.mjs';
import { doctorApp, initApp, updateApp } from './app-doctor-update.mjs';
export { runDevShell } from '../scripts/dev-shell.mjs';
export { validateSimulatorAppSource } from './simulator-conformance.mjs';
export { APP_SCAFFOLD_FEATURE_IDS } from './app-scaffold-capabilities.mjs';

const SDK_VERSION = '^0.6.0';
const NIMICODING_VERSION = '0.5.0';
const KIT_VERSION = '^0.3.0';
const REACT_VERSION = '^19.1.0';
const REACT_DOM_VERSION = '^19.1.0';
const I18NEXT_VERSION = '^25.8.18';
const LUCIDE_REACT_VERSION = '^0.577.0';
const TYPESCRIPT_VERSION = '^5.9.3';
const TSX_VERSION = '^4.21.0';
const NODE_TYPES_VERSION = '^24.10.1';
const REACT_TYPES_VERSION = '^19.2.14';
const REACT_DOM_TYPES_VERSION = '^19.2.3';
const VITE_VERSION = '^7.2.4';
const VITE_REACT_PLUGIN_VERSION = '^5.1.1';
const TAILWINDCSS_VERSION = '^4.3.0';
const TAILWINDCSS_VITE_VERSION = '^4.3.0';
const TAURI_CLI_VERSION = '^2.11.2';
const YAML_VERSION = '^2.9.0';
const NIMI_SHELL_TAURI_VERSION = '0.1.0';
const AI_SDK_VERSION = '^6.0.85';
const APP_TOOLS_VERSION = '^0.2.0';
const ELECTRON_VERSION = '^42.5.0';
const ESBUILD_VERSION = '^0.28.0';
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
    lucideReactVersion: LUCIDE_REACT_VERSION,
    tsxVersion: TSX_VERSION,
    typescriptVersion: TYPESCRIPT_VERSION,
    nodeTypesVersion: NODE_TYPES_VERSION,
    reactTypesVersion: REACT_TYPES_VERSION,
    reactDomTypesVersion: REACT_DOM_TYPES_VERSION,
    viteVersion: VITE_VERSION,
    viteReactPluginVersion: VITE_REACT_PLUGIN_VERSION,
    tailwindcssVersion: TAILWINDCSS_VERSION,
    tailwindcssViteVersion: TAILWINDCSS_VITE_VERSION,
    tauriCliVersion: TAURI_CLI_VERSION,
    yamlVersion: YAML_VERSION,
    nimiShellTauriVersion: NIMI_SHELL_TAURI_VERSION,
    electronVersion: ELECTRON_VERSION,
    esbuildVersion: ESBUILD_VERSION,
    packageManager: PACKAGE_MANAGER,
  };
}

function runNimicodingSync(targetDir, mode) {
  if (!['apply', 'check'].includes(mode)) {
    throw new Error(`Unsupported nimicoding sync mode: ${mode}`);
  }
  const flag = mode === 'apply' ? '--apply' : '--check';
  const pnpmArgs = ['--silent', 'exec', 'nimicoding', 'sync', flag, '--json'];
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
  const plan = options.plan || resolveAppCreatePlan(cwd, options);
  return createAppScaffold({
    cwd,
    options: {
      dir: options.dir,
      profile: options.profile,
      appId: options.appId,
      name: options.name,
      title: options.title,
      packageName: options.packageName,
      author: options.author,
      features: options.features,
      silent: options.silent,
    },
    versions: appScaffoldVersions(),
    createFileTree,
    ensureDirEmptyOrMissing,
    mkdirSync,
    plan,
  });
}

export function resolveAppCreateInput(cwd, options = {}) {
  return resolveAppScaffoldCreateInput({ cwd, options });
}

export function resolveAppCreatePlan(cwd, options = {}) {
  return resolveAppCreatePlanWith(
    cwd,
    options,
    resolveAppScaffoldCreateInput,
    buildAppScaffoldCreatePlan,
  );
}

export function resolveCandidateAppCreatePlan(cwd, options = {}) {
  return resolveAppCreatePlanWith(
    cwd,
    options,
    resolveAppScaffoldCandidateCreateInput,
    buildAppScaffoldCandidateCreatePlan,
  );
}

function resolveAppCreatePlanWith(cwd, options, resolveInput, buildPlan) {
  const resolvedInput = resolveInput({ cwd, options });
  ensureDirEmptyOrMissing(resolvedInput.targetDir);
  const topology = resolveCreateTopology(resolvedInput);
  const versions = {
    ...appScaffoldVersions(),
    ...(topology.workspaceCargoPath ? { workspaceCargoPath: topology.workspaceCargoPath } : {}),
  };
  const plan = buildPlan({ cwd, options, versions, topology });
  assertNoDeclaredWorkspacePortCollision(topology.workspaceRoot, plan);
  return plan;
}

export function createCandidateApp(cwd, options = {}) {
  const plan = options.plan || resolveCandidateAppCreatePlan(cwd, options);
  return createAppScaffoldCandidate({
    cwd,
    options,
    versions: appScaffoldVersions(),
    createFileTree,
    ensureDirEmptyOrMissing,
    mkdirSync,
    plan,
  });
}

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isPathInside(parentDir, targetDir) {
  const relative = path.relative(parentDir, targetDir);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readWorkspacePackages(workspaceRoot) {
  const manifestPath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  let manifest;
  try {
    manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read workspace membership from ${manifestPath}: ${message}`);
  }
  if (!Array.isArray(manifest?.packages)) {
    throw new Error(`Workspace package membership is missing from ${manifestPath}`);
  }
  return manifest.packages.map((entry) => String(entry).replaceAll('\\', '/'));
}

function resolveCreateTopology(resolvedInput) {
  const workspaceRoot = findWorkspaceRoot(path.dirname(resolvedInput.targetDir));
  if (resolvedInput.profile !== 'workspace-app') {
    return Object.freeze({ profile: 'standalone', workspaceRoot });
  }
  if (!workspaceRoot) {
    throw new Error('workspace-app target must belong to a Nimi pnpm workspace');
  }
  const packages = readWorkspacePackages(workspaceRoot);
  for (const requiredMembership of ['apps/*', 'kit', 'app-tools', 'sdks/typescript']) {
    if (!packages.includes(requiredMembership)) {
      throw new Error(`workspace-app requires workspace membership ${requiredMembership}`);
    }
  }
  const appsRoot = path.join(workspaceRoot, 'apps');
  const relativeTarget = path.relative(appsRoot, resolvedInput.targetDir);
  if (
    !relativeTarget
    || relativeTarget.startsWith('..')
    || path.isAbsolute(relativeTarget)
    || relativeTarget.includes(path.sep)
  ) {
    throw new Error('workspace-app target must be a direct apps/* workspace package');
  }
  const cargoTarget = path.join(workspaceRoot, 'kit', 'shell', 'tauri');
  if (!existsSync(cargoTarget) || !statSync(cargoTarget).isDirectory()) {
    throw new Error(`workspace-app Cargo dependency target is unavailable: ${cargoTarget}`);
  }
  const workspaceCargoPath = path.relative(
    path.join(resolvedInput.targetDir, 'src-tauri'),
    cargoTarget,
  ).replaceAll('\\', '/');
  if (!workspaceCargoPath || path.isAbsolute(workspaceCargoPath)) {
    throw new Error('workspace-app Cargo dependency path could not be derived');
  }
  return Object.freeze({
    profile: 'workspace-app',
    workspaceRoot,
    appsRoot,
    workspaceCargoPath,
  });
}

function assertNoDeclaredWorkspacePortCollision(workspaceRoot, plan) {
  if (!workspaceRoot) return;
  const appsRoot = path.join(workspaceRoot, 'apps');
  if (!isPathInside(appsRoot, plan.resolvedInput.targetDir)) return;
  if (!existsSync(appsRoot)) return;
  const selectedPort = plan.preview.identity.devPort;
  for (const entry of readdirSync(appsRoot)) {
    const appDir = path.join(appsRoot, entry);
    if (!statSync(appDir).isDirectory() || path.resolve(appDir) === path.resolve(plan.resolvedInput.targetDir)) continue;
    const manifestPath = path.join(appDir, 'nimi.app.yaml');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot validate declared renderer ports from ${manifestPath}: ${message}`);
    }
    const origin = manifest?.local_development?.electron?.renderer_origin;
    if (typeof origin !== 'string') continue;
    let declaredPort;
    try {
      declaredPort = Number(new URL(origin).port);
    } catch {
      throw new Error(`Invalid declared renderer origin in ${manifestPath}: ${origin}`);
    }
    if (declaredPort === selectedPort) {
      throw new Error(`Declared renderer port collision: ${selectedPort} is already owned by ${manifestPath}`);
    }
  }
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
