import { lstat, open, readdir, realpath } from 'node:fs/promises';
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
  if (isSensitivePath(relPosix)) {
    throw new Error(`Access to sensitive path "${relPosix}" is blocked by Harness security policy.`);
  }
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) {
    throw new Error('Search path must not traverse symbolic links.');
  }
  const real = await realpath(candidate);
  if (real !== root && !real.startsWith(rootPrefix)) {
    throw new Error('Search path must stay inside the session workspace.');
  }
  const realRelPosix = toPosixRelative(root, real);
  if (isSensitivePath(realRelPosix)) {
    throw new Error(`Access to sensitive path "${realRelPosix}" is blocked by Harness security policy.`);
  }
  return { root, target: real, isFile: info.isFile() };
}

function toPosixRelative(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

function isDisallowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!lower) return true;
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.localhost')) return true;
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export type SearchToolsOptions = {
  allowLoopbackFetch?: boolean;
  fetchImpl?: typeof fetch;
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
            if (matcher.test(rel)) matches.push(rel);
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
                  if (isSensitivePath(relFromRoot)) continue;
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
                  if (isSensitivePath(relFromRoot)) continue;
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

          for (const filePath of filesToScan) {
            signal.throwIfAborted();
            if (matches.length >= maxMatches || outputBytes >= MAX_GREP_OUTPUT_BYTES) {
              truncated = true;
              break;
            }
            let handle;
            try {
              handle = await open(filePath, 'r');
              const info = await handle.stat();
              if (!info.isFile() || info.size === 0 || info.size > MAX_GREP_FILE_BYTES) continue;
              const probeLen = Math.min(4096, info.size);
              const probe = Buffer.allocUnsafe(probeLen);
              const { bytesRead } = await handle.read(probe, 0, probeLen, 0);
              if (probe.subarray(0, bytesRead).includes(0)) continue; // Skip binary files.

              const fullBuffer = info.size <= probeLen
                ? probe.subarray(0, bytesRead)
                : await handle.readFile({ signal });
              const rel = toPosixRelative(root, filePath);
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
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Only http:// and https:// URLs are supported.');
          }
          if (parsed.username || parsed.password) {
            throw new Error('URLs with embedded credentials are not allowed.');
          }
          if (!options.allowLoopbackFetch && isDisallowedHost(parsed.hostname)) {
            throw new Error('Fetching local or private network addresses is blocked.');
          }
          const byteLimit = Math.max(1024, Math.min(MAX_FETCH_BYTES, maxBytes ?? DEFAULT_FETCH_BYTES));
          const timeout = Math.max(1000, Math.min(MAX_FETCH_TIMEOUT_MS, timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS));
          const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);

          const response = await fetchFn(parsed.toString(), {
            method: 'GET',
            redirect: 'follow',
            signal: requestSignal,
            headers: {
              Accept: 'text/plain, text/markdown, text/html, application/json, application/xml;q=0.9, */*;q=0.5',
            },
          });
          if (!options.allowLoopbackFetch && response.url) {
            try {
              const finalUrl = new URL(response.url);
              if ((finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') || isDisallowedHost(finalUrl.hostname)) {
                throw new Error('Redirect to a disallowed address was blocked.');
              }
            } catch (error) {
              if (error instanceof Error && error.message.includes('disallowed')) throw error;
            }
          }

          const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          let truncatedByBytes = false;
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
          const rawText = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
          const preview = textPreview(rawText, 16384);
          const payload = {
            url: response.url || parsed.toString(),
            status: response.status,
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
