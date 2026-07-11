export class EvidenceValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EvidenceValidationError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new EvidenceValidationError(code, message);
}

function sourceText(source) {
  if (Buffer.isBuffer(source)) return source.toString('utf8');
  if (Buffer.isBuffer(source?.bytes)) return source.bytes.toString('utf8');
  fail('INVALID_FIELD', 'validator received an unread packet artifact');
}

export function readJsonFile(source, label) {
  try {
    return JSON.parse(sourceText(source));
  } catch {
    fail('INVALID_JSON', `${label} is not valid JSON`);
  }
}

export function readJsonLines(source) {
  const records = [];
  const lines = sourceText(source).split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      fail('INVALID_JSON', `JSONL record ${index + 1} is not valid JSON`);
    }
  }
  return records;
}

export function assertExactObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_FIELD', `${label} must be an object`);
  }
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${label} contains unknown field ${key}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail('MISSING_FIELD', `${label} is missing required field ${field}`);
    }
  }
}

export function assertSchemaVersion(value, expected, label) {
  if (value?.schema_version !== expected) {
    fail('SCHEMA_VERSION_MISMATCH', `${label} schema version must equal ${expected}`);
  }
}

export function assertArtifactRef(contract, value, label) {
  assertExactObject(value, contract.object_schemas.artifact_ref.required_fields, label);
  if (typeof value.path !== 'string' || value.path.length === 0) {
    fail('INVALID_FIELD', `${label}.path must be a non-empty packet-relative path`);
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    fail('ARTIFACT_HASH_MISSING', `${label}.sha256 must be a lowercase SHA-256`);
  }
}
