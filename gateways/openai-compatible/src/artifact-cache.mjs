import { OpenAICompatibleGatewayError } from './errors.mjs';

// Gateway-local response bytes, not Runtime artifact ownership. Eviction only
// invalidates the temporary HTTP URL; it never deletes the Runtime artifact.
export class GatewayArtifactCache {
  #entries = new Map();
  #bytes = 0;
  #nowMs;
  #maxBytes;
  #maxEntries;

  constructor({ nowMs, maxBytes, maxEntries }) {
    this.#nowMs = nowMs;
    this.#maxBytes = maxBytes;
    this.#maxEntries = maxEntries;
  }

  get(id) {
    const entry = this.#entries.get(id);
    if (!entry) return undefined;
    if (entry.value.expiresAtMs <= this.#nowMs()) {
      this.delete(id);
      return undefined;
    }
    return entry.value;
  }

  set(id, value) {
    if (value.bytes.byteLength > this.#maxBytes) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_ARTIFACT_TOO_LARGE',
        'Image exceeds the gateway URL cache capacity; request b64_json instead.',
        503,
      );
    }
    this.delete(id);
    for (const key of this.#entries.keys()) this.get(key);
    while (this.#entries.size >= this.#maxEntries || this.#bytes + value.bytes.byteLength > this.#maxBytes) {
      this.delete(this.#entries.keys().next().value);
    }
    // Copy the exact view so a small slice cannot retain a large backing buffer.
    const entry = { value: { ...value, bytes: Uint8Array.from(value.bytes) }, timer: undefined };
    this.#entries.set(id, entry);
    this.#bytes += entry.value.bytes.byteLength;
    const expire = () => {
      if (this.#entries.get(id) !== entry) return;
      const remaining = entry.value.expiresAtMs - this.#nowMs();
      if (remaining <= 0) {
        this.delete(id);
      } else {
        entry.timer = setTimeout(expire, Math.min(remaining, 2 ** 31 - 1));
        entry.timer.unref();
      }
    };
    expire();
  }

  delete(id) {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.#bytes -= entry.value.bytes.byteLength;
    return this.#entries.delete(id);
  }
}
