import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

declare const __NIMI_ELECTRON_ACCEPTANCE_BUILD__: boolean;
const ACCEPTANCE_BUILD = typeof __NIMI_ELECTRON_ACCEPTANCE_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_ACCEPTANCE_BUILD__;

export function resolveLocalDevelopmentObservationArguments(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!ACCEPTANCE_BUILD || String(env.NIMI_DEV_KERNEL_CHECKPOINT || '').trim() !== '1') return [];
  const port = Number(env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT || 0);
  const root = String(env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT || '').trim();
  const agent = String(env.NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID || '').trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !path.isAbsolute(root)
    || (agent && !/^local-agent:runtime-[0-9a-f]{32}$/u.test(agent))) {
    throw new Error('local-development-observation-config-invalid');
  }
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(root)}`,
    ...(agent ? [`--nimi-dev-agent-id=${agent}`] : []),
  ];
}

export async function resolveMacOSLocalAppUserDataArguments(input: {
  readonly homeDirectory: string;
  readonly authorizationId: string;
  readonly platform?: NodeJS.Platform;
  readonly uid?: number;
}): Promise<string[]> {
  if ((input.platform ?? process.platform) !== 'darwin') return [];
  const authorizationId = requiredPartitionText(input.authorizationId);
  const uid = input.uid ?? process.getuid?.();
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) failPartition();
  const requestedHome = path.resolve(requiredPartitionText(input.homeDirectory));
  const canonicalHome = await realpath(requestedHome).catch(failPartition);
  if (canonicalHome !== requestedHome) failPartition();

  const leaf = createHash('sha256')
    .update('nimi-local-app-user-data-v1\0', 'utf8')
    .update(authorizationId, 'utf8')
    .digest('hex');
  const segments = ['Library', 'Application Support', 'Nimi', 'Local App Hosts', 'v1', leaf];
  let current = canonicalHome;
  await requirePrivateUserDataDirectory(current, Number(uid));
  for (const segment of segments) {
    current = path.join(current, segment);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await requirePrivateUserDataDirectory(current, Number(uid));
  }
  if (!current.startsWith(`${canonicalHome}${path.sep}`) || current.includes(authorizationId)) {
    failPartition();
  }
  return [`--user-data-dir=${current}`];
}

async function requirePrivateUserDataDirectory(candidate: string, uid: number): Promise<void> {
  const metadata = await lstat(candidate).catch(failPartition);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid
    || (metadata.mode & 0o077) !== 0) {
    failPartition();
  }
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
