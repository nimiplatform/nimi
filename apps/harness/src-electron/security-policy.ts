// Shared PC Body security policy enforcing Plan Packet v2.1 Gates 2, 3, 4, and 5:
//   - Strict path normalization rejecting @, file://, \\?\, NTFS ADS, Bidi, trailing dots/spaces (pre-trim)
//   - Shared isSensitivePath() across read, write, edit, delete, grep, glob, and workspace-files
//   - Case-folded control-plane file wall (at any depth, normalized against workspaceRoot) forcing allow_once
//   - Free Shell minimal environment allowlist + recursive .env* secret canary extraction & streaming redaction
// @nimi-authority: rule.nimi.harness.security-gates.workspace-execution-env
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const BIDI_CONTROL_RE = /[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/u;

const SENSITIVE_KEY_NAME_RE = /(?:KEY|SECRET|TOKEN|PASS|PWD|AUTH|CRED|PRIVATE|DSN|COOKIE|JWT)/i;
const BENIGN_ENV_LITERALS = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'null', 'none', 'undefined',
  'development', 'production', 'staging', 'test', 'testing', 'local',
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'utf8', 'utf-8', 'c.utf-8',
  'info', 'debug', 'warn', 'warning', 'error', 'trace', 'silent',
]);

const CANARY_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.next', 'target', 'build']);
const MAX_CANARY_WALK_DEPTH = 4;
const MAX_CANARY_WALK_DIRS = 500;
const MAX_CANARY_ENV_FILE_BYTES = 512 * 1024;

export function sanitizeBidi(text: string): string {
  return text.replace(BIDI_CONTROL_RE, '');
}

/**
 * Truncates UTF-8 text strictly by byte budget (never splitting a multi-byte
 * scalar value), optionally preserving the tail for shell/log diagnostics.
 */
export function truncateUtf8Bytes(text: string, maxBytes: number, keepTail = false): string {
  if (maxBytes <= 0 || !text) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  if (!keepTail) {
    let end = maxBytes;
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
    return buf.subarray(0, end).toString('utf8');
  }
  let start = buf.byteLength - maxBytes;
  while (start < buf.byteLength && (buf[start] & 0xc0) === 0x80) start += 1;
  return buf.subarray(start).toString('utf8');
}

/**
 * Validates raw workspace path input BEFORE trimming so Windows trailing-space
 * and trailing-dot canonicalization bypasses (e.g. ".env ", "package.json ")
 * are rejected unconditionally.
 */
export function validateRawWorkspacePathInput(rawPath: string): void {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || !rawPath.trim()) {
    throw new Error('Workspace path must be a non-empty string.');
  }
  if (CONTROL_CHAR_RE.test(rawPath) || BIDI_CONTROL_RE.test(rawPath)) {
    throw new Error('Workspace path contains forbidden control or Bidi characters.');
  }
  // Reject leading/trailing whitespace BEFORE trimming (NTFS strips trailing spaces!).
  if (rawPath !== rawPath.trim()) {
    throw new Error('Workspace path must not contain leading or trailing whitespace.');
  }
  if (rawPath.startsWith('@')) {
    throw new Error('Workspace paths starting with "@" are forbidden.');
  }
  if (/^file:/i.test(rawPath)) {
    throw new Error('file:// URI paths are forbidden.');
  }
  if (
    rawPath.startsWith('\\\\?\\')
    || rawPath.startsWith('\\\\.\\')
    || rawPath.startsWith('\\??\\')
    || rawPath.startsWith('//?/')
    || rawPath.startsWith('\\\\')
  ) {
    throw new Error('Win32 extended, UNC, or device path prefixes are forbidden.');
  }
  // Reject NTFS Alternate Data Streams (any ':' other than a single Windows drive letter prefix like C:\).
  const withoutDrive = /^[A-Za-z]:[\\/]/.test(rawPath) ? rawPath.slice(2) : rawPath;
  if (withoutDrive.includes(':')) {
    throw new Error('Colons and NTFS Alternate Data Streams are forbidden in workspace paths.');
  }
  // Reject trailing dots or spaces in any raw path segment (Windows canonicalization bypass).
  const segments = withoutDrive.split(/[\\/]+/);
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') continue;
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      throw new Error(`Invalid trailing dot or space in path segment "${segment}".`);
    }
    const stem = segment.split('.')[0]?.toUpperCase() ?? '';
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
      throw new Error(`Windows reserved device name "${segment}" is forbidden.`);
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
  if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error(`Path "${rawPath}" escapes the active workspace root.`);
  }
  const relativePosix = rel ? rel.split(sep).join('/') : '';
  return { absolutePath: candidate, relativePosix };
}

function normalizePosixForPolicy(rawPath: string, workspaceRoot?: string): string {
  const cleaned = sanitizeBidi(rawPath).trim();
  if (!cleaned) return '';
  let target = cleaned;
  if (workspaceRoot && isAbsolute(cleaned)) {
    const rel = relative(resolve(workspaceRoot), resolve(cleaned));
    if (rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) {
      target = rel;
    }
  }
  // Collapse redundant ./ and normalize backslashes; reject/preserve segments faithfully.
  const parts = target
    .replace(/\\/g, '/')
    .split('/')
    .map(p => p.trim())
    .filter(p => p.length > 0 && p !== '.');
  return parts.join('/').toLowerCase();
}

/**
 * Gate 3: Shared sensitive-file hard-deny matcher used uniformly by read, write,
 * edit, delete, glob, grep, and workspace-files. Blocks .env*, private keys, SSH/cloud credentials.
 */
export function isSensitivePath(rawPath: string, workspaceRoot?: string): boolean {
  const norm = normalizePosixForPolicy(rawPath, workspaceRoot);
  if (!norm) return false;
  const parts = norm.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? '';

  // Deny any path inside .ssh, .aws, .gnupg, .kube at ANY depth.
  if (parts.some(p => p === '.ssh' || p === '.aws' || p === '.gnupg' || p === '.kube')) {
    return true;
  }
  // Deny .env, .envrc, and .env* (except explicit .env.example / .env.sample / .env.template).
  // Strip trailing dots/spaces defensively in case caller skipped validateRawWorkspacePathInput.
  const canonicalName = name.replace(/[. ]+$/g, '');
  if (
    canonicalName === '.env'
    || canonicalName === '.envrc'
    || (canonicalName.startsWith('.env') && !['.env.example', '.env.sample', '.env.template'].includes(canonicalName))
  ) {
    return true;
  }
  if (/\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/i.test(canonicalName)) {
    return true;
  }
  if (
    canonicalName === '.npmrc'
    || canonicalName === '.pypirc'
    || canonicalName === '.netrc'
    || canonicalName === '_netrc'
    || canonicalName === 'credentials.json'
    || canonicalName === 'service-account.json'
    || canonicalName.startsWith('id_rsa')
    || canonicalName.startsWith('id_ed25519')
    || canonicalName.startsWith('id_ecdsa')
    || /^secrets?\.(?:json|ya?ml|toml|txt|ini)$/i.test(canonicalName)
  ) {
    return true;
  }
  return false;
}

/**
 * Gate 3: Windows case-folded control-plane file wall (checked at ANY depth and
 * normalized against workspaceRoot). Mutations targeting these files ALWAYS
 * require explicit allow_once approval, even under workspace-edit mode.
 */
export function isControlPlanePath(rawPath: string, workspaceRoot?: string): boolean {
  const norm = normalizePosixForPolicy(rawPath, workspaceRoot);
  if (!norm) return false;
  const parts = norm.split('/').filter(Boolean);
  const name = (parts[parts.length - 1] ?? '').replace(/[. ]+$/g, '');

  // Check control-plane directories at ANY depth (catches ./.git/config AND sub/.git/hooks/*).
  if (parts.some(p => p === '.git' || p === '.github' || p === '.husky' || p === '.vscode')) {
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
    ? ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'WINDIR']
    : ['PATH', 'HOME', 'USER', 'TMPDIR', 'SHELL', 'TERM'];
  const out: Record<string, string> = {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
  };
  const sourceByUpper = new Map<string, string>();
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (typeof v === 'string' && v.length > 0 && !sourceByUpper.has(k.toUpperCase())) {
      sourceByUpper.set(k.toUpperCase(), v);
    }
  }
  const seenUpper = new Set<string>(Object.keys(out).map(k => k.toUpperCase()));
  for (const key of allowlist) {
    const upper = key.toUpperCase();
    if (seenUpper.has(upper)) continue;
    const val = sourceByUpper.get(upper);
    if (typeof val === 'string' && val.length > 0) {
      out[key] = val;
      seenUpper.add(upper);
    }
  }
  return out;
}

const CALLER_ENV_OVERRIDE_ALLOWLIST = new Set([
  'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'TZ', 'LANG', 'LC_ALL', 'GIT_TERMINAL_PROMPT',
]);

export function filterSafeCallerEnvOverrides(overrides?: Record<string, string>): Record<string, string> {
  if (!overrides) return {};
  const safe: Record<string, string> = {};
  const seenUpper = new Set<string>();
  for (const [k, v] of Object.entries(overrides)) {
    const upper = k.toUpperCase();
    if (typeof v === 'string' && CALLER_ENV_OVERRIDE_ALLOWLIST.has(upper) && !seenUpper.has(upper)) {
      safe[upper] = v;
      seenUpper.add(upper);
    }
  }
  return safe;
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

function parseEnvCanaryValue(rawVal: string): string {
  const trimmed = rawVal.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const closeIdx = trimmed.indexOf(quote, 1);
    return closeIdx > 0 ? trimmed.slice(1, closeIdx) : trimmed.slice(1);
  }
  // Strip inline unquoted `# comment` suffix before checking value/entropy.
  const commentIdx = trimmed.search(/\s+#/);
  return (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim();
}

function shouldTrackEnvCanary(key: string, val: string): boolean {
  const lower = val.toLowerCase();
  if (BENIGN_ENV_LITERALS.has(lower)) return false;
  // Explicitly sensitive key names (e.g. API_KEY, PIN_SECRET, AUTH_TOKEN) are tracked
  // even when short (4-7 chars) or numeric, before generic entropy/numeric heuristics run.
  if (SENSITIVE_KEY_NAME_RE.test(key)) {
    return val.length >= 4;
  }
  if (val.length < 8) return false;
  if (/^\d+$/.test(val)) return false;
  if (val.length >= 16 && shannonEntropy(val) >= 3.2) return true;
  return false;
}

/**
 * Gate 4 Layer 3: Walks workspace root and bounded subdirectories strictly in
 * memory right before executing an approved Free Shell command, extracting
 * high-risk/high-entropy `.env*` / `.envrc` secret values + Base64/URL-encoded variants.
 * The caller MUST wipe the returned array on process exit.
 */
export async function extractWorkspaceEnvCanarySecrets(workspaceRoot: string): Promise<string[]> {
  const secrets = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: resolve(workspaceRoot), depth: 0 }];
  let visitedDirs = 0;

  while (queue.length > 0 && visitedDirs < MAX_CANARY_WALK_DIRS) {
    const current = queue.shift()!;
    visitedDirs += 1;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth < MAX_CANARY_WALK_DEPTH && !CANARY_IGNORED_DIRS.has(entry.name.toLowerCase())) {
          queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (
        lower !== '.env'
        && lower !== '.envrc'
        && !(lower.startsWith('.env') && !['.env.example', '.env.sample', '.env.template'].includes(lower))
      ) {
        continue;
      }
      try {
        const filePath = join(current.dir, entry.name);
        const info = await stat(filePath);
        if (!info.isFile() || info.size <= 0 || info.size > MAX_CANARY_ENV_FILE_BYTES) continue;
        const content = await readFile(filePath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).replace(/^export\s+/i, '').trim();
          const val = parseEnvCanaryValue(trimmed.slice(eq + 1));
          if (!shouldTrackEnvCanary(key, val)) continue;
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

/**
 * Sliding-window streaming canary redactor preventing secret leaks split across
 * adjacent stdout/stderr chunks.
 */
export class StreamingCanaryRedactor {
  private buffer = '';
  private readonly overlap: number;

  constructor(private readonly secrets: readonly string[]) {
    this.overlap = secrets.reduce((max, s) => Math.max(max, s.length), 0);
  }

  push(chunk: string): string {
    if (!chunk) return '';
    if (this.secrets.length === 0) return chunk;
    const combined = redactCanarySecrets(this.buffer + chunk, this.secrets);
    const keep = Math.max(0, this.overlap - 1);
    if (combined.length <= keep) {
      this.buffer = combined;
      return '';
    }
    const emitLen = combined.length - keep;
    const out = combined.slice(0, emitLen);
    this.buffer = combined.slice(emitLen);
    return out;
  }

  flush(): string {
    const out = redactCanarySecrets(this.buffer, this.secrets);
    this.buffer = '';
    return out;
  }
}
