import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RANDOM_BYTES = 10;
const ULID_TIME_CHARS = 10;
const ULID_RANDOM_CHARS = 16;
const MAX_ULID_TIME_MS = 0xffffffffffff;

function requireCryptoRandomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw createNimiError({
      message: 'cryptographic random values are required for Nimi ID generation',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'run_in_environment_with_crypto_get_random_values',
      source: 'sdk',
    });
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function normalizeUlidTimestamp(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw createNimiError({
      message: 'Nimi ULID timestamp must be finite',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_finite_timestamp_ms',
      source: 'sdk',
    });
  }
  return Math.min(MAX_ULID_TIME_MS, Math.max(0, Math.trunc(nowMs)));
}

/** Create a canonical, time-sortable Nimi ULID using cryptographic randomness. */
export function createNimiUlid(nowMs: number = Date.now()): string {
  let timeValue = BigInt(normalizeUlidTimestamp(nowMs));
  let timePart = '';
  for (let index = 0; index < ULID_TIME_CHARS; index += 1) {
    timePart = ULID_ALPHABET[Number(timeValue & 31n)] + timePart;
    timeValue >>= 5n;
  }

  let randomValue = 0n;
  for (const byte of requireCryptoRandomBytes(ULID_RANDOM_BYTES)) {
    randomValue = (randomValue << 8n) | BigInt(byte);
  }
  let randomPart = '';
  for (let index = 0; index < ULID_RANDOM_CHARS; index += 1) {
    randomPart = ULID_ALPHABET[Number(randomValue & 31n)] + randomPart;
    randomValue >>= 5n;
  }

  return `${timePart}${randomPart}`;
}
