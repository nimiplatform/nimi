// Platform-owned build input. No environment, renderer or App overrides.
export const PRODUCT_UPDATE_POLICY = Object.freeze({
  channel: 'beta',
  endpoint: 'https://install.nimi.ai/nimi',
  repository: 'nimiplatform/nimi',
  // Admission requires the actual release signing public key. Empty trust
  // cannot validate a candidate; never generate a development replacement.
  publicKey: null,
  macOSTeamId: 'RMZJPQQR3X',
  checkIntervalMs: 6 * 60 * 60 * 1000,
  requestTimeoutMs: 30_000,
  downloadTimeoutMs: 30 * 60 * 1000,
  maximumMetadataBytes: 64 * 1024,
  maximumAssetBytes: 4 * 1024 * 1024 * 1024,
});
