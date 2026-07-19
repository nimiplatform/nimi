import path from 'node:path';
import { existsSync as defaultExistsSync, lstatSync as defaultLstatSync, realpathSync as defaultRealpathSync } from 'node:fs';

export function resolveSignedDesktopDevCarrier(input) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  if (platform === 'darwin' && architecture === 'arm64') {
    const executablePath = '/Applications/Nimi Dev.app/Contents/MacOS/Nimi Dev';
    if (!input.existsSync(executablePath)) {
      throw carrierError(
        `Signed Desktop development carrier is missing: ${executablePath}`,
        'dev-runtime-service-not-installed',
        'run_pnpm_dev_runtime_install',
      );
    }
    return executablePath;
  }
  if (platform !== 'win32' || architecture !== 'x64') {
    throw carrierError(
      `Signed Desktop Electron development is not admitted for ${platform}/${architecture}.`,
      'desktop-dev-signed-carrier-platform-unsupported',
      'use_admitted_signed_desktop_carrier',
    );
  }
  const electronVersion = requiredText(input.electronVersion, 'electronVersion');
  const workspaceRoot = path.resolve(requiredText(input.workspaceRoot, 'workspaceRoot'));
  const executablePath = path.join(
    workspaceRoot,
    '.nimi',
    'local',
    'electron-desktop-runtime',
    electronVersion,
    'Nimi Desktop Runtime.exe',
  );
  if (!input.existsSync(executablePath)) {
    throw carrierError(
      `Signed Desktop development carrier is missing: ${executablePath}`,
      'desktop-dev-signed-carrier-missing',
      'run_pnpm_build_dev_kernel_electron_carrier',
    );
  }
  return executablePath;
}

export function resolvePersistentDesktopDevProfile(workspaceRoot) {
  return path.join(path.resolve(requiredText(workspaceRoot, 'workspaceRoot')), '.nimi', 'local', 'dev-profiles', 'desktop');
}

export function resolveDesktopDevObservationArguments(env = process.env) {
  const rawPort = String(env.NIMI_DESKTOP_DEV_CDP_PORT || '').trim();
  if (!rawPort) return [];
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw carrierError(
      'Desktop development CDP observation port is invalid.',
      'desktop-dev-observation-port-invalid',
      'provide_valid_loopback_cdp_port',
    );
  }
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
  ];
}

export function resolveMacOSDesktopAcceptanceEnvironment(input) {
  const env = input.env ?? process.env;
  const requested = String(env.NIMI_MACOS_DEV_ACCEPTANCE || '').trim();
  const rootValue = String(env.NIMI_MACOS_DEV_ACCEPTANCE_ROOT || '').trim();
  const portValue = String(env.NIMI_DESKTOP_DEV_CDP_PORT || '').trim();
  const zhiyuPortValue = String(env.NIMI_MACOS_DEV_ACCEPTANCE_ZHIYU_CDP_PORT || '').trim();
  if (!requested && !rootValue && !portValue && !zhiyuPortValue) return Object.freeze({});
  const desktopPort = Number(portValue);
  const zhiyuPort = Number(zhiyuPortValue);
  if (requested !== '1' || !rootValue
    || !Number.isInteger(desktopPort) || desktopPort < 1024 || desktopPort > 65535
    || !Number.isInteger(zhiyuPort) || zhiyuPort < 1024 || zhiyuPort > 65535
    || desktopPort === zhiyuPort) {
    throw carrierError(
      'macOS Desktop observation requires one complete explicit acceptance profile.',
      'desktop-dev-acceptance-profile-invalid',
      'use_test_acceptance_macos_dev_chain',
    );
  }
  const workspaceRoot = path.resolve(requiredText(input.workspaceRoot, 'workspaceRoot'));
  const existsSync = input.existsSync ?? defaultExistsSync;
  const lstatSync = input.lstatSync ?? defaultLstatSync;
  const realpathSync = input.realpathSync ?? defaultRealpathSync;
  const authorityRoot = path.join(workspaceRoot, '.nimi', 'local', 'acceptance');
  if (!path.isAbsolute(rootValue) || !existsSync(authorityRoot) || !existsSync(rootValue)) {
    throw acceptancePathError();
  }
  const authorityMetadata = lstatSync(authorityRoot);
  const rootMetadata = lstatSync(rootValue);
  if (!authorityMetadata.isDirectory() || authorityMetadata.isSymbolicLink()
    || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
    || (rootMetadata.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && rootMetadata.uid !== process.getuid())) {
    throw acceptancePathError();
  }
  const canonicalAuthorityRoot = realpathSync(authorityRoot);
  const canonicalRoot = realpathSync(rootValue);
  const relative = path.relative(canonicalAuthorityRoot, canonicalRoot);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw acceptancePathError();
  }
  const captureFile = path.join(canonicalRoot, 'oauth-authorization-url.txt');
  const desktopUserDataRoot = path.join(canonicalRoot, 'desktop-user-data');
  const zhiyuUserDataRoot = path.join(canonicalRoot, 'zhiyu-user-data');
  if (!existsSync(desktopUserDataRoot) || !existsSync(zhiyuUserDataRoot)) throw acceptancePathError();
  const desktopMetadata = lstatSync(desktopUserDataRoot);
  const zhiyuMetadata = lstatSync(zhiyuUserDataRoot);
  if (!desktopMetadata.isDirectory() || desktopMetadata.isSymbolicLink()
    || (desktopMetadata.mode & 0o077) !== 0
    || realpathSync(desktopUserDataRoot) !== desktopUserDataRoot
    || !zhiyuMetadata.isDirectory() || zhiyuMetadata.isSymbolicLink()
    || (zhiyuMetadata.mode & 0o077) !== 0
    || realpathSync(zhiyuUserDataRoot) !== zhiyuUserDataRoot) {
    throw acceptancePathError();
  }
  if (existsSync(captureFile)) {
    throw carrierError(
      'macOS Desktop acceptance OAuth capture must begin with a fresh evidence path.',
      'desktop-dev-acceptance-capture-not-fresh',
      'use_a_new_private_acceptance_evidence_directory',
    );
  }
  return Object.freeze({
    NIMI_MACOS_DEV_ACCEPTANCE: '1',
    NIMI_MACOS_DEV_ACCEPTANCE_ROOT: canonicalRoot,
    NIMI_DEV_KERNEL_CHECKPOINT: '1',
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: canonicalRoot,
    NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: captureFile,
    NIMI_MACOS_DEV_ACCEPTANCE_DESKTOP_USER_DATA_ROOT: desktopUserDataRoot,
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT: String(zhiyuPort),
    NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: zhiyuUserDataRoot,
  });
}

function acceptancePathError() {
  return carrierError(
    'macOS Desktop acceptance evidence root must be one private canonical directory below .nimi/local/acceptance.',
    'desktop-dev-acceptance-path-invalid',
    'use_test_acceptance_macos_dev_chain',
  );
}

function requiredText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function carrierError(message, reasonCode, actionHint) {
  return Object.assign(new Error(message), { reasonCode, actionHint });
}
