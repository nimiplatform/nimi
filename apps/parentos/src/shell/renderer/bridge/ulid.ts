/** Simple ULID generator for ParentOS local IDs */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(): string {
  const now = Date.now();
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let random = '';
  for (let i = 0; i < 16; i++) {
    random += ENCODING[Math.floor(Math.random() * 32)];
  }
  return time + random;
}

export function isoNow(): string {
  return new Date().toISOString();
}
