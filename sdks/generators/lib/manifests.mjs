import path from 'node:path';
import YAML from 'yaml';
import { generatedBy, languages, readText, readYaml, relPath, repoRoot, writeJson } from './context.mjs';

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
const DEFAULT_ERROR_CODES_SOURCE_PATH = 'config/sdks-error-codes.yaml';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNoHandMaintainedValues(sourcePath, visiting = new Set()) {
  const normalized = sourcePath.replaceAll('\\', '/');
  if (visiting.has(normalized)) {
    throw new Error(`${normalized} contains a circular fragment reference`);
  }
  visiting.add(normalized);
  try {
    const raw = YAML.parse(readText(normalized));
    if (!isRecord(raw)) {
      throw new Error(`${normalized} must be a YAML mapping`);
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'values')) {
      throw new Error(`${normalized} must not declare hand-maintained values; values are derived from codes`);
    }
    if (!isRecord(raw.fragments)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(raw.fragments, 'values')) {
      throw new Error(`${normalized} must not declare hand-maintained values fragments; values are derived from codes`);
    }
    if (!Object.prototype.hasOwnProperty.call(raw.fragments, 'codes')) {
      return;
    }
    const refs = Array.isArray(raw.fragments.codes) ? raw.fragments.codes : [raw.fragments.codes];
    const baseDir = path.dirname(path.join(repoRoot, normalized));
    for (const ref of refs) {
      const relativeRef = String(ref || '').trim();
      if (!relativeRef) {
        throw new Error(`empty fragment reference for codes in ${normalized}`);
      }
      const fragmentRel = relPath(path.resolve(baseDir, relativeRef));
      assertNoHandMaintainedValues(fragmentRel, visiting);
    }
  } finally {
    visiting.delete(normalized);
  }
}

export function buildErrorCodesManifest(table, sourcePath = DEFAULT_ERROR_CODES_SOURCE_PATH) {
  const normalized = sourcePath.replaceAll('\\', '/');
  if (!isRecord(table)) {
    throw new Error(`${normalized} must resolve to a YAML mapping`);
  }
  if (Object.prototype.hasOwnProperty.call(table, 'values')) {
    throw new Error(`${normalized} must not declare hand-maintained values; values are derived from codes`);
  }
  const codes = Array.isArray(table.codes) ? table.codes : [];
  const values = assertClosedErrorCodeRows(codes, normalized);
  return {
    contract: 'nimi.sdks.error-codes-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'sdks_spec_table',
    source_paths: [normalized],
    values,
    codes,
  };
}

export function extractErrorCodes(sourcePath = DEFAULT_ERROR_CODES_SOURCE_PATH) {
  assertNoHandMaintainedValues(sourcePath);
  const table = readYaml(sourcePath);
  return buildErrorCodesManifest(table, sourcePath);
}

function assertClosedErrorCodeRows(codes, sourcePath) {
  if (codes.length === 0) {
    throw new Error(`${sourcePath} must declare non-empty codes`);
  }
  const values = [];
  const seen = new Set();
  for (const [index, entry] of codes.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`${sourcePath} codes[${index}] must be a mapping`);
    }
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!ERROR_CODE_PATTERN.test(name)) {
      throw new Error(`${sourcePath} codes entry is not UPPER_SNAKE_CASE: ${name || '<empty>'}`);
    }
    if (seen.has(name)) {
      throw new Error(`${sourcePath} duplicate codes entry: ${name}`);
    }
    const family = typeof entry.family === 'string' ? entry.family : '';
    if (!ERROR_CODE_PATTERN.test(family)) {
      throw new Error(`${sourcePath} codes entry ${name} has invalid family: ${family || '<empty>'}`);
    }
    const sourceRule = typeof entry.source_rule === 'string' ? entry.source_rule.trim() : '';
    if (!sourceRule) {
      throw new Error(`${sourcePath} codes entry ${name} is missing source_rule`);
    }
    if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.trim().length === 0)) {
      throw new Error(`${sourcePath} codes entry ${name} has invalid note`);
    }
    seen.add(name);
    values.push(name);
  }
  return values;
}

export function buildExportManifest(runtime, realm, errorCodes) {
  return {
    contract: 'nimi.sdks.export-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'sdks_generator_projection',
    source_paths: [
      ...runtime.source_paths,
      ...realm.source_paths,
      ...errorCodes.source_paths,
    ],
    languages,
    core_families: ['runtime', 'realm', 'types'],
    excluded_derivative_surfaces: [
      'ai-provider',
      'world',
      'app',
      'permission',
      'ai-config',
      'runtime-route',
      'local-environment',
      'external-framework-adapters',
    ],
    no_forwarding_shims: true,
  };
}

export function writeSharedArtifacts(runtime, realm, errorCodes, exportsManifest) {
  writeJson('sdks/generators/shared/generated/runtime-core.manifest.json', runtime);
  writeJson('sdks/generators/shared/generated/realm-core.manifest.json', realm);
  writeJson('sdks/generators/shared/generated/error-codes.manifest.json', errorCodes);
  writeJson('sdks/generators/shared/generated/export-manifest.json', exportsManifest);
}

export function languageGeneratedDir(language) {
  if (language !== 'typescript') {
    throw new Error(`unsupported SDK language: ${language}`);
  }
  return 'sdks/typescript/core-generated';
}
