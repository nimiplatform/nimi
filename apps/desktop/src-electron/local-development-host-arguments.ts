import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

declare const __NIMI_ELECTRON_ACCEPTANCE_BUILD__: boolean;
declare const __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: boolean;
const ACCEPTANCE_BUILD = typeof __NIMI_ELECTRON_ACCEPTANCE_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_ACCEPTANCE_BUILD__;
const MACOS_LOCAL_DEVELOPMENT_BUILD = typeof __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__;

export function resolveLocalDevelopmentObservationArguments(
  env: NodeJS.ProcessEnv = process.env,
  expectedAppId = '',
  acceptanceBuild = ACCEPTANCE_BUILD,
): string[] {
  const explicitMacOSAcceptance = MACOS_LOCAL_DEVELOPMENT_BUILD
    && String(env.NIMI_MACOS_DEV_ACCEPTANCE || '').trim() === '1';
  if ((!acceptanceBuild && !explicitMacOSAcceptance)
    || String(env.NIMI_DEV_KERNEL_CHECKPOINT || '').trim() !== '1') return [];

  const genericAppId = String(env.NIMI_LOCAL_APP_ACCEPTANCE_APP_ID || '').trim();
  const genericPortValue = String(env.NIMI_LOCAL_APP_ACCEPTANCE_CDP_PORT || '').trim();
  if (genericAppId || genericPortValue) {
    if (!acceptanceBuild
      || !genericAppId
      || !genericPortValue
      || !expectedAppId
      || !/^nimi\.[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u.test(genericAppId)) {
      throw new Error('local-development-observation-config-invalid');
    }
    if (genericAppId !== expectedAppId) return [];
    const genericPort = Number(genericPortValue);
    if (!Number.isInteger(genericPort) || genericPort < 1024 || genericPort > 65535) {
      throw new Error('local-development-observation-config-invalid');
    }
    return [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${genericPort}`,
    ];
  }

  const port = Number(env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT || 0);
  const root = String(env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT || '').trim();
  const agent = String(env.NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID || '').trim();
  const acceptanceRoot = String(env.NIMI_MACOS_DEV_ACCEPTANCE_ROOT || '').trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !path.isAbsolute(root)
    || (explicitMacOSAcceptance && (!path.isAbsolute(acceptanceRoot)
      || path.resolve(root) !== path.join(path.resolve(acceptanceRoot), 'zhiyu-user-data')))
    || (agent && !/^local-agent:runtime-[0-9a-f]{32}$/u.test(agent))) {
    throw new Error('local-development-observation-config-invalid');
  }
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(root)}`,
    ...(explicitMacOSAcceptance ? [`--nimi-acceptance-root=${path.resolve(acceptanceRoot)}`] : []),
    ...(agent ? [`--nimi-dev-agent-id=${agent}`] : []),
  ];
}

export function resolveLocalDevelopmentElectronHostArguments(input: {
  readonly mainEntry: string;
  readonly rendererOrigin: string;
  readonly observationArguments: readonly string[];
  readonly userDataArguments: readonly string[];
  readonly platform?: NodeJS.Platform;
}): string[] {
  const platform = input.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('local-development-platform-unsupported');
  }
  const applicationArgument = platform === 'darwin'
    ? `--nimi-local-app-main=${input.mainEntry}`
    : input.mainEntry;
  return [
    ...input.observationArguments,
    ...input.userDataArguments,
    applicationArgument,
    `--nimi-dev-renderer-url=${input.rendererOrigin}`,
  ];
}

export async function resolveLocalAppUserDataArguments(input: {
  readonly homeDirectory: string;
  readonly authorizationId: string;
  readonly platform?: NodeJS.Platform;
  readonly uid?: number;
}): Promise<string[]> {
  const platform = input.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') failPartition();
  const authorizationId = requiredPartitionText(input.authorizationId);
  const uid = platform === 'darwin' ? input.uid ?? process.getuid?.() : undefined;
  if (platform === 'darwin' && (!Number.isSafeInteger(uid) || Number(uid) < 0)) failPartition();
  const requestedHome = path.resolve(requiredPartitionText(input.homeDirectory));
  const canonicalHome = await realpath(requestedHome).catch(failPartition);
  if (!sameCanonicalPath(canonicalHome, requestedHome, platform)) failPartition();

  const leaf = createHash('sha256')
    .update('nimi-local-app-user-data-v1\0', 'utf8')
    .update(authorizationId, 'utf8')
    .digest('hex');
  const segments = platform === 'darwin'
    ? ['Library', 'Application Support', 'Nimi', 'Local App Hosts', 'v1', leaf]
    : ['AppData', 'Local', 'Nimi', 'Local App Hosts', 'v1', leaf];
  let current = canonicalHome;
  await requirePrivateUserDataDirectory(current, platform, uid);
  for (const segment of segments) {
    current = path.join(current, segment);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await requirePrivateUserDataDirectory(current, platform, uid);
  }
  if (!current.startsWith(`${canonicalHome}${path.sep}`) || current.includes(authorizationId)) {
    failPartition();
  }
  return [`--user-data-dir=${current}`];
}

async function requirePrivateUserDataDirectory(
  candidate: string,
  platform: 'darwin' | 'win32',
  uid: number | undefined,
): Promise<void> {
  const metadata = await lstat(candidate).catch(failPartition);
  const canonical = await realpath(candidate).catch(failPartition);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || !sameCanonicalPath(canonical, candidate, platform)
    || (platform === 'darwin' && (metadata.uid !== uid || (metadata.mode & 0o077) !== 0))) {
    failPartition();
  }
}

function sameCanonicalPath(left: string, right: string, platform: 'darwin' | 'win32'): boolean {
  return platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function requiredPartitionText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
    || value.trim() !== value || value.includes('\0')) {
    failPartition();
  }
  return value;
}

function failPartition(): never {
  throw new Error('local-development-user-data-partition-untrusted');
}
