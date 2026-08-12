import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';
import {
  resolveDesktopDevObservationArguments,
} from '../apps/desktop/scripts/lib/electron-dev-carrier.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const helperPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.helperPath;
const serviceRoot = '/Library/Application Support/Nimi/RuntimeDev';
const bootstrapRoot = path.join(serviceRoot, 'bootstrap');
const runtimePath = MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeExecutablePath;
const desktopPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.desktopApplicationPath;
const desktopExecutablePath = MACOS_LOCAL_DEVELOPMENT_PROFILE.desktopExecutablePath;
const launchDaemonPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.launchDaemonPath;
const candidateOutputParent = path.join(
  repoRoot,
  '.nimi',
  'local',
  'macos-dev-runtime-candidates',
);

const modes = new Map([
  ['--install', 'install'],
  ['--status', 'status'],
  ['--logs', 'logs'],
  ['--desktop', 'desktop'],
  ['--restart', 'restart'],
  ['--uninstall', 'uninstall'],
]);

export function parseMacOSDevRuntimeArguments(args) {
  const normalized = args.slice();
  while (normalized[0] === '--') normalized.shift();
  if (normalized.length === 0) return Object.freeze({ mode: 'update' });
  if (normalized.length !== 1 || !modes.has(normalized[0])) {
    throw workflowError(
      'macOS fixed-service acceptance updates by default and otherwise accepts exactly one of --install, --status, --logs, --desktop, --restart, or --uninstall.',
      'dev-runtime-argument-invalid',
      'use_one_documented_macos_dev_runtime_mode',
    );
  }
  return Object.freeze({ mode: modes.get(normalized[0]) });
}

export async function runMacOSDevRuntimeService(input = {}) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw workflowError(
      `macOS development Runtime requires darwin/arm64, received ${platform}/${architecture}.`,
      'dev-runtime-platform-unsupported',
      'use_native_apple_silicon_macos',
    );
  }

  const mode = input.mode ?? 'update';
  const queryStatus = input.queryStatus ?? readDevelopmentStatus;
  if (mode === 'status') return queryStatus();
  if (mode === 'logs') return readRuntimeLogs();

  const initial = await queryStatus();
  if (mode === 'desktop') {
    assertInstalledRunningStatus(initial);
    const launchDesktop = input.launchDesktop ?? launchInstalledDesktop;
    return launchDesktop();
  }
  const invokeHelper = input.invokeHelper ?? runPrivilegedHelper;

  if (mode === 'install' || mode === 'update') {
    if (mode === 'install' && initial.status !== 'absent') {
      throw workflowError(
        'macOS development Runtime install requires an absent product namespace.',
        'runtime-service-repair-required',
        'run_pnpm_accept_runtime_fixed_service_uninstall_before_install',
        { status: initial },
      );
    }
    if (mode === 'update') {
      assertUpdateReadyStatus(initial);
    }
    const buildCandidate = input.buildCandidate ?? buildDevelopmentCandidate;
    const candidate = await buildCandidate();
    try {
      const candidateHelper = path.join(
        candidate.outputRoot,
        'installer',
        'nimi-macos-dev-security',
      );
      if (!existsSync(candidateHelper)) {
        throw workflowError(
          'The fixed ad-hoc development candidate does not contain its installer helper.',
          'dev-candidate-incomplete',
          'rebuild_the_complete_candidate',
        );
      }
      const installResult = await invokeHelper([
        mode === 'update' ? 'update-candidate' : 'install-candidate',
        candidate.outputRoot,
      ]);
      return Object.freeze(installResult);
    } finally {
      await candidate.cleanup?.();
    }
  }

  if (mode === 'restart') {
    assertHelperAvailable(initial);
    return invokeHelper(['restart-service']);
  }

  if (mode === 'uninstall') {
    assertHelperAvailable(initial);
    return invokeHelper(['uninstall-service']);
  }

  throw workflowError(
    'Unsupported macOS dev Runtime mode.',
    'dev-runtime-argument-invalid',
    'use_one_documented_macos_dev_runtime_mode',
  );
}

function assertUpdateReadyStatus(status) {
  if (status?.status === 'present') return;
  if (status?.status === 'absent') {
    throw workflowError(
      'The macOS development Runtime service is not installed.',
      'dev-runtime-service-not-installed',
      'run_pnpm_accept_runtime_fixed_service_install',
      { status },
    );
  }
  throw workflowError(
    'The macOS development Runtime installation is incomplete.',
    'runtime-service-repair-required',
    'run_pnpm_accept_runtime_fixed_service_uninstall_before_update',
    { status },
  );
}

export function assertInstalledRunningStatus(status) {
  if (status?.status === 'present'
    && status?.state === 'running'
    && Number.isInteger(status?.pid)
    && status.pid > 1) {
    return;
  }
  if (status?.status === 'absent') {
    throw workflowError(
      'The macOS development Runtime service is not installed.',
      'dev-runtime-service-not-installed',
      'run_pnpm_accept_runtime_fixed_service_install',
      { status },
    );
  }
  throw workflowError(
    'The macOS development Runtime is not running.',
    'runtime-service-unavailable',
    'inspect_macos_dev_runtime_status_and_launchd_logs',
    { status },
  );
}

async function readDevelopmentStatus() {
  if (!existsSync(helperPath)) {
    const installedArtifacts = [
      runtimePath,
      desktopPath,
      launchDaemonPath,
      serviceRoot,
      '/private/var/run/nimi-dev',
    ].filter((value, index, values) => existsSync(value) && values.indexOf(value) === index);
    return Object.freeze({
      status: installedArtifacts.length === 0 ? 'absent' : 'partial',
      state: 'stopped',
      serviceName: MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeServiceLabel,
      ...(installedArtifacts.length > 0
        ? {
            reasonCode: 'runtime-service-repair-required',
            installedArtifacts,
          }
        : {}),
    });
  }
  requireInstalledHelperMetadata();
  return Object.freeze(runJSON(helperPath, ['status']));
}

async function buildDevelopmentCandidate() {
  const outputRoot = path.join(candidateOutputParent, randomUUID());
  try {
    const result = runCaptured(process.execPath, [
      path.join(
        repoRoot,
        'apps',
        'desktop',
        'scripts',
        'build-macos-electron-release.mjs',
      ),
      '--local-development-candidate',
    ], {
      ...process.env,
      NIMI_MACOS_RELEASE_OUTPUT: outputRoot,
    });
    if (!String(result.stdout || '').includes(`macOS Electron output: ${outputRoot}`)) {
      throw workflowError(
        'The macOS development build did not report its output directory.',
        'dev-runtime-build-failed',
        'inspect_macos_development_build_output',
      );
    }
    return Object.freeze({
      outputRoot,
      cleanup: () => removeBuiltDevelopmentCandidate(outputRoot),
    });
  } catch (error) {
    removeBuiltDevelopmentCandidate(outputRoot);
    throw error;
  }
}

function removeBuiltDevelopmentCandidate(outputRoot) {
  const resolved = path.resolve(outputRoot);
  if (path.dirname(resolved) !== candidateOutputParent
    || !isUUID(path.basename(resolved))) {
    throw workflowError(
      'Refusing to remove a noncanonical macOS development candidate.',
      'dev-candidate-path-untrusted',
      'inspect_the_candidate_output_path',
      { outputRoot },
    );
  }
  try {
    rmSync(resolved, { recursive: true, force: true });
  } catch (error) {
    throw workflowError(
      'The macOS development candidate source directory could not be removed.',
      'dev-candidate-cleanup-failed',
      'inspect_the_exact_local_candidate_directory',
      {
        outputRoot: resolved,
        diagnostic: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function runPrivilegedHelper(arguments_) {
  const candidateCommand = (
    arguments_[0] === 'install-candidate'
      || arguments_[0] === 'update-candidate'
  ) && arguments_.length === 2;
  if (!candidateCommand) {
    requireInstalledHelperMetadata();
    return runJSON('/usr/bin/sudo', [helperPath, ...arguments_]);
  }

  const source = path.resolve(arguments_[1]);
  const transactionID = randomUUID();
  const staged = path.join(bootstrapRoot, transactionID);
  requireSafeBootstrapPath(staged);
  try {
    runCaptured('/usr/bin/sudo', ['/bin/mkdir', '-p', bootstrapRoot], process.env);
    runCaptured(
      '/usr/bin/sudo',
      ['/usr/sbin/chown', 'root:wheel', serviceRoot, bootstrapRoot],
      process.env,
    );
    runCaptured(
      '/usr/bin/sudo',
      ['/bin/chmod', '0755', serviceRoot, bootstrapRoot],
      process.env,
    );
    runCaptured(
      '/usr/bin/sudo',
      [
        '/usr/bin/ditto',
        '--norsrc',
        '--noextattr',
        '--noacl',
        '--noqtn',
        source,
        staged,
      ],
      process.env,
    );
    runCaptured(
      '/usr/bin/sudo',
      ['/usr/sbin/chown', '-R', 'root:wheel', staged],
      process.env,
    );
    const stagedHelper = path.join(
      staged,
      'installer',
      'nimi-macos-dev-security',
    );
    return runJSON('/usr/bin/sudo', [
      stagedHelper,
      arguments_[0],
      staged,
    ]);
  } finally {
    cleanupBootstrap(staged);
  }
}

function cleanupBootstrap(staged) {
  requireSafeBootstrapPath(staged);
  runCheckedCleanup(['/bin/rm', '-rf', staged], staged);
  if (existsSync(staged)) {
    throw workflowError(
      'The root-owned bootstrap candidate remains after cleanup.',
      'runtime-service-repair-required',
      'inspect_the_exact_bootstrap_candidate',
      { path: staged },
    );
  }
  for (const directory of [bootstrapRoot, serviceRoot]) {
    if (!existsSync(directory)) continue;
    let entries;
    try {
      entries = readdirSync(directory);
    } catch (error) {
      throw workflowError(
        'A fixed root-owned bootstrap directory could not be inspected after cleanup.',
        'runtime-service-repair-required',
        'inspect_the_exact_bootstrap_directory',
        {
          path: directory,
          diagnostic: error instanceof Error ? error.message : String(error),
        },
      );
    }
    if (entries.length > 0) continue;
    runCheckedCleanup(['/bin/rmdir', directory], directory);
    if (existsSync(directory)) {
      throw workflowError(
        'An empty root-owned bootstrap directory remains after cleanup.',
        'runtime-service-repair-required',
        'inspect_the_exact_bootstrap_directory',
        { path: directory },
      );
    }
  }
}

function runCheckedCleanup(args, target) {
  const result = spawnSync(
    '/usr/bin/sudo',
    args,
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error || result.status !== 0) {
    throw workflowError(
      'A fixed root-owned bootstrap path could not be cleaned.',
      'runtime-service-repair-required',
      'inspect_the_exact_bootstrap_path',
      {
        path: target,
        status: result.status ?? 'unavailable',
        diagnostic: String(result.stderr || '').trim().slice(0, 1000),
      },
    );
  }
}

function requireSafeBootstrapPath(candidate) {
  const parent = path.dirname(candidate);
  const identifier = path.basename(candidate);
  if (parent !== bootstrapRoot
    || !isUUID(identifier)) {
    throw workflowError(
      'Refusing to mutate a noncanonical bootstrap path.',
      'dev-candidate-path-untrusted',
      'rebuild_the_candidate',
      { candidate },
    );
  }
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function readRuntimeLogs() {
  const result = runCaptured('/usr/bin/log', [
    'show',
    '--style',
    'compact',
    '--last',
    '30m',
    '--predicate',
    'process == "nimi-runtime" OR subsystem BEGINSWITH "ai.nimi.runtime"',
  ], process.env);
  return Object.freeze({
    status: 'ok',
    serviceName: MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeServiceLabel,
    window: '30m',
    logs: String(result.stdout || '').split(/\r?\n/u).slice(-2000),
  });
}

async function launchInstalledDesktop() {
  const desktop = spawn(desktopExecutablePath, resolveDesktopDevObservationArguments(), {
    cwd: path.dirname(desktopExecutablePath),
    env: process.env,
    stdio: 'inherit',
  });
  const result = await waitForChild(desktop);
  if (result.error || result.code !== 0) {
    throw workflowError(
      `The installed Nimi Dev application exited with ${result.error?.message || result.signal || `status ${result.code}`}.`,
      'desktop-dev-launch-failed',
      'inspect_the_installed_nimi_dev_application',
    );
  }
  return Object.freeze({
    status: 'stopped',
    application: desktopPath,
  });
}

function waitForChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once('error', (error) => finish({ error }));
    child.once('exit', (code, signal) => finish({ code, signal }));
  });
}

function assertHelperAvailable(status) {
  if (existsSync(helperPath)) return;
  throw workflowError(
    'The installed macOS development security helper is unavailable.',
    status?.status === 'absent'
      ? 'dev-runtime-service-not-installed'
      : 'runtime-service-repair-required',
    'install_or_repair_the_macos_development_runtime',
    { status },
  );
}

function requireInstalledHelperMetadata() {
  const metadata = lstatSync(helperPath);
  if (!metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.uid !== 0
    || metadata.gid !== 0
    || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o755
    || realpathSync(helperPath) !== helperPath) {
    throw workflowError(
      'The installed macOS development security helper metadata is untrusted.',
      'runtime-service-repair-required',
      'reinstall_the_root_owned_macos_development_security_helper',
    );
  }
}

function runJSON(command, args) {
  const result = runCaptured(command, args, process.env);
  try {
    return JSON.parse(String(result.stdout || '').trim());
  } catch {
    throw workflowError(
      `${path.basename(command)} did not return one JSON document.`,
      'dev-runtime-command-result-invalid',
      'inspect_macos_dev_runtime_command_output',
    );
  }
}

function runCaptured(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const parsed = parseFailure(result.stderr);
    if (parsed) {
      throw workflowError(
        parsed.message,
        parsed.reasonCode,
        parsed.actionHint,
        parsed.details,
      );
    }
    const diagnostic = `${result.stderr || ''}\n${result.stdout || ''}`
      .replaceAll(/\s+/gu, ' ')
      .trim()
      .slice(0, 1000);
    throw workflowError(
      `${path.basename(command)} failed with status ${result.status ?? 'unavailable'}${diagnostic ? `: ${diagnostic}` : ''}`,
      'dev-runtime-command-failed',
      'inspect_macos_dev_runtime_command_error',
    );
  }
  return result;
}

function parseFailure(value) {
  for (const line of String(value || '').split(/\r?\n/u).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.status === 'failed'
        && parsed.reasonCode
        && parsed.actionHint
        && parsed.message) {
        return parsed;
      }
    } catch {
      // Non-JSON diagnostics are reported by runCaptured.
    }
  }
  return undefined;
}

function workflowError(message, reasonCode, actionHint, details = undefined) {
  return Object.assign(new Error(message), {
    reasonCode,
    actionHint,
    details,
  });
}
