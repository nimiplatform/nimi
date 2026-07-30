import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export function resolveLocalDevelopmentElectronHostArguments(input: {
  readonly mainEntry: string;
  readonly rendererOrigin: string;
  readonly userDataArguments: readonly string[];
  readonly cdpPort?: number;
  readonly platform?: NodeJS.Platform;
}): string[] {
  const platform = input.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error('local-development-platform-unsupported');
  }
  const applicationArgument = platform === 'darwin'
    ? `--nimi-local-app-main=${input.mainEntry}`
    : input.mainEntry;
  const cdpArguments = input.cdpPort === undefined
    ? []
    : localDevelopmentCdpArguments(input.cdpPort);
  return [
    ...input.userDataArguments,
    ...cdpArguments,
    applicationArgument,
    `--nimi-dev-renderer-url=${input.rendererOrigin}`,
  ];
}

function localDevelopmentCdpArguments(value: number): string[] {
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) {
    throw new Error('local-development-cdp-port-invalid');
  }
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${value}`,
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
  await requireCanonicalUserHome(current, platform, uid);
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

async function requireCanonicalUserHome(
  candidate: string,
  platform: 'darwin' | 'win32',
  uid: number | undefined,
): Promise<void> {
  const metadata = await lstat(candidate).catch(failPartition);
  const canonical = await realpath(candidate).catch(failPartition);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || !sameCanonicalPath(canonical, candidate, platform)
    || (platform === 'darwin' && (metadata.uid !== uid || (metadata.mode & 0o022) !== 0))) {
    failPartition();
  }
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
