import { generatedBy, languages, readYaml, writeJson } from './context.mjs';

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

export function extractErrorCodes() {
  const table = readYaml('config/sdks-error-codes.yaml');
  const values = Array.isArray(table?.values) ? table.values.map(String) : [];
  const codes = Array.isArray(table?.codes) ? table.codes : [];
  const codeNames = codes.map((entry) => String(entry?.name ?? ''));
  assertClosedErrorCodeTable(values, codeNames);
  return {
    contract: 'nimi.sdks.error-codes-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'sdks_spec_table',
    source_paths: ['config/sdks-error-codes.yaml'],
    values,
    codes,
  };
}

function assertClosedErrorCodeTable(values, codeNames) {
  if (values.length === 0 || codeNames.length === 0) {
    throw new Error('config/sdks-error-codes.yaml must declare non-empty values and codes');
  }
  for (const [label, entries] of [['values', values], ['codes', codeNames]]) {
    const seen = new Set();
    for (const entry of entries) {
      if (!ERROR_CODE_PATTERN.test(entry)) {
        throw new Error(`config/sdks-error-codes.yaml ${label} entry is not UPPER_SNAKE_CASE: ${entry || '<empty>'}`);
      }
      if (seen.has(entry)) {
        throw new Error(`config/sdks-error-codes.yaml duplicate ${label} entry: ${entry}`);
      }
      seen.add(entry);
    }
  }
  const valueSet = new Set(values);
  const codeNameSet = new Set(codeNames);
  const missingRows = values.filter((value) => !codeNameSet.has(value));
  const missingValues = codeNames.filter((name) => !valueSet.has(name));
  if (missingRows.length > 0 || missingValues.length > 0) {
    throw new Error(
      `config/sdks-error-codes.yaml values/codes mismatch: missing rows=${missingRows.join(',') || '<none>'}; missing values=${missingValues.join(',') || '<none>'}`,
    );
  }
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
  if (language === 'go') return 'sdks/go/coregenerated';
  return `sdks/${language}/${language === 'typescript' ? 'core-generated' : 'core_generated'}`;
}
