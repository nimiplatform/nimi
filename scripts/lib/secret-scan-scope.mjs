export const generatedSecretScanExcludes = [
  {
    label: 'runtime Go protobuf stubs',
    pattern: /^runtime\/gen\/runtime\/v1\/[^/]+(?:_grpc)?\.pb\.go$/u,
    source: 'proto/runtime/v1/*.proto',
    driftGate: 'pnpm proto:drift-check',
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
    label: 'Platform app catalog projections',
    pattern: /^(?:kit\/shell\/capabilities\/src\/platform-projection\.ts|kit\/shell\/tauri\/src\/platform_catalog\/nimi_app_registry\.rs|sdks\/typescript\/core\/app\/platform-catalog\.generated\.ts)$/u,
    source: '.nimi/spec/platform/kernel/tables/nimi-app-{registry,release-descriptors}.yaml',
    driftGate: 'pnpm check:platform-catalog-drift',
  },
];

export function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//u, '');
}

export function generatedSecretScanExclusion(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return generatedSecretScanExcludes.find((entry) => entry.pattern.test(normalized)) || null;
}

export function isGeneratedSecretScanExcluded(filePath) {
  return generatedSecretScanExclusion(filePath) !== null;
}

export function filterSecretScanFiles(files) {
  const scanned = [];
  const excluded = [];
  for (const file of files) {
    const normalized = normalizeRepoPath(file);
    const exclusion = generatedSecretScanExclusion(normalized);
    if (exclusion) {
      excluded.push({ file: normalized, exclusion });
      continue;
    }
    scanned.push(normalized);
  }
  return { scanned, excluded };
}

export function generatedArtifactBaselineEntries(baseline) {
  const results = baseline?.results;
  if (!results || typeof results !== 'object') return [];

  return Object.keys(results)
    .map(normalizeRepoPath)
    .filter(isGeneratedSecretScanExcluded)
    .sort();
}
