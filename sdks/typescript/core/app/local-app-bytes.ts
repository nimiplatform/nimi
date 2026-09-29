// Media bytes on the local-App shell carrier are exact Uint8Array views; the
// JSON number[] shape is not accepted. ArrayBuffer.isView alone also admits
// Float64Array and DataView, so the intrinsic %TypedArray% tag decides. It
// reads the internal type name, holds for views from another realm (bytes
// structured-cloned across Electron IPC) and ignores an own Symbol.toStringTag.
const typedArrayName = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  Symbol.toStringTag,
)?.get;

export function isNimiLocalAppByteView(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && typedArrayName?.call(value) === 'Uint8Array';
}

/**
 * The view's own byte range as an independent Uint8Array at offset 0. Callers
 * pass this across IPC so neither a larger backing buffer nor later caller
 * writes travel with the request.
 */
export function copyNimiLocalAppBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view);
}

/** Returns the view when it already owns exactly its buffer, else a copy. */
export function exactNimiLocalAppBytes(view: Uint8Array): Uint8Array {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength && !isSharedBuffer(view.buffer)
    ? view
    : copyNimiLocalAppBytes(view);
}

function isSharedBuffer(buffer: ArrayBufferLike): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && Object.prototype.toString.call(buffer) === '[object SharedArrayBuffer]';
}
