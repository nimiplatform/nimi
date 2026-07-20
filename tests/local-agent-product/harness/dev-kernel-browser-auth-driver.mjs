import fs from 'node:fs';
import path from 'node:path';

import {
  removeBrowserProfile,
  runRealChromeLogin,
  safeBrowserAudit,
} from './dev-kernel-browser-auth-chrome.mjs';
import { repoRoot } from './registry.mjs';

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
const DEFAULT_CREDENTIALS_FILE = path.join(
  repoRoot,
  '.nimi',
  'local',
  'dev-kernel-browser-auth-credentials.json',
);
const STANDARD_PASSWORD_LOGIN_RATE_LIMIT = 5;
const STANDARD_PASSWORD_LOGIN_RATE_WINDOW_MS = 15 * 60 * 1_000;
const DEV_KERNEL_REALM_POLICY = Object.freeze({
  schemaVersion: 'nimi.realm-test-policy/v1',
  profile: 'dev_kernel_checkpoint',
  passwordLoginLimit: 24,
  passwordLoginWindowMs: 15 * 60 * 1_000,
  loopbackOnly: true,
  freshPasswordVerificationRequired: true,
});
const CREDENTIAL_ENV_NAMES = Object.freeze([
  'NIMI_DEV_KERNEL_BROWSER_AUTH_CREDENTIALS_FILE',
  'NIMI_DEV_KERNEL_PRIMARY_EMAIL',
  'NIMI_DEV_KERNEL_PRIMARY_PASSWORD',
  'NIMI_DEV_KERNEL_SECONDARY_EMAIL',
  'NIMI_DEV_KERNEL_SECONDARY_PASSWORD',
]);
export function createDevKernelBrowserAuthDriver({
  trialRoot,
  captureFile,
  diagnosticsRoot,
  requiredCredentialRoles,
  env = process.env,
  browserFlow = runRealChromeLogin,
  captureTimeoutMs = 30_000,
  accountProjectionTimeoutMs = 15_000,
  realmPolicy,
} = {}) {
  const canonicalTrialRoot = requireDirectory(trialRoot, 'trial root');
  const resolvedCaptureFile = requireTrialDescendant(canonicalTrialRoot, captureFile, 'capture file');
  const resolvedDiagnosticsRoot = requireTrialDescendant(
    canonicalTrialRoot,
    diagnosticsRoot,
    'browser diagnostics root',
  );
  const roles = requireRoles(requiredCredentialRoles);
  const credentials = loadDevKernelBrowserAuthCredentials({ roles, env });
  const childEnvironment = Object.freeze(browserAuthSafeChildEnvironment(env));
  const ratePolicy = realmPolicy === undefined
    ? Object.freeze({ profile: 'standard', passwordLoginLimit: STANDARD_PASSWORD_LOGIN_RATE_LIMIT, passwordLoginWindowMs: STANDARD_PASSWORD_LOGIN_RATE_WINDOW_MS })
    : requireDevKernelRealmPolicyProjection(realmPolicy);
  const credentialAttemptTimes = [];
  let sequence = 0;

  return Object.freeze({
    captureFile: resolvedCaptureFile,
    audit: () => Object.freeze({
      profile: ratePolicy.profile,
      passwordLoginLimit: ratePolicy.passwordLoginLimit,
      passwordLoginWindowMs: ratePolicy.passwordLoginWindowMs,
      attemptCount: credentialAttemptTimes.length,
      remainingAttempts: Math.max(0, ratePolicy.passwordLoginLimit - credentialAttemptTimes.length),
    }),
    async authenticate({ credentialRole, expectedAccountId, trigger, readAccountProjection, label }) {
      if (!roles.includes(credentialRole) || typeof trigger !== 'function' || typeof readAccountProjection !== 'function') {
        throw new Error('dev-kernel-browser-auth-request-invalid');
      }
      const expected = boundedText(expectedAccountId, 256, 'expected account id');
      const attemptLabel = requireLabel(label);
      const attempt = ++sequence;
      const privateProfileRoot = requireTrialDescendant(
        canonicalTrialRoot,
        path.join(canonicalTrialRoot, 'browser-auth-private', `${String(attempt).padStart(2, '0')}-${credentialRole}`),
        'browser profile root',
      );
      const failureRoot = requireTrialDescendant(
        canonicalTrialRoot,
        path.join(resolvedDiagnosticsRoot, `${String(attempt).padStart(2, '0')}-${attemptLabel}`),
        'browser failure root',
      );
      fs.rmSync(resolvedCaptureFile, { force: true });
      fs.rmSync(privateProfileRoot, { recursive: true, force: true });
      try {
        admitPasswordLoginAttempt(credentialAttemptTimes, ratePolicy);
        await trigger();
        const authorization = await waitForCapturedAuthorizationUrl(resolvedCaptureFile, {
          timeoutMs: captureTimeoutMs,
        });
        const browserAudit = await browserFlow({
          authorization,
          credential: credentials[credentialRole],
          profileRoot: privateProfileRoot,
          failureRoot,
          label: attemptLabel,
          childEnvironment,
        });
        const account = await waitForExpectedAccountProjection(
          readAccountProjection,
          expected,
          accountProjectionTimeoutMs,
        );
        return Object.freeze({
          accountId: account.accountProjection.accountId,
          callbackCompleted: browserAudit.callbackCompleted === true,
          browser: safeBrowserAudit(browserAudit),
        });
      } finally {
        fs.rmSync(resolvedCaptureFile, { force: true });
        await removeBrowserProfile(privateProfileRoot);
      }
    },
  });
}

function admitPasswordLoginAttempt(attemptTimes, ratePolicy) {
  const now = Date.now();
  while (attemptTimes.length > 0 && now - attemptTimes[0] >= ratePolicy.passwordLoginWindowMs) {
    attemptTimes.shift();
  }
  if (attemptTimes.length >= ratePolicy.passwordLoginLimit) {
    throw new Error('dev-kernel-browser-auth-rate-window-exhausted');
  }
  attemptTimes.push(now);
}

export async function probeDevKernelRealmPolicy(realmOrigin = AUTHORIZATION_ORIGIN) {
  const origin = new URL(realmOrigin);
  if (origin.origin !== AUTHORIZATION_ORIGIN || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('dev-kernel-browser-auth-realm-policy-origin-invalid');
  }
  const response = await fetch(`${origin.origin}/api/auth/dev-kernel-policy`, {
    method: 'GET',
    redirect: 'error',
  }).catch(() => null);
  if (!response || response.status !== 200) {
    throw new Error('dev-kernel-browser-auth-realm-policy-unavailable');
  }
  return requireDevKernelRealmPolicyProjection(await response.json().catch(() => null));
}

export function requireDevKernelRealmPolicyProjection(value) {
  if (!plainObject(value)
    || Object.keys(value).sort().join('|') !== [
      'freshPasswordVerificationRequired',
      'loopbackOnly',
      'passwordLoginLimit',
      'passwordLoginWindowMs',
      'profile',
      'schemaVersion',
    ].sort().join('|')
    || value.schemaVersion !== DEV_KERNEL_REALM_POLICY.schemaVersion
    || value.profile !== DEV_KERNEL_REALM_POLICY.profile
    || value.passwordLoginLimit !== DEV_KERNEL_REALM_POLICY.passwordLoginLimit
    || value.passwordLoginWindowMs !== DEV_KERNEL_REALM_POLICY.passwordLoginWindowMs
    || value.loopbackOnly !== true
    || value.freshPasswordVerificationRequired !== true) {
    throw new Error('dev-kernel-browser-auth-realm-policy-invalid');
  }
  return DEV_KERNEL_REALM_POLICY;
}

export function browserAuthSafeChildEnvironment(env = process.env) {
  const safe = { ...env };
  for (const name of CREDENTIAL_ENV_NAMES) delete safe[name];
  return safe;
}

export function loadDevKernelBrowserAuthCredentials({ roles, env = process.env } = {}) {
  const requiredRoles = requireRoles(roles);
  const filePath = requireLocalCredentialsPath(
    normalized(env.NIMI_DEV_KERNEL_BROWSER_AUTH_CREDENTIALS_FILE) || DEFAULT_CREDENTIALS_FILE,
  );
  const document = readCredentialDocument(filePath);
  const result = {};
  for (const role of requiredRoles) {
    const upper = role.toUpperCase();
    const emailFromEnv = normalized(env[`NIMI_DEV_KERNEL_${upper}_EMAIL`]);
    const passwordFromEnv = stringValue(env[`NIMI_DEV_KERNEL_${upper}_PASSWORD`]);
    if (Boolean(emailFromEnv) !== Boolean(passwordFromEnv)) {
      throw new Error(`dev-kernel-browser-auth-credentials-incomplete:${role}`);
    }
    const fromFile = document?.[role];
    const email = emailFromEnv || normalized(fromFile?.email);
    const password = passwordFromEnv || stringValue(fromFile?.password);
    if (!isEmail(email) || !password || password.length > 1_024) {
      throw new Error(`dev-kernel-browser-auth-credentials-missing:${role}`);
    }
    result[role] = Object.freeze({ email, password });
  }
  return Object.freeze(result);
}

export async function waitForCapturedAuthorizationUrl(captureFile, {
  timeoutMs = 30_000,
  intervalMs = 50,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value = '';
    try {
      value = fs.readFileSync(captureFile, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (value.endsWith('\n')) {
      const lines = value.split(/\r?\n/u).filter(Boolean);
      if (lines.length !== 1) {
        throw new Error('dev-kernel-browser-auth-capture-duplicate');
      }
      const authorization = requireCapturedAuthorizationUrl(lines[0]);
      fs.writeFileSync(captureFile, '', { mode: 0o600 });
      return authorization;
    }
    if (Date.now() >= deadline) {
      throw new Error('dev-kernel-browser-auth-capture-missing');
    }
    await delay(intervalMs);
  }
}

export function requireCapturedAuthorizationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('dev-kernel-browser-auth-authorization-url-invalid');
  }
  if (url.origin !== AUTHORIZATION_ORIGIN
    || url.protocol !== 'http:'
    || url.hostname !== 'localhost'
    || url.port !== '3002'
    || url.pathname !== AUTHORIZATION_PATH
    || url.username
    || url.password
    || url.hash) {
    throw new Error('dev-kernel-browser-auth-authorization-url-forbidden');
  }
  requireAuthorizationQuery(url);
  const callback = requireLoopbackCallback(url.searchParams.get('redirect_uri'));
  return Object.freeze({ url: url.toString(), callback });
}

async function waitForExpectedAccountProjection(readAccountProjection, expectedAccountId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readAccountProjection().catch(() => null);
    if (latest?.state === 'authenticated') {
      if (latest.accountProjection?.accountId !== expectedAccountId) {
        throw new Error('dev-kernel-browser-auth-account-mismatch');
      }
      return latest;
    }
    await delay(100);
  }
  throw new Error('dev-kernel-browser-auth-account-projection-missing');
}

function readCredentialDocument(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('dev-kernel-browser-auth-credentials-file-invalid');
  }
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('dev-kernel-browser-auth-credentials-file-invalid');
  }
  if (!plainObject(document)
    || document.schemaVersion !== 'nimi.dev-kernel-browser-auth-credentials/v1'
    || Object.keys(document).some((key) => !['schemaVersion', 'primary', 'secondary'].includes(key))) {
    throw new Error('dev-kernel-browser-auth-credentials-file-invalid');
  }
  for (const role of ['primary', 'secondary']) {
    if (document[role] === undefined) continue;
    if (!plainObject(document[role])
      || Object.keys(document[role]).sort().join(',') !== 'email,password') {
      throw new Error('dev-kernel-browser-auth-credentials-file-invalid');
    }
  }
  return document;
}

function requireLocalCredentialsPath(value) {
  const resolved = path.resolve(value);
  const relativeToRepo = path.relative(repoRoot, resolved);
  const insideRepo = relativeToRepo === ''
    || (!relativeToRepo.startsWith(`..${path.sep}`) && relativeToRepo !== '..' && !path.isAbsolute(relativeToRepo));
  const localRoot = path.join(repoRoot, '.nimi', 'local');
  if (insideRepo) {
    const relativeToLocal = path.relative(localRoot, resolved);
    if (!relativeToLocal
      || relativeToLocal === '..'
      || relativeToLocal.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToLocal)) {
      throw new Error('dev-kernel-browser-auth-credentials-file-not-local');
    }
  }
  return resolved;
}

function requireAuthorizationQuery(url) {
  const allowedKeys = new Set([...REQUIRED_AUTHORIZATION_QUERY_KEYS, ...OPTIONAL_AUTHORIZATION_QUERY_KEYS]);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('dev-kernel-browser-auth-authorization-url-forbidden');
    }
  }
  if (REQUIRED_AUTHORIZATION_QUERY_KEYS.some((key) => url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get('response_type') !== 'code'
    || url.searchParams.get('client_id') !== AUTHORIZATION_CLIENT_ID
    || url.searchParams.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43,128}$/u.test(url.searchParams.get('code_challenge') || '')
    || !/^[A-Za-z0-9_-]{16,256}$/u.test(url.searchParams.get('state') || '')) {
    throw new Error('dev-kernel-browser-auth-authorization-url-forbidden');
  }
  const presence = ['prompt', 'presence_purpose', 'presence_nonce']
    .map((key) => url.searchParams.get(key) || '');
  if (presence.some(Boolean)
    && (presence[0] !== 'login'
      || !/^[A-Za-z0-9._:/-]{1,256}$/u.test(presence[1] || '')
      || !/^[A-Za-z0-9_-]{16,128}$/u.test(presence[2] || ''))) {
    throw new Error('dev-kernel-browser-auth-authorization-url-forbidden');
  }
  const audience = url.searchParams.get('audience');
  if (audience !== null && !/^[A-Za-z0-9._:/-]{1,256}$/u.test(audience)) {
    throw new Error('dev-kernel-browser-auth-authorization-url-forbidden');
  }
}

function requireLoopbackCallback(value) {
  let callback;
  try { callback = new URL(value || ''); } catch {
    throw new Error('dev-kernel-browser-auth-callback-invalid');
  }
  if (callback.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(callback.hostname)
    || !Number.isInteger(Number(callback.port))
    || Number(callback.port) < 1_024
    || Number(callback.port) > 49_151
    || callback.pathname !== '/oauth/callback'
    || callback.username
    || callback.password
    || callback.hash
    || callback.search) {
    throw new Error('dev-kernel-browser-auth-callback-invalid');
  }
  return Object.freeze({ origin: callback.origin, path: callback.pathname });
}

function requireDirectory(value, label) {
  const resolved = path.resolve(boundedText(value, 32_768, label));
  if (!path.isAbsolute(resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`dev-kernel-browser-auth-${label.replaceAll(' ', '-')}-invalid`);
  }
  return fs.realpathSync.native(resolved);
}

function requireTrialDescendant(trialRoot, candidate, label) {
  if (!path.isAbsolute(String(candidate || ''))) {
    throw new Error(`dev-kernel-browser-auth-${label.replaceAll(' ', '-')}-invalid`);
  }
  const resolved = canonicalPathThroughExistingAncestor(candidate);
  const relative = path.relative(trialRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`dev-kernel-browser-auth-${label.replaceAll(' ', '-')}-forbidden`);
  }
  return resolved;
}

function canonicalPathThroughExistingAncestor(value) {
  let existing = path.resolve(value);
  const missingSegments = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  const canonicalExisting = fs.existsSync(existing)
    ? fs.realpathSync.native(existing)
    : existing;
  return path.join(canonicalExisting, ...missingSegments);
}

function requireRoles(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('dev-kernel-browser-auth-roles-invalid');
  const roles = [...new Set(value)];
  if (roles.some((role) => !['primary', 'secondary'].includes(role))) {
    throw new Error('dev-kernel-browser-auth-roles-invalid');
  }
  return roles;
}

function requireLabel(value) {
  const label = normalized(value);
  if (!/^[a-z0-9-]{1,80}$/u.test(label)) throw new Error('dev-kernel-browser-auth-label-invalid');
  return label;
}

function boundedText(value, maxLength, label) {
  const text = normalized(value);
  if (!text || text.length > maxLength) throw new Error(`dev-kernel-browser-auth-${label.replaceAll(' ', '-')}-invalid`);
  return text;
}

function isEmail(value) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalized(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
