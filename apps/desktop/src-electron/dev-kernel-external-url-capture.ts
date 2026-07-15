import path from 'node:path';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';

const CHECKPOINT_FLAG = 'NIMI_DEV_KERNEL_CHECKPOINT';
const CAPTURE_FILE_ENV = 'NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE';
const TRIAL_ROOT_ENV = 'NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT';
const AUTHORIZATION_ORIGIN = 'http://localhost:3002';
const AUTHORIZATION_PATH = '/api/auth/oauth/authorize';
const AUTHORIZATION_CLIENT_ID = 'nimi-desktop';
const REQUIRED_AUTHORIZATION_QUERY_KEYS = Object.freeze([
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
]);
const OPTIONAL_AUTHORIZATION_QUERY_KEYS = new Set([
  'audience',
  'prompt',
  'presence_purpose',
  'presence_nonce',
]);

export type DevKernelExternalUrlCapture = {
  readonly capture: (url: string) => Promise<boolean>;
};

export function createDevKernelExternalUrlCapture(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DevKernelExternalUrlCapture {
  const configuredPath = normalized(env[CAPTURE_FILE_ENV]);
  if (!configuredPath) {
    return { capture: async () => false };
  }
  if (normalized(env[CHECKPOINT_FLAG]) !== '1') {
    throw new Error('desktop-external-url-capture-checkpoint-required');
  }
  const trialRoot = normalized(env[TRIAL_ROOT_ENV]);
  if (!path.isAbsolute(trialRoot) || !path.isAbsolute(configuredPath)) {
    throw new Error('desktop-external-url-capture-path-invalid');
  }
  const capturePath = path.resolve(configuredPath);
  const resolvedTrialRoot = path.resolve(trialRoot);
  requireStrictDescendant(resolvedTrialRoot, capturePath);

  let serial = Promise.resolve();
  const capturedUrls = new Set<string>();

  return {
    capture(url: string): Promise<boolean> {
      const operation = serial.then(async () => {
        const authorizationUrl = requireAuthorizationUrl(url);
        if (capturedUrls.has(authorizationUrl)) {
          throw new Error('desktop-external-url-capture-duplicate');
        }
        await requireCanonicalCapturePath(resolvedTrialRoot, capturePath);
        await writeFile(capturePath, `${authorizationUrl}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        }).catch((error: NodeJS.ErrnoException) => {
          if (error?.code === 'EEXIST') {
            throw new Error('desktop-external-url-capture-file-not-fresh');
          }
          throw error;
        });
        capturedUrls.add(authorizationUrl);
        return true;
      });
      serial = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}

export function requireDevKernelAuthorizationUrl(url: string): string {
  return requireAuthorizationUrl(url);
}

async function requireCanonicalCapturePath(trialRoot: string, capturePath: string): Promise<void> {
  const canonicalTrialRoot = await realpath(trialRoot).catch(() => {
    throw new Error('desktop-external-url-capture-trial-root-invalid');
  });
  const parent = path.dirname(capturePath);
  await mkdir(parent, { recursive: true });
  const canonicalParent = await realpath(parent).catch(() => {
    throw new Error('desktop-external-url-capture-path-invalid');
  });
  requireWithinRoot(canonicalTrialRoot, canonicalParent);
  const existing = await lstat(capturePath).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new Error('desktop-external-url-capture-path-invalid');
  }
}

function requireAuthorizationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('desktop-external-url-capture-url-invalid');
  }
  if (url.origin !== AUTHORIZATION_ORIGIN
    || url.protocol !== 'http:'
    || url.hostname !== 'localhost'
    || url.port !== '3002'
    || url.pathname !== AUTHORIZATION_PATH
    || url.username
    || url.password
    || url.hash) {
    throw new Error('desktop-external-url-capture-url-forbidden');
  }
  requireAuthorizationQuery(url);
  return url.toString();
}

function requireAuthorizationQuery(url: URL): void {
  const allowedKeys = new Set([...REQUIRED_AUTHORIZATION_QUERY_KEYS, ...OPTIONAL_AUTHORIZATION_QUERY_KEYS]);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('desktop-external-url-capture-url-forbidden');
    }
  }
  if (REQUIRED_AUTHORIZATION_QUERY_KEYS.some((key) => url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get('response_type') !== 'code'
    || url.searchParams.get('client_id') !== AUTHORIZATION_CLIENT_ID
    || url.searchParams.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43,128}$/u.test(url.searchParams.get('code_challenge') || '')
    || !/^[A-Za-z0-9_-]{16,256}$/u.test(url.searchParams.get('state') || '')) {
    throw new Error('desktop-external-url-capture-url-forbidden');
  }
  let callback: URL;
  try {
    callback = new URL(url.searchParams.get('redirect_uri') || '');
  } catch {
    throw new Error('desktop-external-url-capture-url-forbidden');
  }
  if (callback.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(callback.hostname)
    || Number(callback.port) < 1_024
    || Number(callback.port) > 49_151
    || callback.pathname !== '/oauth/callback'
    || callback.username
    || callback.password
    || callback.search
    || callback.hash) {
    throw new Error('desktop-external-url-capture-url-forbidden');
  }
  const presence = ['prompt', 'presence_purpose', 'presence_nonce']
    .map((key) => url.searchParams.get(key) || '');
  if (presence.some(Boolean)
    && (presence[0] !== 'login'
      || !/^[A-Za-z0-9._:/-]{1,256}$/u.test(presence[1] || '')
      || !/^[A-Za-z0-9_-]{16,128}$/u.test(presence[2] || ''))) {
    throw new Error('desktop-external-url-capture-url-forbidden');
  }
  const audience = url.searchParams.get('audience');
  if (audience !== null && !/^[A-Za-z0-9._:/-]{1,256}$/u.test(audience)) {
    throw new Error('desktop-external-url-capture-url-forbidden');
  }
}

function requireStrictDescendant(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || isOutsideRoot(relative)) {
    throw new Error('desktop-external-url-capture-path-forbidden');
  }
}

function requireWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (isOutsideRoot(relative)) {
    throw new Error('desktop-external-url-capture-path-forbidden');
  }
}

function isOutsideRoot(relative: string): boolean {
  return relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative);
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
