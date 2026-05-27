export type RuntimeBridgeConfigDefaults = Readonly<{
  schemaVersion: number;
  grpcAddr: string;
  httpAddr: string;
}>;

// Mirrors .nimi/spec/runtime/kernel/tables/config-schema.yaml for the host bridge fields
// Desktop still edits a local bridge config file, but the default values are Runtime-owned.
export const RUNTIME_BRIDGE_CONFIG_DEFAULTS = {
  schemaVersion: 1,
  grpcAddr: '127.0.0.1:46371',
  httpAddr: '127.0.0.1:46372',
} as const satisfies RuntimeBridgeConfigDefaults;
