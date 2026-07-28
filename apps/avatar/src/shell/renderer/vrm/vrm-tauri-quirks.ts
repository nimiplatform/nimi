// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Tauri webview (macOS WKWebView) intermittently fails when GLTFLoader's
// `ImageBitmapLoader` decodes blob-backed VRM textures via
// `createImageBitmap`. The local r056 loader adapter temporarily sets
// `window.createImageBitmap` to `undefined` so GLTFLoader's
// constructor-time check (`createImageBitmap !== undefined`) picks
// `ImageLoader` (HTMLImageElement-based) instead of `ImageBitmapLoader`.
//
// IMPORTANT: a throwing stub does NOT work. ImageBitmapLoader is chosen
// at GLTFLoader construction time based on the truthiness of the global.
// A throwing function is still truthy — the loader picks
// ImageBitmapLoader and surfaces every texture decode failure as a
// hard-fail. The fallback path is only selected when the global is
// `undefined`.

import { hasAvatarTauriHostRuntime } from '../app-shell/avatar-host-bridge.js';

type CreateImageBitmapFn = typeof globalThis.createImageBitmap;

type WindowLike = {
  createImageBitmap?: CreateImageBitmapFn;
};

function getWindow(): WindowLike | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as WindowLike;
}

function isTauriRuntime(): boolean {
  return hasAvatarTauriHostRuntime();
}

function unsetCreateImageBitmap(win: WindowLike): boolean {
  // Property may be non-configurable on some webviews — try defineProperty
  // first (cleanest), fall back to plain assignment, and report failure
  // via the boolean return so the caller can avoid marking install done.
  try {
    Object.defineProperty(win, 'createImageBitmap', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    return true;
  } catch {
    try {
      (win as { createImageBitmap?: CreateImageBitmapFn | undefined }).createImageBitmap = undefined;
      return win.createImageBitmap === undefined;
    } catch {
      return false;
    }
  }
}

let permanentInstalled = false;

/**
 * Permanently install the createImageBitmap stub for the lifetime of the
 * renderer process. Idempotent and a no-op outside the Tauri runtime.
 *
 * Why this is permanent (not scoped to loadVrmFromManifest):
 * GLTFLoader continues to fetch some textures asynchronously after
 * `loadAsync` resolves — MToon plugin afterRoot processing, blob-URL
 * image elements that finish decoding late, and any deferred mipmap
 * upload all hit `createImageBitmap` after the per-load suspend has
 * been restored. On Tauri's macOS WKWebView this races and 1+ texture
 * fetches fail with the blob URL already revoked, leaving a Texture
 * with `image === undefined` — Three.js then throws on the first
 * `texture.colorSpace = …` write and the WebGL context is lost.
 *
 * Forcing GLTFLoader's `<img>` fallback for every texture decode side-
 * steps the WKWebView quirk entirely. The `<img>` path is slightly
 * slower in synthetic benchmarks but is the stable code path on every
 * platform we ship to.
 */
export function installCreateImageBitmapSuspendForTauri(): void {
  if (permanentInstalled) return;
  if (!isTauriRuntime()) return;
  const win = getWindow();
  if (!win) return;
  if (unsetCreateImageBitmap(win)) {
    permanentInstalled = true;
  }
}

/** Test-only seam: undo the permanent install so the next install can
 *  re-run. Production code MUST NOT call this. */
export function __resetCreateImageBitmapSuspendForTests(): void {
  permanentInstalled = false;
}

/**
 * Set `window.createImageBitmap` to `undefined` so GLTFLoader uses its
 * `<img>` fallback during a VRM load. Returns a `restore` function.
 * Calling `restore` more than once is safe (subsequent calls are no-ops).
 *
 * In SSR / non-browser environments, returns a no-op restore.
 *
 * Note: when `installCreateImageBitmapSuspendForTauri()` has already run
 * for this process, this scoped suspend is effectively a no-op — the
 * global is already `undefined` and stays `undefined` after restore.
 */
export function suspendCreateImageBitmapForTauriVrmLoad(): () => void {
  const win = getWindow();
  if (!win) {
    return () => {};
  }
  const previous = win.createImageBitmap;
  unsetCreateImageBitmap(win);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (win.createImageBitmap === undefined && previous !== undefined) {
      win.createImageBitmap = previous;
    }
  };
}
