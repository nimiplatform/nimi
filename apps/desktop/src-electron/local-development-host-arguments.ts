// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034c
// The native carrier prepends the Runtime-derived `--user-data-dir` from the
// launch's Host technical profile; Desktop never chooses a profile path.
export function resolveLocalDevelopmentElectronHostLaunch(input: {
  readonly mainEntry: string;
  readonly rendererOrigin: string;
  readonly cdpPort?: number;
  readonly platform?: NodeJS.Platform;
  readonly sourceLocalDevelopment?: boolean;
}): { readonly arguments: string[] } {
  const platform = input.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('local-development-platform-unsupported');
  }
  const applicationArgument = platform === 'darwin' && input.sourceLocalDevelopment !== true
    ? `--nimi-local-app-main=${input.mainEntry}`
    : input.mainEntry;
  const cdpArguments = input.cdpPort === undefined
    ? []
    : localDevelopmentCdpArguments(input.cdpPort);
  return {
    arguments: [
      ...cdpArguments,
      applicationArgument,
      `--nimi-dev-renderer-url=${input.rendererOrigin}`,
    ],
  };
}

function localDevelopmentCdpArguments(value: number): string[] {
  if (!Number.isSafeInteger(value) || (value !== 0 && (value < 1024 || value > 65535))) {
    throw new Error('local-development-cdp-port-invalid');
  }
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${value}`,
  ];
}
