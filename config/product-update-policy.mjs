// Platform-owned build input. No environment, renderer or App overrides.
export const PRODUCT_UPDATE_POLICY = Object.freeze({
  channel: 'beta',
  endpoint: 'https://install.nimi.ai/nimi',
  repository: 'nimiplatform/nimi',
  // Platform-approved raw Ed25519 release signing public key.
  publicKey: 'hcbaPfpofg03H/qVizlO0n2N3owg2VyDj+dD83IuWQI=', // pragma: allowlist secret (public verification key)
  macOSTeamId: 'RMZJPQQR3X',
  checkIntervalMs: 6 * 60 * 60 * 1000,
  requestTimeoutMs: 30_000,
  downloadTimeoutMs: 30 * 60 * 1000,
  maximumMetadataBytes: 64 * 1024,
  maximumAssetBytes: 4 * 1024 * 1024 * 1024,
});
