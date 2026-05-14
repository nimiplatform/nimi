// This web adapter never resolves successfully. Keep the return type opaque so
// the web build does not import desktop-private renderer type authority.
export function hasLive2dCubismCore(): boolean {
  return false;
}

export function resolveLive2dCubismCoreScriptUrl(): string {
  throw new Error('Live2D Cubism Core script is not available in the web shell.');
}

export async function ensureLive2dCubismCoreLoaded(): Promise<void> {
  throw new Error('Live2D Cubism Core is not available in the web shell.');
}

export async function loadOfficialCubismRuntimeModules(): Promise<any> {
  throw new Error('Live2D Cubism runtime is not available in the web shell.');
}
