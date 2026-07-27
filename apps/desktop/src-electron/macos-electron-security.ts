type ElectronCommandLine = {
  hasSwitch(name: string): boolean;
};

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
  'remote-debugging-pipe',
] as const;

export function assertMacOSElectronSecurity(input: {
  platform: NodeJS.Platform;
  commandLine: ElectronCommandLine;
}): void {
  if (input.platform !== 'darwin') return;
  const forbidden = FORBIDDEN_CHROMIUM_SWITCHES.find((name) => input.commandLine.hasSwitch(name));
  if (forbidden) {
    throw Object.assign(new Error(`forbidden macOS Electron switch: ${forbidden}`), {
      reasonCode: 'macos-electron-unsafe-chromium-switch',
    });
  }
}
