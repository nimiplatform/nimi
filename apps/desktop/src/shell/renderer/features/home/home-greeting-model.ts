const DEFAULT_GREETING_NAMES = new Set(['nimi user']);

export function resolveHomeGreetingName(user: Record<string, unknown> | null): string {
  if (!user) return '';
  const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : '';
  if (displayName) {
    return DEFAULT_GREETING_NAMES.has(displayName.toLowerCase()) ? '' : displayName;
  }
  const handle = typeof user.handle === 'string' ? user.handle.trim() : '';
  return DEFAULT_GREETING_NAMES.has(handle.toLowerCase()) ? '' : handle;
}
