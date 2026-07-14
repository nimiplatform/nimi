export function inspectPublicRuntimeSurface(runtime: object): boolean {
  return !('grants' in runtime);
}
