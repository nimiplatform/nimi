import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  buildAppScaffoldCandidateCreatePlan,
  buildAppScaffoldCreatePlan,
  createAppScaffold,
  createAppScaffoldCandidate,
  resolveAppScaffoldCandidateCreateInput,
  resolveAppScaffoldCreateInput,
} from './app-scaffold.mjs';
import { initApp } from './app-doctor-update.mjs';
import {
  buildAppProject,
  adoptAppProject,
  checkAppProject,
  syncAppProject,
  testAppProject,
  validateAppInitialization,
} from './app-project-lifecycle.mjs';
import { aggregateAppTargetCandidates, packAppTarget } from './app-pack.mjs';
import { runDevShell } from '../scripts/dev-shell.mjs';
export { runDevShell };
import { parse as parseYaml } from 'yaml';
import { readWebDevelopment } from './web-development.mjs';
import { readMobileDevelopment } from './mobile-development.mjs';
import { resolveDevelopmentRealm, developmentRealmEnvironment } from './development-environment.mjs';
export { APP_SCAFFOLD_FEATURE_IDS } from './app-scaffold-capabilities.mjs';

const APP_TOOLS_PACKAGE_MANIFEST = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
if (!APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions
  || typeof APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions !== 'object'
  || Array.isArray(APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions)) {
  throw new Error('app-tools package manifest is missing nimiScaffoldVersions');
}
const SCAFFOLD_VERSIONS = Object.freeze({ ...APP_TOOLS_PACKAGE_MANIFEST.nimiScaffoldVersions });

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
  return { ...SCAFFOLD_VERSIONS };
}

function runNimicodingSync(targetDir, mode) {
  if (!['apply', 'check'].includes(mode)) {
    throw new Error(`Unsupported nimicoding sync mode: ${mode}`);
  }
  const packagePath = path.join(targetDir, 'node_modules', '@nimiplatform', 'nimi-coding', 'package.json');
  const expectedVersion = SCAFFOLD_VERSIONS.nimicodingVersion;
  let installed;
  try { installed = JSON.parse(readFileSync(packagePath, 'utf8')); }
  catch { throw new Error(`Install project-local @nimiplatform/nimi-coding@${expectedVersion} before nimi-app ${mode === 'apply' ? 'init/sync' : 'check'}.`); }
  if (installed.name !== '@nimiplatform/nimi-coding' || installed.version !== expectedVersion) {
    throw new Error(`Project-local @nimiplatform/nimi-coding must be ${expectedVersion}, found ${installed.version || 'unknown'}. Install the target app-tools/nimi-coding combination before applying projections.`);
  }
  let entry;
  try {
    const packageRoot = realpathSync(path.dirname(packagePath));
    if (typeof installed.bin?.nimicoding !== 'string' || !installed.bin.nimicoding) throw new Error('Missing bin.nimicoding');
    entry = realpathSync(path.resolve(packageRoot, installed.bin.nimicoding));
    if (!entry.startsWith(`${packageRoot}${path.sep}`) || !statSync(entry).isFile()) throw new Error('Invalid bin.nimicoding');
  } catch (cause) {
    throw new Error(`Project-local @nimiplatform/nimi-coding@${expectedVersion} must declare an existing nimicoding entry inside its package. Reinstall the selected package before init/sync/check.`, { cause });
  }
  const flag = mode === 'apply' ? '--apply' : '--check';
  const result = spawnSync(process.execPath, [entry, 'sync', flag, '--json'], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const output = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`nimicoding sync ${mode} failed. Run pnpm install before rerunning the lifecycle command. ${output}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`nimicoding sync ${mode} returned invalid JSON: ${message}`);
  }
}

function runAppCommand(targetDir, command, options = {}) {
  const result = spawnSync(command, {
    cwd: targetDir,
    shell: true,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: [result.error?.message, result.stderr].filter(Boolean).join('\n'),
  };
}

function appToolRunners() {
  return { runNimicodingSync, runAppCommand };
}

export function createApp(cwd, options = {}) {
  const plan = options.plan || resolveAppCreatePlan(cwd, options);
  return createAppScaffold({
    cwd,
    options: {
      dir: options.dir,
      profile: options.profile,
      platform: options.platform,
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
  const topology = resolveCreateTopology();
  const versions = appScaffoldVersions();
  const plan = buildPlan({ cwd, options, versions, topology });
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

function resolveCreateTopology() {
  return Object.freeze({ profile: 'standalone' });
}

export function initAppScaffold(cwd, options = {}) {
  if (options.adopt) return adoptAppProject(cwd, options, appScaffoldVersions(), appToolRunners());
  validateAppInitialization(path.resolve(cwd, options.dir || '.'), appScaffoldVersions());
  return initApp(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function syncApp(cwd, options = {}) {
  return syncAppProject(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function checkApp(cwd, options = {}) {
  return checkAppProject(cwd, options, appScaffoldVersions(), appToolRunners());
}

export function testApp(cwd, options = {}) {
  return testAppProject(cwd, options, appToolRunners());
}

export function buildApp(cwd, options = {}) {
  return buildAppProject(cwd, options, appToolRunners());
}

export function packApp(cwd, options = {}) {
  const manifest = parseYaml(readFileSync(path.join(path.resolve(cwd, options.dir || '.'), 'nimi.app.yaml'), 'utf8'));
  if (manifest.platform === 'web') throw new Error('Web pack is not implemented; use the App-owned website build and deployment process.');
  return options.aggregate
    ? aggregateAppTargetCandidates(cwd, options)
    : packAppTarget(cwd, options);
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.scaffold-web-carrier
// @nimi-authority: rule.nimi.platform.app-ecosystem.mobile-development-entry
export async function runAppDevelopment(cwd, options = {}) {
  const root = path.resolve(cwd, options.dir || '.');
  if (!existsSync(path.join(root, 'nimi.app.yaml'))) throw new Error('nimi.app.yaml is required for App development.');
  const manifest = parseYaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
  const platform = options.platform || manifest.platform || 'desktop';
  if (!['desktop', 'web', 'mobile'].includes(platform)) throw new Error(`Unsupported App development platform: ${platform}`);
  if (platform === 'desktop') return runDevShell(cwd, options);
  if (options.shell || options.cdpPort !== undefined || options.noCdp || options.resume || options.newRegistration || options.listRegistrations) {
    throw new Error('Desktop shell, registration and CDP launch options do not apply to remote Web or Mobile dev.');
  }
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const selectedRealm = resolveDevelopmentRealm(options.realm || undefined);
  const environment = { ...process.env, ...developmentRealmEnvironment(selectedRealm) };
  if (platform === 'mobile') {
    const mobile = readMobileDevelopment(manifest, pkg);
    process.stdout.write('[nimi-app] Running the App-owned mobile command; native source admission and verified OS callback remain required.\n');
    const result = runAppCommand(root, mobile.command, { env: environment });
    if (result.status !== 0) throw new Error(`Mobile development command exited with ${result.status}: ${result.stderr}`);
    return;
  }
  const web = readWebDevelopment(manifest, { realm: selectedRealm.name, env: environment });
  if (!pkg.scripts?.[web.script] || /\bnimi-app\s+dev\b/u.test(pkg.scripts[web.script])) throw new Error('Web dev requires a real, non-recursive App-owned renderer script.');
  process.stdout.write(`[nimi-app] Web source: ${web.site.origin}; official sign-in and first Home source confirmation are required.\n`);
  const result = runAppCommand(root, web.command, { env: environment });
  if (result.status !== 0) throw new Error(`Web development command exited with ${result.status}: ${result.stderr}`);
}
