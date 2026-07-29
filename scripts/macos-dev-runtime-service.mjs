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
import readline from 'node:readline/promises';
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
const desktopRoot = path.join(repoRoot, 'apps', 'desktop');
const rendererUrl = 'http://127.0.0.1:1420';
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
  if (normalized.length === 0) return Object.freeze({ mode: 'status' });
  if (normalized.length !== 1 || !modes.has(normalized[0])) {
    throw workflowError(
      'macOS dev:runtime accepts no argument or exactly one of --install, --status, --logs, --desktop, --restart, or --uninstall.',
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

  const mode = input.mode ?? 'status';
  const queryStatus = input.queryStatus ?? readDevelopmentStatus;
  if (mode === 'status') return queryStatus();
  if (mode === 'logs') return readRuntimeLogs();

  const initial = await queryStatus();
  if (mode === 'desktop') {
    assertHealthyInstalledStatus(initial);
    const launchDesktop = input.launchDesktop ?? launchInstalledDesktop;
    return launchDesktop();
  }
  const confirm = input.confirm ?? confirmMachineMutation;
  const invokeHelper = input.invokeHelper ?? runPrivilegedHelper;

  if (mode === 'install') {
    if (initial.status !== 'absent') {
      throw workflowError(
        'macOS development Runtime install requires an absent product namespace.',
        'runtime-service-repair-required',
        'run_pnpm_dev_runtime_uninstall_before_install',
        { status: initial },
      );
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
      await confirm(installImpact(), 'INSTALL NIMI MACOS DEV RUNTIME');
      const installResult = await invokeHelper([
        'install-candidate',
        candidate.outputRoot,
      ]);
      const final = await queryStatus();
      assertHealthyInstalledStatus(final);
      return Object.freeze({
        ...installResult,
        status: 'installed',
        state: final.state,
        pid: final.pid,
        serviceName: MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeServiceLabel,
      });
    } finally {
      await candidate.cleanup?.();
    }
  }

  if (mode === 'restart') {
    assertHelperAvailable(initial);
    await confirm(restartImpact(), 'RESTART NIMI MACOS DEV RUNTIME');
    const result = await invokeHelper(['restart-service']);
    const final = await queryStatus();
    assertHealthyInstalledStatus(final);
    if (!Number.isInteger(result?.previousPID)
      || !Number.isInteger(result?.pid)
      || result.pid === result.previousPID
      || final.pid !== result.pid) {
      throw workflowError(
        'Runtime restart did not observe one new live process.',
        'runtime-service-unavailable',
        'inspect_macos_dev_runtime_launchd_logs',
        { result, status: final },
      );
    }
    return result;
  }

  if (mode === 'uninstall') {
    assertHelperAvailable(initial);
    await confirm(uninstallImpact(), 'UNINSTALL NIMI MACOS DEV RUNTIME');
    const result = await invokeHelper(['uninstall-service']);
    const final = await queryStatus();
    if (final.status !== 'absent') {
      throw workflowError(
        'macOS development Runtime remains present after uninstall.',
        'runtime-service-repair-required',
        'inspect_the_exact_remaining_nimi_paths',
        { status: final },
      );
    }
    return result;
  }

  throw workflowError(
    'Unsupported macOS dev Runtime mode.',
    'dev-runtime-argument-invalid',
    'use_one_documented_macos_dev_runtime_mode',
  );
}

export function assertHealthyInstalledStatus(status) {
  if (status?.status === 'present'
    && status?.state === 'running'
    && status?.healthy === true
    && Number.isInteger(status?.pid)
    && status.pid > 1) {
    return;
  }
  if (status?.status === 'absent') {
    throw workflowError(
      'The macOS development Runtime service is not installed.',
      'dev-runtime-service-not-installed',
      'run_pnpm_dev_runtime_install',
      { status },
    );
  }
  throw workflowError(
    'The macOS development Runtime is not healthy.',
    status?.reasonCode === 'runtime-service-untrusted'
      ? 'runtime-service-untrusted'
      : 'runtime-service-repair-required',
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
      ...readKnownStagingArtifacts(),
    ].filter((value, index, values) => existsSync(value) && values.indexOf(value) === index);
    return Object.freeze({
      status: installedArtifacts.length === 0 ? 'absent' : 'partial',
      state: 'stopped',
      healthy: false,
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
  if (arguments_[0] !== 'install-candidate' || arguments_.length !== 2) {
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
      ['/usr/bin/ditto', '--noqtn', '--noacl', source, staged],
      process.env,
    );
    runCaptured(
      '/usr/bin/sudo',
      ['/usr/sbin/chown', '-R', 'root:wheel', staged],
      process.env,
    );
    return runJSON('/usr/bin/sudo', [
      path.join(staged, 'installer', 'nimi-macos-dev-security'),
      'install-candidate',
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

function readKnownStagingArtifacts() {
  const patterns = [
    [serviceRoot, /^\.active-([0-9a-f-]+)\.stage$/iu],
    ['/Applications', /^\.Nimi Dev\.app-([0-9a-f-]+)\.stage$/iu],
    ['/usr/local/libexec', /^\.nimi-macos-dev-security-([0-9a-f-]+)\.stage$/iu],
    ['/Library/LaunchDaemons', /^\.ai\.nimi\.runtime\.dev-([0-9a-f-]+)\.stage\.plist$/iu],
  ];
  const artifacts = [];
  for (const [parent, pattern] of patterns) {
    if (!existsSync(parent)) continue;
    for (const entry of readDirectoryForStatus(parent, artifacts)) {
      const match = entry.match(pattern);
      if (match && isUUID(match[1])) artifacts.push(path.join(parent, entry));
    }
  }
  if (existsSync(bootstrapRoot)) {
    for (const entry of readDirectoryForStatus(bootstrapRoot, artifacts)) {
      if (isUUID(entry)) artifacts.push(path.join(bootstrapRoot, entry));
    }
  }
  return artifacts.sort();
}

function readDirectoryForStatus(directory, artifacts) {
  try {
    return readdirSync(directory);
  } catch {
    artifacts.push(directory);
    return [];
  }
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
  const renderer = spawn(process.execPath, [
    path.join(desktopRoot, 'scripts', 'ensure-dev-renderer-port.mjs'),
    '--',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    '1420',
    '--strictPort',
  ], {
    cwd: desktopRoot,
    env: process.env,
    stdio: 'inherit',
  });
  let desktop;
  try {
    await waitForRenderer(renderer);
    desktop = spawn(desktopExecutablePath, resolveDesktopDevObservationArguments(), {
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
      rendererUrl,
    });
  } finally {
    await stopChild(renderer);
    if (desktop?.exitCode === null && desktop.signalCode === null) {
      await stopChild(desktop);
    }
  }
}

async function waitForRenderer(renderer) {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    if (renderer.exitCode !== null || renderer.signalCode !== null) {
      throw workflowError(
        'The Desktop renderer process exited before becoming ready.',
        'desktop-dev-renderer-unavailable',
        'inspect_the_desktop_renderer_output',
      );
    }
    try {
      const response = await fetch(rendererUrl);
      if (response.ok || response.status < 500) return;
      lastError = new Error(`renderer responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw workflowError(
    `Timed out waiting for the Desktop renderer: ${lastError instanceof Error ? lastError.message : String(lastError || '')}`,
    'desktop-dev-renderer-unavailable',
    'inspect_the_desktop_renderer_output',
  );
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

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    waitForChild(child).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitForChild(child);
  }
}

async function confirmMachineMutation(impact, phrase) {
  process.stdout.write(
    `${JSON.stringify({ status: 'confirmation-required', confirmation: phrase, impact })}\n`,
  );
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw workflowError(
      'Interactive confirmation is required before privileged macOS service mutation.',
      'macos-dev-machine-mutation-confirmation-required',
      'rerun_in_an_interactive_terminal_and_enter_the_exact_confirmation_phrase',
    );
  }
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const answer = await terminal.question(
    `Type ${JSON.stringify(phrase)} to continue: `,
  );
  terminal.close();
  if (answer !== phrase) {
    throw workflowError(
      'macOS development Runtime mutation was cancelled.',
      'macos-dev-machine-mutation-cancelled',
      'rerun_only_after_approving_the_reported_changes',
    );
  }
}

function installImpact() {
  return Object.freeze({
    action: 'install the fixed ad-hoc-signed macOS development Desktop and Runtime service',
    writes: [
      desktopPath,
      `${serviceRoot}/{active,state,install-transaction.json}`,
      launchDaemonPath,
      helperPath,
      '/private/var/run/nimi-dev',
    ],
    creates: ['non-login _nimiruntimedev user and group'],
    rollbackDeletes: [
      `System Keychain items with service ${MACOS_LOCAL_DEVELOPMENT_PROFILE.keychainService}`,
      'only fixed development installation paths created by the failed transaction',
    ],
  });
}

function restartImpact() {
  return Object.freeze({
    action: `restart ${MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeServiceLabel}`,
    consequence: 'the Runtime process and protected sessions rotate',
    persistentDataDeleted: false,
  });
}

function uninstallImpact() {
  return Object.freeze({
    action: 'stop and uninstall the macOS development Desktop and Runtime service',
    deletes: [
      desktopPath,
      serviceRoot,
      launchDaemonPath,
      helperPath,
      '/private/var/run/nimi-dev',
      '_nimiruntimedev user and group',
      'Runtime-only development protected state',
      `System Keychain items with service ${MACOS_LOCAL_DEVELOPMENT_PROFILE.keychainService}`,
    ],
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
  const verification = spawnSync(
    '/usr/bin/codesign',
    ['--verify', '--strict', '--verbose=4', helperPath],
    { encoding: 'utf8' },
  );
  if (verification.error || verification.status !== 0) {
    throw workflowError(
      'The installed macOS development security helper signature is invalid.',
      'runtime-service-untrusted',
      'reinstall_the_macos_development_runtime',
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
