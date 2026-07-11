import path from 'node:path';
import { TextDecoder } from 'node:util';
import { inflateSync } from 'node:zlib';

import {
  assertExactObject,
  assertSchemaVersion,
  fail,
  readJsonFile,
} from './third-party-hardcut-evidence-core.mjs';

const PROHIBITED_PATTERNS = [
  ['credential_header', /\b(?:authorization|cookie|set-cookie)\s*[:=]\s*(?:bearer|basic)?\s*[^\s"']+/iu],
  ['credential_field', /"(?:access_token|refresh_token|token|ticket|secret|session_secret|launch_ticket|protected_access_secret|signed_url|object_key|password|api_key|authorization|cookie|headers?)"\s*:/iu],
  ['signed_url', /https?:\/\/[^\s"']+[?&](?:x-amz-signature|signature|sig|token)=/iu],
  ['private_windows_path', /(?:^|[\s"'])(?:[a-z]:[\\/]|\\\\)[^\s"']+/imu],
  ['private_posix_path', /(?:^|[\s"'])\/(?:Users|home|root|private|tmp|var)\/[^\s"']+/mu],
  ['raw_content_field', /"(?:content|body|bytes|media_data|media_base64|raw_response|local_path|file_path)"\s*:/iu],
  ['embedded_content', /\bdata:(?:image|audio|video)\/[^;,]+[;,]/iu],
  ['encoded_content', /(?:^|[^A-Za-z0-9+/])(?:[A-Za-z0-9+/]{128,}={0,2})(?:$|[^A-Za-z0-9+/])/mu],
  ['jwt_material', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}\b/u],
  ['private_key', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u],
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function printableRatio(text) {
  if (text.length === 0) return 1;
  let printable = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (character === '\n' || character === '\r' || character === '\t' || codePoint >= 0x20) {
      printable += 1;
    }
  }
  return printable / [...text].length;
}

function decodeUtf8(bytes) {
  try {
    const decoded = UTF8_DECODER.decode(bytes);
    return printableRatio(decoded) >= 0.85 ? decoded : null;
  } catch {
    return null;
  }
}

function decodeUtf16(bytes, offset, bigEndian) {
  const available = bytes.length - offset;
  const byteLength = available - (available % 2);
  if (byteLength < 8) return null;
  const candidate = bytes.subarray(offset, offset + byteLength);
  let expectedZeroBytes = 0;
  for (let index = bigEndian ? 0 : 1; index < candidate.length; index += 2) {
    if (candidate[index] === 0) expectedZeroBytes += 1;
  }
  if (expectedZeroBytes / (candidate.length / 2) < 0.2) return null;
  const normalized = bigEndian ? Buffer.from(candidate).swap16() : candidate;
  const decoded = normalized.toString('utf16le').replace(/^\uFEFF/u, '');
  return printableRatio(decoded) >= 0.85 ? decoded : null;
}

function decodeRecognizedText(bytes) {
  const decoded = [];
  const add = (value) => {
    if (value !== null && !decoded.includes(value)) decoded.push(value);
  };
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    add(decodeUtf8(bytes.subarray(3)));
  } else {
    add(decodeUtf8(bytes));
  }
  for (const offset of [0, 1]) {
    add(decodeUtf16(bytes, offset, false));
    add(decodeUtf16(bytes, offset, true));
  }
  if (decoded.length === 0) {
    fail('TEXT_ENCODING_UNSUPPORTED', 'text artifact encoding is not recognized');
  }
  return decoded;
}

function buildExactCanaryBytes(literals) {
  const encodings = [];
  const seen = new Set();
  for (const literal of literals) {
    const utf8 = Buffer.from(literal, 'utf8');
    const utf16le = Buffer.from(literal, 'utf16le');
    for (const candidate of [utf8, utf16le, Buffer.from(utf16le).swap16()]) {
      const key = candidate.toString('hex');
      if (!seen.has(key)) {
        encodings.push(candidate);
        seen.add(key);
      }
    }
  }
  return encodings;
}

function parseInternationalText(data, maxTextBytes) {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 0 || keywordEnd + 5 > data.length) return null;
  const compressionFlag = data[keywordEnd + 1];
  const compressionMethod = data[keywordEnd + 2];
  if (![0, 1].includes(compressionFlag) || compressionMethod !== 0) return null;
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  if (languageEnd < 0) return null;
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd < 0) return null;
  const payload = data.subarray(translatedEnd + 1);
  let textBytes;
  try {
    textBytes = compressionFlag === 1 && compressionMethod === 0
      ? inflateSync(payload, { maxOutputLength: maxTextBytes })
      : payload;
  } catch {
    return null;
  }
  const translatedKeyword = decodeUtf8(data.subarray(languageEnd + 1, translatedEnd));
  const text = decodeUtf8(textBytes);
  if (translatedKeyword === null || text === null) return null;
  return [
    data.toString('latin1', 0, keywordEnd),
    data.toString('ascii', keywordEnd + 3, languageEnd),
    translatedKeyword,
    text,
  ].join('\n');
}

function extractPngTextRegions(bytes, allowedChunks, maxTextBytes) {
  if (bytes.length < 20 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return [];
  const regions = [];
  let decodedBytes = 0;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) break;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (allowedChunks.has(type)) {
      let decoded = null;
      if (type === 'tEXt') {
        decoded = data.toString('latin1');
      } else if (type === 'zTXt') {
        const keywordEnd = data.indexOf(0);
        if (keywordEnd >= 0 && data[keywordEnd + 1] === 0) {
          try {
            decoded = `${data.toString('latin1', 0, keywordEnd)}\n${inflateSync(
              data.subarray(keywordEnd + 2),
              { maxOutputLength: maxTextBytes },
            ).toString('latin1')}`;
          } catch {
            decoded = null;
          }
        }
      } else if (type === 'iTXt') {
        decoded = parseInternationalText(data, maxTextBytes);
      }
      if (decoded === null) {
        fail('PNG_TEXT_METADATA_INVALID', 'PNG text metadata is malformed or unsupported');
      }
      decodedBytes += Buffer.byteLength(decoded, 'utf8');
      if (decodedBytes > maxTextBytes) {
        fail('TEXT_SCAN_TOO_LARGE', 'PNG text metadata exceeds the canonical scan limit');
      }
      regions.push(decoded);
    }
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  return regions;
}

function rejectTextPatterns(regions, exactLiterals = []) {
  for (const text of regions) {
    if (exactLiterals.some((literal) => text.includes(literal))) {
      fail('PROHIBITED_PACKET_MATERIAL', 'synthetic decoded canary detected');
    }
    for (const [, pattern] of PROHIBITED_PATTERNS) {
      if (pattern.test(text)) {
        fail('PROHIBITED_PACKET_MATERIAL', 'prohibited byte sequence detected');
      }
    }
  }
}

function createPrivacySink(metadata, configuration) {
  const {
    canaryBytes,
    canaryLiterals,
    maxCanaryBytes,
    maxTextBytes,
    pngTextChunks,
    textExtensions,
  } = configuration;
  const extension = path.extname(metadata.relativePath).toLowerCase();
  const recognizedText = textExtensions.has(extension);
  const chunks = [];
  let formatPrefix = Buffer.alloc(0);
  let isPng = recognizedText ? false : null;
  let tail = Buffer.alloc(0);
  return {
    write(chunk) {
      const window = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
      if (canaryBytes.some((canary) => window.indexOf(canary) >= 0)) {
        fail('PROHIBITED_PACKET_MATERIAL', 'synthetic binary canary detected');
      }
      const tailLength = Math.min(Math.max(maxCanaryBytes - 1, 0), window.length);
      tail = Buffer.from(window.subarray(window.length - tailLength));
      if (recognizedText || isPng === true) {
        chunks.push(Buffer.from(chunk));
        return;
      }
      if (isPng === false) return;
      if (formatPrefix.length + chunk.length < PNG_SIGNATURE.length) {
        formatPrefix = Buffer.concat([formatPrefix, chunk]);
        return;
      }
      const requiredBytes = PNG_SIGNATURE.length - formatPrefix.length;
      const signature = formatPrefix.length === 0
        ? chunk.subarray(0, PNG_SIGNATURE.length)
        : Buffer.concat([formatPrefix, chunk.subarray(0, requiredBytes)]);
      isPng = signature.equals(PNG_SIGNATURE);
      if (isPng) {
        if (formatPrefix.length > 0) chunks.push(formatPrefix);
        chunks.push(Buffer.from(chunk));
      }
      formatPrefix = Buffer.alloc(0);
    },
    end() {
      if (!recognizedText && isPng !== true) return;
      const bytes = Buffer.concat(chunks, metadata.size);
      if (recognizedText) {
        rejectTextPatterns(decodeRecognizedText(bytes));
      } else {
        rejectTextPatterns(
          extractPngTextRegions(bytes, pngTextChunks, maxTextBytes),
          canaryLiterals,
        );
      }
    },
  };
}

export function rejectProhibitedPacketMaterial(artifactStore, policy, resourcePolicy) {
  const textExtensions = new Set(policy.text_extensions);
  const pngTextChunks = new Set(policy.png_text_chunks);
  const canaryBytes = buildExactCanaryBytes(policy.synthetic_canary_literals);
  const maxCanaryBytes = Math.max(...canaryBytes.map((canary) => canary.length));
  artifactStore.scanAll((metadata) => createPrivacySink(metadata, {
    canaryBytes,
    canaryLiterals: policy.synthetic_canary_literals,
    maxCanaryBytes,
    maxTextBytes: resourcePolicy.max_text_scan_bytes,
    pngTextChunks,
    textExtensions,
  }));
}

export function rejectStructuredLeakFindings(reportPath) {
  const report = readJsonFile(reportPath, 'leak report');
  for (const probe of report.probes ?? []) {
    for (const surface of probe.surfaces ?? []) {
      if (Number.isInteger(surface.finding_count) && surface.finding_count > 0) {
        fail(
          'LEAK_FINDING_PRESENT',
          `leak probe ${probe.material_class} found prohibited material on ${surface.surface}`,
        );
      }
    }
  }
}

export function validateStructuredLeakReport(contract, reportPath) {
  const report = readJsonFile(reportPath, 'leak report');
  assertExactObject(report, contract.object_schemas.leak_report.required_fields, 'leak report');
  assertSchemaVersion(report, contract.version, 'leak report');
  if (!Array.isArray(report.probes)) {
    fail('LEAK_PROBE_INVALID', 'leak report probes must be an array');
  }
  const materialClasses = contract.prohibited_material_registry.classes;
  const knownMaterials = new Set(materialClasses);
  const observedMaterials = new Set();
  for (const probe of report.probes ?? []) {
    assertExactObject(
      probe,
      contract.object_schemas.leak_probe.required_fields,
      `leak probe ${probe.material_class ?? '<unknown>'}`,
    );
    if (!knownMaterials.has(probe.material_class)) {
      fail('UNKNOWN_MATERIAL_CLASS', `unknown leak-probe material class ${probe.material_class}`);
    }
    if (observedMaterials.has(probe.material_class)) {
      fail('DUPLICATE_MATERIAL_CLASS', `duplicate leak-probe material class ${probe.material_class}`);
    }
    observedMaterials.add(probe.material_class);
    if (!/^[a-f0-9]{64}$/u.test(probe.canary_sha256 ?? '')) {
      fail('LEAK_PROBE_INVALID', `leak probe ${probe.material_class} must retain only a canary SHA-256`);
    }
    if (!Array.isArray(probe.surfaces) || probe.surfaces.length === 0) {
      fail('LEAK_PROBE_INVALID', `leak probe ${probe.material_class} has no inspected surfaces`);
    }
    for (const surface of probe.surfaces) {
      assertExactObject(
        surface,
        contract.object_schemas.leak_surface.required_fields,
        `leak probe ${probe.material_class} surface`,
      );
      if (
        typeof surface.surface !== 'string'
        || surface.surface.length === 0
        || !Array.isArray(surface.redacted_locations)
        || surface.redacted_locations.some((location) => typeof location !== 'string')
      ) {
        fail('LEAK_PROBE_INVALID', `leak probe ${probe.material_class} has invalid surface metadata`);
      }
      if (!Number.isInteger(surface.finding_count) || surface.finding_count < 0) {
        fail('LEAK_PROBE_INVALID', `leak probe ${probe.material_class} has an invalid finding count`);
      }
      if (surface.finding_count > 0) {
        fail(
          'LEAK_FINDING_PRESENT',
          `leak probe ${probe.material_class} found prohibited material on ${surface.surface}`,
        );
      }
    }
  }
  const missing = materialClasses.filter((item) => !observedMaterials.has(item));
  if (missing.length > 0) {
    fail('LEAK_PROBE_COVERAGE_MISSING', `leak report omits ${missing.length} required material classes`);
  }
}
