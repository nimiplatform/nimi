const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(value: number, length: number): string {
  let input = Math.floor(value);
  let output = '';
  for (let index = 0; index < length; index += 1) {
    const mod = input % 32;
    output = ENCODING[mod] + output;
    input = Math.floor(input / 32);
  }
  return output;
}

function encodeRandom(length: number): string {
  const random = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(random);
  } else {
    for (let index = 0; index < random.length; index += 1) {
      random[index] = Math.floor(Math.random() * 256);
    }
  }
  let output = '';
  for (let index = 0; index < random.length; index += 1) {
    output += ENCODING[random[index]! % 32];
  }
  return output;
}

export function createUlid(timeMs?: number): string {
  const timestamp = Number.isFinite(timeMs) ? Number(timeMs) : Date.now();
  return `${encodeTime(timestamp, 10)}${encodeRandom(16)}`;
}
