import path from 'node:path';

const VALUE_EXPORT_PATTERN = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|let|var|enum)\s*\*?\s*([A-Za-z0-9_$]+)/;
const CONST_EXPORT_PATTERN = /^export\s+(?:declare\s+)?const\s+(?!enum\b)([A-Za-z0-9_$]+)/;
const CONST_ENUM_EXPORT_PATTERN = /^export\s+(?:declare\s+)?const\s+enum\s+([A-Za-z0-9_$]+)/;
const TYPE_EXPORT_PATTERN = /^export\s+(?:declare\s+)?(interface|type)\s+([A-Za-z0-9_$]+)/;
const STAR_EXPORT_PATTERN = /^export\s+(type\s+)?\*\s+from\s+['"]([^'"]+)['"]/;
const STAR_NAMESPACE_EXPORT_PATTERN = /^export\s+(?:type\s+)?\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"][^'"]+['"]/;
const NAMED_EXPORT_PATTERN = /^export\s+(type\s+)?\{([^}]*)\}/;
const DEFAULT_EXPORT_PATTERN = /^export\s+default\b/;
const EXPORT_ASSIGNMENT_PATTERN = /^export\s*=/;

export const POSTURE_REQUIRING_AUTHORITY = 'runtime-projection';
export const AUTHORITY_REF_RULE_PREFIX = 'rule:';
export const AUTHORITY_REF_RULE_PATTERN = /^rule:([A-Z]-[A-Z]+-\d+)$/;
export const AUTHORITY_REF_GROUP_PREFIX = 'group:';
export const AUTHORITY_REF_CONTRACT_PREFIX = 'contract:';

// Collapse multi-line `export {...}` blocks so brace-wrapped named exports
// cannot evade line-based parsing.
function collapseExportBlocks(source) {
  return source.replace(/^([ \t]*export\s+(?:type\s+)?\{)([^}]*?)(\})/gms, (match) => match.replace(/\s*\n\s*/g, ' '));
}

export function parseModuleExports(source) {
  const named = [];
  const stars = [];
  const errors = [];
  const collapsed = collapseExportBlocks(source);
  for (const rawLine of collapsed.split('\n')) {
    const line = rawLine.trimStart();
    if (!line.startsWith('export')) {
      continue;
    }
    const starNamespace = STAR_NAMESPACE_EXPORT_PATTERN.exec(line);
    if (starNamespace) {
      named.push({ name: starNamespace[1], kind: 'value' });
      continue;
    }
    const star = STAR_EXPORT_PATTERN.exec(line);
    if (star) {
      stars.push(star[2]);
      continue;
    }
    const constEnum = CONST_ENUM_EXPORT_PATTERN.exec(line);
    if (constEnum) {
      named.push({ name: constEnum[1], kind: 'value' });
      continue;
    }
    const constValue = CONST_EXPORT_PATTERN.exec(line);
    if (constValue) {
      named.push({ name: constValue[1], kind: 'value' });
      continue;
    }
    const value = VALUE_EXPORT_PATTERN.exec(line);
    if (value) {
      named.push({ name: value[2], kind: 'value' });
      continue;
    }
    const typed = TYPE_EXPORT_PATTERN.exec(line);
    if (typed) {
      named.push({ name: typed[2], kind: 'type' });
      continue;
    }
    const block = NAMED_EXPORT_PATTERN.exec(line);
    if (block) {
      const blockIsTypeOnly = Boolean(block[1]);
      for (const entry of block[2].split(',')) {
        let spec = entry.trim();
        if (!spec) {
          continue;
        }
        let kind = blockIsTypeOnly ? 'type' : 'unknown';
        if (spec.startsWith('type ')) {
          kind = 'type';
          spec = spec.slice('type '.length).trim();
        }
        const name = spec.split(/\s+as\s+/).pop()?.trim();
        if (name) {
          named.push({ name, kind });
        }
      }
      continue;
    }
    if (DEFAULT_EXPORT_PATTERN.test(line)) {
      errors.push(`default exports are not admissible on posture-governed surfaces: "${line.slice(0, 80)}"`);
      continue;
    }
    if (EXPORT_ASSIGNMENT_PATTERN.test(line)) {
      errors.push(`export-assignment is not admissible on posture-governed surfaces: "${line.slice(0, 80)}"`);
      continue;
    }
    // Fail closed: an export form this parser does not recognize must never
    // become a silently unregistered public symbol.
    errors.push(`unrecognized export form (extend the posture gate parser before using it): "${line.slice(0, 80)}"`);
  }
  return { named, stars, errors };
}

export function collectRootExports({ rootDir, entryFile, readFile }) {
  const exportsBySymbol = new Map();
  const errors = [];
  const visited = new Set();

  const visit = (moduleRelPath) => {
    const normalized = normalizeModulePath(moduleRelPath);
    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    let source;
    try {
      source = readFile(path.join(rootDir, normalized));
    } catch (error) {
      errors.push(`cannot read module ${normalized}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const parsed = parseModuleExports(source);
    for (const parseError of parsed.errors) {
      errors.push(`${normalized}: ${parseError}`);
    }
    for (const symbol of parsed.named) {
      const existing = exportsBySymbol.get(symbol.name);
      if (existing) {
        existing.duplicates = [...(existing.duplicates ?? []), normalized];
        continue;
      }
      exportsBySymbol.set(symbol.name, { kind: symbol.kind, module: normalized });
    }
    for (const target of parsed.stars) {
      if (!target.startsWith('.')) {
        errors.push(`${normalized}: star re-export through package specifier "${target}" is not admissible on posture-governed surfaces`);
        continue;
      }
      visit(path.join(path.dirname(normalized), target));
    }
  };

  visit(entryFile);
  return { exportsBySymbol, errors };
}

function normalizeModulePath(moduleRelPath) {
  let normalized = moduleRelPath.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\//, '');
  // Repo ESM convention writes `.js` specifiers for `.ts` sources.
  normalized = normalized.replace(/\.js$/, '.ts');
  if (!/\.(ts|tsx|mts|cts)$/.test(normalized)) {
    normalized = `${normalized}.ts`;
  }
  return path.normalize(normalized).replace(/\\/g, '/');
}

export function validateRegistry({ registry, rootExports, collectErrors = [], root, enforcedRoots, methodGroupIds, ruleIds, contractExists }) {
  const errors = [...collectErrors];
  const postureIds = new Set((registry.postures ?? []).map((posture) => posture.id));
  if (postureIds.size === 0) {
    errors.push('registry declares no postures');
  }
  const allEnforcedRoots = enforcedRoots ?? [root];

  const entries = registry.entries ?? [];
  const entriesByKey = new Map();
  for (const entry of entries) {
    const key = `${entry.module}#${entry.symbol}`;
    if (entriesByKey.has(key)) {
      errors.push(`duplicate registry entry for ${key}`);
      continue;
    }
    entriesByKey.set(key, entry);
  }

  for (const [symbol, info] of rootExports) {
    const entry = entriesByKey.get(`${root}/${info.module}#${symbol}`);
    if (!entry) {
      errors.push(`public export ${symbol} (${root}/${info.module}) has no authority posture entry`);
      continue;
    }
    if (info.kind !== 'unknown' && entry.kind !== info.kind) {
      errors.push(`symbol ${symbol}: registry kind ${entry.kind} does not match source kind ${info.kind}`);
    }
    if (info.duplicates) {
      errors.push(`symbol ${symbol}: exported from multiple modules (${[info.module, ...info.duplicates].join(', ')})`);
    }
  }

  for (const entry of entries) {
    const inEnforcedRoot = allEnforcedRoots.some((enforcedRoot) => entry.module?.startsWith(`${enforcedRoot}/`));
    if (!inEnforcedRoot) {
      errors.push(`registry entry ${entry.symbol}: module ${entry.module} is outside every enforced coverage root`);
      continue;
    }
    if (!entry.module.startsWith(`${root}/`)) {
      continue;
    }
    const relModule = entry.module.slice(root.length + 1);
    const sourceInfo = rootExports.get(entry.symbol);
    if (!sourceInfo || sourceInfo.module !== relModule) {
      errors.push(`registry entry ${entry.symbol} is stale: not exported from ${entry.module} in the ${root} entry module graph`);
    }
    if (!postureIds.has(entry.posture)) {
      errors.push(`registry entry ${entry.symbol}: posture ${entry.posture} is not a declared posture id`);
    }
    const refs = entry.authority_ref ?? [];
    if (entry.posture === POSTURE_REQUIRING_AUTHORITY && refs.length === 0) {
      errors.push(`registry entry ${entry.symbol}: posture ${POSTURE_REQUIRING_AUTHORITY} requires at least one authority_ref`);
    }
    for (const ref of refs) {
      const ruleMatch = AUTHORITY_REF_RULE_PATTERN.exec(ref);
      if (ruleMatch) {
        if (!ruleIds.has(ruleMatch[1])) {
          errors.push(`registry entry ${entry.symbol}: authority_ref ${ref} does not resolve to a rule heading under .nimi/spec/`);
        }
        continue;
      }
      if (ref.startsWith(AUTHORITY_REF_RULE_PREFIX)) {
        errors.push(`registry entry ${entry.symbol}: authority_ref ${ref} is not a well-formed rule reference`);
        continue;
      }
      if (ref.startsWith(AUTHORITY_REF_GROUP_PREFIX)) {
        const groupId = ref.slice(AUTHORITY_REF_GROUP_PREFIX.length);
        if (!methodGroupIds.has(groupId)) {
          errors.push(`registry entry ${entry.symbol}: authority_ref ${ref} does not resolve in runtime-method-groups.yaml`);
        }
        continue;
      }
      if (ref.startsWith(AUTHORITY_REF_CONTRACT_PREFIX)) {
        const contractRelPath = ref.slice(AUTHORITY_REF_CONTRACT_PREFIX.length);
        if (!contractExists(contractRelPath)) {
          errors.push(`registry entry ${entry.symbol}: authority_ref ${ref} does not exist under .nimi/spec/`);
        }
        continue;
      }
      errors.push(`registry entry ${entry.symbol}: authority_ref ${ref} uses an unknown format (expected rule:/group:/contract:)`);
    }
  }

  return { ok: errors.length === 0, errors };
}
