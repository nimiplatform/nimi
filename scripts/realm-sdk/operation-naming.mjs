import { TAG_TO_SERVICE } from './constants.mjs';

export function normalizeTagToService(tag) {
  const explicit = TAG_TO_SERVICE[String(tag || '').trim()];
  if (explicit) {
    return explicit;
  }

  const normalized = String(tag || '').trim();
  if (!normalized) {
    return 'MiscService';
  }

  const words = normalized
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return 'MiscService';
  }

  const serviceName = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  return `${serviceName}Service`;
}

export function toLowerCamel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'operation';
  }

  const segments = normalized
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (segments.length === 0) {
    return 'operation';
  }

  const first = segments[0];
  const head = first.charAt(0).toLowerCase() + first.slice(1);
  const tail = segments
    .slice(1)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  const candidate = `${head}${tail}`.replace(/^[^A-Za-z_]+/, '');
  return candidate || 'operation';
}
