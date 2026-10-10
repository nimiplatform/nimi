export const PRODUCT_UPDATE_POLICY: Readonly<{
  channel: 'beta' | 'stable'; endpoint: string; repository: string; publicKey: string | null;
  macOSTeamId: string; checkIntervalMs: number; requestTimeoutMs: number;
  downloadTimeoutMs: number; maximumMetadataBytes: number; maximumAssetBytes: number;
}>;
