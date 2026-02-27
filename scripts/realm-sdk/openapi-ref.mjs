export function resolveOpenApiRef(root, ref) {
  const normalized = String(ref || '');
  if (!normalized.startsWith('#/')) {
    return null;
  }

  const segments = normalized
    .slice(2)
    .split('/')
    .map((segment) => decodeURIComponent(segment));

  let cursor = root;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') {
      return null;
    }
    cursor = cursor[segment];
  }
  return cursor ?? null;
}
