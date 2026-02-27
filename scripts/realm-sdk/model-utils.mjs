export function classifyModelExport(modelSource) {
  if (/^\s*export\s+enum\s+/m.test(modelSource)) {
    return 'value';
  }
  if (/^\s*export\s+const\s+/m.test(modelSource)) {
    return 'value';
  }
  if (/^\s*export\s+class\s+/m.test(modelSource)) {
    return 'value';
  }
  if (/^\s*export\s+function\s+/m.test(modelSource)) {
    return 'value';
  }
  if (/^\s*export\s+type\s+/m.test(modelSource)) {
    return 'type';
  }
  return 'unknown';
}

export function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

export function isValidTypeIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''));
}

export function toTypeIdentifier(value) {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  const candidate = normalized || 'Model';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    return candidate;
  }
  return `Model${candidate.replace(/[^A-Za-z0-9_]/g, '')}`;
}

export function uniqueSymbolName(baseName, used) {
  const base = String(baseName || 'Model');
  const count = Number(used.get(base) || 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}${count}`;
}

export function toEnumMemberKey(value, index, used) {
  let base = '';
  if (typeof value === 'string') {
    base = value
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const sign = value < 0 ? 'NEG_' : '';
    const raw = String(Math.abs(value)).replace(/[^0-9]+/g, '_').replace(/^_+|_+$/g, '');
    base = `${sign}VALUE_${raw || String(index + 1)}`;
  } else if (typeof value === 'boolean') {
    base = value ? 'TRUE' : 'FALSE';
  } else if (value === null) {
    base = 'NULL';
  }

  if (!base) {
    base = `VALUE_${String(index + 1)}`;
  }
  if (/^[0-9]/.test(base)) {
    base = `_${base}`;
  }

  return uniqueSymbolName(base, used);
}

export function splitIdentifierWords(value) {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }
  const separated = normalized
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return separated
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function mergeOverlappingIdentifiers(left, right) {
  const leftWords = splitIdentifierWords(left);
  const rightWords = splitIdentifierWords(right);

  if (leftWords.length === 0) {
    return rightWords.join('');
  }
  if (rightWords.length === 0) {
    return leftWords.join('');
  }

  let overlap = 0;
  const maxOverlap = Math.min(leftWords.length, rightWords.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const leftTail = leftWords.slice(leftWords.length - size).join('|');
    const rightHead = rightWords.slice(0, size).join('|');
    if (leftTail === rightHead) {
      overlap = size;
      break;
    }
  }

  return [...leftWords, ...rightWords.slice(overlap)].join('');
}

export function stripSchemaSuffixes(schemaSymbol) {
  const suffixes = ['ResponseDto', 'RequestDto', 'ResultDto', 'InputDto', 'OutputDto', 'Dto', 'Response', 'Request', 'Result', 'Input', 'Output'];
  let current = String(schemaSymbol || '');

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }

  return current || String(schemaSymbol || '');
}

export function reserveUniqueSymbol(baseName, occupied) {
  const fallback = String(baseName || 'RealmEnum');
  let candidate = fallback;
  let index = 2;
  while (occupied.has(candidate)) {
    candidate = `${fallback}${index}`;
    index += 1;
  }
  occupied.add(candidate);
  return candidate;
}

export function escapeSingleQuoteString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}
