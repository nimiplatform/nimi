export const accountDestinations = [
  '/account',
  '/account/profile',
  '/account/friends',
  '/account/privacy',
  '/account/security',
  '/account/sessions',
  '/account/data',
  '/account/delete',
] as const;
export type AccountDestination = (typeof accountDestinations)[number];

export function accountHandle(value: unknown): string {
  return String(value ?? '').replace(/^@/, '');
}

function admittedDestination(value: string | null): string {
  const [path, search = ''] = String(value || '').split('?');
  const admitted = accountDestinations.find((item) => item === path) ?? '/account';
  const view = new URLSearchParams(search).get('view');
  return admitted === '/account/friends' && view && ['received', 'sent', 'blocked'].includes(view)
    ? `${admitted}?view=${view}`
    : admitted;
}

/** Ordinary account navigation is separate from an owner-issued OAuth continuation. */
export function accountReturnTo(search: string): string {
  const value = new URLSearchParams(search).get('returnTo');
  return admittedDestination(value);
}

export function accountLoginUrl(path: string, search = ''): string {
  const admitted = admittedDestination(path + search);
  return `/login?returnTo=${encodeURIComponent(admitted)}`;
}

export function profilePatch(
  original: Record<string, unknown>,
  draft: { displayName: string; bio: string; city: string; countryCode: string },
) {
  return Object.fromEntries(
    Object.entries(draft)
      .filter(([key, value]) => value !== String(original[key] ?? ''))
      .map(([key, value]) => [key, key === 'displayName' ? value.trim() : value.trim() || null]),
  );
}
