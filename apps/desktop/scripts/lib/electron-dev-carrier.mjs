import path from 'node:path';

export function resolveSignedDesktopDevCarrier(input) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  if (platform !== 'win32' || architecture !== 'x64') {
    throw carrierError(
      `Signed Desktop Electron development is not admitted for ${platform}/${architecture}.`,
      'desktop-dev-signed-carrier-platform-unsupported',
      'use_windows_x64_signed_desktop_carrier',
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

function requiredText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function carrierError(message, reasonCode, actionHint) {
  return Object.assign(new Error(message), { reasonCode, actionHint });
}
