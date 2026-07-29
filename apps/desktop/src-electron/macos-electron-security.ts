type ElectronCommandLine = {
  getSwitchValue(name: string): string;
  hasSwitch(name: string): boolean;
};

declare const __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: boolean;
declare const __NIMI_ELECTRON_DEVELOPMENT_BUILD__: boolean;

const MACOS_LOCAL_DEVELOPMENT_BUILD =
  typeof __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__;
const ELECTRON_DEVELOPMENT_BUILD =
  typeof __NIMI_ELECTRON_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_DEVELOPMENT_BUILD__;

const FORBIDDEN_CHROMIUM_SWITCHES = [
  'disable-sandbox',
  'disable-setuid-sandbox',
  'disable-site-isolation-trials',
  'disable-web-security',
  'inspect',
  'inspect-brk',
  'js-flags',
  'no-sandbox',
  'remote-allow-origins',
  'remote-debugging',
  'remote-debugging-pipe',
] as const;

export function resolveElectronRuntimeDeploymentProfile(input: {
  electronDevelopmentBuild: boolean;
  macOSLocalDevelopmentBuild: boolean;
}): 'local-development' | 'production' {
  return input.electronDevelopmentBuild || input.macOSLocalDevelopmentBuild
    ? 'local-development'
    : 'production';
}

export function assertMacOSElectronSecurity(input: {
  platform: NodeJS.Platform;
  commandLine: ElectronCommandLine;
  electronDevelopmentBuild?: boolean;
  localDevelopmentBuild?: boolean;
}): void {
  if (input.platform !== 'darwin') return;
  const forbidden = FORBIDDEN_CHROMIUM_SWITCHES.find((name) => input.commandLine.hasSwitch(name));
  if (forbidden) {
    fail(`forbidden macOS Electron switch: ${forbidden}`);
  }

  const hasRemoteDebuggingAddress = input.commandLine.hasSwitch('remote-debugging-address');
  const hasRemoteDebuggingPort = input.commandLine.hasSwitch('remote-debugging-port');
  if (!hasRemoteDebuggingAddress && !hasRemoteDebuggingPort) return;

  const localDevelopmentBuild = input.localDevelopmentBuild ?? MACOS_LOCAL_DEVELOPMENT_BUILD;
  const electronDevelopmentBuild = input.electronDevelopmentBuild ?? ELECTRON_DEVELOPMENT_BUILD;
  const address = input.commandLine.getSwitchValue('remote-debugging-address');
  const rawPort = input.commandLine.getSwitchValue('remote-debugging-port');
  const port = Number(rawPort);
  if (!(localDevelopmentBuild || electronDevelopmentBuild)
    || !hasRemoteDebuggingAddress
    || !hasRemoteDebuggingPort
    || address !== '127.0.0.1'
    || !Number.isInteger(port)
    || port < 1024
    || port > 65535
    || String(port) !== rawPort) {
    fail('forbidden macOS Electron remote debugging configuration');
  }
}

function fail(message: string): never {
  throw Object.assign(new Error(message), {
    reasonCode: 'macos-electron-unsafe-chromium-switch',
  });
}
