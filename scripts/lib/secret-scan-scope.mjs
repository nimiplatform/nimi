export const generatedProtocolSecretScanExcludes = [
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
];

export function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//u, '');
}

export function generatedProtocolSecretScanExclusion(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return generatedProtocolSecretScanExcludes.find((entry) => entry.pattern.test(normalized)) || null;
}

export function isGeneratedProtocolSecretScanExcluded(filePath) {
  return generatedProtocolSecretScanExclusion(filePath) !== null;
}

export function filterSecretScanFiles(files) {
  const scanned = [];
  const excluded = [];
  for (const file of files) {
    const normalized = normalizeRepoPath(file);
    const exclusion = generatedProtocolSecretScanExclusion(normalized);
    if (exclusion) {
      excluded.push({ file: normalized, exclusion });
      continue;
    }
    scanned.push(normalized);
  }
  return { scanned, excluded };
}

export function generatedProtocolBaselineEntries(baseline) {
  const results = baseline?.results;
  if (!results || typeof results !== 'object') return [];

  return Object.keys(results)
    .map(normalizeRepoPath)
    .filter(isGeneratedProtocolSecretScanExcluded)
    .sort();
}
