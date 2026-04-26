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

export type SandboxSourceKind = 'handler' | 'lib';

export type SandboxSourcePolicyOptions = {
  kind?: SandboxSourceKind;
  sourcePath?: string;
  allowLibImports?: boolean;
};

export type StaticImportSpec = {
  statement: string;
  bindings: string;
  specifier: string;
};

const STATIC_IMPORT_RE = /\bimport\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"]\s*;?/g;

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

function stripCommentsOnly(source: string): string {
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
        output += ch + next;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      output += ch;
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
    }
    output += ch;
    i += 1;
  }
  return output;
}

export function collectStaticImports(source: string): StaticImportSpec[] {
  const code = stripCommentsOnly(source);
  const imports: StaticImportSpec[] = [];
  for (const match of code.matchAll(STATIC_IMPORT_RE)) {
    imports.push({
      statement: match[0] ?? '',
      bindings: (match[1] ?? '').trim(),
      specifier: match[2] ?? '',
    });
  }
  return imports;
}

function isValidSourcePath(path: string): boolean {
  if (!path.endsWith('.js')) return false;
  const normalized = path.replace(/\\/g, '/');
  return normalized.includes('/runtime/nimi/');
}

function isAllowedLibImport(specifier: string): boolean {
  if (!specifier.endsWith('.js')) return false;
  if (specifier.includes('..//') || specifier.includes('\\')) return false;
  return specifier.startsWith('../lib/');
}

function validateImportBindings(bindings: string): string | null {
  const trimmed = bindings.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return 'NAS sandbox only allows named imports from runtime/nimi/lib';
  }
  if (/\bas\b/.test(trimmed)) {
    return 'NAS sandbox does not allow renamed lib imports';
  }
  return null;
}

export function validateSandboxSourcePolicy(
  source: string,
  options: SandboxSourcePolicyOptions = {},
): SandboxPolicyResult {
  const kind = options.kind ?? 'handler';
  if (options.sourcePath && !isValidSourcePath(options.sourcePath)) {
    return { ok: false, reason: `NAS sandbox source path is outside runtime/nimi or not .js: ${options.sourcePath}` };
  }
  const code = stripCommentsAndStrings(source);
  if (kind === 'handler' && !/\bexport\s+default\b/.test(code)) {
    return { ok: false, reason: 'NAS handler must use export default' };
  }
  if (kind === 'lib' && /\bexport\s+default\b/.test(code)) {
    return { ok: false, reason: 'NAS lib helpers must use named exports only' };
  }
  if (/\bimport\s*\(/.test(code)) {
    return { ok: false, reason: 'NAS sandbox does not allow dynamic import' };
  }
  if (/\bimport\s+['"]/.test(stripCommentsOnly(source))) {
    return { ok: false, reason: 'NAS sandbox does not allow side-effect imports' };
  }
  const staticImports = collectStaticImports(source);
  if (staticImports.length > 0) {
    if (!options.allowLibImports || kind !== 'handler') {
      return { ok: false, reason: 'NAS sandbox does not allow static import here' };
    }
    for (const imported of staticImports) {
      const bindingError = validateImportBindings(imported.bindings);
      if (bindingError) {
        return { ok: false, reason: bindingError };
      }
      if (!isAllowedLibImport(imported.specifier)) {
        return { ok: false, reason: `NAS sandbox import is outside runtime/nimi/lib: ${imported.specifier}` };
      }
    }
  }
  if (kind === 'handler' && /\bexport\s+(?!default\b)/.test(code)) {
    return { ok: false, reason: 'NAS sandbox only allows export default' };
  }
  if (kind === 'lib' && !/\bexport\s+(?:async\s+)?(?:function|const|let)\s+/.test(code)) {
    return { ok: false, reason: 'NAS lib helper must export named functions or values' };
  }
  for (const identifier of FORBIDDEN_GLOBAL_IDENTIFIERS) {
    const prefix = identifier === 'window' ? '(^|[^A-Za-z0-9_$.])' : '(^|[^A-Za-z0-9_$])';
    const pattern = new RegExp(`${prefix}${identifier}([^A-Za-z0-9_$]|$)`);
    if (pattern.test(code)) {
      return { ok: false, reason: `NAS sandbox forbids ambient global access: ${identifier}` };
    }
  }
  return { ok: true };
}

export function assertSandboxSourcePolicy(source: string, options: SandboxSourcePolicyOptions = {}): void {
  const result = validateSandboxSourcePolicy(source, options);
  if (!result.ok) {
    throw new Error(result.reason);
  }
}
