import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

type ElectronCommandLine = {
  getSwitchValue(name: string): string;
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

export function assertMacOSDesktopAcceptanceProfile(input: {
  platform: NodeJS.Platform;
  macOSLocalDevelopmentBuild: boolean;
  commandLine: ElectronCommandLine;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  uid?: number;
}): void {
  if (input.platform !== 'darwin') return;

  if (FORBIDDEN_CHROMIUM_SWITCHES.some((name) => input.commandLine.hasSwitch(name))) {
    failAcceptanceProfile();
  }

  const observationPort = exactText(input.commandLine.getSwitchValue('remote-debugging-port'));
  const observationAddress = exactText(input.commandLine.getSwitchValue('remote-debugging-address'));
  const userDataDirectory = exactText(input.commandLine.getSwitchValue('user-data-dir'));
  const acceptanceFlag = exactText(input.env.NIMI_MACOS_DEV_ACCEPTANCE);
  const acceptanceRoot = exactText(input.env.NIMI_MACOS_DEV_ACCEPTANCE_ROOT);
  const acceptanceUserData = exactText(input.env.NIMI_MACOS_DEV_ACCEPTANCE_DESKTOP_USER_DATA_ROOT);
  const captureFile = exactText(input.env.NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE);
  const trialRoot = exactText(input.env.NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT);
  const checkpoint = exactText(input.env.NIMI_DEV_KERNEL_CHECKPOINT);
  const zhiyuPort = exactText(input.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT);
  const zhiyuUserData = exactText(input.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT);
  const profileValues = [
    acceptanceFlag,
    acceptanceRoot,
    acceptanceUserData,
    captureFile,
    trialRoot,
    checkpoint,
    zhiyuPort,
    zhiyuUserData,
  ];

  if (acceptanceFlag !== '1') {
    if (observationPort || observationAddress || profileValues.some(Boolean)) {
      failAcceptanceProfile();
    }
    return;
  }

  const uid = input.uid ?? process.getuid?.();
  const port = exactPort(observationPort);
  const companionPort = exactPort(zhiyuPort);
  if (!input.macOSLocalDevelopmentBuild
    || observationAddress !== '127.0.0.1'
    || port === companionPort
    || checkpoint !== '1'
    || !Number.isSafeInteger(uid)
    || Number(uid) < 0) {
    failAcceptanceProfile();
  }

  const canonicalRoot = requirePrivateCanonicalDirectory(acceptanceRoot, Number(uid));
  const expectedDesktopUserData = path.join(canonicalRoot, 'desktop-user-data');
  const expectedZhiyuUserData = path.join(canonicalRoot, 'zhiyu-user-data');
  if (acceptanceUserData !== expectedDesktopUserData
    || userDataDirectory !== expectedDesktopUserData
    || zhiyuUserData !== expectedZhiyuUserData
    || trialRoot !== canonicalRoot
    || captureFile !== path.join(canonicalRoot, 'oauth-authorization-url.txt')) {
    failAcceptanceProfile();
  }
  requirePrivateCanonicalDirectory(expectedDesktopUserData, Number(uid));
  requirePrivateCanonicalDirectory(expectedZhiyuUserData, Number(uid));
  if (existsSync(captureFile)) failAcceptanceProfile();

  const expectedDebugArguments = new Set([
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
  ]);
  const debugArguments = input.argv.filter((value) => value.startsWith('--remote-debugging'));
  if (debugArguments.length !== expectedDebugArguments.size
    || debugArguments.some((value) => !expectedDebugArguments.has(value))) {
    failAcceptanceProfile();
  }
  const userDataArguments = input.argv.filter((value) => value.startsWith('--user-data-dir'));
  if (userDataArguments.length !== 1 || userDataArguments[0] !== `--user-data-dir=${expectedDesktopUserData}`) {
    failAcceptanceProfile();
  }
}

function requirePrivateCanonicalDirectory(candidate: string, uid: number): string {
  if (!candidate || !path.isAbsolute(candidate) || path.normalize(candidate) !== candidate) {
    failAcceptanceProfile();
  }
  let canonical: string;
  try {
    canonical = realpathSync(candidate);
    const metadata = lstatSync(candidate);
    if (canonical !== candidate
      || !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || metadata.uid !== uid
      || (metadata.mode & 0o077) !== 0) {
      failAcceptanceProfile();
    }
  } catch {
    failAcceptanceProfile();
  }
  return canonical!;
}

function exactPort(value: string): number {
  if (!/^[1-9][0-9]{3,4}$/u.test(value)) failAcceptanceProfile();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || String(port) !== value) {
    failAcceptanceProfile();
  }
  return port;
}

function exactText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function failAcceptanceProfile(): never {
  throw Object.assign(new Error('desktop-dev-acceptance-profile-invalid'), {
    reasonCode: 'desktop-dev-acceptance-profile-invalid',
    actionHint: 'use_test_acceptance_macos_dev_chain',
  });
}
