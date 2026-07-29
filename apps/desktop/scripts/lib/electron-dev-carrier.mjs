import path from 'node:path';

export function resolveSignedDesktopDevCarrier(input) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
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
      'prepare_signed_desktop_electron_runtime',
    );
  }
  return executablePath;
}

export function resolveWorkspaceElectronDevCarrier(input) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw carrierError(
      `Workspace Electron development is not admitted for ${platform}/${architecture}.`,
      'desktop-dev-workspace-carrier-platform-unsupported',
      'use_native_apple_silicon_macos',
    );
  }
  const executablePath = path.resolve(requiredText(input.electronExecutable, 'electronExecutable'));
  if (!input.existsSync(executablePath)) {
    throw carrierError(
      `Workspace Electron development carrier is missing: ${executablePath}`,
      'desktop-dev-workspace-carrier-missing',
      'install_the_workspace_Electron_dependency',
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

function requiredText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function carrierError(message, reasonCode, actionHint) {
  return Object.assign(new Error(message), { reasonCode, actionHint });
}
