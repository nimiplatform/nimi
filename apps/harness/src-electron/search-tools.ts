import { lookup as dnsLookup } from 'node:dns/promises';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { bool, int, obj, opt, str } from '@earendil-works/pi-schema';
import { textPreview } from './text-preview.js';
import { isSensitivePath, validateRawWorkspacePathInput } from './security-policy.js';

const MAX_WALK_ENTRIES = 20_000;
const MAX_GREP_FILES = 5_000;
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GREP_OUTPUT_BYTES = 48 * 1024;
const MAX_LINE_EXCERPT = 300;
const DEFAULT_FETCH_BYTES = 128 * 1024;
const MAX_FETCH_BYTES = 512 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_TIMEOUT_MS = 30_000;

function isIgnoredDirectory(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist' || name.startsWith('dist-');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert a glob pattern (*, **, ?, {a,b}, [abc]) into a bounded RegExp over POSIX relative paths. */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  let regex = '^';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        regex += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i += 1;
    } else if (ch === '{') {
      const close = normalized.indexOf('}', i + 1);
      if (close > i + 1 && !normalized.slice(i + 1, close).includes('{')) {
        const parts = normalized.slice(i + 1, close).split(',').map(escapeRegex);
        regex += `(?:${parts.join('|')})`;
        i = close + 1;
      } else {
        regex += '\\{';
        i += 1;
      }
    } else if (ch === '[') {
      const close = normalized.indexOf(']', i + 1);
      if (close > i + 1) {
        const body = normalized.slice(i + 1, close).replace(/^!/, '^');
        regex += `[${body}]`;
        i = close + 1;
      } else {
        regex += '\\[';
        i += 1;
      }
    } else {
      regex += escapeRegex(ch);
      i += 1;
    }
  }
  regex += '$';
  return new RegExp(regex);
}

async function resolveWorkspaceTarget(workspace: string, subPath?: string): Promise<{ root: string; target: string; isFile: boolean }> {
  const root = await realpath(workspace);
  if (!subPath || subPath === '.' || subPath === './') {
    return { root, target: root, isFile: false };
  }
  validateRawWorkspacePathInput(subPath);
  if (isAbsolute(subPath) || subPath.includes('\\') || /[\x00-\x1f]/u.test(subPath)) {
    throw new Error('Choose a relative path inside the session workspace.');
  }
  const candidate = resolve(root, subPath);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootPrefix)) {
    throw new Error('Search path must stay inside the session workspace.');
  }
  const relPosix = toPosixRelative(root, candidate);
  if (isSensitivePath(relPosix, root)) {
    throw new Error(`Access to sensitive path "${relPosix}" is blocked by Harness security policy.`);
  }
  // Walk every intermediate segment with lstat to reject symlinks anywhere in the path.
  let probe = root;
  for (const seg of relPosix.split('/').filter(Boolean)) {
    probe = join(probe, seg);
    const segInfo = await lstat(probe);
    if (segInfo.isSymbolicLink()) {
      throw new Error('Search path must not traverse symbolic links.');
    }
  }
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) {
    throw new Error('Search path must not traverse symbolic links.');
  }
  if (info.isFile() && info.nlink > 1) {
    throw new Error('Hardlinked files are blocked by Harness security policy.');
  }
  const real = await realpath(candidate);
  if (real !== root && !real.startsWith(rootPrefix)) {
    throw new Error('Search path must stay inside the session workspace.');
  }
  const realRelPosix = toPosixRelative(root, real);
  if (isSensitivePath(realRelPosix, root)) {
    throw new Error(`Access to sensitive path "${realRelPosix}" is blocked by Harness security policy.`);
  }
  return { root, target: real, isFile: info.isFile() };
}

function toPosixRelative(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

function expandIpv6Groups(raw: string): number[] | null {
  const clean = raw.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!clean.includes(':')) return null;
  let normalized = clean;
  const v4Tail = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (v4Tail) {
    const octets = [Number(v4Tail[1]), Number(v4Tail[2]), Number(v4Tail[3]), Number(v4Tail[4])];
    if (octets.some(o => o > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = normalized.slice(0, v4Tail.index + 1) + `${hi}:${lo}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - (left.length + right.length) : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const parts = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (parts.length !== 8) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    nums.push(parseInt(part, 16));
  }
  return nums;
}

function isDisallowedIP(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!lower) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4) {
    const [a, b, c] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3])];
    if (a > 255 || b > 255 || c > 255 || Number(ipv4[4]) > 255) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 CGNAT
    if (a === 169 && b === 254) return true; // Link-local / cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }
  const g = expandIpv6Groups(lower);
  if (g) {
    const isAllZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    // Unspecified (::), Loopback (::1), IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96)
    if (isAllZeroPrefix && g[5] === 0) {
      if (g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
      const v4 = `${(g[6] >> 8) & 255}.${g[6] & 255}.${(g[7] >> 8) & 255}.${g[7] & 255}`;
      return isDisallowedIP(v4);
    }
    if (isAllZeroPrefix && g[5] === 0xffff) {
      const v4 = `${(g[6] >> 8) & 255}.${g[6] & 255}.${(g[7] >> 8) & 255}.${g[7] & 255}`;
      return isDisallowedIP(v4);
    }
    // IPv4-translated (::ffff:0:0:0/96, RFC 2765)
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) {
      const v4 = `${(g[6] >> 8) & 255}.${g[6] & 255}.${(g[7] >> 8) & 255}.${g[7] & 255}`;
      return isDisallowedIP(v4);
    }
    // NAT64 local-use (64:ff9b:1::/48, RFC 8215) is unconditionally private/local.
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001) {
      return true;
    }
    // NAT64 well-known (64:ff9b::/96, RFC 6052) embeds IPv4 in the final 32 bits.
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      const v4 = `${(g[6] >> 8) & 255}.${g[6] & 255}.${(g[7] >> 8) & 255}.${g[7] & 255}`;
      return isDisallowedIP(v4);
    }
    // 6to4 (2002::/16) embeds IPv4 in groups 1 & 2
    if (g[0] === 0x2002) {
      const v4 = `${(g[1] >> 8) & 255}.${g[1] & 255}.${(g[2] >> 8) & 255}.${g[2] & 255}`;
      return isDisallowedIP(v4);
    }
    // Teredo (2001:0000::/32)
    if (g[0] === 0x2001 && g[1] === 0x0000) return true;
    // Link-local (fe80::/10), ULA (fc00::/7), Multicast (ff00::/8)
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    return false;
  }
  return true;
}

function isDisallowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!lower) return true;
  if (
    lower === 'localhost'
    || lower.endsWith('.local')
    || lower.endsWith('.localhost')
    || lower.endsWith('.internal')
  ) {
    return true;
  }
  if (isIP(lower)) {
    return isDisallowedIP(lower);
  }
  // Reject non-dotted integer / hex / octal IPv4 obfuscations (e.g. 2130706433, 0x7f000001).
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(lower)) {
    return true;
  }
  return false;
}

type PinnedTarget = { address: string; family: 4 | 6 };
type DnsLookupFn = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

async function resolvePinnedFetchTarget(
  parsed: URL,
  allowLoopback: boolean,
  dnsLookupFn?: DnsLookupFn | null,
): Promise<PinnedTarget> {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }
  const bareHost = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!allowLoopback && isDisallowedHost(parsed.hostname)) {
    throw new Error('Fetching local or private network addresses is blocked.');
  }
  const ipVer = isIP(bareHost);
  if (ipVer === 4 || ipVer === 6) {
    if (!allowLoopback && isDisallowedIP(bareHost)) {
      throw new Error('Fetching local or private network addresses is blocked.');
    }
    return { address: bareHost, family: ipVer };
  }
  if (dnsLookupFn === null) {
    // Only reachable when a unit test supplies a mock fetchImpl without a mock DNS resolver.
    return { address: bareHost, family: 4 };
  }
  const lookup = dnsLookupFn ?? ((host: string) => dnsLookup(host, { all: true }));
  const records = await lookup(bareHost).catch(() => {
    throw new Error(`Unable to resolve host "${parsed.hostname}".`);
  });
  if (!records.length) {
    throw new Error(`Unable to resolve host "${parsed.hostname}".`);
  }
  for (const rec of records) {
    if (!allowLoopback && isDisallowedIP(rec.address)) {
      throw new Error('Fetching local or private network addresses is blocked.');
    }
  }
  const first = records[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

type PinnedHttpResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
  truncatedByBytes: boolean;
  url: string;
};

/**
 * Performs an IP-pinned HTTP/HTTPS GET connecting directly to the already-validated
 * IP address (preventing DNS rebinding TOCTOU between lookup and socket connect)
 * while preserving the original Host header and TLS SNI servername.
 */
function pinnedHttpGet(
  parsed: URL,
  pinned: PinnedTarget,
  byteLimit: number,
  signal: AbortSignal,
): Promise<PinnedHttpResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    signal.throwIfAborted();
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;
    const port = parsed.port ? Number(parsed.port) : defaultPort;
    const hostHeader = parsed.host;
    const servername = parsed.hostname.replace(/^\[|\]$/g, '');
    const pathAndQuery = `${parsed.pathname || '/'}${parsed.search || ''}`;

    const req = mod.request(
      {
        host: pinned.address,
        family: pinned.family,
        port,
        method: 'GET',
        path: pathAndQuery,
        headers: {
          Host: hostHeader,
          Accept: 'text/plain, text/markdown, text/html, application/json, application/xml;q=0.9, */*;q=0.5',
        },
        // RFC 6066 forbids IP address literals in TLS SNI servername.
        ...(isHttps && isIP(servername) === 0 ? { servername } : {}),
      },
      res => {
        const status = res.statusCode ?? 0;
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
        // On redirect, drain immediately and return status + Location without buffering body.
        if (status >= 300 && status < 400) {
          res.resume();
          cleanup();
          resolvePromise({ status, headers, body: Buffer.alloc(0), truncatedByBytes: false, url: parsed.toString() });
          return;
        }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncatedByBytes = false;
        let ended = false;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolvePromise({
            status,
            headers,
            body: Buffer.concat(chunks),
            truncatedByBytes,
            url: parsed.toString(),
          });
        };
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          const remaining = byteLimit - totalBytes;
          if (chunk.byteLength > remaining) {
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            totalBytes += Math.max(0, remaining);
            truncatedByBytes = true;
            res.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
          totalBytes += chunk.byteLength;
        });
        res.on('end', () => {
          ended = true;
          finish();
        });
        res.on('close', () => {
          if (settled) return;
          if (ended || truncatedByBytes || res.complete) {
            finish();
            return;
          }
          settled = true;
          cleanup();
          rejectPromise(new Error('HTTP response connection closed before body completed.'));
        });
        res.on('error', err => {
          if (settled) return;
          settled = true;
          cleanup();
          rejectPromise(err);
        });
      },
    );

    const onAbort = () => {
      req.destroy(signal.reason instanceof Error ? signal.reason : new Error('Request aborted.'));
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    req.on('error', err => {
      cleanup();
      rejectPromise(err);
    });
    req.end();
  });
}

export type SearchToolsOptions = {
  allowLoopbackFetch?: boolean;
  fetchImpl?: typeof fetch;
  dnsLookupImpl?: DnsLookupFn;
  /** Optional handle-level secure workspace file reader (e.g. SecureWorkspaceExecutionEnv.readWorkspaceFileSecure). */
  readWorkspaceFile?: (relativePosix: string, maxBytes: number) => Promise<Uint8Array>;
};

export function searchTools(workspace: string | (() => string), account: AbortSignal, options: SearchToolsOptions = {}) {
  const resolveWorkspace = () => (typeof workspace === 'function' ? workspace() : workspace);
  const fetchFn = options.fetchImpl ?? globalThis.fetch;

  return defineExtension({
    name: 'nimi-harness.search-tools',
    tools: [
      defineTool({
        name: 'glob',
        description: 'Find files matching a glob pattern inside the session workspace (e.g. "**/*.ts", "src/*.tsx"). Automatically ignores .git, node_modules, and dist directories.',
        parameters: obj({
          pattern: str({ description: 'Glob pattern relative to the search root, e.g. "**/*.ts" or "*.md".' }),
          path: opt(str({ description: 'Optional subfolder relative to the workspace root.' })),
          limit: opt(int({ description: 'Maximum matches to return (1-200, default 100).' })),
        }),
        replay: 'safe',
        async execute({ pattern, path: subPath, limit }, _api, ctx) {
          const signal = ctx.abortSignal ? AbortSignal.any([account, ctx.abortSignal]) : account;
          signal.throwIfAborted();
          if (!pattern.trim() || pattern.length > 500) throw new Error('Provide a non-empty glob pattern of up to 500 characters.');
          const maxMatches = Math.max(1, Math.min(200, limit ?? 100));
          const { root, target, isFile } = await resolveWorkspaceTarget(resolveWorkspace(), subPath);
          const matcher = globToRegExp(pattern);
          const matches: string[] = [];
          let truncated = false;
          let visited = 0;

          if (isFile) {
            const rel = toPosixRelative(root, target);
            if (!isSensitivePath(rel, root) && matcher.test(rel)) matches.push(rel);
          } else {
            const queue: string[] = [target];
            while (queue.length > 0 && !truncated) {
              signal.throwIfAborted();
              const current = queue.shift()!;
              let entries;
              try {
                entries = await readdir(current, { withFileTypes: true });
              } catch {
                continue;
              }
              entries.sort((a, b) => a.name.localeCompare(b.name));
              for (const entry of entries) {
                signal.throwIfAborted();
                if (++visited > MAX_WALK_ENTRIES) {
                  truncated = true;
                  break;
                }
                if (entry.isSymbolicLink()) continue;
                const full = join(current, entry.name);
                if (entry.isDirectory()) {
                  if (isIgnoredDirectory(entry.name)) continue;
                  queue.push(full);
                } else if (entry.isFile()) {
                  const relFromTarget = toPosixRelative(target, full);
                  const relFromRoot = toPosixRelative(root, full);
                  if (isSensitivePath(relFromRoot, root)) continue;
                  if (matcher.test(relFromTarget) || matcher.test(relFromRoot)) {
                    matches.push(relFromRoot);
                    if (matches.length >= maxMatches) {
                      truncated = true;
                      break;
                    }
                  }
                }
              }
            }
          }

          const summary = matches.length
            ? matches.join('\n') + (truncated ? `\n... (truncated at ${matches.length} matches)` : '')
            : 'No matching files found.';
          return {
            output: [{ type: 'text', text: summary }],
            details: { pattern, matches, truncated },
          };
        },
      }),

      defineTool({
        name: 'grep',
        description: 'Search text or regex across files in the session workspace, returning file paths, 1-based line numbers, and line excerpts. Automatically skips .git, node_modules, dist directories, and binary files.',
        parameters: obj({
          pattern: str({ description: 'Regular expression or literal string to search for.' }),
          path: opt(str({ description: 'Optional file or subfolder relative to the workspace root.' })),
          glob: opt(str({ description: 'Optional file glob filter, e.g. "**/*.ts" or "*.md".' })),
          literal: opt(bool({ description: 'If true, match pattern literally instead of as a regular expression.' })),
          ignoreCase: opt(bool({ description: 'If true, perform a case-insensitive search.' })),
          limit: opt(int({ description: 'Maximum matching lines to return (1-200, default 80).' })),
        }),
        replay: 'safe',
        async execute({ pattern, path: subPath, glob: fileGlob, literal, ignoreCase, limit }, _api, ctx) {
          const signal = ctx.abortSignal ? AbortSignal.any([account, ctx.abortSignal]) : account;
          signal.throwIfAborted();
          if (!pattern || pattern.length > 500) throw new Error('Provide a non-empty search pattern of up to 500 characters.');
          let regex: RegExp;
          try {
            regex = new RegExp(literal ? escapeRegex(pattern) : pattern, ignoreCase ? 'i' : '');
          } catch (error) {
            throw new Error(`Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`);
          }
          const fileMatcher = fileGlob?.trim() ? globToRegExp(fileGlob) : undefined;
          const maxMatches = Math.max(1, Math.min(200, limit ?? 80));
          const { root, target, isFile } = await resolveWorkspaceTarget(resolveWorkspace(), subPath);

          const filesToScan: string[] = [];
          let truncated = false;
          if (isFile) {
            filesToScan.push(target);
          } else {
            const queue: string[] = [target];
            let visited = 0;
            while (queue.length > 0 && filesToScan.length < MAX_GREP_FILES) {
              signal.throwIfAborted();
              const current = queue.shift()!;
              let entries;
              try {
                entries = await readdir(current, { withFileTypes: true });
              } catch {
                continue;
              }
              entries.sort((a, b) => a.name.localeCompare(b.name));
              for (const entry of entries) {
                signal.throwIfAborted();
                if (++visited > MAX_WALK_ENTRIES) {
                  truncated = true;
                  break;
                }
                if (entry.isSymbolicLink()) continue;
                const full = join(current, entry.name);
                if (entry.isDirectory()) {
                  if (isIgnoredDirectory(entry.name)) continue;
                  queue.push(full);
                } else if (entry.isFile()) {
                  const relFromTarget = toPosixRelative(target, full);
                  const relFromRoot = toPosixRelative(root, full);
                  if (isSensitivePath(relFromRoot, root)) continue;
                  if (!fileMatcher || fileMatcher.test(relFromTarget) || fileMatcher.test(relFromRoot) || fileMatcher.test(entry.name)) {
                    filesToScan.push(full);
                    if (filesToScan.length >= MAX_GREP_FILES) {
                      truncated = true;
                      break;
                    }
                  }
                }
              }
            }
          }

          const matches: { file: string; line: number; text: string }[] = [];
          let outputBytes = 0;
          const formattedLines: string[] = [];

          const rootPrefix = root.endsWith(sep) ? root : root + sep;
          for (const filePath of filesToScan) {
            signal.throwIfAborted();
            if (matches.length >= maxMatches || outputBytes >= MAX_GREP_OUTPUT_BYTES) {
              truncated = true;
              break;
            }
            let handle;
            try {
              const relCheck = toPosixRelative(root, filePath);
              if (isSensitivePath(relCheck, root)) continue;
              let fullBuffer: Buffer;
              let rel = relCheck;
              if (options.readWorkspaceFile) {
                const rawBytes = await options.readWorkspaceFile(relCheck, MAX_GREP_FILE_BYTES);
                if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_GREP_FILE_BYTES) continue;
                const probeLen = Math.min(4096, rawBytes.byteLength);
                if (Buffer.from(rawBytes.buffer, rawBytes.byteOffset, probeLen).includes(0)) continue;
                fullBuffer = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
              } else {
                const realFile = await realpath(filePath);
                if (realFile !== root && !realFile.startsWith(rootPrefix)) continue;
                const realRel = toPosixRelative(root, realFile);
                if (isSensitivePath(realRel, root)) continue;
                handle = await open(realFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
                const info = await handle.stat();
                if (!info.isFile() || info.nlink > 1 || info.size === 0 || info.size > MAX_GREP_FILE_BYTES) continue;
                const probeLen = Math.min(4096, info.size);
                const probe = Buffer.allocUnsafe(probeLen);
                const { bytesRead } = await handle.read(probe, 0, probeLen, 0);
                if (probe.subarray(0, bytesRead).includes(0)) continue; // Skip binary files.

                fullBuffer = info.size <= probeLen
                  ? probe.subarray(0, bytesRead)
                  : await handle.readFile({ signal });
                rel = realRel;
              }
              const lines = fullBuffer.toString('utf8').split(/\r?\n/);
              for (let index = 0; index < lines.length; index++) {
                const lineText = lines[index];
                if (!regex.test(lineText)) continue;
                const excerpt = lineText.length > MAX_LINE_EXCERPT
                  ? lineText.slice(0, MAX_LINE_EXCERPT) + '…'
                  : lineText;
                const formatted = `${rel}:${index + 1}: ${excerpt}`;
                const nextBytes = outputBytes + Buffer.byteLength(formatted, 'utf8') + 1;
                if (formattedLines.length > 0 && nextBytes > MAX_GREP_OUTPUT_BYTES) {
                  truncated = true;
                  break;
                }
                outputBytes = nextBytes;
                formattedLines.push(formatted);
                matches.push({ file: rel, line: index + 1, text: excerpt });
                if (matches.length >= maxMatches) {
                  truncated = true;
                  break;
                }
              }
            } catch (error) {
              if ((error as { name?: string })?.name === 'AbortError') throw error;
              continue;
            } finally {
              await handle?.close().catch(() => {});
            }
          }

          const outputText = formattedLines.length
            ? formattedLines.join('\n') + (truncated ? `\n... (truncated at ${formattedLines.length} matches)` : '')
            : 'No matches found.';
          return {
            output: [{ type: 'text', text: outputText }],
            details: { pattern, count: matches.length, truncated },
          };
        },
      }),

      defineTool({
        name: 'web_fetch',
        description: 'Fetch text content from an HTTP or HTTPS URL with bounded timeout and byte size limit. Requires user approval.',
        parameters: obj({
          url: str({ description: 'HTTP or HTTPS URL to fetch.' }),
          maxBytes: opt(int({ description: 'Maximum response bytes to read (default 131072, max 524288).' })),
          timeoutMs: opt(int({ description: 'Request timeout in milliseconds (default 15000, max 30000).' })),
        }),
        replay: 'unsafe',
        async execute({ url, maxBytes, timeoutMs }, _api, ctx) {
          const signal = ctx.abortSignal ? AbortSignal.any([account, ctx.abortSignal]) : account;
          signal.throwIfAborted();
          let parsed: URL;
          try {
            parsed = new URL(url);
          } catch {
            throw new Error('Provide a valid HTTP or HTTPS URL.');
          }
          const byteLimit = Math.max(1024, Math.min(MAX_FETCH_BYTES, maxBytes ?? DEFAULT_FETCH_BYTES));
          const timeout = Math.max(1000, Math.min(MAX_FETCH_TIMEOUT_MS, timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS));
          const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
          let currentUrl = parsed;
          let finalUrl = parsed.toString();
          let status = 0;
          let contentType = 'application/octet-stream';
          let rawBuffer: Buffer = Buffer.alloc(0);
          let totalBytes = 0;
          let truncatedByBytes = false;

          if (options.fetchImpl) {
            // Test-injected fetch implementation: still enforce full SSRF validation on every hop.
            const testDns = options.dnsLookupImpl ?? null;
            let response!: Response;
            for (let hop = 0; hop <= 5; hop++) {
              await resolvePinnedFetchTarget(currentUrl, Boolean(options.allowLoopbackFetch), testDns);
              response = await fetchFn(currentUrl.toString(), {
                method: 'GET',
                redirect: 'manual',
                signal: requestSignal,
                headers: {
                  Accept: 'text/plain, text/markdown, text/html, application/json, application/xml;q=0.9, */*;q=0.5',
                },
              });
              if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) break;
                if (hop === 5) throw new Error('Too many redirects while fetching URL.');
                const nextUrl = new URL(location, currentUrl);
                await resolvePinnedFetchTarget(nextUrl, Boolean(options.allowLoopbackFetch), testDns);
                currentUrl = nextUrl;
                continue;
              }
              break;
            }
            status = response.status;
            finalUrl = response.url || currentUrl.toString();
            contentType = response.headers.get('content-type') ?? 'application/octet-stream';
            const chunks: Uint8Array[] = [];
            if (response.body) {
              const reader = response.body.getReader();
              try {
                for (;;) {
                  requestSignal.throwIfAborted();
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (!value) continue;
                  const remaining = byteLimit - totalBytes;
                  if (value.byteLength > remaining) {
                    chunks.push(value.subarray(0, remaining));
                    totalBytes += remaining;
                    truncatedByBytes = true;
                    await reader.cancel().catch(() => {});
                    break;
                  }
                  chunks.push(value);
                  totalBytes += value.byteLength;
                }
              } finally {
                reader.releaseLock();
              }
            }
            rawBuffer = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
          } else {
            // Production path: resolve DNS once per hop and connect directly to the pinned IP
            // (eliminating DNS rebinding TOCTOU between validation and TCP connect).
            let pinnedRes!: PinnedHttpResponse;
            for (let hop = 0; hop <= 5; hop++) {
              const pinned = await resolvePinnedFetchTarget(currentUrl, Boolean(options.allowLoopbackFetch));
              pinnedRes = await pinnedHttpGet(currentUrl, pinned, byteLimit, requestSignal);
              if (pinnedRes.status >= 300 && pinnedRes.status < 400) {
                const location = pinnedRes.headers['location'];
                if (!location) break;
                if (hop === 5) throw new Error('Too many redirects while fetching URL.');
                currentUrl = new URL(location, currentUrl);
                continue;
              }
              break;
            }
            status = pinnedRes.status;
            finalUrl = pinnedRes.url;
            contentType = pinnedRes.headers['content-type'] ?? 'application/octet-stream';
            rawBuffer = pinnedRes.body;
            totalBytes = rawBuffer.byteLength;
            truncatedByBytes = pinnedRes.truncatedByBytes;
          }

          const rawText = rawBuffer.toString('utf8');
          const preview = textPreview(rawText, 16384);
          const payload = {
            url: finalUrl,
            status,
            contentType,
            bytesRead: totalBytes,
            truncated: truncatedByBytes || preview.truncated,
            text: preview.text,
          };
          return {
            output: [{ type: 'text', text: JSON.stringify(payload) }],
            details: { url: payload.url, status: payload.status, bytesRead: payload.bytesRead, truncated: payload.truncated },
          };
        },
      }),
    ],
  });
}
