const FORBIDDEN_GLOBAL_IDENTIFIERS = [
  'window',
  'document',
  'fetch',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'postMessage',
  'self',
  'globalThis',
  'eval',
  'Function',
  'Worker',
  'SharedWorker',
  'importScripts',
  'navigator',
  'location',
  'constructor',
] as const;

export type SandboxPolicyResult =
  | { ok: true }
  | { ok: false; reason: string };

function stripCommentsAndStrings(source: string): string {
  let output = '';
  let i = 0;
  let quote: '"' | "'" | '`' | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        output += '\n';
      } else {
        output += ' ';
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        output += '  ';
        i += 2;
      } else {
        output += ch === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        output += '  ';
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      output += ch === '\n' && quote === '`' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      output += '  ';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      output += '  ';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      output += ' ';
      i += 1;
      continue;
    }
    output += ch;
    i += 1;
  }
  return output;
}

export function validateSandboxSourcePolicy(source: string): SandboxPolicyResult {
  const code = stripCommentsAndStrings(source);
  if (!/\bexport\s+default\b/.test(code)) {
    return { ok: false, reason: 'NAS handler must use export default' };
  }
  if (/\bimport\s*(?:\(|[\s{*])/.test(code)) {
    return { ok: false, reason: 'NAS sandbox does not allow static or dynamic import' };
  }
  if (/\bexport\s+(?!default\b)/.test(code)) {
    return { ok: false, reason: 'NAS sandbox only allows export default' };
  }
  for (const identifier of FORBIDDEN_GLOBAL_IDENTIFIERS) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${identifier}([^A-Za-z0-9_$]|$)`);
    if (pattern.test(code)) {
      return { ok: false, reason: `NAS sandbox forbids ambient global access: ${identifier}` };
    }
  }
  return { ok: true };
}

export function assertSandboxSourcePolicy(source: string): void {
  const result = validateSandboxSourcePolicy(source);
  if (!result.ok) {
    throw new Error(result.reason);
  }
}
