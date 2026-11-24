// Shared PC Body security policy enforcing Plan Packet v2.1 Gates 2, 3, 4, and 5:
//   - Strict path normalization rejecting @, file://, \\?\, NTFS ADS, Bidi, trailing dots/spaces
//   - Shared isSensitivePath() across read, write, edit, grep, and glob
//   - Case-folded control-plane file wall forcing allow_once
//   - Free Shell minimal environment allowlist + .env* secret canary extraction & redaction
// @nimi-authority: rule.nimi.harness.security-gates.workspace-execution-env
import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const BIDI_CONTROL_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/u;

const SENSITIVE_KEY_NAME_RE = /(?:KEY|SECRET|TOKEN|PASS|PWD|AUTH|CRED|PRIVATE|DSN|COOKIE|JWT)/i;
const BENIGN_ENV_LITERALS = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'none', 'undefined',
  'development', 'production', 'staging', 'test', 'testing', 'local',
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'utf8', 'utf-8', 'c.utf-8',
  'info', 'debug', 'warn', 'warning', 'error', 'trace', 'silent',
]);

export function sanitizeBidi(text: string): string {
  return text.replace(BIDI_CONTROL_RE, '');
}

/**
 * Validates and resolves a candidate path strictly inside workspaceRoot,
 * eliminating path-utils / isInsideWorkspace parsing divergence on Windows & POSIX.
 */
export function validateRawWorkspacePathInput(rawPath: string): void {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('Workspace path must be a non-empty string.');
  }
  const trimmed = rawPath.trim();
  if (CONTROL_CHAR_RE.test(rawPath) || BIDI_CONTROL_RE.test(rawPath)) {
    throw new Error('Workspace path contains forbidden control or Bidi characters.');
  }
  if (trimmed.startsWith('@')) {
    throw new Error('Workspace paths starting with "@" are forbidden.');
  }
  if (/^file:\/\//i.test(trimmed)) {
    throw new Error('file:// URI paths are forbidden.');
  }
  if (trimmed.startsWith('\\\\?\\') || trimmed.startsWith('\\\\.\\') || trimmed.startsWith('//?/')) {
    throw new Error('Win32 extended/device path prefixes are forbidden.');
  }
  // Reject NTFS Alternate Data Streams (any ':' other than a single Windows drive letter prefix like C:\).
  const withoutDrive = /^[A-Za-z]:[\\/]/.test(trimmed) ? trimmed.slice(2) : trimmed;
  if (withoutDrive.includes(':')) {
    throw new Error('Colons and NTFS Alternate Data Streams are forbidden in workspace paths.');
  }
  // Reject trailing dots or spaces in any path segment (Windows canonicalization bypass).
  const segments = withoutDrive.split(/[\\/]+/);
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') continue;
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      throw new Error(`Invalid trailing dot or space in path segment "${segment}".`);
    }
  }
}

export function resolveSafeWorkspacePath(workspaceRoot: string, rawPath: string): {
  absolutePath: string;
  relativePosix: string;
} {
  validateRawWorkspacePathInput(rawPath);
  const root = resolve(workspaceRoot);
  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${rawPath}" escapes the active workspace root.`);
  }
  const relativePosix = rel.split(sep).join('/');
  return { absolutePath: candidate, relativePosix };
}

/**
 * Gate 3: Shared sensitive-file hard-deny matcher used uniformly by read, write,
 * edit, delete, glob, and grep. Blocks .env*, private keys, SSH/cloud credentials.
 */
export function isSensitivePath(relativePosixPath: string): boolean {
  const norm = relativePosixPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!norm) return false;
  const parts = norm.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? '';

  // Deny any path inside .ssh, .aws, .gnupg, .kube
  if (parts.some(p => p === '.ssh' || p === '.aws' || p === '.gnupg' || p === '.kube')) {
    return true;
  }
  // Deny .env and .env.* (except explicit .env.example / .env.sample / .env.template)
  if (name === '.env' || (name.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(name))) {
    return true;
  }
  // Deny key material, certificates with private keys, token files
  if (/\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/i.test(name)) {
    return true;
  }
  if (
    name === '.npmrc'
    || name === '.pypirc'
    || name === '.netrc'
    || name === '_netrc'
    || name === 'credentials.json'
    || name === 'service-account.json'
    || name.startsWith('id_rsa')
    || name.startsWith('id_ed25519')
    || name.startsWith('id_ecdsa')
    || /^secrets?\.(?:json|ya?ml|toml|txt|ini)$/i.test(name)
  ) {
    return true;
  }
  return false;
}

/**
 * Gate 3: Windows case-folded control-plane file wall. Mutations targeting these
 * files ALWAYS require explicit allow_once approval, even under workspace-edit mode.
 */
export function isControlPlanePath(relativePosixPath: string): boolean {
  const norm = relativePosixPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!norm) return false;
  const parts = norm.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? '';

  if (parts[0] === '.git' || parts[0] === '.github' || parts[0] === '.husky' || parts[0] === '.vscode') {
    return true;
  }
  if (
    name === 'package.json'
    || name === 'package-lock.json'
    || name === 'pnpm-lock.yaml'
    || name === 'yarn.lock'
    || name === 'makefile'
    || name === 'dockerfile'
    || name === 'conftest.py'
    || name === 'build.rs'
    || name === 'cargo.toml'
    || name === 'go.mod'
    || name === 'pyproject.toml'
  ) {
    return true;
  }
  if (
    /^(?:vitest|jest|vite|webpack|rollup|babel|eslint|prettier|playwright)\.config\./i.test(name)
    || /^tsconfig(?:\..+)?\.json$/i.test(name)
  ) {
    return true;
  }
  if (/\.(?:ps1|psm1|psd1|sh|bash|zsh|bat|cmd|cjs|mjs)$/i.test(name)) {
    return true;
  }
  return false;
}

/**
 * Gate 3: Safe Shell-less git invocation arguments disabling untrusted repo hooks/pagers.
 */
export function safeGitArgs(args: readonly string[]): string[] {
  return [
    '-c', 'core.fsmonitor=false',
    '-c', 'diff.external=',
    '-c', 'core.pager=cat',
    '-c', 'core.hooksPath=',
    ...args,
  ];
}

/**
 * Gate 4: Minimal environment allowlist for Free Shell execution (inheritEnv: false).
 */
export function buildMinimalShellEnv(sourceEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowlist = process.platform === 'win32'
    ? ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'WINDIR']
    : ['PATH', 'HOME', 'USER', 'TMPDIR', 'SHELL', 'TERM'];
  const out: Record<string, string> = {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
  };
  for (const key of allowlist) {
    const val = sourceEnv[key];
    if (typeof val === 'string' && val.length > 0) {
      out[key === 'Path' ? 'PATH' : key] = val;
    }
  }
  return out;
}

function shannonEntropy(value: string): number {
  if (!value.length) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function shouldTrackEnvCanary(key: string, rawVal: string): boolean {
  const val = rawVal.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (val.length < 8) return false;
  const lower = val.toLowerCase();
  if (BENIGN_ENV_LITERALS.has(lower)) return false;
  if (/^\d+$/.test(val)) return false;
  if (SENSITIVE_KEY_NAME_RE.test(key)) return true;
  if (val.length >= 16 && shannonEntropy(val) >= 3.2) return true;
  return false;
}

/**
 * Gate 4 Layer 3: Reads workspace `.env*` files strictly in memory right before
 * executing an approved Free Shell command and extracts high-risk/high-entropy
 * secret values + Base64/URL-encoded variants for stdout/stderr canary redaction.
 * The caller MUST wipe the returned array on process exit.
 */
export async function extractWorkspaceEnvCanarySecrets(workspaceRoot: string): Promise<string[]> {
  const secrets = new Set<string>();
  let entries;
  try {
    entries = await readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower !== '.env' && !(lower.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(lower))) {
      continue;
    }
    try {
      const content = await readFile(join(workspaceRoot, entry.name), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).replace(/^export\s+/i, '').trim();
        const rawVal = trimmed.slice(eq + 1).trim();
        if (!shouldTrackEnvCanary(key, rawVal)) continue;
        const val = rawVal.replace(/^(['"])(.*)\1$/, '$2');
        secrets.add(val);
        const b64 = Buffer.from(val, 'utf8').toString('base64');
        if (b64.length >= 12) secrets.add(b64);
        const urlEnc = encodeURIComponent(val);
        if (urlEnc !== val && urlEnc.length >= 12) secrets.add(urlEnc);
      }
    } catch {
      // Ignore unreadable env files; never fail open on redaction.
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length);
}

export function redactCanarySecrets(text: string, canarySecrets: readonly string[]): string {
  if (!text || canarySecrets.length === 0) return text;
  let result = text;
  for (const secret of canarySecrets) {
    if (secret && result.includes(secret)) {
      result = result.split(secret).join('[REDACTED_WORKSPACE_SECRET]');
    }
  }
  return result;
}
