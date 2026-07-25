import { generatedBy, languages, readYaml, writeJson } from './context.mjs';

export function extractErrorCodes() {
  const table = readYaml('config/sdks-error-codes.yaml');
  return {
    contract: 'nimi.sdks.error-codes-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'sdks_spec_table',
    source_paths: ['config/sdks-error-codes.yaml'],
    provenance: {
      source_rule: 'S-SURFACE-019',
    },
    values: table.values || [],
    codes: table.codes || [],
  };
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
      '.nimi/spec/sdks/client-core.authority.yaml',
    ],
    provenance: {
      source_rule: 'rule.nimi.sdks.client-core.r063',
    },
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
