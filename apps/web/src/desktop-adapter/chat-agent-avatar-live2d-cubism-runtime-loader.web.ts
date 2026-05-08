// This web adapter never resolves successfully. Keep the return type opaque so
// the web build does not import desktop-private renderer type authority.
export async function loadOfficialCubismRuntimeModules(): Promise<any> {
  throw new Error('Live2D Cubism runtime is not available in the web shell.');
}
