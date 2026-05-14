const RAW_MINISIGN_PUBLIC_KEY_BYTES = 42;
const DEFAULT_UNTRUSTED_COMMENT = 'untrusted comment: Nimi Desktop updater public key';

function decodeBase64Strict(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

function isRawMinisignPublicKey(value) {
  const decoded = decodeBase64Strict(value);
  if (!decoded || decoded.length !== RAW_MINISIGN_PUBLIC_KEY_BYTES) {
    return false;
  }
  return decoded[0] === 0x45 && (decoded[1] === 0x64 || decoded[1] === 0x44);
}

function normalizeNewlines(value) {
  const raw = String(value || '').trim();
  return raw.includes('\\n') && !raw.includes('\n') ? raw.replaceAll('\\n', '\n') : raw;
}

function parseMinisignPublicKeyText(value) {
  const lines = normalizeNewlines(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return null;
  }

  const comment = lines[0];
  const publicKey = lines[1];
  if (!comment || !isRawMinisignPublicKey(publicKey)) {
    return null;
  }
  return { comment, publicKey };
}

function encodeMinisignPublicKeyText({ comment, publicKey }) {
  return Buffer.from(`${comment}\n${publicKey}\n`, 'utf8').toString('base64');
}

export function normalizeDesktopUpdaterPublicKey(input) {
  const raw = normalizeNewlines(input);
  if (!raw) {
    throw new Error('NIMI_DESKTOP_UPDATER_PUBLIC_KEY is required');
  }

  const literalKey = parseMinisignPublicKeyText(raw);
  if (literalKey) {
    return encodeMinisignPublicKeyText(literalKey);
  }

  const decoded = decodeBase64Strict(raw);
  if (decoded) {
    const decodedText = decoded.toString('utf8');
    const encodedKey = parseMinisignPublicKeyText(decodedText);
    if (encodedKey) {
      return encodeMinisignPublicKeyText(encodedKey);
    }
  }

  if (isRawMinisignPublicKey(raw)) {
    return encodeMinisignPublicKeyText({
      comment: DEFAULT_UNTRUSTED_COMMENT,
      publicKey: raw,
    });
  }

  throw new Error(
    'NIMI_DESKTOP_UPDATER_PUBLIC_KEY must be a minisign public key line, a minisign.pub two-line text, or base64-encoded minisign.pub text',
  );
}

