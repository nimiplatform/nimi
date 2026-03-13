export function hasTauriInvoke(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__?.core?.invoke;
}
