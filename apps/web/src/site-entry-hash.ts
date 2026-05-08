export function isWebShellHashRoute(hash: string): boolean {
  const normalizedHash = hash.trim();
  return normalizedHash === '#/' || normalizedHash.startsWith('#/');
}

export function isWebShellPathRoute(pathname: string): boolean {
  const normalizedPathname = pathname.trim();
  return normalizedPathname === '/login';
}
