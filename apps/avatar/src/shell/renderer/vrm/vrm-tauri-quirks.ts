// Wave 2 chunk 2-A of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Tauri webview (macOS WKWebView) intermittently hangs when GLTFLoader
// invokes `createImageBitmap` during VRM texture decode. Per
// vrm-backend-contract.md §6.1 (NAV-VRM-007), we temporarily replace
// `window.createImageBitmap` with a function that throws — this forces
// GLTFLoader to fall through to its `<img>` element fallback path.
//
// The returned `restore` function reinstates the original reference.
// The implementation is idempotent and supports nested suspension:
//   const r1 = suspend();
//   const r2 = suspend();
//   r2(); r1(); // safe; original restored exactly once.
// SSR / non-browser environments are guarded — the returned restore is
// a no-op.

const SUSPEND_MARKER = Symbol.for('apps.avatar.vrm.createImageBitmap.suspended');

type CreateImageBitmapFn = typeof globalThis.createImageBitmap;
type SuspendedFn = CreateImageBitmapFn & { [SUSPEND_MARKER]?: true };

type WindowLike = {
  createImageBitmap?: CreateImageBitmapFn;
};

function getWindow(): WindowLike | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as WindowLike;
}

function makeSuspendedStub(): SuspendedFn {
  const stub: SuspendedFn = (() => {
    throw new Error(
      'createImageBitmap is suspended for Tauri VRM load (forces GLTFLoader <img> fallback path)',
    );
  }) as SuspendedFn;
  stub[SUSPEND_MARKER] = true;
  return stub;
}

/**
 * Suspend `window.createImageBitmap` so GLTFLoader uses its `<img>` fallback
 * during a VRM load. Returns a `restore` function. Calling `restore` more than
 * once is safe (subsequent calls are no-ops). Nested suspension stacks: each
 * `restore` undoes its own layer.
 *
 * In SSR / non-browser environments, returns a no-op restore.
 */
export function suspendCreateImageBitmapForTauriVrmLoad(): () => void {
  const win = getWindow();
  if (!win) {
    return () => {};
  }
  const previous = win.createImageBitmap;
  const stub = makeSuspendedStub();
  win.createImageBitmap = stub;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    // Only restore if our stub is still the active reference; if a deeper
    // nested suspend layer is on top, we just unhook ourselves silently —
    // the deeper layer keeps its own previous reference.
    if (win.createImageBitmap === stub) {
      if (previous === undefined) {
        delete (win as { createImageBitmap?: CreateImageBitmapFn }).createImageBitmap;
      } else {
        win.createImageBitmap = previous;
      }
    }
    // If a deeper suspend wrapped over ours, that deeper restore will see
    // its own previous (which is our stub) and re-install our stub when it
    // unwinds — but we already marked ourselves restored, so that stub
    // restoration is harmless until the outer restore runs.
  };
}
