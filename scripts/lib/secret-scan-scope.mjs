export const secretScanExcludes = [
  {
    label: 'runtime Go protobuf stubs',
    pattern: /^runtime\/gen\/runtime\/v1\/[^/]+(?:_grpc)?\.pb\.go$/u,
    source: 'proto/runtime/v1/*.proto',
    driftGate: 'pnpm proto:drift-check',
  },
  {
    label: 'Realm source-materialization OpenAPI projection',
    pattern: /^runtime\/gen\/realm\/v1\/source_materialization_openapi\.go$/u,
    source: 'config/realm-openapi/api-nimi.yaml and config/realm-private-operation-carriers.yaml',
    driftGate: 'pnpm check:sdks-generators',
  },
  {
    label: 'SDK vNext TypeScript protobuf stubs',
    pattern: /^sdks\/typescript\/core-generated\/runtime-protobuf\/(?:google\/protobuf|runtime\/v1)\/[^/]+\.ts$/u,
    source: 'proto/runtime/v1/*.proto and imported protobuf well-known types',
    driftGate: 'pnpm proto:drift-check',
  },
  {
    label: 'native OAuth result logo data module',
    pattern: /^kit\/auth\/src\/logic\/native-oauth-result-logo\.ts$/u,
    source: 'kit/auth/src/logic/native-oauth-result-logo.png',
    driftGate: 'pnpm --filter @nimiplatform/kit test -- native-oauth-result-page.test.ts',
  },
  {
    label: 'Platform AI profile catalog projection',
    pattern: /^sdks\/typescript\/core\/app\/ai-profile-factory\.generated\.ts$/u,
    source: 'config/platform-ai-profile-factory-catalog.yaml',
    driftGate: 'pnpm check:platform-catalog-drift',
  },
  {
    label: 'Runtime provider catalog projection',
    pattern: /^runtime\/catalog\/providers\/[^/]+\.yaml$/u,
    source: 'runtime/catalog/source/providers/**/*.source.yaml and runtime/catalog/source/providers/local/*.yaml',
    driftGate: 'pnpm check:runtime-catalog-drift',
  },
  {
    label: 'managed image backend package projection',
    pattern: /^runtime\/internal\/engine\/generated\/managed-image-backend-packages\.yaml$/u,
    source: 'config/runtime-managed-image-backend-packages.yaml',
    driftGate: 'pnpm check:managed-image-backend-package-drift',
  },
  {
    label: 'signed source-materialization v3 reference vectors',
    pattern: /^runtime\/internal\/services\/runtimeagent\/testdata\/source-materialization-v3\/(?:persona-character|world-character)\.json$/u,
    source: 'public signed source-materialization v3 conformance vectors',
    driftGate: 'go test ./internal/services/runtimeagent',
  },
];

export function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//u, '');
}

export function secretScanExclusion(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return secretScanExcludes.find((entry) => entry.pattern.test(normalized)) || null;
}

export function isSecretScanExcluded(filePath) {
  return secretScanExclusion(filePath) !== null;
}

export function filterSecretScanFiles(files) {
  const scanned = [];
  const excluded = [];
  for (const file of files) {
    const normalized = normalizeRepoPath(file);
    const exclusion = secretScanExclusion(normalized);
    if (exclusion) {
      excluded.push({ file: normalized, exclusion });
      continue;
    }
    scanned.push(normalized);
  }
  return { scanned, excluded };
}

export function excludedArtifactBaselineEntries(baseline) {
  const results = baseline?.results;
  if (!results || typeof results !== 'object') return [];

  return Object.keys(results)
    .map(normalizeRepoPath)
    .filter(isSecretScanExcluded)
    .sort();
}
