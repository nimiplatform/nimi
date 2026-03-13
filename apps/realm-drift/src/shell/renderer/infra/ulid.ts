const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID-like ID: 10-char timestamp + 16-char random.
 * Monotonic within the same millisecond is not required for demo scope.
 */
export function generateId(): string {
  const now = Date.now();
  let ts = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = ENCODING[t % 32] + ts;
    t = Math.floor(t / 32);
  }

  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += ENCODING[Math.floor(Math.random() * 32)];
  }

  return ts + rand;
}
