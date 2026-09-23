import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PROFILE_CHILDREN = ['user-data', 'session-data', 'tmp'] as const;
const TEMPORARY_ENVIRONMENT_KEYS = ['TEMP', 'TMP', 'TMPDIR', 'SystemTemp'] as const;
const BOOTSTRAP_DIRECTORY = 'nimi-home-bootstrap';
const APP_HOSTS_DIRECTORY = 'app-hosts';
const HASHED_NAME = /^[0-9a-f]{32}$/u;

export type DesktopHomeHostProfile = {
  readonly mode: 'root' | 'bootstrap';
  readonly profileRoot: string;
  readonly userData: string;
  readonly sessionData: string;
  readonly temp: string;
  /** Host-user scope the root-mode profile belongs to; null in bootstrap mode. */
  readonly scopeRoot: string | null;
  readonly bootstrapReason: string | null;
};

/**
 * Original temporary environment of this Home process, captured before the
 * profile preflight redirects it. The bootstrap slot always derives from the
 * original temporary directory, and a relaunch restores these exact values so
 * the next instance does not nest inside this instance's profile.
 */
export type DesktopTemporaryEnvironment = {
  readonly originalTempDirectory: string;
  readonly apply: (temp: string) => void;
  readonly restore: () => void;
};

export function captureDesktopTemporaryEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  tmpdir: () => string = os.tmpdir,
): DesktopTemporaryEnvironment {
  const original = new Map(TEMPORARY_ENVIRONMENT_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(environment, key) ? environment[key] : undefined,
  ] as const));
  const originalTempDirectory = path.resolve(tmpdir());
  return Object.freeze({
    originalTempDirectory,
    apply(temp: string): void {
      for (const key of ['TEMP', 'TMP', 'TMPDIR'] as const) environment[key] = temp;
    },
    restore(): void {
      for (const [key, value] of original) {
        if (value === undefined) delete environment[key];
        else environment[key] = value;
      }
    },
  });
}

/** Fixed bootstrap slot for one single-instance scope; never a data root. */
export function desktopHomeBootstrapSlot(originalTempDirectory: string, singleInstanceScope: string): string {
  const key = createHash('sha256')
    .update('nimi.home-bootstrap-slot.v1\0', 'utf8')
    .update(singleInstanceScope, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return path.join(originalTempDirectory, BOOTSTRAP_DIRECTORY, key);
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-017a
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-006d
/**
 * Resolves Nimi Home's own Host technical profile before any Electron session
 * exists. With a usable bound root it is `<scope>/desktop` under the selected
 * data root; otherwise it is the explicit single-instance bootstrap slot, used
 * only for setup and repair. Must run after the fixed single-instance lock is
 * owned, so no predecessor can still be using the slot.
 */
export async function prepareDesktopHomeHostProfile(input: {
  readonly readScopeRoot: () => Promise<string>;
  readonly singleInstanceScope: string;
  readonly temporaryEnvironment: DesktopTemporaryEnvironment;
  readonly platform?: NodeJS.Platform;
  readonly reportCleanupFailure?: (error: unknown) => void;
}): Promise<DesktopHomeHostProfile> {
  const platform = input.platform ?? process.platform;
  const slot = desktopHomeBootstrapSlot(input.temporaryEnvironment.originalTempDirectory, input.singleInstanceScope);
  let bootstrapReason: string;
  try {
    const rootProfile = await prepareDesktopHomeRootProfile(await input.readScopeRoot(), platform);
    // A previous bootstrap run leaves only this known slot behind; clearing
    // it is best effort once the selected root is usable.
    await removeKnownSlot(slot).catch((error: unknown) => input.reportCleanupFailure?.(error));
    return rootProfile;
  } catch (error) {
    bootstrapReason = reasonCode(error);
  }
  await removeKnownSlot(slot);
  const profileRoot = path.join(slot, 'profile');
  await mkdir(path.dirname(slot), { recursive: true });
  for (const directory of [slot, profileRoot, ...PROFILE_CHILDREN.map((child) => path.join(profileRoot, child))]) {
    await ensureRealDirectory(directory, 'private', platform);
  }
  for (const child of PROFILE_CHILDREN) await writeProbe(path.join(profileRoot, child));
  return profile('bootstrap', profileRoot, null, bootstrapReason);
}

/**
 * Prepares `<scope>/desktop` under the selected root as the current GUI user
 * and proves it writable. Throws without side effects elsewhere when unusable.
 */
export async function prepareDesktopHomeRootProfile(
  scopeRootValue: unknown,
  platform: NodeJS.Platform = process.platform,
): Promise<DesktopHomeHostProfile> {
  const scopeRoot = validatedScopeRoot(scopeRootValue);
  const profileRoot = path.join(scopeRoot, 'desktop');
  await preparePrivateProfile(scopeRoot, profileRoot, platform);
  return profile('root', profileRoot, scopeRoot, null);
}

/** Best-effort removal of this instance's known bootstrap slot at exit. */
export async function releaseDesktopHomeBootstrapSlot(profileRoot: string): Promise<void> {
  const slot = path.dirname(profileRoot);
  if (path.basename(path.dirname(slot)) !== BOOTSTRAP_DIRECTORY) return;
  await removeKnownSlot(slot).catch(() => undefined);
}

function profile(
  mode: DesktopHomeHostProfile['mode'],
  profileRoot: string,
  scopeRoot: string | null,
  bootstrapReason: string | null,
): DesktopHomeHostProfile {
  return Object.freeze({
    mode,
    profileRoot,
    userData: path.join(profileRoot, 'user-data'),
    sessionData: path.join(profileRoot, 'session-data'),
    temp: path.join(profileRoot, 'tmp'),
    scopeRoot,
    bootstrapReason,
  });
}

function validatedScopeRoot(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\0')
    || !path.isAbsolute(value) || path.normalize(value) !== value
    || !HASHED_NAME.test(path.basename(value))
    || path.basename(path.dirname(value)) !== APP_HOSTS_DIRECTORY) {
    throw withReason('desktop-home-profile-scope-invalid');
  }
  return value;
}

async function preparePrivateProfile(scopeRoot: string, profileRoot: string, platform: NodeJS.Platform): Promise<void> {
  const appHosts = path.dirname(scopeRoot);
  const dataRoot = path.dirname(appHosts);
  const dataRootStat = await stat(dataRoot).catch(() => null);
  if (!dataRootStat?.isDirectory()) throw withReason('desktop-home-profile-data-root-unavailable');
  await ensureRealDirectory(appHosts, { sharedMode: dataRootStat.mode & 0o7777 }, platform);
  for (const directory of [scopeRoot, profileRoot, ...PROFILE_CHILDREN.map((child) => path.join(profileRoot, child))]) {
    await ensureRealDirectory(directory, 'private', platform);
  }
  for (const child of PROFILE_CHILDREN) await writeProbe(path.join(profileRoot, child));
}

async function ensureRealDirectory(
  directory: string,
  policy: 'private' | { readonly sharedMode: number },
  platform: NodeJS.Platform,
): Promise<void> {
  const existing = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw withReason('desktop-home-profile-inspect-failed', error);
  });
  if (!existing) {
    const mode = platform === 'win32' ? undefined : policy === 'private' ? 0o700 : policy.sharedMode;
    const created = await mkdir(directory, mode === undefined ? {} : { mode }).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw withReason('desktop-home-profile-create-failed', error);
      return false;
    });
    // mkdir applies the process umask; a shared directory this process created
    // keeps the root's exact mode so other OS users can create their scope.
    if (created && mode !== undefined && policy !== 'private') {
      await chmod(directory, mode).catch((error: NodeJS.ErrnoException) => {
        throw withReason('desktop-home-profile-create-failed', error);
      });
    }
    return ensureRealDirectory(directory, policy, platform);
  }
  if (existing.isSymbolicLink()) throw withReason('desktop-home-profile-link-rejected');
  if (!existing.isDirectory()) throw withReason('desktop-home-profile-not-directory');
}

async function writeProbe(directory: string): Promise<void> {
  const probe = path.join(directory, `.nimi-home-profile-probe-${process.pid}-${Date.now()}`);
  try {
    const handle = await open(probe, 'wx');
    try { await handle.writeFile('nimi-home-profile'); } finally { await handle.close(); }
    await rm(probe);
  } catch (error) {
    await rm(probe, { force: true }).catch(() => undefined);
    throw withReason('desktop-home-profile-not-writable', error);
  }
}

async function removeKnownSlot(slot: string): Promise<void> {
  const existing = await lstat(slot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw withReason('desktop-home-bootstrap-slot-inspect-failed', error);
  });
  if (!existing) return;
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw withReason('desktop-home-bootstrap-slot-invalid');
  }
  await rm(slot, { recursive: true, force: false }).catch((error: unknown) => {
    throw withReason('desktop-home-bootstrap-slot-busy', error);
  });
}

function withReason(reason: string, cause?: unknown): Error & { readonly reasonCode: string } {
  return Object.assign(new Error(reason, cause === undefined ? undefined : { cause }), { reasonCode: reason });
}

function reasonCode(error: unknown): string {
  if (error && typeof error === 'object') {
    for (const key of ['reasonCode', 'message'] as const) {
      const value = (error as Readonly<Record<string, unknown>>)[key];
      if (typeof value === 'string' && /^[a-z][a-z0-9-]{0,127}$/u.test(value)) return value;
    }
  }
  return 'desktop-home-profile-scope-unavailable';
}

export function shouldRetryDesktopHomeProfile(input: {
  readonly mode: 'root' | 'bootstrap';
  readonly alreadyRelaunched: boolean;
  readonly startupSettled: boolean;
  readonly trigger: 'startup' | 'activation' | 'command' | 'user-action';
}): boolean {
  return input.mode === 'root' || !input.alreadyRelaunched || input.trigger === 'user-action'
    || (input.trigger === 'activation' && input.startupSettled);
}
