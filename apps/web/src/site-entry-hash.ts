export function isWebShellHashRoute(hash: string): boolean {
  const normalizedHash = hash.trim();
  return normalizedHash === '#/' || normalizedHash.startsWith('#/');
}
